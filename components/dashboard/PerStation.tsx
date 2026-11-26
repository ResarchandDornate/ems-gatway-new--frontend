"use client";

/**
 * PerStation — BESS cockpit dashboard.
 *
 * Layout: hero strip · [today rail | live power-flow stage | plant rail] · day curves.
 *
 * Data comes from the central backend: useBessLiveCentral for the live figures
 * (shared with the power-flow twin), and useDashboardCentral for what only this
 * screen reads — the cabinet energy counters, the subsystem flags and the S2
 * series behind the recent curves. Every figure follows the unit picker: one
 * cabinet, or the site as the sum of all of them. Figures the backend cannot
 * produce (today's energy, revenue without a tariff, rated capacity) read "—".
 * Field-by-field: docs/dashboard-api-mapping.md.
 */

import { useMemo } from "react";
import type { ProfitRow, Station } from "@/lib/api/types";
import { useAlarms } from "@/hooks/useAlarms";
import { useProfitReport } from "@/hooks/useCurveReport";
import { fmtINRCompact } from "@/lib/format";
import { useFinancials } from "@/hooks/useFinancials";
import { useBessLiveCentral as useBessLive } from "@/hooks/useBessLiveCentral";
import { EnergyTwin } from "@/components/energy3d";
import { PageHeader, PageStat } from "@/components/PageHeader";
import { useSiteAssets } from "@/hooks/useSiteAssets";
import { useSiteFreshness } from "@/hooks/useSiteFreshness";
import { DailyEnergyChart } from "./viz/DailyEnergyChart";
import { SignalPeriodCard } from "./viz/SignalPeriodCard";
import { COMM_LOST_MS } from "@/lib/alarms/commLost";
import { SharedPeriodBar, SharedPeriodProvider } from "@/components/charts/SharedPeriod";
import { DASHBOARD_RANGES } from "@/lib/charts/period";
import { HoverSyncProvider } from "@/components/charts/HoverSync";
import { MultiSeriesPeriodCard } from "./viz/MultiSeriesPeriodCard";
import { series } from "@/lib/charts/tokens";
import { PowerPeriodCard, SocPeriodCard } from "./viz/PeriodCurves";
import Link from "next/link";

import { useNow } from "@/lib/charts/stable";
import { activeAlarmFilters } from "./ActiveAlarms";
import { Wifi, WifiOff } from "lucide-react";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";
import { useCabinetReadings, useS1Today, useS1Windows, useS2Recent, useSelectedCabinets } from "@/hooks/useDashboardCentral";
import { allOnline, sumOver, STATUS_FRESH_MS, type CabinetReadings } from "@/lib/api/services/dashboardCentral.service";
import { useCommDevices } from "@/hooks/usePowerStation";
import { useAppConfig } from "@/hooks/useAppConfig";
import { SUMMARY_TYPES } from "@/lib/devices/registry";
import { recentRows, s1Flag } from "./recentWindow";
import { istMidnight } from "@/lib/api/time";
import { istDate } from "@/lib/api/time";

/** Whole number with thousands separators; null → "—". */
function num(v: number | null): string {
  return v == null ? "—" : Math.round(v).toLocaleString("en-IN");
}

function runDays(iso: string): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * One reading inside a rail card: a colour-coded rule, a label, the figure.
 *
 * This replaced a card-per-figure rail. Four cards each holding a single number
 * meant four headers, four borders and four shadows to carry four values — and
 * because each card was mostly padding, the rail ran taller than the 3D stage
 * beside it and still looked empty. Rows put the same four readings in about a
 * third of the height, and the rule keeps the colour coding.
 */
function MetricRow({ label, value, unit, accent }: {
  label: string; value: number | null; unit: string; accent: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderTop: "1px solid var(--line)" }}>
      <span style={{ flex: "0 0 2px", width: 2, height: 14, borderRadius: 999, background: accent, opacity: 0.85 }} />
      <span style={{ flex: 1, fontSize: 11.5, color: "var(--ink3)", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums", color: "var(--ink)" }}>
        {num(value)}
        {value != null && <small style={{ fontSize: 10.5, fontWeight: 500, color: "var(--muted)", marginLeft: 3 }}>{unit}</small>}
      </span>
    </div>
  );
}

