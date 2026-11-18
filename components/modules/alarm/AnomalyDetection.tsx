"use client";

/**
 * The gateway's on-board anomaly model (S7): whether it is running, each
 * cabinet's score against the threshold now, the score over the cycles the
 * backend returns, and every predicted anomaly with the readings behind it.
 *
 * A prediction, not an alarm: the model flags readings unlike the ones it
 * learnt from, which is how a restart or an unusual charge looks as well as
 * a fault. The page says so, and shows the features so a reader can judge.
 * Built on the live record — see lib/central/edgeAi.ts.
 */

import { Fragment, useMemo, useState } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useEdgeAi, useEdgeAiAnomalies } from "@/hooks/useEdgeAi";
import { anomaliesOf, cyclesOf, featureLabel, EDGE_AI_MAX_LIMIT, type EdgeAiRecord, type EdgeAiSource } from "@/lib/central";
import { inWindow } from "@/lib/central/gateways";
import { mergeRows } from "@/lib/central/history";
import { useEdgeAiPeriod, useEdgeAiDeep, edgeAiPeriodEnd } from "@/hooks/useEdgeAiPeriod";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { BucketChart, withRange } from "@/components/charts/BucketChart";
import { aggregate, bucketsOf } from "@/lib/charts/period";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { chartTokens, tooltipStyle, cursorStyle, series } from "@/lib/charts/tokens";
import { PLOT_MARGIN, xAxis, yAxis } from "@/lib/charts/axes";
import { timeAxisProps, timeTooltipLabel, withGaps } from "@/lib/charts/timeAxis";
import { AxisUnit, ChartCardHead, Reading } from "@/components/dashboard/viz/ChartCardHead";
import { formatAge } from "@/lib/freshness";

const cabinet = (bessId: string | null | undefined) =>
  bessId ? bessId.replace(/^bess_(\d+)$/, "BESS $1") : "BESS";
/** Feature names in Title Case ("Max cell voltage" → "Max Cell Voltage"). */
const featureName = (k: string) => featureLabel(k).replace(/\b[a-z]/g, (c) => c.toUpperCase());
const score = (v: number | null | undefined) => (typeof v === "number" ? v.toFixed(3) : "—");
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : String(+v.toFixed(2)));

