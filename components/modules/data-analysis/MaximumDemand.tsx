"use client";

/**
 * Maximum Demand — the billed peak, the contract, and what the battery saved.
 *
 * Four questions, in the order an operator asks them:
 *
 *   1. What is my peak this window, and when did it happen?
 *   2. How close is that to my contract demand?
 *   3. What would it have been without the battery — i.e. what is the BESS
 *      worth on this half of the bill?
 *   4. What is the block in progress doing right now?
 *
 * Only (4) is live. (1)-(3) come from the snapshot store and move slowly, so
 * they are not dressed up as realtime.
 *
 * The arithmetic, the block alignment rule and the counterfactual's assumption
 * all live in maxDemand.service.ts. This file renders and does not compute,
 * with one exception — the ₹ figure, which is a multiplication the service
 * deliberately leaves out because it depends on a rate the overlay may not
 * have.
 */

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import { AlertTriangle, ShieldCheck, ShieldOff } from "lucide-react";
import type { MaxDemand } from "@/lib/api/services/maxDemand.service";
import { chartTokens, cursorStyle, tooltipStyle } from "@/lib/charts/tokens";
import { PLOT_MARGIN, tickLabel, yAxis, zeroBasedTicks } from "@/lib/charts/axes";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { dailyToBuckets } from "@/lib/charts/period";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { fmtINR } from "@/lib/format";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { everyBucketX } from "./staggerTick";

