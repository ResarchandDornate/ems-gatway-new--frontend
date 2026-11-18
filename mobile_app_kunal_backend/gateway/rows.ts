/**
 * Reading a signal off a historian row.
 *
 * The documented JSON shape is the `pcs_values` / `bms_values` envelope. The
 * API Reference of 10 Aug 2026 is explicit — "fast_bess pcs_values/bms_values,
 * object map, Compact value-only signal maps for 1-second historian" — and
 * `format=compact` rows carry `schema_version` 2 with `write_mode` value_only.
 * That is what this file tries first, and on a conformant gateway it is the
 * only branch that ever runs.
 *
 * An earlier version of this comment claimed the history endpoint returns
 * flattened columns instead, and that reading the envelope was why every
 * history value came back undefined. That was inferred from `colKey` in
 * signals.ts and it was wrong. The flattened spelling — "PCS
 * total_active_power" — is the **CSV export** format; the 24-hour export
 * shipped in the handover package uses it for all 72 of its columns, and the
 * JSON API does not. The remaining candidates below are kept because they cost
 * nothing and a CSV-derived row is a real thing someone may hand this code,
 * not because the JSON API needs them.
 *
 * What is not inference: reading a value must never be able to manufacture
 * one. `signalValue` only ever returns a number it found under a key that
 * literally spells a documented signal; nothing is derived, defaulted or
 * scaled. Where it finds nothing the answer is null, and `decodable()` lets
 * the caller tell "the gateway reported no value" apart from "this build did
 * not understand the row" — a distinction that did not exist when a `?? 0`
 * downstream turned both into a measured zero and drew a flat line across a
 * cycling plant.
 */

import type { SignalAsset } from "./signals";

/** Containers to search, per asset, in the order they are worth trying. */
const CONTAINERS: Record<SignalAsset, readonly string[]> = {
  PCS: ["pcs_values", "pcs", "pcs_signals"],
  BMS: ["bms_values", "bms", "bms_signals"],
};

/** Containers that hold both assets, keyed by the flattened column key. */
const SHARED = ["values", "signals"] as const;

function numeric(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  /* The gateway wraps some points as { value, quality }. A point whose quality
     is anything but good resolves to null rather than to its value: the board
     keeps the last decoded number in place when a read fails, so trusting the
     value alone would present a stale register as a measurement. Same rule the
     telemetry decoder already applies. */
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.quality === "string" && o.quality !== "good") return null;
    if (typeof o.value === "number") return Number.isFinite(o.value) ? o.value : null;
  }
  return null;
}

function fromContainer(row: Record<string, unknown>, key: string, name: string): number | null {
  const c = row[key];
  if (!c || typeof c !== "object") return null;
  return numeric((c as Record<string, unknown>)[name]);
}

/**
 * One signal off one row, wherever the gateway put it.
 *
 * Returns null both for "the gateway reported no value" and for "this build
 * could not find the column". Those are different facts and the caller needs to
 * tell them apart — `decodable()` answers that question for the row as a whole,
 * once, rather than per signal.
 */
export function signalValue(
  row: Record<string, unknown> | null | undefined,
  asset: SignalAsset,
  name: string,
): number | null {
  if (!row || typeof row !== "object") return null;
  for (const c of CONTAINERS[asset]) {
    const v = fromContainer(row, c, name);
    if (v != null) return v;
  }

  /* The flattened column key, which is what the history endpoint actually
     returns. `signals.ts` has documented this spelling since the profile was
     generated — it was simply never read at runtime. */
  const flat = `${asset} ${name}`;
  const atRoot = numeric(row[flat]);
  if (atRoot != null) return atRoot;

  for (const c of SHARED) {
    const v = fromContainer(row, c, flat) ?? fromContainer(row, c, name);
    if (v != null) return v;
  }

  return null;
}

/**
 * Whether this row carried any recognisable signal column at all.
 *
 * A row that decodes to nothing on every signal is not a quiet plant, it is a
 * shape this build does not understand — and the difference has to reach the
 * screen. Checked against SOC and total active power because those two are
 * present on every historian row the gateway has ever produced; a row missing
 * both is a row we are not reading.
 */
export function decodable(row: Record<string, unknown>): boolean {
  return (
    signalValue(row, "PCS", "total_active_power") != null ||
    signalValue(row, "BMS", "display_soc") != null ||
    signalValue(row, "PCS", "soc") != null
  );
}

/** The column names a row actually carried, for reporting an undecodable one. */
export function observedKeys(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = Object.keys(v as Record<string, unknown>).slice(0, 4);
      out.push(inner.length ? `${k}{${inner.join(",")}}` : `${k}{}`);
    } else {
      out.push(k);
    }
  }
  return out.slice(0, 24);
}

/** The four figures every history view is built from, as one decode pass. */
export interface RowSample {
  t: number;
  powerKw: number | null;
  soc: number | null;
  tempMax: number | null;
  cellSpreadMv: number | null;
}

export function readSample(row: Record<string, unknown>): RowSample | null {
  const t = row.timestamp_epoch_ms;
  if (typeof t !== "number" || !Number.isFinite(t)) return null;
  return {
    t,
    /* total_active_power, not charge_discharge_power: Modbus 192 reads a
       permanent 0.0 on this firmware and using it would draw an idle battery.
       The substitution is stated on the dashboard. */
    powerKw: signalValue(row, "PCS", "total_active_power"),
    soc: signalValue(row, "BMS", "display_soc") ?? signalValue(row, "PCS", "soc"),
    tempMax: signalValue(row, "BMS", "battery_max_temperature"),
    cellSpreadMv: signalValue(row, "BMS", "max_min_cell_voltage_diff"),
  };
}
