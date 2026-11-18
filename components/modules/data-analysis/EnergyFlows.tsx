"use client";

/**
 * Self-consumption and export.
 *
 * The two ratios are shown side by side and labelled with the question each
 * answers, because they are routinely quoted as if interchangeable and they
 * move in opposite directions — see the service header. A site reading 100%
 * self-consumption and 20% self-sufficiency has a small array, not a good one.
 *
 * The finding the screen exists for is lower down: how much of what was
 * exported left while the battery still had room to take it, and what that gave
 * away at the gap between the export and import rates.
 */

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
} from "recharts";
import { ArrowUpFromLine, ShieldOff, ShieldCheck } from "lucide-react";
import type { EnergyFlows as Flows } from "@/lib/api/services/energyFlows.service";
import { chartTokens, tooltipStyle } from "@/lib/charts/tokens";
import { PLOT_MARGIN, tickLabel, xAxis, yAxis, zeroBasedTicks } from "@/lib/charts/axes";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { dailyToBuckets, ymdOf } from "@/lib/charts/period";
import { AxisUnit } from "@/components/dashboard/viz/ChartCardHead";
import { fmtINR } from "@/lib/format";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { everyBucketX } from "./staggerTick";

/**
 * An energy figure and the unit it should be read in.
 *
 * Returned as a pair rather than a formatted string, because the caller prints
 * the unit separately — abbreviating to "209.6k" and letting "kWh" be appended
 * beside it produced "209.6kkWh" on every six-figure total. Past ten thousand
 * the figure becomes MWh, which is what somebody would say out loud anyway.
 */
function energy(v: number | null): { value: string; unit: string } {
  if (v == null) return { value: "—", unit: "" };
  if (Math.abs(v) >= 10_000) return { value: (v / 1000).toFixed(1), unit: "MWh" };
  return { value: Math.round(v).toLocaleString("en-IN"), unit: "kWh" };
}

