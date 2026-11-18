"use client";

/**
 * The site's Solis PV inverter (S6), as the SOC controller reads it: its state
 * and output now, output against the derate limit over the readings the
 * backend returns, how often the controller's reads succeed, and the
 * communication events.
 *
 * Built on the live record (8 Oct 2026), not the backend's note — see
 * lib/central/solis.ts. The note promised today's yield, inverter temperature
 * and PV string readings; the stream carries none of them, and the card says
 * so rather than showing three dashes as if they were readings.
 */

import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { useSolisCentral } from "@/hooks/useSolisCentral";
import {
  controllerLabel, eventsOf, isGoodRead, limitKw, snapshotsOf, solarKw,
  type SolisSnapshot, type SolisEventRow, type SolisRecord,
} from "@/lib/central";
import { LoadingState } from "@/components/shared/LoadingState";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { Card, Row, StatusTile, num } from "./equipmentUi";
import { chartTokens, tooltipStyle, cursorStyle } from "@/lib/charts/tokens";
import { PLOT_MARGIN, tickLabel, xAxis, yAxis, zeroBasedTicks } from "@/lib/charts/axes";
import { timeAxisProps, timeTooltipLabel, withGaps } from "@/lib/charts/timeAxis";
import { PeriodNav, usePeriod, useSwipe } from "@/components/charts/PeriodNav";
import { BucketChart } from "@/components/charts/BucketChart";
import { useSolarPeriod, gapFor } from "../periodHistory";
import { AxisUnit, Reading } from "@/components/dashboard/viz/ChartCardHead";
import { TELEMETRY_STALE_AFTER_MS, formatAge } from "@/lib/freshness";
import { useStableTicks } from "@/lib/charts/stable";
import { useSolarToday } from "@/hooks/useSolarToday";

const word = (s: string | null | undefined) =>
  (s ? controllerLabel(s).replace(/\b[a-z]/g, (c) => c.toUpperCase()) : "Not Reported");

/** "Observed Solis state changed from None to ON" → "Observed Solis State Changed To On";
 *  UNKNOWN_0x0003 → "Unknown (0x0003)"; ON_DERATED → "On · Limited". */
function messageText(m: string): string {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  return m
    .replace(/\bfrom None to\b/g, "to")
    .replace(/\bto None\b/g, "to Not Reported")
    .replace(/\bUNKNOWN_(0x[0-9A-Fa-f]+)\b/g, "Unknown ($1)")
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (w) => w.split("_").map(cap).join(" · "))
    .replace(/\b[A-Za-z]+\b/g, (w) => (w === "x" ? w : cap(w)))
    .replace(/\bDerated\b/g, "Limited");
}

function NowCard({ s }: { s: SolisSnapshot }) {
  const age = Date.now() - s.ts;
  const stale = age > TELEMETRY_STALE_AFTER_MS;
  const v = s.solis;
  const good = isGoodRead(v);
  const today = useSolarToday().data;
  const hm = (t: number) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <Card title={`Solis Inverter${v.unit_id != null ? ` · Unit ${v.unit_id}` : ""}`}
          note={`${formatAge(age)} ago${stale ? " · Not Current" : ""}`}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", gap: 18, justifyContent: "center", flexWrap: "wrap" }}>
          <StatusTile label="State" state={v.state ? messageText(v.state) : "Not Reported"} />
          <StatusTile label="Connection" state={v.communication_quality ? word(v.communication_quality) : "Not Reported"} />
          <StatusTile label="Power Mode" state={word(v.power_mode).replace(/^Derated$/, "Limited")} />
        </div>
        <div>
          <Row label="Active Power" value={good ? num(solarKw(v), 1) : "—"} unit="kW" />
          {/* No yield register: integrated from today's S5/S6 power readings. */}
          <Row label="Generated Today (Estimate)"
               value={today?.kwh != null ? `${today.isFloor ? "≥ " : ""}${num(today.kwh, 1)}` : "—"}
               unit={today?.kwh != null ? "kWh" : undefined} />
          <Row label="Output Limit"
               value={v.power_limit_percent != null ? `${v.power_limit_percent.toFixed(0)}% · ${num(limitKw(v), 0)}` : "—"}
               unit={v.power_limit_percent != null ? "kW" : undefined} />
          <Row label="Target" value={`${v.target_state ? messageText(v.target_state) : "—"}${v.target_power_kw != null ? ` · ${v.target_power_kw.toFixed(0)} kW` : ""}`} />
        </div>
        <div>
          <Row label="Last Read" value={v.last_read_age_sec != null ? `${v.last_read_age_sec.toFixed(1)} s ago` : "—"} />
          <Row label="Last Command Confirmed" value={v.command_verified == null ? "—" : v.command_verified ? "Yes" : "No"} />
          <Row label="Last Error" value={v.last_error ?? (v.last_exception_code != null ? `Code ${v.last_exception_code}` : "None")} />
        </div>
      </div>
    </Card>
  );
}