/**
 * Horizontal bar for a bounded 0–100 reading. Same rule as the gauge: a null
 * reading draws an empty track, never a zero-width bar that would read as a
 * measured zero.
 */
function PctBar({ label, value, accent }: { label: string; value: number | null; accent: string }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
          {value == null ? "—" : `${value.toFixed(1)}%`}
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
        {value != null && (
          <div style={{
            height: "100%", borderRadius: 999, background: accent,
            width: `${Math.max(0, Math.min(100, value))}%`, transition: "width 0.6s ease",
          }} />
        )}
      </div>
    </div>
  );
}

/** Cell temperature bands: blue below 20 °C, green to 35, orange to 45, red above. */
const tempColor = (c: number) =>
  c >= 45 ? "var(--red)" : c >= 35 ? "var(--orange)" : c >= 20 ? "var(--green)" : "var(--accent-2)";
const TEMP_SCALE_C = 60;

/** The hottest cell, on a 0–60 °C bar coloured by band. */
function HighestTemp({ maxC }: { maxC: number | null }) {
  if (maxC == null) return null;
  const color = tempColor(maxC);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Highest Temp</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color, fontVariantNumeric: "tabular-nums" }}>
          {maxC.toFixed(1)}
          <small style={{ fontSize: 10, fontWeight: 500, color: "var(--muted)" }}> °C</small>
        </span>
      </div>
      <div style={{ height: 5, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 999,
          width: `${Math.max(0, Math.min(100, (maxC / TEMP_SCALE_C) * 100))}%`,
          background: color,
          transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

/** Rail card shell: a title, an optional qualifier, then rows. */
function RailCard({ title, note, grow = false, children }: {
  title: string; note?: string;
  /** Take the rail's leftover height, spreading the rows down the card. */
  grow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={grow ? "surface-card dash-grow" : "surface-card"}
      style={{
        padding: "var(--pad-sm) var(--pad) 6px",
        ...(grow ? { display: "flex", flexDirection: "column" } : null),
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
        <h3 className="card-title">{title}</h3>
        {note && <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{note}</span>}
      </div>
      {grow
        ? <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-evenly" }}>{children}</div>
        : children}
    </div>
  );
}

function PanelHead({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
      <h2 style={{ fontSize: "var(--fs-title)", fontWeight: 600, color: "var(--ink)", margin: 0, letterSpacing: "-0.012em" }}>
        {title}
      </h2>
      {note && <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>}
    </div>
  );
}

/**
 * Subsystem reachability — the "is it still talking to us" flags the plant's
 * own EMS puts on its home screen, in its own labels and order.
 *
 * The rows are the registry's System Status types (lib/devices/registry:
 * `summary`) that the site actually has — each type's label, order and link
 * register live there, not here:
 *
 *   PCS            S1 pcs_values.pcs_online_status
 *   BMS            S1 pcs_values.bms_online_status (the PCS's view of the link)
 *   Liquid cooling S2 liquid_cooling p1146 online_points
 *   Grid meter     S2 grid_meter p1354 communication_status
 *   Dehumidifier   S2 dehumidifier p1282 online_points
 *
 * A type with no device fitted gets no row. Site 1 has no grid meter, and its
 * row used to read a permanent "Offline" off the empty slot's link register.
 *
 * On Total a row reads Online only when every cabinet that has the device
 * does, and Offline when any one does not. `rows` is null while the roster
 * loads.
 *
 * `online` is `boolean | null` rather than a bare boolean: null is the state
 * every row must be able to show, because "we have not heard yet" is not the
 * same claim as "it is offline", and a status card that cannot tell those
 * apart is worse than no card. It renders "—".
 *
 * A stale flag is shown as last reported, not blanked: when the gateway goes
 * quiet the operator needs to see the state it went quiet in. `asOf` dates it —
 * the card says "as of HH:MM" once the data is older than STATUS_FRESH_MS,
 * because the gateway keeps saying `quality: good` about devices that have
 * stopped talking, and only the timestamp can tell.
 */
type StatusRow = { label: string; online: boolean | null; at?: number | null };

/** Average cell temperature on the site-scoped backend: S2, not S1 (gatewayCompat POINT_MAP). */
const avgTempTag = (c: { sourceId: string }) => `${c.sourceId}_bms::avg_cell_temperature`;

/* Vivid status colours for the online/offline read — clearer than the muted
   house --green/--red, which wash out on the dark card. */
const STATUS_OK = "#2EC27E";
const STATUS_BAD = "#F0564A";

function SystemStatus({ rows, asOf }: { rows: StatusRow[] | null; asOf?: number | null }) {
  /* Stale when the site itself is not live (the badge's verdict), or when
     these flags are older than STATUS_FRESH_MS. Stale rows keep the state they
     went quiet in, but read as history — dimmed, "(last)" — rather than a bold
     "Online" beside a site that has stopped reporting. */
  const site = useSiteFreshness();
  const siteDown = site.label !== "Live" && site.label !== "No data";
  const stamp = asOf ?? site.lastReadingAt;
  const stale = siteDown || (asOf != null && Date.now() - asOf > STATUS_FRESH_MS);
  const when = stamp != null
    ? new Date(stamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    : null;
  return (
    <div className="surface-card dash-grow" style={{ padding: "var(--pad-sm) var(--pad)" }}>
      <h3 className="card-title" style={{ marginBottom: 6, display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>System Status</span>
        {when && <span style={{ fontSize: 10, fontWeight: 400, color: "var(--muted)" }}>Captured {when}</span>}
      </h3>
      {!rows?.length && (
        <div style={{ padding: "6px 0", borderTop: "1px solid var(--line)", fontSize: 11, color: "var(--muted)" }}>
          {rows == null ? "Reading devices…" : "No devices reported"}
        </div>
      )}
      {rows?.map(({ label, online, at }) => {
        /* The Communication Lost rule (lib/alarms/commLost): nothing captured
           for 15 minutes is lost, whatever the last bit said. */
        const lost = at != null && Date.now() - at > COMM_LOST_MS;
        const word = online == null ? "—" : lost ? "Communication Lost" : online ? "Online" : "Offline";
        const bad = lost || online === false;
        return (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid var(--line)", opacity: stale ? 0.6 : 1 }}>
          {/* The glyph carries the state as well as the word does, so the row
              still reads for someone who cannot separate the red from the ink —
              a struck-through aerial is not a colour. */}
          {bad
            ? <WifiOff size={13} strokeWidth={2} style={{ flex: "0 0 auto", color: STATUS_BAD }} />
            : <Wifi size={13} strokeWidth={2} style={{ flex: "0 0 auto", color: online == null ? "var(--line)" : STATUS_OK }} />}
          <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "var(--ink)", whiteSpace: "nowrap" }}>
            {label}
          </span>
          <span style={{
            fontSize: stale ? 12 : 13, fontWeight: stale ? 500 : 700, whiteSpace: "nowrap",
            color: online == null ? "var(--muted)" : bad ? STATUS_BAD : stale ? "var(--muted)" : STATUS_OK,
          }}>
            {word}
          </span>
        </div>
        );
      })}
    </div>
  );
}

/** "YYYY-MM-DD" in local time — the shape the ToD endpoints expect. Built from
 *  the local calendar rather than toISOString(), which is UTC: east of Greenwich
 *  that returns yesterday for most of the evening, and a month boundary read a
 *  day early puts the first of the month in the wrong bucket. */
function ymd(d: Date): string {
  return istDate(d.getTime());
}

/** The two calendar windows the revenue block reports. Day 0 of a month is the
 *  last day of the one before it, which is also how February sorts itself out. */
function revenueWindows(nowDate: Date) {
  /* The IST calendar month, built at UTC noon so the date cannot slip. */
  const [y, m, dd] = istDate(nowDate.getTime()).split("-").map(Number);
  const now = new Date(Date.UTC(y, m - 1, dd, 12));
  return {
    lastMonth: [
      ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 12))),
      ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12))),
    ] as const,
    thisMonth: [
      ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12))),
      ymd(now),
    ] as const,
  };
}

