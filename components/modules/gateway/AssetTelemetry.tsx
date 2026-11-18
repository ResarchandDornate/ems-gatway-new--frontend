"use client";

/**
 * Asset Telemetry — the nine S2 substreams, signal by signal.
 *
 * S1 covers the battery and inverter. This covers everything else the gateway
 * reads: the cooling loop, the meter, fire protection, the IO module. Together
 * they are the whole asset model the old NorthBound adapter knew.
 *
 * ── Why a table and not tiles ──────────────────────────────────────────────
 *
 * A substream carries a hundred-odd points of wildly mixed kinds — setpoints,
 * temperatures, status words, fault flags. There is no six-figure summary that
 * would not be an arbitrary pick, so the honest shape is every signal with its
 * own unit and category, and a chart on demand for the one being examined.
 *
 * ── Asset scoping is not cosmetic ──────────────────────────────────────────
 *
 * Each substream spans both cabinets and a point_id is shared between them, so
 * every derived value here is scoped to one asset. Without that the table
 * would show whichever cabinet's row arrived first under a single name, and
 * the chart would draw two cabinets as one line.
 */

import { useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { useMemo, useState } from "react";
import {
  SUBSTREAMS, assetsIn, latestPerSignal, label, isKeySignal, decoded,
  type GeneralRecord,
} from "@/lib/central";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { AssetPointHistory } from "./AssetPointHistory";

const DASH = "—";

/* Display-only Title Case for ids like "liquid_cooling" or "external_ems_1";
   the ids themselves stay as they are for queries and comparisons. */
const ACRONYMS = new Set(["ems", "pcs", "bms", "io", "dc", "ac"]);
const tabLabel = (id: string) =>
  id.split(/[_\s]+/).filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

/* A signal's own display name when the gateway gives one; a raw snake_case
   fallback is Title Cased. */
const signalLabel = (r: GeneralRecord) => {
  const l = label(r);
  return /_/.test(l) ? tabLabel(l) : l;
};

const clock = (iso: string | null) => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? DASH
    : new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};

/**
 * The value, with float noise taken off.
 *
 * `value` arrives as a string carrying whatever the register held, and the
 * gateway's floats are single-precision widened to double — so an inlet
 * temperature of 24.9 °C reaches here as "24.899999618530273" and a 0.3 bar
 * setpoint as "0.30000001192092896". Those digits are an artefact of the
 * conversion, not precision the instrument has, and rendering eighteen of them
 * makes a table of real readings look like noise.
 *
 * Three decimals is past any resolution these sensors claim, so nothing real
 * is lost. A value that will not parse — a status word, a flag, anything the
 * column carries that is not a number — is passed through untouched rather
 * than coerced. The exact string stays available in the row's title.
 */
const shown = (r: GeneralRecord) => {
  if (r.value == null) return DASH;
  let n = Number(r.value);
  if (!Number.isFinite(n)) return r.value;
  /* Known decode faults undone (lib/central/decode): p1065–p1068 arrive
     word-swapped (×65,536), PCS power factor signed-as-unsigned (~65). The
     raw string stays in the row's title. */
  n = decoded(r.substream, r.signal, n) ?? n;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 3 });
};

