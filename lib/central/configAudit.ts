"use client";

/**
 * S8, the gateway's configuration audit, off the central backend.
 *
 *   GET /gateways/{id}/config-audit?limit=&setting_path=&change_source=
 *
 * One row per setting change: who changed what, from what, to what, and why.
 * `setting_path` narrows to one setting (e.g. `controller.high_limit`);
 * `change_source` to how it was changed. No from/to — the reference lists
 * none for this stream.
 *
 * `old_value` / `new_value` are JSON as the gateway sent them — a number, a
 * string, an object, or null — so they are kept as `unknown` and rendered
 * through auditValueText() rather than assumed scalar.
 */

import { getSession } from "./session";
import { CentralReadError } from "./gateways";

export const CONFIG_AUDIT_MAX_LIMIT = 1000;

export type ConfigChangeSource = "local_api" | "central_command" | "config_file" | "software_update";

/** `ConfigAuditRecord`. Everything but the two timestamps may be null. */
export interface ConfigAuditRecord {
  audit_id: string | null;
  actor: string | null;
  actor_role: string | null;
  change_source: string | null;
  setting_path: string | null;
  old_value: unknown;
  new_value: unknown;
  revision: string | null;
  reason: string | null;
  /** Links a change to the command that caused it, and to S4 alarms with the same id. */
  correlation_id: string | null;
  sample_time_utc: string;
  received_at_utc: string;
  data: Record<string, unknown> | null;
}

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
};

export async function fetchConfigAudit(
  gatewayId: string,
  opts: { limit?: number; settingPath?: string; changeSource?: ConfigChangeSource } = {},
): Promise<ConfigAuditRecord[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");

  const limit = Math.max(1, Math.min(opts.limit ?? 50, CONFIG_AUDIT_MAX_LIMIT));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.settingPath) qs.set("setting_path", opts.settingPath);
  if (opts.changeSource) qs.set("change_source", opts.changeSource);

  const r = await fetch(
    `/api/central/gateways/${encodeURIComponent(gatewayId)}/config-audit?${qs}`,
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );
  if (r.status === 422) throw new CentralReadError("Gateway id or filter rejected by the backend", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);

  const body: unknown = await r.json();
  if (!Array.isArray(body)) return [];
  /* Newest first by sample time — a reconnecting gateway uploads late. */
  return (body as ConfigAuditRecord[]).sort((a, b) => ms(b.sample_time_utc) - ms(a.sample_time_utc));
}

/** `controller.high_limit` → `Controller › high limit`. */
export function settingLabel(path: string | null | undefined): string {
  if (!path) return "—";
  return path
    .split(".")
    .map((part, i) => {
      const t = part.replace(/_/g, " ");
      return i === 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t;
    })
    .join(" › ");
}

/** An old/new value as one line: scalars as-is, objects as compact JSON, null as a dash. */
export function auditValueText(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}