/** Rupees, summed over a report's discharge rows. */
function revenueOf(report?: { dischargeRevenue: ProfitRow[] }): number | null {
  if (!report) return null;
  return report.dischargeRevenue.reduce((sum, row) => sum + row.total, 0);
}

/**
 * Revenue, as its own card in the left rail.
 *
 * The figures are discharge revenue — energy sold, priced at the site's ToD
 * tariff by fetchProfitReport. Not margin: the same call returns `chargeCost`
 * and this block deliberately does not net the two off, because "revenue" and
 * "what the arbitrage actually made" are different questions and a single
 * unlabelled rupee figure cannot answer both.
 *
 * A site with no tariff configured reads "—", not ₹0. It used to read ₹0 on the
 * theory that zero was what was known — but zero rupees is a claim that the
 * plant earned nothing, and what is actually known is that nobody has written
 * the rate card down. No site in overlay/stations.ts SITE_OVERLAY has
 * `todRates` today, so every figure here is "—" and no report is requested.
 * Even with a tariff, the ToD split needs intra-day energy history, which the
 * central backend does not serve — so this card stays blocked on two things.
 *
 * Total is not wired, and shows "—" rather than a number. It is the one figure
 * the current fetch cannot honestly produce: the ToD split needs intra-day
 * buckets, the query caps at 5,000 of them (~208 days), and so a "lifetime"
 * total on any site older than about seven months would silently be a partial
 * sum wearing a lifetime label. Wiring it means either a settlement feed or
 * walking the history in ~200-day windows.
 */
