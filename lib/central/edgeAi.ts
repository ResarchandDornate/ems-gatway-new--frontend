"use client";

/**
 * S7, the gateway's on-board anomaly model, off the central backend.
 *
 *   GET /gateways/{id}/edge-ai?limit=&source_id=&bess_id=&only_anomalies=&from_time=&to_time=
 *
 * from/to is in the Oct 2026 reference and is sent, and applied here too
 * until the backend honours it (see inWindow).
 *
 * ── What the stream really carries (checked live, 8 Oct 2026) ──────────────
 *
 * Not the backend's first note. Every promoted field — model_name, model_version,
 * inference_type, result, score, status — is null on all 112 rows, so the
 * filters match nothing. Everything is in `data`, in two shapes:
 *
 *   cycle    every ~30 s: data.model_info (IsolationForest v0_3, 33 features,
 *            threshold ~0.569, "anomaly_score_ml >= threshold means anomaly"),
 *            data.edge_ai_status (GOOD / STALE), latest_age_sec,
 *            stale_after_sec, cycle_latency_ms, and data.sources[] — per
 *            cabinet: anomaly_score_ml, threshold, ml_predicted_anomaly, ok,
 *            and 8 key_features.
 *   anomaly  one per predicted anomaly: bess_id, anomaly_score_ml, and
 *            anomaly_context — the full 33-feature snapshot behind it.
 *
 * Scores ran 0.39–0.66 over the rows read. All 20 anomalies fell 10:29–10:41
 * IST on 8 Oct, both cabinets, as the plant restarted after its overnight
 * outage (phase-current imbalance ~21.6 against ~1–2 normally).
 */

import { getSession } from "./session";
import { CentralReadError, inWindow, setWindow, type ReadWindow } from "./gateways";

export const EDGE_AI_MAX_LIMIT = 1000;

export interface EdgeAiSource {
  ok?: boolean;
  bess_id?: string;
  source_id?: string;
  threshold?: number;
  anomaly_score_ml?: number;
  ml_predicted_anomaly?: boolean;
  inference_latency_ms?: number;
  key_features?: Record<string, number>;
}

export interface EdgeAiModelInfo {
  version?: string;
  model_type?: string;
  threshold?: number;
  feature_count?: number;
  threshold_direction?: string;
}

/**
 * `EdgeAIRecord`. v2 (S7_EDGE_AI_API_2, 8 Oct 2026): ONE ROW PER BESS per
 * inference cycle — a two-cabinet cycle is two rows sharing cycle_index —
 * with cycle_index, edge_ai_status, model_version, model_type, source_id,
 * bess_id, ml_predicted_anomaly, anomaly_score_ml and threshold promoted.
 * v1 rows (one per cycle, everything in data.sources, promoted fields null)
 * are still read. Any promoted field may be null.
 */
export interface EdgeAiRecord {
  cycle_index?: number | null;
  edge_ai_status?: string | null;
  model_version?: string | null;
  model_type?: string | null;
  source_id?: string | null;
  bess_id?: string | null;
  ml_predicted_anomaly?: boolean | null;
  anomaly_score_ml?: number | null;
  threshold?: number | null;
  sample_time_utc: string;
  received_at_utc: string;
  data: {
    phase?: string;
    cycle_index?: number;
    cycle_time?: string;
    /* cycle */
    sources?: EdgeAiSource[];
    model_info?: EdgeAiModelInfo;
    edge_ai_status?: string;
    latest_age_sec?: number;
    stale_after_sec?: number;
    cycle_latency_ms?: number;
    /* anomaly */
    bess_id?: string;
    source_id?: string;
    anomaly_score_ml?: number;
    ml_predicted_anomaly?: boolean;
    anomaly_context?: { features?: Record<string, number>; threshold?: number; model_version?: string; reason?: string | null };
  } | null;
}

const ms = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? 0 : t;
};