function SourceCard({ s, threshold }: { s: EdgeAiSource; threshold: number | null }) {
  const sc = s.anomaly_score_ml ?? null;
  const th = s.threshold ?? threshold;
  const flagged = !!s.ml_predicted_anomaly;
  const pct = sc == null ? 0 : Math.min(100, Math.max(0, sc * 100));
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[13.5px] font-semibold text-ink">{cabinet(s.bess_id)}</h3>
        <span className={`pill ${s.ok === false ? "gray" : flagged ? "red" : "green"}`}>
          <span className="dot" />{s.ok === false ? "Not Scored" : flagged ? "Unusual Behaviour" : "Normal"}
        </span>
      </div>
      <div className="flex items-baseline gap-2 mt-3">
        <span className="text-[22px] font-semibold text-ink tabular-nums">{score(sc)}</span>
        <span className="text-[11.5px] text-muted">Anomaly Score · Flagged At {score(th)} Or Above</span>
      </div>
      {/* Score against the threshold, 0–1. */}
      <div className="relative mt-2 h-2 rounded-full bg-surface3" aria-hidden>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: flagged ? "var(--red)" : "var(--accent)" }} />
        {th != null && <div className="absolute -top-1 -bottom-1 w-px bg-ink3" style={{ left: `${th * 100}%` }} />}
      </div>
      <div className="mt-3 grid gap-x-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
        {Object.entries(s.key_features ?? {}).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 py-[5px] border-b border-line text-[11.5px]">
            <span className="text-muted">{featureName(k)}</span>
            <span className="font-mono text-ink">{fmt(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const rowKey = (r: EdgeAiRecord) => `${r.sample_time_utc}|${r.bess_id ?? r.data?.bess_id ?? ""}|${r.cycle_index ?? r.data?.cycle_index ?? ""}`;
const rowTime = (r: EdgeAiRecord) => Date.parse(r.sample_time_utc) || 0;

function ScoreChart({ live, liveLoading, threshold }: { live: EdgeAiRecord[]; liveLoading: boolean; threshold: number | null }) {
  const { gatewayId } = useAppConfig();
  /* Day / Week / Month / Year (PeriodNav). A Day is every cycle's score as a
     line; a Week / Month one capsule per day, a Year one per month — lowest
     to highest score with a dot at the average, one row per cabinet. */
  const nav = usePeriod("day");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const stored = useEdgeAiPeriod(gatewayId, period);
  const end = edgeAiPeriodEnd(period);
  const cycles = useMemo(() => {
    const win = { fromMs: period.from, toMs: end };
    const inPeriod = (rows: EdgeAiRecord[]) => rows.filter((r) => inWindow(r.sample_time_utc, win));
    return cyclesOf(mergeRows(inPeriod(live), inPeriod(stored.data ?? []), rowKey, rowTime));
  }, [live, stored.data, period.from, end]);

  const bessIds = useMemo(() => [...new Set(cycles.flatMap((c) => c.sources.map((s) => s.bess_id ?? "")))].filter(Boolean).sort(), [cycles]);
  const data = useMemo(() => withGaps([...cycles].reverse().map((c) => {
    const row: Record<string, number | null> & { ts: number } = { ts: c.ts };
    for (const id of bessIds) row[id] = c.sources.find((s) => s.bess_id === id)?.anomaly_score_ml ?? null;
    return row;
  })), [cycles, bessIds]);
  const isDay = period.range === "day";
  const buckets = useMemo(() => isDay ? [] : bessIds.map((id) => withRange(aggregate(
    cycles.flatMap((c) => {
      const v = c.sources.find((s) => s.bess_id === id)?.anomaly_score_ml;
      return typeof v === "number" && Number.isFinite(v) ? [{ ts: c.ts, value: v }] : [];
    }),
    bucketsOf(period), "measure",
  ))), [isDay, bessIds, cycles, period]);
  const span: [number, number] = [period.from, period.to];
  const latest = cycles[0];
  const colorOf = (i: number) => series(i % 2 === 0 ? "primary" : "secondary").stroke;
  const avgOf = (id: string) => {
    const v = cycles.map((c) => c.sources.find((s) => s.bess_id === id)?.anomaly_score_ml).filter((x): x is number => typeof x === "number");
    return v.length ? v.reduce((a, x) => a + x, 0) / v.length : null;
  };
  const loading = (stored.isLoading || liveLoading) && !cycles.length;

  return (
    <div className="surface-card chart-card" style={{ padding: "var(--pad-sm) var(--pad)", flex: "none" }}>
      <ChartCardHead
        title="Anomaly Score"
        readings={<>
          {bessIds.map((id, i) => (
            <Reading key={id} swatch={colorOf(i)} label={isDay ? cabinet(id) : `${cabinet(id)} Average`}
                     value={score(isDay ? latest?.sources.find((s) => s.bess_id === id)?.anomaly_score_ml : avgOf(id))} />
          ))}
          {isDay && <span style={{ fontSize: 11, color: "var(--muted)" }}>Dashed Line: Flag Level {score(threshold)}</span>}
        </>}
      />
      <div style={{ marginBottom: 10 }}><PeriodNav state={nav} /></div>
      <div {...swipe} style={swipe.style}>
        {loading ? (
          <div style={{ height: 260 }}><LoadingState rows={3} /></div>
        ) : isDay ? (
          <div className="chart-body" style={{ position: "relative", height: 260 }}>
            <AxisUnit unit="Score" />
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={PLOT_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
                <XAxis {...xAxis} {...timeAxisProps(data, span)} />
                <YAxis {...yAxis} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} />
                <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} labelFormatter={timeTooltipLabel}
                         formatter={(v, name) => [typeof v === "number" ? v.toFixed(3) : "—", cabinet(String(name))]} />
                {threshold != null && <ReferenceLine y={threshold} stroke={chartTokens.reference} strokeDasharray="4 3" />}
                {bessIds.map((id, i) => (
                  <Line key={id} type="monotone" dataKey={id} name={id} dot={false} isAnimationActive={false} strokeWidth={2}
                        stroke={colorOf(i)} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {bessIds.map((id, i) => (
              <div key={id}>
                {bessIds.length > 1 && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink2)", marginBottom: 4 }}>{cabinet(id)}</div>}
                <BucketChart buckets={buckets[i]} kind="measure" color={colorOf(i)} unit="Score" period={period}
                             height={bessIds.length > 1 ? 150 : 260} hideLabels={i < bessIds.length - 1} />
              </div>
            ))}
            {!bessIds.length && <div style={{ height: 260 }} />}
          </div>
        )}
      </div>
    </div>
  );
}

function AnomalyLog({ rows }: { rows: ReturnType<typeof anomaliesOf> }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h3 className="text-[13.5px] font-semibold text-ink">Flagged Moments</h3>
        <span className="text-[11px] text-muted">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-[12px] text-ink3">Nothing Flagged</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 420 }}>
          <table className="ps-table">
            <thead><tr><th>Time</th><th>BESS</th><th className="num">Score</th><th className="num">Threshold</th></tr></thead>
            <tbody>
              {rows.map((a, i) => (
                <Fragment key={`${a.ts}-${a.bessId}-${i}`}>
                  <tr onClick={() => setOpen(open === i ? null : i)} style={{ cursor: "pointer" }}>
                    <td className="font-mono" style={{ whiteSpace: "nowrap" }}>{timeTooltipLabel(a.ts)}</td>
                    <td style={{ color: "var(--ink)" }}>{cabinet(a.bessId)}</td>
                    <td className="num">{score(a.score)}</td>
                    <td className="num">{score(a.threshold)}</td>
                  </tr>
                  {open === i && (
                    <tr>
                      <td colSpan={4}>
                        <div className="grid gap-x-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
                          {Object.entries(a.features).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => (
                            <div key={k} className="flex justify-between gap-3 py-[4px] border-b border-line text-[11.5px]">
                              <span className="text-muted">{featureName(k)}</span>
                              <span className="font-mono text-ink">{fmt(v)}</span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AnomalyDetection() {
  const { gatewayId } = useAppConfig();
  const { data, isLoading, isError, error, refetch } = useEdgeAi(gatewayId);
  const cycles = useMemo(() => cyclesOf(data ?? []), [data]);
  /* The flagged rows on their own reach further back than the newest 1,000
     (one per BESS per cycle); merged with any in the main read, once each. */
  const flagged = useEdgeAiAnomalies(gatewayId);
  /* The live read stops at the newest 1,000 rows and /edge-ai ignores from/to,
     so each cabinet is also read on its own (newest 1,000 rows and flagged
     rows each) to reach further back for the chart and the log. */
  const cabinetIds = useMemo(() => [...new Set(cycles.flatMap((c) => c.sources.map((s) => s.bess_id ?? "")))].filter(Boolean).sort(), [cycles]);
  const deep = useEdgeAiDeep(gatewayId, cabinetIds);
  const live = useMemo(
    () => mergeRows(data ?? [], [...(flagged.data ?? []), ...(deep.data?.rows ?? [])], rowKey, rowTime),
    [data, flagged.data, deep.data],
  );
  const anomalies = useMemo(() => {
    const seen = new Set<string>();
    return [...anomaliesOf(flagged.data ?? []), ...anomaliesOf(deep.data?.flagged ?? []), ...anomaliesOf(data ?? [])]
      .filter((a) => { const k = `${a.ts}|${a.bessId}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => b.ts - a.ts);
  }, [data, flagged.data, deep.data]);
  /* A flagged read that came back full is the read cap, not the count. */
  const countKnown = !!flagged.data && flagged.data.length < EDGE_AI_MAX_LIMIT;

  const latest = cycles[0];
  const model = cycles.find((c) => c.model)?.model ?? null;
  const threshold = model?.threshold ?? latest?.sources[0]?.threshold ?? null;
  const age = latest ? Date.now() - latest.ts : null;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, paddingRight: 4 }}>
      <PageHeader title="Anomaly Detection">
        <PageStat label="Model Version" value={model?.version ?? "—"} />
        <PageStat label="Status" value={/^(good|ok)$/i.test(latest?.status ?? "") ? "Running" : latest?.status ?? "—"}
                  color={/^(good|ok)$/i.test(latest?.status ?? "") ? "var(--green)" : latest?.status ? "var(--gold)" : undefined} />
        <PageStat label="Last Checked" value={age != null ? `${formatAge(age)} ago` : "—"} />
        <PageStat label="Flagged" value={countKnown || !anomalies.length ? String(anomalies.length) : `${anomalies.length}+`} color={anomalies.length ? "var(--red)" : undefined} />
      </PageHeader>

      {isLoading ? <LoadingState rows={4} />
        : isError ? <ErrorState message={error instanceof Error ? error.message : "Edge AI Read Failed"} onRetry={() => refetch()} />
        : !cycles.length ? <EmptyState title="No Model Output Yet" description="" />
        : (
          <>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
              {latest.sources.map((s) => <SourceCard key={s.bess_id ?? s.source_id} s={s} threshold={threshold} />)}
            </div>
            <ScoreChart live={live} liveLoading={flagged.isLoading || deep.isLoading} threshold={threshold} />
            <AnomalyLog rows={anomalies} />
          </>
        )}
    </div>
  );
}