function RevenueCard({ stationId, sourceIds, wholeSite }: {
  stationId: string;
  sourceIds: string[];
  wholeSite: boolean;
}) {
  /* Resolved once per mount: these are the query keys, and recomputing them
     every render would be a new key each time if the strings ever drifted. */
  const windows = useMemo(() => revenueWindows(new Date()), []);
  /* Settings → Revenue, else the site's diesel rate — see useFinancials. */
  const fin = useFinancials(stationId, sourceIds, wholeSite);
  /* No rates at all: a ToD rate card's profit report, where the site has one.
     An empty id disables useProfitReport. */
  const priced = !fin.rates && SITE_OVERLAY_FOR(stationId).todRates != null;
  const id = priced ? stationId : "";
  const last = useProfitReport(id, windows.lastMonth[0], windows.lastMonth[1]);
  const curr = useProfitReport(id, windows.thisMonth[0], windows.thisMonth[1]);

  const pick = (pid: string) => fin.periods.find((p) => p.id === pid)?.revenueRs ?? null;
  const rows: { label: string; value: number | null; loading: boolean }[] = fin.rates
    ? [
        { label: "Last Month", value: pick("lastMonth"), loading: fin.loading },
        { label: "This Month", value: pick("month"),     loading: fin.loading },
        { label: "Total",    value: pick("lifetime"),  loading: fin.loading },
      ]
    : [
        { label: "Last Month", value: priced ? revenueOf(last.data) : null, loading: priced && last.isLoading },
        { label: "This Month", value: priced ? revenueOf(curr.data) : null, loading: priced && curr.isLoading },
        { label: "Total",      value: null,                 loading: false },
      ];

  return (
    <Link href="/financials" className="surface-card revenue-link" style={{ padding: "var(--pad-sm) var(--pad)", display: "block", color: "inherit" }} title="Open Financials">
      <h3 className="card-title" style={{ marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        Revenue
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--muted)" }}>Financials ›</span>
      </h3>
      {/* Three across rather than three down. The rail slot is short, and a row
          of figures costs one line where a list costs three. They are the same
          kind of quantity in the same unit, so reading them side by side is no
          harder than reading them stacked. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
        {rows.map(({ label, value, loading }) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: 2 }}>
              {label}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: value == null ? "var(--muted)" : "var(--ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {loading ? "…" : value == null ? "—" : fmtINRCompact(value)}
            </div>
          </div>
        ))}
      </div>
    </Link>
  );
}

export function PerStation({ station }: { station: Station }) {
  /* Same filters the Active alarms list below uses, so the two share one
     react-query entry — the strip's figure is the length of the list, not a
     second opinion about it. */
  const { data: alarms } = useAlarms(activeAlarmFilters(station.id));
  const live = useBessLive(station.id);
  const { selected, all: allCabinets } = useSelectedCabinets();
  const { data: readings } = useCabinetReadings();
  const { data: windows } = useS1Windows();
  const { data: s2Recent } = useS2Recent();
  /* Today's charts read the fast stream from midnight (it takes a date range);
     S2 is the fallback while that loads or if it has nothing today. */
  const { data: s1Today } = useS1Today();
  const todayFromFast = !!s1Today && Object.values(s1Today).some((x) => x.soc.length || x.power.length);

  const hasThermal = live.maxCellTempC != null;
  const days = runDays(station.operationTime);

  /* The cabinets on screen, by both of their ids. */
  const sourceIds = selected.map((c) => c.sourceId);
  const bessIds = selected.map((c) => c.bessId);
  const sum = (pick: (c: CabinetReadings) => number | null) => sumOver(readings, sourceIds, pick);
  const energy = {
    /* DC: the AC lifetime pair is inconsistent (dashboardCentral POINTS). */
    lifetimeCharge:    sum((c) => c.dcChargeKwh),
    lifetimeDischarge: sum((c) => c.dcDischargeKwh),
    monthCharge:       sum((c) => c.monthChargeKwh),
    monthDischarge:    sum((c) => c.monthDischargeKwh),
    yearCharge:        sum((c) => c.yearChargeKwh),
    yearDischarge:     sum((c) => c.yearDischargeKwh),
  };

  /* A row per System Status device type (lib/devices/registry), for the
     selected cabinets that HAVE one — the roster says which (fetchCommStatus).
     A type no selected cabinet has gets no row; one fitted later gets a row
     the next time the roster is read. Null while the roster loads. */
  const { gatewayId, gatewayMode } = useAppConfig();
  const { data: roster } = useCommDevices(gatewayId);
  const subsystems: StatusRow[] | null = roster == null ? null : SUMMARY_TYPES.flatMap((t): StatusRow[] => {
    const having = selected.filter((c) => roster.some((d) => d.kind === t.kind && d.id.startsWith(`${c.sourceId}_`)));
    if (having.length === 0) return [];
    const label = t.summary ?? t.label;
    /* PCS and BMS: the fast stream's flag and time. */
    if (t.fastLink) {
      const name = t.fastLink;
      return [{ label, online: allOnline(having.map((c) => s1Flag(windows, c.bessId, name, Infinity))), at: live.lastTs ?? null }];
    }
    /* Capture time: the oldest across those cabinets, so a row is lost when
       any of them is. */
    const links = having.map((c) => readings?.[c.sourceId]?.links[t.kind]);
    const ats = links.map((l) => l?.at ?? null);
    return [{
      label,
      online: allOnline(links.map((l) => l?.online ?? null)),
      at: ats.some((a) => a == null) ? null : Math.min(...(ats as number[])),
    }];
  });

  /* A row per selected BESS unit in the same System Status card: online when
     the cabinet's PCS link reports online in its latest fast sample, and
     Communication Lost when that cabinet has gone quiet (its own last sample,
     not the site's). Same signal the PCS subsystem row aggregates. */
  const bessRows: StatusRow[] = selected.map((c) => {
    const s = windows?.[c.bessId]?.[0];
    const t = s?.sample_time_utc ? Date.parse(s.sample_time_utc) : NaN;
    return {
      label: c.label,
      online: s1Flag(windows, c.bessId, "pcs_online_status", Infinity),
      at: Number.isNaN(t) ? null : t,
    };
  });
  /* BESS units first, then the shared subsystems, in the one card. Null only
     while the device roster is still loading. */
  const statusRows: StatusRow[] | null = subsystems == null ? null : [...bessRows, ...subsystems];

  /* Keyed on the joined ids: `selected` is a fresh array every render. */
  const bessKey = bessIds.join(",");
  const recent = useMemo(
    () => recentRows(todayFromFast ? s1Today : s2Recent, selected),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s1Today, s2Recent, todayFromFast, bessKey],
  );
  /* Today only: the axis runs from local midnight to now, and readings from
     earlier days are dropped. The read can reach back days when readings are
     sparse, which drew 28 Sep onwards on 1 Oct. Line broken at gaps, caption
     with the span the readings actually cover — see lib/charts/timeAxis. */
  /* The axis end follows a clock, not the polls, so it creeps forward
     instead of stepping when a read lands (lib/charts/stable). 15 s is
     invisible on a day-long axis and spares the rest of the page a re-render
     every second. */
  const now = useNow(15_000);
  const todayRows = useMemo(() => {
    const midnight = istMidnight(now);
    return recent.rows.filter((r) => r.ts >= midnight);
  }, [recent.rows, now]);
  const siteAssets = useSiteAssets(station);
  /* No useSiteFreshness() here: it ticks every second, and called at this
     level it re-rendered every chart on the page with it. The leaves that
     show freshness (SystemStatus, the station bar) call it themselves. */

  return (
    // The wrapper owns the scroll, the grid owns the fit. In fit mode the grid is
    // exactly 100% of the wrapper so no scrollbar ever appears; below the fit
    // breakpoint the grid grows past it and this is what scrolls.
    /* One period for every graph on the page (SharedPeriod): 1 Hour, 1 Day,
       Week or 28 Days — the dashboard never reads more than 28 days. */
    <SharedPeriodProvider initial="day" ranges={DASHBOARD_RANGES}>
    {/* Hovering one chart shows that moment on every chart (HoverSync). */}
    <HoverSyncProvider>
    <div style={{ height: "100%", overflowY: "auto", overflowX: "hidden", paddingRight: 4 }}>
    <div className="dash-page dash-fit">

      {/* ── Hero strip ── page title, identity and the framing figures ── */}
      <PageHeader
        title="Dashboard"
        // Info icon removed from the Dashboard header.
        // info={`${station.powerStationEnglishName || station.id} · Battery Energy Storage System · live power & energy`}
        /* Freshness pill removed from the header; the station bar's badge still
           shows Live / Delayed / Offline.
        status={
          /* Same verdict as the station-bar badge (useSiteFreshness): this pill
             used to call data live for 15 minutes, beside a badge saying the
             site was offline. * /
          <span
            className={
              freshness.label === "Live" ? "pill green"
              : freshness.label === "Delayed" ? "pill amber"
              : freshness.label === "No data" ? "pill gray"
              : "pill red"
            }
            style={{ fontSize: 10 }}
            title={freshness.title}
          >
            <span className="dot" />
            {freshness.label.toLowerCase()}
          </span>
        }
        */
      >
        {/* Active now, not today's tally. `summary.todayAlarms` counted everything
            raised since midnight including alarms since cleared, so a plant that
            had a rough morning and was fixed by ten still read as a plant with
            alarms — and the list directly below it, which has always been
            active-only, would show none of them. */}
        <PageStat label="Active Alarms" value={alarms?.total == null ? "—" : String(alarms.total)} />
        <PageStat label="Installed Power" value={station.installedPower ? `${station.installedPower.toLocaleString("en-IN")} kW` : "—"} />
        <PageStat label="Rated Capacity" value={station.installedCapacity ? `${station.installedCapacity.toLocaleString("en-IN")} kWh` : "—"} />
        <PageStat label="Run Days" value={days == null ? "—" : `${days}`} />
      </PageHeader>

      {/* ── Cockpit: today rail · flow stage · plant rail ── */}
      <div className="dash-cockpit">
        <div className="dash-rail dash-rail-fill">
          {/*
            State of charge leads the rail: it is the one reading an operator
            checks first. State of health sits under it on the same 0–100 scale.
          */}
          <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad)" }}>
            {/* State of charge as a figure over a bar, not a dial: the dial had to
                shrink to 56px to fit this rail, and at that size its number no
                longer fit inside the arc. */}
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>State Of Charge</span>
              <span style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
                {live.soc == null ? "—" : live.soc.toFixed(1)}
                {live.soc != null && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500, marginLeft: 2 }}>%</span>}
              </span>
            </div>
            <div style={{ height: 6, marginTop: 8, borderRadius: 999, background: "var(--line)", overflow: "hidden" }}>
              {live.soc != null && (
                /* One gradient across the whole track (red empty → blue full),
                   clipped at the SOC, so the fill's end colour tracks the level. */
                <div style={{
                  height: "100%", borderRadius: 999,
                  background: "linear-gradient(90deg, var(--red) 0%, var(--orange) 33%, var(--green) 66%, var(--accent-2) 100%)",
                  backgroundSize: `${10000 / Math.max(1, Math.min(100, live.soc))}% 100%`,
                  width: `${Math.max(0, Math.min(100, live.soc))}%`, transition: "width 0.6s ease",
                }} />
              )}
            </div>
            {/* Paired, not stacked. Both are a label over a bar on the same
                bounded scale, so side by side they read as one row about the
                bank's condition and cost one row's height instead of two — the
                38px that decides whether this rail fits its slot on a live
                station. Thermal spread renders only when both cell temperatures
                are present, so state of health takes the full width alone rather
                than sitting in a half-width column beside a gap. */}
            <div style={{
              marginTop: 14, display: "grid", gap: 12,
              gridTemplateColumns: hasThermal ? "1fr 1fr" : "1fr",
            }}>
              <PctBar label="State Of Health" value={live.soh} accent="var(--green)" />
              {hasThermal && <HighestTemp maxC={live.maxCellTempC} />}
            </div>
          </div>

          {/* Its own card rather than a block inside the one above. The rail is
              content-height beside a stage that fills the row, so the space under
              it was going spare; a card uses that deliberately instead of leaving
              a gap. It costs its own padding and title to do so, which is why the
              dial above cannot grow by as much as the split appears to free. */}
          <RevenueCard
            stationId={station.id}
            sourceIds={sourceIds}
            wholeSite={selected.length === allCabinets.length}
          />

          {/* Today reads in the live accent, lifetime in the quieter pair — the
              rule colour groups the rail into two pairs at a glance. */}
          {/* Two cards folded into one: on a fixed-height screen a second card
              header and its padding cost ~55px that the 3D stage needs more. */}
          <RailCard title="Energy" grow>
            <MetricRow label="Charge · Today" value={live.chargedKwh} unit="kWh" accent="var(--accent)" />
            <MetricRow label="Discharge · Today" value={live.dischargedKwh} unit="kWh" accent="var(--green)" />
            {/* Today stays "—": it is a counter minus its midnight reading, and
                nothing serves a midnight reading. Lifetime is the PCS's own DC
                counter (p0205/p0206), summed over the cabinets on screen. */}
            <MetricRow label="Charge · Lifetime" value={energy.lifetimeCharge} unit="kWh" accent="var(--gold)" />
            <MetricRow label="Discharge · Lifetime" value={energy.lifetimeDischarge} unit="kWh" accent="var(--accent-2)" />
          </RailCard>
        </div>

        <div className="surface-card dash-stage" style={{ padding: "var(--pad-sm) var(--pad)", display: "flex", flexDirection: "column", minWidth: 0 }}>
          <PanelHead title="Live Power Flow" />
          {/* 240 rather than 300, and the same figure the stage itself is given
              below — two different floors for one box is how the wrapper ends up
              asserting a height the scene inside it has already overruled.
              `flex: 1` is what gives the canvas a definite height to measure,
              which is the part that matters to it. */}
          <div style={{ flex: 1, minHeight: 240 }}>
            {/*
              The twin reads the same station through its own data layer rather
              than taking `live` as props. That looks like a duplicated fetch
              and is not one — both go through the same react-query key, so the
              second caller is served from cache. What it buys is that the
              visualisation keeps a single input shape (EnergySnapshot) whoever
              mounts it, which is the whole point of lib/energy.

              Overlay off: run days, capacity and the live/stale badge are
              already in this page's header and rails.
            */}
            <EnergyTwin
              source="gateway"
              stationId={station.id}
              /* The cabinets on screen, not the site: one BESS of two is half
                 the 522 kWh, so its SOC × rating is its own stored energy. */
              ratedCapacityKwh={station.installedCapacity
                ? (station.installedCapacity * selected.length) / Math.max(1, allCabinets.length)
                : null}
              runDays={days}
              assets={siteAssets.assets}
              showOverlay={false}
              /* Only the stacked layout below 1180px cannot afford the scene's
                 320px default; beside the rails the stage is a full-height column
                 and squashing it there is what turned the isometric view into a
                 flat sliver. 240 keeps the scene in proportion and still fits the
                 narrow case. */
              minHeight={240}
            />
          </div>
        </div>

        <div className="dash-rail dash-rail-fill">
          {/*
            Bank readings stood here — DC bus voltage, stack current, avg and max
            cell temperature, and the thermal-spread bar under them. All five are
            gone with the card. The spread bar was the only cell-imbalance cue on
            this screen, so if it is wanted back it needs a home of its own rather
            than a corner of the status card.
          */}
          <SystemStatus rows={statusRows} asOf={live.lastTs} />

        </div>
      </div>

      {/* The graphs' one period control, above all the chart rows. */}
      <SharedPeriodBar />

      {/* ── Charts ── throughput + the two day curves, sharing one row ── */}
      <div className="dash-charts">
        <DailyEnergyChart stationId={station.id} />

        {/* Day (from midnight, live) / Week / Month / Year — see viz/PeriodCurves. */}
        <SocPeriodCard cabinets={selected} todayRows={todayRows} />
        <PowerPeriodCard cabinets={selected} todayRows={todayRows} nowKw={live.battKw} nowKwBySource={live.battKwBySource} nowTs={live.lastTs} />
      </div>
    </div>

    {/* ── Second chart row ── below the one-screen grid, so the dashboard
        scrolls to it rather than squeezing every chart to fit. */}
    <div className="dash-charts" style={{ marginTop: "var(--gap)", paddingBottom: "var(--gap)" }}>
      <SignalPeriodCard title="State Of Health" cabinets={selected} signal="soh" unit="%" domain={[0, 100]} color={series("primary").stroke} />
      <SignalPeriodCard title="Average Battery Temperature" cabinets={selected} signal="average_temperature" unit="°C" domain={[0, 50]}
        color="var(--orange)" tagOf={gatewayMode ? avgTempTag : undefined} />
      <SignalPeriodCard title="Current" cabinets={selected} signal="cluster_total_current" unit="A" signed color="var(--green)" />
    </div>

    {/* ── Third chart row ── battery temperature extremes and the PCS's power
        per phase, each combined across the selected BESS. */}
    <div className="dash-charts dash-charts-2" style={{ paddingBottom: "var(--gap)" }}>
      <MultiSeriesPeriodCard
        title="Max And Min Battery Temperature" cabinets={selected} unit="°C" domain={[0, 50]}
        specs={[
          { label: "Max", color: "var(--red)", combine: "max", tagOf: (c) => `fast:${c.bessId}:bms_values::battery_max_temperature` },
          { label: "Min", color: "var(--accent-2)", combine: "min", tagOf: (c) => `fast:${c.bessId}:bms_values::battery_min_temperature` },
        ]}
      />
      {/* Line voltage AB / BC / CA over time, combined across the selected BESS.
          Off the 1 s fast stream (grid_voltage_*_v) — CleanEdge does not report
          per-phase active power, so this card carries the line voltages. */}
      <MultiSeriesPeriodCard
        title="Line Voltage" cabinets={selected} unit="V"
        specs={[
          { label: "AB", color: series("primary").stroke, combine: "max", tagOf: (c) => `fast:${c.bessId}:pcs_values::grid_voltage_ab_v` },
          { label: "BC", color: series("secondary").stroke, combine: "max", tagOf: (c) => `fast:${c.bessId}:pcs_values::grid_voltage_bc_v` },
          { label: "CA", color: "var(--green)", combine: "max", tagOf: (c) => `fast:${c.bessId}:pcs_values::grid_voltage_ca_v` },
        ]}
      />
    </div>
    </div>
    </HoverSyncProvider>
    </SharedPeriodProvider>
  );
}