export async function fetchEdgeAi(
  gatewayId: string,
  opts: { limit?: number; bessId?: string; sourceId?: string; onlyAnomalies?: boolean } & ReadWindow = {},
): Promise<EdgeAiRecord[]> {
  const s = getSession();
  if (!s) throw new CentralReadError("Not signed in");
  const limit = Math.max(1, Math.min(opts.limit ?? 50, EDGE_AI_MAX_LIMIT));
  const qs = new URLSearchParams({ limit: String(limit) });
  if (opts.bessId) qs.set("bess_id", opts.bessId);
  if (opts.sourceId) qs.set("source_id", opts.sourceId);
  if (opts.onlyAnomalies) qs.set("only_anomalies", "true");
  setWindow(qs, opts);
  const r = await fetch(
    `/api/central/gateways/${encodeURIComponent(gatewayId)}/edge-ai?${qs}`,
    { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" },
  );
  if (r.status === 422) throw new CentralReadError("Gateway id rejected by the backend", 422);
  if (!r.ok) throw new CentralReadError(`Central backend answered ${r.status}`, r.status);
  const body: unknown = await r.json();
  if (!Array.isArray(body)) return [];
  return (body as EdgeAiRecord[]).filter((x) => inWindow(x.sample_time_utc, opts)).sort((a, b) => ms(b.sample_time_utc) - ms(a.sample_time_utc));
}

export interface EdgeAiCycle {
  ts: number;
  status: string | null;
  latestAgeSec: number | null;
  staleAfterSec: number | null;
  model: EdgeAiModelInfo | null;
  sources: EdgeAiSource[];
}

export interface EdgeAiAnomaly {
  ts: number;
  bessId: string | null;
  score: number | null;
  threshold: number | null;
  features: Record<string, number>;
}

/** The inference cycles, newest first. */
/** A v2 row: one BESS of one cycle, its result promoted to the top level. */
const isPerBess = (r: EdgeAiRecord) => r.bess_id != null || r.anomaly_score_ml != null;

export function cyclesOf(rows: EdgeAiRecord[]): EdgeAiCycle[] {
  const out: EdgeAiCycle[] = [];
  /* v2: gather each cycle's per-BESS rows (same cycle_index; same sample time
     when the index is missing) into one cycle, so a two-cabinet cycle is not
     counted twice. */
  const byCycle = new Map<string, EdgeAiRecord[]>();
  for (const r of rows) {
    if (!isPerBess(r) || !ms(r.sample_time_utc)) continue;
    const k = r.cycle_index != null ? `c${r.cycle_index}` : `t${r.sample_time_utc}`;
    (byCycle.get(k) ?? byCycle.set(k, []).get(k)!).push(r);
  }
  for (const group of byCycle.values()) {
    const first = group[0];
    const d = first.data;
    out.push({
      ts: Math.max(...group.map((g) => ms(g.sample_time_utc))),
      status: first.edge_ai_status ?? d?.edge_ai_status ?? null,
      latestAgeSec: d?.latest_age_sec ?? null,
      staleAfterSec: d?.stale_after_sec ?? null,
      model: d?.model_info ?? (first.model_type || first.model_version
        ? { model_type: first.model_type ?? undefined, version: first.model_version ?? undefined, threshold: first.threshold ?? undefined }
        : null),
      sources: group.map((g) => {
        const raw = g.data?.sources?.find((x) => x.bess_id === g.bess_id);
        return {
          ...raw,
          bess_id: g.bess_id ?? raw?.bess_id,
          source_id: g.source_id ?? raw?.source_id,
          anomaly_score_ml: g.anomaly_score_ml ?? raw?.anomaly_score_ml,
          ml_predicted_anomaly: g.ml_predicted_anomaly ?? raw?.ml_predicted_anomaly,
          threshold: g.threshold ?? raw?.threshold,
        };
      }).sort((a, b) => String(a.bess_id).localeCompare(String(b.bess_id))),
    });
  }
  /* v1: one row per cycle with everything in data.sources. */
  for (const r of rows) {
    if (isPerBess(r)) continue;
    const d = r.data;
    const ts = ms(r.sample_time_utc);
    if (!d?.sources || !ts) continue;
    out.push({
      ts,
      status: d.edge_ai_status ?? null,
      latestAgeSec: d.latest_age_sec ?? null,
      staleAfterSec: d.stale_after_sec ?? null,
      model: d.model_info ?? null,
      sources: d.sources,
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** The predicted anomalies, newest first. */
export function anomaliesOf(rows: EdgeAiRecord[]): EdgeAiAnomaly[] {
  const out: EdgeAiAnomaly[] = [];
  for (const r of rows) {
    const d = r.data;
    const ts = ms(r.sample_time_utc);
    if (!ts) continue;
    /* v2: a per-BESS row the model flagged. Its 33-feature snapshot is in
       anomaly_context when sent, else the cycle's key features for it. */
    if (isPerBess(r)) {
      if (r.ml_predicted_anomaly !== true) continue;
      const raw = d?.sources?.find((x) => x.bess_id === r.bess_id);
      out.push({
        ts,
        bessId: r.bess_id ?? null,
        score: typeof r.anomaly_score_ml === "number" ? r.anomaly_score_ml : null,
        threshold: r.threshold ?? d?.anomaly_context?.threshold ?? null,
        features: d?.anomaly_context?.features ?? raw?.key_features ?? {},
      });
      continue;
    }
    if (!d?.anomaly_context) continue;
    out.push({
      ts,
      bessId: d.bess_id ?? null,
      score: typeof d.anomaly_score_ml === "number" ? d.anomaly_score_ml : null,
      threshold: d.anomaly_context.threshold ?? null,
      features: d.anomaly_context.features ?? {},
    });
  }
  return out.sort((a, b) => b.ts - a.ts);
}

/** `pcs_phase_current_imbalance` → `PCS phase current imbalance`. */
/** The model's inputs, in words a site operator uses. Unknown keys fall back to their own name. */
const FEATURE_WORDS: Record<string, string> = {
  bms_fault_flag_count: "Battery Faults Raised",
  pcs_fault_flag_count: "Inverter (PCS) Faults Raised",
  bms_temperature_spread: "Cell Temperature Spread",
  bms_cell_voltage_spread: "Cell Voltage Spread",
  pcs_phase_current_imbalance: "Phase Current Imbalance",
  pcs_phase_voltage_imbalance: "Phase Voltage Imbalance",
  pcs_dc_current_vs_bms_current_delta: "Current Mismatch, Inverter vs Battery",
  pcs_dc_voltage_vs_bms_voltage_delta: "Voltage Mismatch, Inverter vs Battery",
};

export function featureLabel(key: string): string {
  if (FEATURE_WORDS[key]) return FEATURE_WORDS[key];
  const s = key.replace(/_/g, " ").replace(/\b(pcs|bms|soc|soh|dc|can)\b/gi, (m) => m.toUpperCase());
  return s.charAt(0).toUpperCase() + s.slice(1);
}
