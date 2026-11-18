/**
 * Response shapes for the NorthBound EMS Gateway, per API Reference v20260810.
 *
 * Every numeric field is `number | null`. The gateway returns null for a point
 * it could not read, and that must survive to the screen as a dash rather than
 * being coerced to 0 — the same rule the UGX-backed app already follows.
 */

export type Quality = "good" | "partial" | "stale" | "bad" | "missing";

/** One compact 1-second historian row (schema_version 2, write_mode value_only). */
export interface FastBessRow {
  timestamp_utc: string;
  timestamp_epoch_ms: number;
  source_id: string;
  bess_id: string;
  quality: Quality;
  max_data_age_ms: number | null;
  selected_signal_count: number | null;
  good_signal_count: number | null;
  bad_signal_count: number | null;
  pcs_values: Record<string, number | null>;
  bms_values: Record<string, number | null>;
}

export interface FastBessHistory {
  rows: FastBessRow[];
  /** Max timestamp_epoch_ms in this page; the cursor for the next request. */
  nextCursor: number | null;
  /** True when the gateway returned a full page and more may exist. */
  hasMore: boolean;
}

export interface GatewayHealth {
  ok: boolean;
  /** Free-form health payload; rendered as key/value, never interpreted. */
  detail: Record<string, unknown>;
}

export interface SourceSummary {
  source_id: string;
  display_name: string | null;
  online: boolean | null;
  signal_count: number | null;
  last_seen_utc: string | null;
}

/* GatewayAlarm used to be declared here as well as in client.ts, and the
   two drifted: this copy still said `asset: "PCS" | "BMS"` while the live
   one was being widened. Nothing imported it. Removed rather than kept in
   sync — the shape belongs next to the function that builds it. */


/** Which backend served the request, stated so the UI can say so. */
export type GatewayMode = "live" | "capture" | "demo";

export interface GatewayMeta {
  mode: GatewayMode;
  /** Present in capture mode: what the data actually is. */
  note?: string;
  windowUtc?: [string, string];
}