/** The same figure inline, where a separate unit would not fit. */
const kwh = (v: number | null) => {
  const e = energy(v);
  return e.unit ? `${e.value} ${e.unit}` : e.value;
};
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

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
      {sub && <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 4, lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

export function EnergyFlows({ data, loading }: { data: Flows | undefined; loading: boolean }) {
  /* Day / Week / Month / Year (PeriodNav): days of a Week or Month, monthly
     sums for a Year, and a Day as its one complete day — the flows are
     differenced per day and have nothing finer. */
  const nav = usePeriod("week");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const daily = useMemo(() => {
    const rows = (data?.days ?? []).filter((d) => !d.partial).map((d) => ({
      date: d.date,
      solar: d.solarKwh == null ? null : Math.round(d.solarKwh),
      imported: Math.round(d.importKwh),
      exported: Math.round(d.exportKwh),
      load: Math.round(d.loadKwh),
    }));
    if (period.range === "day") {
      const r = rows.find((x) => x.date === ymdOf(period.from));
      return [{ label: period.label, ts: period.from, solar: r?.solar ?? null, imported: r?.imported ?? null, exported: r?.exported ?? null, load: r?.load ?? null }];
    }
    return dailyToBuckets(rows, period, { solar: "sum", imported: "sum", exported: "sum", load: "sum" });
  }, [data, period]);
  const num = (v: unknown) => (typeof v === "number" ? v : 0);

  const byHour = useMemo(
    () => (data?.exportByHour ?? []).map((n, h) => ({ hour: hh(h), kwh: Math.round(n) })),
    [data],
  );
  /* Five round ticks from 0 (lib/charts/axes). Imported and exported stack,
     so the daily scale has to hold their sum. */
  const dailyTicks = zeroBasedTicks(Math.max(1, ...daily.map((d) => Math.max(num(d.imported) + num(d.exported), num(d.load), num(d.solar)))));
  const hourTicks = zeroBasedTicks(Math.max(1, ...byHour.map((d) => d.kwh)));

  if (loading) return <LoadingState rows={6} />;
  if (!data?.window || !data.totals) {
    return (
      <EmptyState
        title="No Energy History Yet"
        description=""
      />
    );
  }

  const t = data.totals;
  const exportShare = t.solarKwh && t.solarKwh > 0 ? t.exportKwh / t.solarKwh : 0;
  const avoidableShare = t.exportKwh > 0 ? t.avoidableExportKwh / t.exportKwh : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>

      {/* ── The two ratios ────────────────────────────────────────────────── */}
      <Card
        title="Self-Consumption And Self-Sufficiency"
        note={`${data.days.filter((d) => !d.partial).length} Complete Days · ${data.days[0]?.date} → ${data.days[data.days.length - 1]?.date}`}
      >
        <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Big
            label="Self-Consumption"
            value={t.selfConsumptionPct == null ? "—" : t.selfConsumptionPct.toFixed(0)} unit="%"
            sub="Of Solar Generated"
            tone={t.selfConsumptionPct == null ? undefined : t.selfConsumptionPct >= 90 ? "good" : t.selfConsumptionPct >= 75 ? "warn" : "bad"}
          />
          <Big
            label="Self-Sufficiency"
            value={t.selfSufficiencyPct == null ? "—" : t.selfSufficiencyPct.toFixed(0)} unit="%"
            sub="Of Site Load"
            tone={t.selfSufficiencyPct == null ? undefined : t.selfSufficiencyPct >= 50 ? "good" : t.selfSufficiencyPct >= 25 ? "warn" : undefined}
          />
          <Big
            label="Exported"
            {...energy(t.exportKwh)}
            sub={t.solarKwh ? `${Math.round(exportShare * 100)}% Of Generation` : undefined}
          />
          <Big
            label="Imported"
            {...energy(t.importKwh)}
            sub={`Load ${kwh(t.loadKwh)}`}
          />
        </div>
      </Card>

      {/* ── The finding ───────────────────────────────────────────────────── */}
      {t.exportKwh > 0 && (
        <Card title="Export The Battery Could Have Taken">
          <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
            <Big
              label="Pack Idle Or Discharging"
              {...energy(t.avoidableExportKwh)}
              sub={`${Math.round(avoidableShare * 100)}% Of Export`}
              tone={avoidableShare > 0.5 ? "bad" : avoidableShare > 0.2 ? "warn" : "good"}
            />
            <Big
              label="Pack Already Charging"
              {...energy(t.exportWhileChargingKwh)}
            />
            <Big
              label="Given Away"
              value={data.avoidableValueRs == null ? "—" : fmtINR(data.avoidableValueRs)}
              sub={
                data.importRateRs != null && data.exportRateRs != null
                  ? `In ₹${data.importRateRs}/kWh · Out ₹${data.exportRateRs}/kWh`
                  : "Not Priced"
              }
              tone={data.avoidableValueRs ? "bad" : undefined}
            />
            <Big
              label="Battery Took"
              {...energy(t.batteryChargeKwh)}
              sub={`Returned ${kwh(t.batteryDischargeKwh)}`}
            />
          </div>

          {t.avoidableExportKwh > 0 && (
            <div style={{
              display: "flex", gap: 9, alignItems: "flex-start", marginTop: 14, padding: "10px 12px",
              borderRadius: 8, background: "rgb(var(--color-accent) / 0.08)", border: "1px solid rgb(var(--color-accent) / 0.25)",
            }}>
              <ArrowUpFromLine size={15} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.55 }}>
                <strong>{kwh(t.avoidableExportKwh)}</strong> Exported While The Pack Was Below 95% And Not Charging
              </span>
            </div>
          )}
        </Card>
      )}

      {/* ── Where it goes ─────────────────────────────────────────────────── */}
      <Card title={period.range === "year" ? "Monthly Energy" : "Daily Energy"} note="Solar Derived By Balance">
        <div style={{ marginBottom: 10 }}><PeriodNav state={nav} /></div>
        <div {...swipe} style={{ ...swipe.style, height: 250, position: "relative" }}>
          <AxisUnit unit="kWh" />
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={daily} margin={PLOT_MARGIN}>
              <CartesianGrid stroke={chartTokens.grid} strokeDasharray="3 3" vertical={false} />
              <XAxis {...everyBucketX(daily.length)} />
              <YAxis {...yAxis} domain={[0, dailyTicks[dailyTicks.length - 1]]} ticks={dailyTicks} tickFormatter={tickLabel} />
              <Tooltip
                contentStyle={tooltipStyle}
                cursor={{ fill: "var(--chart-grid)", opacity: 0.2 }}
                formatter={(v: number | string, n: string) => [`${v} kWh`, n]}
              />
              <Legend
                verticalAlign="top" height={26} iconSize={10}
                formatter={(v) => <span style={{ fontSize: 11, color: "var(--ink3)" }}>{v}</span>}
              />
              {/* Imported and exported are the measured pair and are stacked
                  against each other; load and solar are lines because one is
                  integrated and the other derived, and stacking them beside
                  measured bars would give all four the same standing. */}
              <Bar dataKey="imported" name="Imported" stackId="grid" fill={chartTokens.primary} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={22} />
              <Bar dataKey="exported" name="Exported" stackId="grid" fill={chartTokens.secondary} radius={[2, 2, 0, 0]} isAnimationActive={false} maxBarSize={22} />
              <Line type="monotone" dataKey="load" name="Load" stroke={chartTokens.reference} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="solar" name="Solar (Derived)" stroke={chartTokens.glow} strokeWidth={1.6} strokeDasharray="4 3" dot={false} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* ── When it leaves ────────────────────────────────────────────────── */}
      {t.exportKwh > 0 && (
        <Card title="Export By Hour Of Day">
          <div style={{ height: 180, position: "relative" }}>
            <AxisUnit unit="kWh" />
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byHour} margin={PLOT_MARGIN}>
                <CartesianGrid stroke={chartTokens.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="hour" interval={3} {...xAxis} />
                <YAxis {...yAxis} domain={[0, hourTicks[hourTicks.length - 1]]} ticks={hourTicks} tickFormatter={tickLabel} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--chart-grid)", opacity: 0.25 }} formatter={(v) => [`${v} kWh`, "Exported"]} />
                <Bar dataKey="kwh" fill={chartTokens.secondary} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Is export even permitted? ─────────────────────────────────────── */}
      <Card title="Export Limiting" note="Read Live From The Battery Controller">
        {data.antiReverseFlow == null ? (
          <p style={{ fontSize: 12, color: "var(--muted)" }}>
            No Answer From The EMS
          </p>
        ) : (
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            {data.antiReverseFlow.enabled
              ? <ShieldCheck size={16} style={{ color: "var(--good)", flexShrink: 0, marginTop: 2 }} />
              : <ShieldOff size={16} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />}
            <div style={{ fontSize: 12, color: "var(--ink2)", lineHeight: 1.6 }}>
              <strong style={{ color: data.antiReverseFlow.enabled ? "var(--good)" : "var(--accent)" }}>
                {data.antiReverseFlow.enabled == null ? "State Unknown"
                  : data.antiReverseFlow.enabled ? "Export Limit Is On" : "Export Limit Is Off"}
              </strong>
              {data.antiReverseFlow.upperKw != null && <> · Limit {Math.round(data.antiReverseFlow.upperKw)} kW</>}
            </div>
          </div>
        )}
      </Card>

    </div>
  );
}