export function AssetTelemetry({
  gatewayId, rows, loading, error, configPending,
  substream, onSubstream,
  point, onPoint,
}: {
  gatewayId: string;
  rows: GeneralRecord[] | undefined;
  loading: boolean;
  error: Error | null;
  configPending?: boolean;
  substream: string;
  onSubstream: (s: string) => void;
  point: GeneralRecord | null;
  onPoint: (r: GeneralRecord | null) => void;
  pointRows: GeneralRecord[] | undefined;
  pointLoading: boolean;
}) {
  const all = rows ?? [];
  /* Total shows every asset; BESS 1 / BESS 2 only that cabinet's. */
  const { isTotal, selected } = useSelectedCabinets();
  const pickedKey = isTotal ? "" : selected.map((c) => c.sourceId).join(",");
  const assets = useMemo(() => {
    const list = assetsIn(all);
    if (!pickedKey) return list;
    const ids = pickedKey.split(",");
    return list.filter((a) => ids.some((id) => a.startsWith(`${id}_`)));
  }, [all, pickedKey]);
  const [asset, setAsset] = useState<string | null>(null);
  const activeAsset = asset && assets.includes(asset) ? asset : assets[0] ?? null;

  const [keyOnly, setKeyOnly] = useState(false);
  const [q, setQ] = useState("");

  const signals = useMemo(() => {
    let list = latestPerSignal(all, activeAsset);
    if (keyOnly) list = list.filter(isKeySignal);
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (r) =>
          label(r).toLowerCase().includes(needle) ||
          (r.point_id ?? "").toLowerCase().includes(needle) ||
          (r.category ?? "").toLowerCase().includes(needle),
      );
    }
    return list;
  }, [all, activeAsset, keyOnly, q]);

  if (!gatewayId) {
    if (configPending) {
      return (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">Loading…</p>
        </div>
      );
    }
    return (
      <div className="surface-card ps-hero">
        <div>
          <h1 className="ps-hero-title">No Gateway Configured</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Asset Telemetry">
        {all.length > 0 && <PageStat label="Signals" value={`${signals.length} of ${latestPerSignal(all, activeAsset).length}`} />}
      </PageHeader>

      <div className="nav-track" style={{ alignSelf: "flex-start", flexWrap: "wrap" }}>
        {SUBSTREAMS.map((s) => (
          <button
            key={s} type="button"
            onClick={() => { onSubstream(s); onPoint(null); }}
            className={`nav-pill ${s === substream ? "on" : ""}`}
          >
            {tabLabel(s)}
          </button>
        ))}
      </div>

      {error && (
        <div className="surface-card" style={{ padding: "var(--pad)", borderColor: "#C2566B" }}>
          <p className="card-eyebrow" style={{ color: "#C2566B" }}>Could Not Read</p>
          <p className="text-[12px] text-ink3 mt-1">{error.message}</p>
        </div>
      )}

      {loading && !rows && (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">Loading…</p>
        </div>
      )}

      {!error && !loading && all.length === 0 && (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">No Signals</p>
        </div>
      )}

      {all.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {assets.length > 1 && (
              <div className="nav-track">
                {assets.map((a) => (
                  <button
                    key={a} type="button"
                    onClick={() => { setAsset(a); onPoint(null); }}
                    className={`nav-pill ${a === activeAsset ? "on" : ""}`}
                  >
                    {tabLabel(a.replace(/^external_ems_(\d+)_?/, "BESS $1 "))}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button" onClick={() => setKeyOnly((v) => !v)}
              className={`nav-pill ${keyOnly ? "on" : ""}`}
              title="Signals the gateway itself marks as key"
            >
              Key Only
            </button>
            <input
              value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Filter Signals…"
              className="filter-input"
              style={{ maxWidth: 230, height: 28, fontSize: 12 }}
            />
          </div>

          {point && (
            <div className="surface-card" style={{ padding: "var(--pad)" }}>
              <div className="flex items-baseline justify-between gap-3">
                <div>
                  <p className="card-eyebrow" title={point.point_id ?? undefined}>{signalLabel(point)}</p>
                  <p className="text-[10px] text-muted mt-0.5" title={point.point_id ?? undefined}>
                    {point.category ? tabLabel(point.category) : DASH}
                    {point.unit ? ` · ${point.unit}` : ""}
                  </p>
                </div>
                <button type="button" className="nav-pill" onClick={() => onPoint(null)}>Close</button>
              </div>
              <AssetPointHistory point={point} assetId={activeAsset} />
            </div>
          )}

          <div className="surface-card" style={{ padding: "var(--pad)" }}>
            <div className="grid gap-x-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))" }}>
              {signals.map((r) => (
                <button
                  key={r.point_id}
                  type="button"
                  onClick={() => onPoint(r)}
                  className="flex items-baseline gap-2 py-[5px] border-b border-line text-left hover:bg-surface3/50 transition-colors"
                  title={`${r.point_id} · raw ${r.value ?? "null"} · click to chart`}
                >
                  <span className="text-[11.5px] text-ink3 truncate flex-1" title={label(r)}>
                    {signalLabel(r)}
                  </span>
                  <span className="text-[11.5px] font-mono text-ink flex-none">{shown(r)}</span>
                  <span className="text-[10px] text-muted flex-none" style={{ minWidth: 26 }}>
                    {r.unit ?? ""}
                  </span>
                  {r.quality && r.quality !== "good" && (
                    <span className="text-[9px] flex-none" style={{ color: "#C9A227" }}>
                      {tabLabel(r.quality)}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {signals.length === 0 && (
              <p className="text-[12px] text-muted">No Matches</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
