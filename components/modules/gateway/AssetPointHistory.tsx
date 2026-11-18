"use client";

/**
 * One S2 signal over a Day / Week / Month / Year period (PeriodNav), for
 * Asset Telemetry. A Day is the signal's readings as a line; a Week / Month
 * one capsule (or bar) per day, a Year one per month — BucketChart.
 *
 * Read through fetchPointHistory (live newest 1,000 plus stored history), in
 * slices of at most 90 days because the stored-history route refuses longer.
 * Values have the gateway's known decode faults undone, as the table does.
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAppConfig } from "@/hooks/useAppConfig";
import { fetchPointHistory } from "@/lib/api/services/pointsCentral.service";
import { decoded, label, type GeneralRecord } from "@/lib/central";
import { xAxis } from "@/lib/charts/axes";
import { timeAxisProps, timeTooltipLabel, withGaps } from "@/lib/charts/timeAxis";
import { aggregate, bucketsOf, kindOf } from "@/lib/charts/period";
import { BucketChart, withRange } from "@/components/charts/BucketChart";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";

const SLICE_MS = 90 * 86_400_000;
const HEIGHT = 190;

export function AssetPointHistory({ point, assetId }: { point: GeneralRecord; assetId: string | null }) {
  const { gatewayId } = useAppConfig();
  const nav = usePeriod("day");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const tag = assetId && point.point_id ? `${assetId}::${point.point_id}` : null;

  /* The read ends at now in 5-minute steps, never with a ticking clock. */
  const end = Math.min(period.to, Math.ceil(Date.now() / 300_000) * 300_000);
  const slices = useMemo(() => {
    const out: [string, string][] = [];
    for (let a = period.from; a < end; a += SLICE_MS) out.push([new Date(a).toISOString(), new Date(Math.min(end, a + SLICE_MS)).toISOString()]);
    return out;
  }, [period.from, end]);
  const qs = useQueries({
    queries: slices.map(([s, e]) => ({
      queryKey: ["dataAnalysis", "history", gatewayId, tag, s, e] as const,
      queryFn: () => fetchPointHistory(gatewayId, tag!, s, e),
      enabled: !!gatewayId && !!tag,
      staleTime: 60_000,
    })),
  });
  const loading = qs.some((q) => q.isLoading);
  const dataKey = qs.map((q) => q.dataUpdatedAt).join(",");

  const rows = useMemo(() => {
    const byTs = new Map<number, number>();
    for (const q of qs) for (const e of q.data ?? []) {
      const ts = Date.parse(e.t);
      const v = decoded(point.substream, point.signal, e.value);
      if (!Number.isNaN(ts) && v != null && Number.isFinite(v)) byTs.set(ts, v);
    }
    return [...byTs.entries()].sort((a, b) => a[0] - b[0]).map(([ts, v]) => ({ ts, v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, point.substream, point.signal]);

  const isDay = period.range === "day";
  const unit = point.unit ?? "";
  const kind = useMemo(() => kindOf(unit, rows.map((r) => r.v)), [unit, rows]);
  const buckets = useMemo(
    () => (isDay ? [] : withRange(aggregate(rows.map((r) => ({ ts: r.ts, value: r.v })), bucketsOf(period), kind))),
    [isDay, rows, period, kind],
  );
  const span: [number, number] = [period.from, period.to];

  return (
    <>
      <div style={{ marginTop: 10 }}><PeriodNav state={nav} /></div>
      <div {...swipe} style={{ ...swipe.style, height: HEIGHT, marginTop: 10 }}>
        {loading && rows.length === 0 ? (
          <p className="text-[12px] text-muted">Loading History…</p>
        ) : !isDay ? (
          <BucketChart buckets={buckets} kind={kind} color="var(--accent)" unit={unit} period={period} height={HEIGHT} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={withGaps(rows)} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis {...xAxis} {...timeAxisProps(rows, span)} />
              <YAxis tick={{ fontSize: 9, fill: "var(--muted)" }} width={52} domain={["auto", "auto"]} />
              <Tooltip
                contentStyle={{
                  background: "var(--tooltip-bg)", border: "1px solid var(--tooltip-line)",
                  borderRadius: 8, fontSize: 11,
                }}
                labelFormatter={timeTooltipLabel}
                formatter={(v: unknown) => [
                  typeof v === "number" ? `${v.toLocaleString("en-IN", { maximumFractionDigits: 3 })} ${unit}`.trim() : "—",
                  label(point),
                ]}
              />
              <Line
                type="monotone" dataKey="v" stroke="var(--accent)"
                strokeWidth={1.6} dot={rows.length < 3} isAnimationActive={false} connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </>
  );
}