function PowerChart({ gatewayId, rows, snaps }: { gatewayId: string; rows: SolisRecord[]; snaps: SolisSnapshot[] }) {
  /* Day / Week / Month / Year. A Day is the readings — power, and the derate
     limit as a dashed step; a read that is not GOOD is a gap, not a value.
     Longer periods are one capsule of power per day or month. */
  const nav = usePeriod("day");
  const swipe = useSwipe(nav);
  const { period } = nav;
  const isDay = period.range === "day";
  const { day, buckets, loading } = useSolarPeriod(gatewayId, period, rows);
  const data = useMemo(() => withGaps(day, gapFor(day.map((d) => d.ts))), [day]);
  const ticks = useStableTicks(
    zeroBasedTicks(Math.max(1, ...day.map((d) => Math.max(d.power ?? 0, d.limit ?? 0)))),
    `${period.range}|${period.from}`,
  );
  const latest = snaps.find((s) => isGoodRead(s.solis));
  const empty = isDay ? !day.some((d) => d.power != null || d.limit != null) : buckets.every((b) => b.n === 0);

  return (
    <Card title="Active Power">
      <div style={{ marginBottom: 10 }}><PeriodNav state={nav} /></div>
      <div style={{ display: "flex", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
        <Reading swatch={chartTokens.secondary} label="Power" value={latest ? `${num(solarKw(latest.solis), 1)} kW` : "—"} />
        <Reading swatch={chartTokens.reference} label="Output Limit" value={latest && limitKw(latest.solis) != null ? `${num(limitKw(latest.solis), 0)} kW` : "—"} />
      </div>
      <div {...swipe} style={{ ...swipe.style, height: 260, position: "relative" }}>
        {loading ? <LoadingState rows={3} /> : empty ? null : !isDay ? (
          <BucketChart buckets={buckets} kind="measure" color={chartTokens.secondary} unit="kW" period={period} height={260} />
        ) : (
          <>
            <AxisUnit unit="kW" />
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={PLOT_MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.grid} vertical={false} />
                <XAxis {...xAxis} {...timeAxisProps(day, [period.from, period.to])} />
                <YAxis {...yAxis} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} tickFormatter={tickLabel} />
                <Tooltip contentStyle={tooltipStyle} cursor={cursorStyle} labelFormatter={timeTooltipLabel}
                         formatter={(v, name) => [typeof v === "number" ? `${v.toFixed(1)} kW` : "—", name]} />
                <Line type="stepAfter" dataKey="limit" name="Output Limit" stroke={chartTokens.reference}
                      strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="power" name="Power" stroke={chartTokens.secondary}
                      strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>
    </Card>
  );
}

/** How often the controller's reads of the inverter came back GOOD. */
function LinkCard({ snaps }: { snaps: SolisSnapshot[] }) {
  const counts = new Map<string, number>();
  for (const s of snaps) {
    const q = (s.solis.communication_quality ?? "not reported").toLowerCase();
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  const order = ["good", "stale", "offline", "error", "not reported"];
  const rows = [...counts.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return (
    <Card title="Connection Quality" note={`Last ${snaps.length} Readings`}>
      {rows.map(([q, n]) => (
        <Row key={q} label={controllerLabel(q)} value={`${n} · ${((n / snaps.length) * 100).toFixed(0)}%`} />
      ))}
    </Card>
  );
}

function EventsCard({ events }: { events: SolisEventRow[] }) {
  if (!events.length) return null;
  return (
    <Card title="Events">
      <div style={{ overflowX: "auto", maxHeight: 320, maxWidth: "100%" }}>
        <table className="ps-table" style={{ minWidth: 560 }}>
          <thead>
            <tr><th>Time</th><th>Event</th><th>Severity</th><th>Message</th><th className="num">SOC BESS 1 / BESS 2</th></tr>
          </thead>
          <tbody>
            {events.map(({ ts, event: e }, i) => (
              <tr key={e.id ?? `${ts}-${i}`}>
                <td className="font-mono" style={{ whiteSpace: "nowrap" }}>{timeTooltipLabel(ts)}</td>
                <td style={{ color: "var(--ink)" }}>{word(e.event_type)}</td>
                <td>{word(e.severity)}</td>
                <td>{e.message ? messageText(e.message) : "—"}</td>
                <td className="num">
                  {e.soc_x != null ? e.soc_x.toFixed(1) : "—"} / {e.soc_y != null ? e.soc_y.toFixed(1) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function SolarInverterView({ gatewayId }: { gatewayId: string }) {
  const { data, isLoading, isError, error, refetch } = useSolisCentral(gatewayId);
  const snaps = useMemo(() => snapshotsOf(data ?? []), [data]);
  const events = useMemo(() => eventsOf(data ?? []), [data]);

  if (isLoading) return <LoadingState rows={4} />;
  if (isError) {
    return <ErrorState message={error instanceof Error ? error.message : "Solis Read Failed"} onRetry={() => refetch()} />;
  }
  if (!snaps.length) {
    return <EmptyState title="No Solis Data Yet" description="The backend holds no inverter reports for this gateway." />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap-sm)" }}>
      <NowCard s={snaps[0]} />
      <PowerChart gatewayId={gatewayId} rows={data ?? []} snaps={snaps} />
      {/* Side by side where both fit (≈ 1 : 3), stacked on a phone. A fixed
          two-column grid squeezed Events into a ~50 px column at 375 px. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--gap-sm)", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 220px", minWidth: 0 }}><LinkCard snaps={snaps} /></div>
        <div style={{ flex: "3 1 440px", minWidth: 0 }}><EventsCard events={events} /></div>
      </div>
    </div>
  );
}