const dt = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const hm = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
const kva = (v: number | null) => (v == null ? "—" : `${Math.round(v)}`);

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad) var(--pad)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 11 }}>
        <h3 className="card-title">{title}</h3>
        {note && <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

function Big({ label, value, unit, sub, tone }: {
  label: string; value: string; unit?: string; sub?: string; tone?: "bad" | "warn" | "good";
}) {
  const colour = tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--accent)" : tone === "good" ? "var(--good)" : "var(--ink)";
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 600, marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums", color: colour, lineHeight: 1.1 }}>
        {value}
        {unit && <small style={{ fontSize: 12, fontWeight: 500, color: "var(--muted)", marginLeft: 4 }}>{unit}</small>}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function MaximumDemand({ data, loading }: { data: MaxDemand | undefined; loading: boolean }) {
  /* Day / Week / Month / Year (PeriodNav): a Day is its 15-minute blocks, a
     Week or Month each day's highest block, a Year each month's. */
  const nav = usePeriod("week");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const daily = useMemo(() => {
    if (period.range === "day") {
      return (data?.blocks ?? [])
        .filter((b) => b.startTs >= period.from && b.startTs < period.to)
        .map((b) => ({
          label: new Date(b.startTs).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" }),
          peak: b.kva == null ? null : Math.round(b.kva),
          withoutBess: b.withoutBessKva == null ? null : Math.round(b.withoutBessKva),
        }));
    }
    const rows = (data?.daily ?? []).map((d) => ({ date: d.date, peak: Math.round(d.kva), withoutBess: d.withoutBessKva == null ? null : Math.round(d.withoutBessKva) }));
    return dailyToBuckets(rows, period, { peak: "max", withoutBess: "max" });
  }, [data, period]);
  const hasDaily = daily.some((d) => d.peak != null);

  if (loading) return <LoadingState rows={6} />;
  if (!data?.window || !data.peak?.kva) {
    return (
      <EmptyState
        title="No Demand History Yet"
        description=""
      />
    );
  }

  const { peak, peakWithoutBess, contractKva, demandChargeRs, current, emsLimiter, window: w } = data;
  const peakKva = peak.kva!;
  /* Five round ticks from 0 that hold the contract line (lib/charts/axes). */
  const demandTicks = zeroBasedTicks(Math.max(
    1, contractKva ?? 0,
    ...daily.map((d) => Math.max(Number(d.peak) || 0, Number((d as { withoutBess?: number | null }).withoutBess) || 0)),
  ));

  /* Utilisation against the sanctioned figure. Above 100% is not a warning,
     it is an excess the DISCOM prices separately and usually at a penal
     multiple — so it gets the bad colour, not the amber one. */
  const utilPct = contractKva ? (peakKva / contractKva) * 100 : null;
  const tone = utilPct == null ? undefined : utilPct > 100 ? "bad" : utilPct > 90 ? "warn" : "good";

  /* What the battery took off the billed peak. Positive means it helped; a
     NEGATIVE value is the finding that matters most on this screen — it means
     the battery was charging during the block that set the bill and has made
     the demand charge worse. */
  const avoidedKva =
    peakWithoutBess?.withoutBessKva != null ? peakWithoutBess.withoutBessKva - peakKva : null;
  const avoidedRs = avoidedKva != null && demandChargeRs != null ? avoidedKva * demandChargeRs : null;
  const wouldBreach = contractKva != null && peakWithoutBess?.withoutBessKva != null
    && peakWithoutBess.withoutBessKva > contractKva && peakKva <= contractKva;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      {/* ── The four headline figures ─────────────────────────────────────── */}
      <Card
        title="Billed Maximum Demand"
        note={`${w.blocks.toLocaleString("en-IN")} Blocks · ${dt(w.fromTs)} → ${dt(w.toTs)}`}
      >
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <Big
            label="Peak This Window"
            value={kva(peakKva)} unit="kVA"
            sub={`${dt(peak.startTs)} · ${hm(peak.startTs)}–${hm(peak.startTs + 900_000)}`}
            tone={tone}
          />
          <Big
            label="Contract Demand"
            value={contractKva == null ? "—" : kva(contractKva)} unit={contractKva == null ? undefined : "kVA"}
            sub={
              contractKva == null
                ? "Not Set"
                : utilPct == null ? undefined
                  : utilPct > 100
                    ? `Exceeded By ${Math.round(peakKva - contractKva)} kVA`
                    : `${Math.round(utilPct)}% Used · ${Math.round(contractKva - peakKva)} kVA Headroom`
            }
            tone={tone}
          />
          <Big
            label="Without The Battery"
            value={peakWithoutBess?.withoutBessKva == null ? "—" : kva(peakWithoutBess.withoutBessKva)}
            unit={peakWithoutBess?.withoutBessKva == null ? undefined : "kVA"}
            sub="Estimated"
          />
          <Big
            label={avoidedKva != null && avoidedKva < 0 ? "Demand ADDED" : "Demand Avoided"}
            value={avoidedKva == null ? "—" : `${avoidedKva < 0 ? "+" : ""}${Math.round(Math.abs(avoidedKva))}`}
            unit={avoidedKva == null ? undefined : "kVA"}
            sub={
              avoidedRs == null
                ? demandChargeRs == null ? "Not Priced" : undefined
                : avoidedKva != null && avoidedKva < 0
                  ? `Costing ${fmtINR(Math.abs(avoidedRs))} / Month`
                  : `Worth ${fmtINR(avoidedRs)} / Month`
            }
            tone={avoidedKva == null ? undefined : avoidedKva < 0 ? "bad" : "good"}
          />
        </div>

        {wouldBreach && contractKva != null && (
          <div style={{
            display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, padding: "10px 12px",
            borderRadius: 8, background: "rgb(var(--color-good) / 0.08)", border: "1px solid rgb(var(--color-good) / 0.25)",
          }}>
            <ShieldCheck size={15} style={{ color: "var(--good)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5 }}>
              Without The Battery · <strong>{kva(peakWithoutBess!.withoutBessKva)} kVA</strong>, Over Contract By{" "}
              {Math.round(peakWithoutBess!.withoutBessKva! - contractKva)} kVA
            </span>
          </div>
        )}

        {avoidedKva != null && avoidedKva < 0 && (
          <div style={{
            display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, padding: "10px 12px",
            borderRadius: 8, background: "rgb(var(--color-bad) / 0.08)", border: "1px solid rgb(var(--color-bad) / 0.25)",
          }}>
            <AlertTriangle size={15} style={{ color: "var(--bad)", flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.5 }}>
              <strong>Battery Charging During The Peak Block</strong>
            </span>
          </div>
        )}
      </Card>

      {/* ── The block in progress ─────────────────────────────────────────── */}
      {current && (
        <Card
          title="Block In Progress"
          note={`${hm(current.startTs)}–${hm(current.startTs + 900_000)} · ${Math.round(current.elapsedMs / 60_000)} Of 15 Min`}
        >
          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            <Big label={current.latestTs != null ? `Latest Reading · ${hm(current.latestTs)}` : "Latest Reading"} value={kva(current.latestKva)} unit="kVA" />
            <Big label="Block Mean So Far" value={kva(current.meanSoFarKva)} unit="kVA" />
            <Big
              label="Projected At Close"
              value={kva(current.projectedKva)} unit="kVA"
              sub={
                current.projectedKva != null && current.projectedKva > peakKva
                  ? "Would Set A New Peak"
                  : "Below The Window Peak"
              }
              tone={
                current.projectedKva == null ? undefined
                  : contractKva != null && current.projectedKva > contractKva ? "bad"
                    : current.projectedKva > peakKva ? "warn" : "good"
              }
            />
          </div>
        </Card>
      )}

      {/* ── Daily peaks ───────────────────────────────────────────────────── */}
      {/* Shared axes (lib/charts/axes); the contract line must sit on the scale. */}
      {(data.daily.length > 0 || data.blocks.length > 0) && (
        <Card title="Peak Demand" note={period.range === "day" ? "Each 15-Minute Block" : `Highest 15-Minute Block Each ${period.range === "year" ? "Month" : "Day"}`}>
          <div style={{ marginBottom: 10 }}><PeriodNav state={nav} /></div>
          {!hasDaily ? (
            <p style={{ fontSize: 12, color: "var(--muted)", padding: "40px 0", textAlign: "center" }}>No demand readings for {period.label}.</p>
          ) : (
          <div {...swipe} style={{ ...swipe.style, height: 240, position: "relative" }}>
            <AxisUnit unit="kVA" />
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daily} margin={PLOT_MARGIN}>
                <CartesianGrid stroke={chartTokens.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis {...everyBucketX(daily.length)} />
                <YAxis {...yAxis} domain={[0, demandTicks[demandTicks.length - 1]]} ticks={demandTicks} tickFormatter={tickLabel} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "var(--chart-grid)", opacity: 0.25 }}
                  formatter={(v: number | string, name: string) => [
                    `${v} kVA`,
                    name === "peak" ? "Billed Peak" : "Without Battery (Est.)",
                  ]}
                />
                <Legend
                  verticalAlign="top" height={26} iconType="plainline" iconSize={14}
                  formatter={(value) => (
                    <span style={{ fontSize: 11, color: "var(--ink3)" }}>
                      {value === "peak" ? "Billed Peak" : "Without Battery (Est.)"}
                    </span>
                  )}
                />
                {contractKva != null && (
                  /* Drawn on top of the bars, because the whole chart is read
                     against it — a day is fine or it is not, and the answer is
                     whether the bar crosses this line. */
                  <ReferenceLine
                    y={contractKva}
                    stroke={chartTokens.reference}
                    strokeDasharray="5 4"
                    label={{
                      value: `Contract ${contractKva} kVA`,
                      position: "insideTopRight",
                      fill: chartTokens.textMuted,
                      fontSize: 10,
                    }}
                  />
                )}
                <Bar dataKey="peak" fill={chartTokens.primary} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={26} />
                <Line
                  type="monotone" dataKey="withoutBess" stroke={chartTokens.secondary}
                  strokeWidth={1.6} strokeDasharray="4 3" dot={false} isAnimationActive={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          )}
        </Card>
      )}

      {/* ── Is anything defending the number? ─────────────────────────────── */}
      <Card title="Demand Limiter" note="Read Live From The Battery Controller">
        {emsLimiter == null ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            No Answer From The EMS
          </p>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {emsLimiter.enabled ? (
              <ShieldCheck size={16} style={{ color: "var(--good)", flexShrink: 0, marginTop: 2 }} />
            ) : (
              <ShieldOff size={16} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />
            )}
            <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.6 }}>
              <strong style={{ color: emsLimiter.enabled ? "var(--good)" : "var(--accent)" }}>
                {emsLimiter.enabled == null ? "State Unknown"
                  : emsLimiter.enabled ? "Demand Limit Is On" : "Demand Limit Is Off"}
              </strong>
              {emsLimiter.demandKw != null && (
                <> · Demand Setting {Math.round(emsLimiter.demandKw)} kW</>
              )}
              {emsLimiter.limitPct != null && <> · Limit {Math.round(emsLimiter.limitPct)}%</>}
            </div>
          </div>
        )}
      </Card>

    </div>
  );
}
