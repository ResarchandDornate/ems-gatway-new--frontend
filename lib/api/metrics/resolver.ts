/**
 * Metric resolver — reads canonical metrics out of a source payload using a
 * Profile. Pure functions, no fetching: the caller fetches the payload however
 * the source demands (REST, WebSocket frame, mock) and hands it here.
 *
 *   const r = readMetric(KINETICS_PROFILE, payload, "bank.voltage", { bank: "bms_bank_1" });
 *   r => { metric: "bank.voltage", value: 748.2, unit: "V", status: "ok" }
 *
 * Guarantees:
 *   - Absent data is `null` + status, never 0. No fabricated values.
 *   - Scale/transform run only on real numbers.
 *   - Derived bindings compose canonical metrics, with cycle protection.
 */

import { METRICS, isMetricId } from "./registry";
import type {
  Profile, Binding, ReadContext, Reading, ArrayReading, FieldBinding,
} from "./types";

// ── Path resolution ──────────────────────────────────────────────────────────

/** Substitute `{placeholder}` segments from the read context. */
function fillPath(template: string, ctx: ReadContext): string {
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    ctx[name] !== undefined ? String(ctx[name]) : `{${name}}`
  );
}

/** Walk a dot path through an object tree. Returns undefined on any miss. */
function walk(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/**
 * Resolve a path against the payload per the profile's shape.
 * "flat" treats the whole path as one key; "nested" walks the tree, and if the
 * leaf is a point object ({ value, raw, quality, ... }) unwraps `.value`.
 */
function resolvePath(profile: Profile, payload: unknown, path: string, ctx: ReadContext): unknown {
  const filled = fillPath(path, ctx);
  if (filled.includes("{")) return undefined; // unfilled placeholder — missing context

  if (profile.shape === "flat") {
    return payload != null && typeof payload === "object"
      ? (payload as Record<string, unknown>)[filled]
      : undefined;
  }

  let v = walk(payload, filled);
  // Kinetics point envelope: assets.{id}.telemetry.{key} -> { value, raw, quality }
  if (v != null && typeof v === "object" && "value" in (v as object)) {
    v = (v as { value: unknown }).value;
  }
  return v;
}

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

function applyScaling(b: FieldBinding, raw: number): number {
  let v = raw;
  if (b.scale !== undefined) v = v * b.scale;
  if (b.transform) v = b.transform(v);
  return v;
}

// ── Scalar read ──────────────────────────────────────────────────────────────

export function readMetric(
  profile: Profile,
  payload: unknown,
  metric: string,
  ctx: ReadContext = {},
  _seen: Set<string> = new Set()
): Reading {
  if (!isMetricId(metric)) {
    return { metric, value: null, unit: "", status: "unknown", reason: `"${metric}" is not in the metric registry` };
  }
  const spec = METRICS[metric];
  const binding: Binding | undefined = profile.bindings[metric];

  if (!binding) {
    return { metric, value: null, unit: spec.unit, status: "unmapped", reason: `profile "${profile.id}" has no binding` };
  }

  switch (binding.kind) {
    case "unmapped":
      return { metric, value: null, unit: spec.unit, status: "unmapped", reason: binding.reason };

    case "field": {
      let raw = toNumber(resolvePath(profile, payload, binding.path, ctx));
      if (raw == null && binding.fallbacks) {
        for (const fb of binding.fallbacks) {
          raw = toNumber(resolvePath(profile, payload, fb, ctx));
          if (raw != null) break;
        }
      }
      if (raw == null) return { metric, value: null, unit: spec.unit, status: "absent" };
      return { metric, value: applyScaling(binding, raw), unit: spec.unit, status: "ok" };
    }

    case "derived": {
      if (_seen.has(metric)) {
        return { metric, value: null, unit: spec.unit, status: "unmapped", reason: `circular derivation via "${metric}"` };
      }
      const seen = new Set(_seen).add(metric);
      const inputs = binding.from.map((m) => readMetric(profile, payload, m, ctx, seen).value);
      const value = binding.compute(inputs);
      return value == null
        ? { metric, value: null, unit: spec.unit, status: "absent" }
        : { metric, value, unit: spec.unit, status: "ok" };
    }

    case "array": {
      // A scalar read of an array metric returns null — use readMetricArray.
      return { metric, value: null, unit: spec.unit, status: "unmapped", reason: "array metric — use readMetricArray()" };
    }
  }
}

// ── Array read ───────────────────────────────────────────────────────────────

export function readMetricArray(
  profile: Profile,
  payload: unknown,
  metric: string,
  ctx: ReadContext = {}
): ArrayReading {
  if (!isMetricId(metric)) {
    return { metric, values: [], unit: "", status: "unknown", reason: `"${metric}" is not in the metric registry` };
  }
  const spec = METRICS[metric];
  const binding = profile.bindings[metric];

  if (!binding) {
    return { metric, values: [], unit: spec.unit, status: "unmapped", reason: `profile "${profile.id}" has no binding` };
  }
  if (binding.kind === "unmapped") {
    return { metric, values: [], unit: spec.unit, status: "unmapped", reason: binding.reason };
  }
  if (binding.kind !== "array") {
    return { metric, values: [], unit: spec.unit, status: "unmapped", reason: "scalar binding — use readMetric()" };
  }

  const scale = (n: number | null) => (n == null ? null : binding.scale !== undefined ? n * binding.scale : n);

  // Expansion mode: N discrete keys gathered into one array (UGX cel_volt_N).
  // `{n}` is the position within the block; any other placeholder (`{rack}`)
  // is filled from ctx by resolvePath, so one binding serves every rack.
  if (binding.expand) {
    const values: (number | null)[] = [];
    for (let i = 1; i <= binding.expand.count; i++) {
      const key = binding.expand.keyTemplate.replace("{n}", String(i));
      values.push(scale(toNumber(resolvePath(profile, payload, key, ctx))));
    }
    // Drop the padded tail so the array length is the sensor count, not the
    // register span. Trimming only the tail keeps a genuine mid-block zero (a
    // failed sensor) visible instead of silently shortening the pack.
    if (binding.zeroPadded) {
      let end = values.length;
      while (end > 0 && (values[end - 1] == null || values[end - 1] === 0)) end--;
      values.length = end;
    }
    const any = values.some((v) => v != null);
    return { metric, values, unit: spec.unit, status: any ? "ok" : "absent" };
  }

  // Native array point (Kinetics vcell/tcell).
  const v = resolvePath(profile, payload, binding.path, ctx);
  if (!Array.isArray(v)) return { metric, values: [], unit: spec.unit, status: "absent" };
  const values = v.map((x) => scale(toNumber(x)));
  return { metric, values, unit: spec.unit, status: values.some((x) => x != null) ? "ok" : "absent" };
}

// ── Bulk read + audit ────────────────────────────────────────────────────────

/** Read many scalar metrics at once. */
export function readMetrics(
  profile: Profile,
  payload: unknown,
  metrics: string[],
  ctx: ReadContext = {}
): Record<string, Reading> {
  const out: Record<string, Reading> = {};
  for (const m of metrics) out[m] = readMetric(profile, payload, m, ctx);
  return out;
}

/**
 * Coverage audit: for every registry metric, how does this profile bind it?
 * Drives the dev-only mapping inspector and answers "what breaks if we swap
 * backends" without running the app against a live gateway.
 */
export function auditProfile(profile: Profile): {
  metric: string; label: string; unit: string;
  kind: Binding["kind"] | "missing"; detail: string;
}[] {
  return (Object.keys(METRICS) as (keyof typeof METRICS)[]).map((id) => {
    const spec = METRICS[id];
    const b = profile.bindings[id];
    if (!b) return { metric: id, label: spec.label, unit: spec.unit, kind: "missing" as const, detail: "no binding declared" };
    switch (b.kind) {
      case "field":    return { metric: id, label: spec.label, unit: spec.unit, kind: b.kind, detail: b.path + (b.scale !== undefined ? ` ×${b.scale}` : "") };
      case "array":    return { metric: id, label: spec.label, unit: spec.unit, kind: b.kind, detail: b.expand ? `${b.expand.keyTemplate} ×${b.expand.count}` : b.path };
      case "derived":  return { metric: id, label: spec.label, unit: spec.unit, kind: b.kind, detail: `f(${b.from.join(", ")})${b.note ? ` — ${b.note}` : ""}` };
      case "unmapped": return { metric: id, label: spec.label, unit: spec.unit, kind: b.kind, detail: b.reason };
    }
  });
}
