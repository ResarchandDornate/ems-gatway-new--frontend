"use client";

/**
 * Energy — the plant's calendar, rather than its last N minutes.
 *
 * History answers "what has this plant been doing", anchored to now and sized
 * in spans. That is the operational question and it is the right shape for it.
 * This screen answers the other one: what did it do *yesterday*, this week,
 * last month — a period with edges somebody else chose, that can be stepped
 * through and compared against the one before it.
 *
 * The split matters because the two cannot share a control. A rolling "24h"
 * and a calendar "3 September" are different windows on the same data, and a
 * screen offering both ends up labelling one with the other's heading.
 *
 * ── Where each period's figures come from ─────────────────────────────────
 *
 * Day, week and month are integrated from the historian, through the same
 * server-side aggregation History reads, so they are exact over the window and
 * carry their own coverage. Year and lifetime cannot be: the gateway retains
 * ninety days, so a year is mostly a period this app has no rows for and never
 * will. Those two read the plant's **own cumulative counters** instead —
 * bms_1's yearly registers and the PCS's lifetime AC totals — which are
 * measured by the plant and are not a summary of anything this app holds.
 *
 * They are therefore presented differently and labelled as what they are. A
 * chart drawn over a counter would be a fabrication; a counter presented as
 * though this app had integrated it would be a quieter one.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 *
 * No produced, no consumed, no self-consumption share, no savings. The
 * reference app this screen is modelled on leads with all four, and none of
 * them can be assembled from what this gateway historises: no tariff reaches
 * it, and the utility meter reports cumulative registers rather than
 * per-period energy — and on this site it is not communicating at all.
 * Charged and discharged are what is actually metered here, so they are what
 * this screen shows.
 *
 * "Produced" is the one to revisit. This screen was built believing the site
 * had no solar; it has. `/api/solis/status` reports a PV inverter, and the
 * dashboard now shows its live output — but live power is all that endpoint
 * can give. What blocks a produced figure *here* is the absence of a series:
 * the endpoint is a state read, and its history sibling is an event log
 * written when the controller acts rather than on a cadence, so the gaps
 * between its rows are not measurement intervals. PV energy over a period
 * cannot be integrated from that, and a "Produced" bar assembled from it
 * would be the first invented number in this app.
 *
 * A cadenced `solis_power_w` in the historian would unblock it, and that ask
 * is with the gateway team — see docs/gateway-findings-2026-09-03.md.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, TriangleAlert, Info, BatteryCharging, Zap,
  Gauge, CalendarDays, LineChart as LineIcon, Sun, Building2,
} from "lucide-react";

import { useHistory, useSite, useSolis } from "../data";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, Segmented, Shimmer, MetricCard, Value,
  FeatureCard, Chip, ChipRow, Readout, StatusIndicator, StationStatus, ListItem,
  SectionMenu, SectionBack, useSection,
} from "../components";
import { EnergyProfile, type EnergySlot } from "../viz/EnergyProfile";

/* ── Periods ───────────────────────────────────────────────────────────── */

/**
 * Only the three the historian can draw.
 *
 * Year and lifetime used to be two more tabs on this control, which put four
 * charted periods and two register reads behind one segmented switch and made
 * them look like the same kind of answer. They are not, and they now live in
 * their own section — see TotalsSection.
 */
type Period = "day" | "week" | "month";

const PERIODS: { value: Period; label: string }[] = [
  { value: "day",   label: "Day" },
  { value: "week",  label: "Week" },
  { value: "month", label: "Month" },
];

/**
 * What the gateway keeps.
 *
 * Its own storage note gives ninety days, and the store on this side is filled
 * from it, so stepping back past this is stepping into a period for which no
 * row can ever arrive. The back button stops there and says why, rather than
 * offering an empty chart of August 2025.
 */
const RETENTION_DAYS = 90;

/* Local time throughout. A day boundary is the one the person reading this
   screen lives in, not UTC — a plant in IST that starts charging at 23:00
   belongs to that evening, and shifting it five and a half hours into the next
   morning would misattribute every night of the month. */

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Monday-first, which is what a week means in the plant's own reporting. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

interface PeriodWindow {
  /** The whole period, whether or not it has finished. */
  from: number;
  to: number;
  /** Heading, in the reader's terms. */
  title: string;
  /** How many slots the chart is divided into, and what each is called. */
  slots: number;
  slotLabel: (i: number, start: Date) => string;
  slotMs: number;
}

/**
 * The period `back` steps before the one containing `now`.
 *
 * Built with Date arithmetic rather than by subtracting milliseconds, because
 * neither a month nor — in a timezone that observes it — a day is a fixed
 * number of them. IST does not observe daylight saving, so this is currently
 * belt and braces; it costs nothing and it is the difference between this
 * working and this quietly dropping an hour if the app is ever read elsewhere.
 */
function periodWindow(period: Period, back: number, now: number): PeriodWindow {
  const n = new Date(now);

  if (period === "day") {
    const s = startOfDay(n);
    s.setDate(s.getDate() - back);
    const e = new Date(s);
    e.setDate(e.getDate() + 1);
    return {
      from: s.getTime(), to: e.getTime(),
      title: s.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" }),
      slots: 24,
      slotMs: 3_600_000,
      slotLabel: (i) => String(i).padStart(2, "0"),
    };
  }

  if (period === "week") {
    const s = startOfWeek(n);
    s.setDate(s.getDate() - back * 7);
    const e = new Date(s);
    e.setDate(e.getDate() + 7);
    const end = new Date(e.getTime() - 1);
    return {
      from: s.getTime(), to: e.getTime(),
      title: `${s.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – ${end.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
      slots: 7,
      slotMs: 86_400_000,
      slotLabel: (i, start) => {
        const d = new Date(start);
        d.setDate(d.getDate() + i);
        return d.toLocaleDateString("en-IN", { weekday: "short" }).slice(0, 3);
      },
    };
  }

  const s = startOfMonth(n);
  s.setMonth(s.getMonth() - back);
  const e = new Date(s);
  e.setMonth(e.getMonth() + 1);
  /* Days in this month, not 30. February and the thirty-one-day months both
     get the right number of bars this way, and the last bar of a short month
     is a bar rather than an empty slot. */
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000);
  return {
    from: s.getTime(), to: e.getTime(),
    title: s.toLocaleDateString("en-IN", { month: "long", year: "numeric" }),
    slots: days,
    slotMs: 86_400_000,
    slotLabel: (i) => String(i + 1),
  };
}

/* ── Screen ────────────────────────────────────────────────────────────── */

const BASE = "/k/energy";

/**
 * The contents page.
 *
 * Named for the questions a reader actually arrives with, not for the
 * endpoints behind them — "where did my energy go this week" rather than
 * "historian aggregation". Two of the four are things this gateway cannot
 * answer, and they are listed anyway, disabled, with the reason in their own
 * subtitle: a reader who cannot find consumption needs to know it is not
 * measured here, which is a different fact from the app not having the screen.
 *
 * Nothing on this page fetches. Every section owns its own hooks and mounts
 * only when opened, so arriving at Energy costs one render and no gateway
 * reads — the whole point of putting a menu in front of it. The battery
 * section in particular pulls a window of history that can take tens of
 * seconds cold, and it used to do that whether or not anyone wanted it.
 */
const SECTIONS = [
  { key: "trends",      title: "Charge and discharge" },
  { key: "generation",  title: "Solar generation" },
  { key: "consumption", title: "Site consumption" },
  { key: "totals",      title: "Totals and counters" },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];
const KEYS = SECTIONS.map((s) => s.key);

export function EnergyScreen() {
  const section = useSection(BASE, KEYS) as SectionKey | null;

  if (section === "trends") {
    return (
      <>
        <Header />
        <SectionBack title="Energy" base={BASE} />
        <ChargeDischargeSection />
      </>
    );
  }

  if (section === "generation") {
    return (
      <>
        <Header />
        <SectionBack title="Energy" base={BASE} />
        <GenerationSection />
      </>
    );
  }

  if (section === "totals") {
    return (
      <>
        <Header />
        <SectionBack title="Energy" base={BASE} />
        <TotalsSection />
      </>
    );
  }

  /* "consumption" never resolves to a section: its menu row is disabled, so
     the only way here is a typed URL, and the menu is the right landing for
     one of those. */
  return (
    <>
      <Header />
      <StationStatus />
      <div style={{ padding: "0 4px 18px" }}>
        <span className="m-h1 m-ink">Energy</span>
      </div>
      <SectionMenu
        base={BASE}
        items={[
          {
            key: "trends",
            title: "Charge and discharge",
            subtitle: "By hour, day, week or month — stepped back through the calendar",
            icon: <BatteryCharging size={17} />,
          },
          {
            key: "generation",
            title: "Solar generation",
            subtitle: "What the PV inverter is producing right now",
            icon: <Sun size={17} />,
          },
          {
            key: "consumption",
            title: "Site consumption",
            /* Listed and refused rather than hidden. The utility meter is the
               only instrument that could answer this and it is not
               communicating, which a reader is better off being told than
               left to infer from an absence. */
            subtitle: "Not available — the utility meter is not communicating with the site controller",
            icon: <Building2 size={17} />,
            disabled: true,
          },
          {
            key: "totals",
            title: "Totals and counters",
            subtitle: "This year and since commissioning, from the plant's own registers",
            icon: <Gauge size={17} />,
          },
        ]}
      />

      {/* One line, once, instead of the caveat paragraphs that used to sit
          under every figure on this screen. The detail still exists — it is
          inside the sections it applies to. */}
      <div className="m-label m-ink3" style={{ padding: "16px 6px 0", lineHeight: 1.55 }}>
        Every figure here is metered by the plant. Nothing is priced, because no tariff reaches
        this gateway.
      </div>
    </>
  );
}

/* ── Charge and discharge ──────────────────────────────────────────────── */

function ChargeDischargeSection() {
  const [period, setPeriod] = useState<Period>("day");
  /* How many periods before the current one. Reset on every change of period,
     because "three back" means three days in one and three months in another,
     and carrying it across would land the reader somewhere they did not ask
     for. */
  const [back, setBack] = useState(0);

  const now = Date.now();
  const w = useMemo(
    () => periodWindow(period, back, now),
    /* `now` deliberately not a dependency: it changes every render and the
       window it produces does not, except at a period boundary — which the
       next interaction picks up. Depending on it would rebuild this object
       every render and re-key the query below through `useHistory`. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [period, back],
  );

  /* The request stops at now; the chart's slot grid does not.

     Asking for the rest of today would have the server open chunks for hours
     that have not happened. Shrinking the axis to match would then draw a
     partly-elapsed day as a complete short one — the exact misreading the
     history rewrite was done to fix. So the window asked for is clipped and
     the grid below stays the period's own width: this morning draws as this
     morning, with the afternoon empty and labelled.

     Rounded down to the minute so the query key holds still between renders. A
     key derived from a raw clock changes on every paint and refetches a window
     the chunk cache already holds. */
  const askTo = Math.max(
    /* Never zero-width. In the first minute of a new period the clamp above
       lands exactly on `w.from` — buildSeries requires `to` to be after
       `from` and answers a 400, so for that one minute the Day view would
       have shown a gateway error instead of an empty morning. A minute of
       window that has not happened yet costs nothing: the server clips its
       own coverage to now regardless. */
    w.from + 60_000,
    Math.min(w.to, Math.floor(now / 60_000) * 60_000),
  );
  const spanMinutes = Math.max(1, Math.round((askTo - w.from) / 60_000));

  const h = useHistory(spanMinutes, undefined, { from: w.from, to: askTo });
  const site = useSite();

  const coverage = h.coverage;
  /* Same test History uses, and for the same reason: zero chunks read is zero
     chunks read, whatever was asked for. Without it an unanswered request
     falls through to "nothing recorded", which is a confident claim about the
     plant made in the one situation where the app knows least. */
  const unread = !h.isLoading && !h.error && coverage.ready === 0;

  /**
   * The server's buckets, folded onto the period's own slots.
   *
   * Energy is summed from `chargedKwh`/`dischargedKwh`, which the server
   * integrated over raw rows — never from the plotted power, which is a mean
   * and would lose whatever the plant did between two samples.
   *
   * A slot stays null until a sample lands in it, so an hour nobody has read
   * and an hour the plant sat idle are drawn differently.
   */
  const slots = useMemo<EnergySlot[]>(() => {
    const start = new Date(w.from);
    const out: EnergySlot[] = Array.from({ length: w.slots }, (_, i) => ({
      t: w.from + i * w.slotMs,
      label: w.slotLabel(i, start),
      chargedKwh: null,
      dischargedKwh: null,
      soc: null,
    }));

    /* Slot boundaries by calendar arithmetic, not by dividing the offset —
       the same reason periodWindow uses Date methods. */
    const edges = out.map((_, i) => {
      const d = new Date(w.from);
      if (w.slotMs === 3_600_000) d.setHours(d.getHours() + i);
      else d.setDate(d.getDate() + i);
      return d.getTime();
    });

    const socSum = new Array<number>(w.slots).fill(0);
    const socN = new Array<number>(w.slots).fill(0);

    for (const s of h.samples) {
      /* Linear scan of the edges would be O(samples × slots); a month of
         hourly buckets against 31 slots is small either way, but the bisect is
         three lines and removes the question. */
      let lo = 0, hi = w.slots - 1, at = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const end = mid + 1 < w.slots ? edges[mid + 1] : w.to;
        if (s.t < edges[mid]) hi = mid - 1;
        else if (s.t >= end) lo = mid + 1;
        else { at = mid; break; }
      }
      if (at < 0) continue;

      const slot = out[at];
      slot.chargedKwh = (slot.chargedKwh ?? 0) + s.chargedKwh;
      slot.dischargedKwh = (slot.dischargedKwh ?? 0) + s.dischargedKwh;
      if (s.soc != null) { socSum[at] += s.soc; socN[at] += 1; }
    }

    for (let i = 0; i < w.slots; i++) {
      if (socN[i] > 0) out[i].soc = socSum[i] / socN[i];
    }
    return out;
  }, [h.samples, w]);

  const drawn = slots.some((s) => s.chargedKwh != null);

  /* Rounded once, so the parts add up to the headline on screen. Same
     arithmetic as History, and for the same reason recorded there: rounding
     each of three figures independently produced a total a reader could check
     and find wrong. */
  const dp1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const charged = unread ? null : dp1(h.totals.charged);
  const discharged = unread ? null : dp1(h.totals.discharged);
  const throughput = charged == null || discharged == null ? null : charged + discharged;

  const fillPct = coverage.windowMs
    ? Math.min(100, Math.round((coverage.coveredMs / coverage.windowMs) * 100))
    : 0;

  /* How far back this period may be stepped. A period whose end falls before
     the gateway's retention holds no rows and never will, so the control stops
     rather than offering a window that is permanently empty. */
  const retentionFloor = now - RETENTION_DAYS * 86_400_000;
  const prev = periodWindow(period, back + 1, now);
  const canGoBack = prev.to > retentionFloor;
  const canGoForward = back > 0;

  return (
    <>
      <Segmented<Period>
        ariaLabel="Energy period"
        value={period}
        onChange={(v) => { setPeriod(v); setBack(0); }}
        options={PERIODS}
      />

      <ChartedPeriod
          w={w}
          title={w.title}
          isToday={back === 0}
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onStep={(d) => setBack((b) => Math.max(0, b + d))}
          retentionDays={RETENTION_DAYS}
          h={h}
          unread={unread}
          drawn={drawn}
          slots={slots}
          charged={charged}
          discharged={discharged}
          throughput={throughput}
          fillPct={fillPct}
          period={period}
        monthCounter={
          period === "month" && back === 0
            ? { charged: site.chargedKwhMonth, discharged: site.dischargedKwhMonth }
            : null
        }
      />
    </>
  );
}

/* ── The charted periods ───────────────────────────────────────────────── */

function ChartedPeriod({
  w, title, isToday, canGoBack, canGoForward, onStep, retentionDays,
  h, unread, drawn, slots, charged, discharged, throughput, fillPct, period,
  monthCounter,
}: {
  w: PeriodWindow;
  title: string;
  isToday: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onStep: (d: number) => void;
  retentionDays: number;
  h: ReturnType<typeof useHistory>;
  unread: boolean;
  drawn: boolean;
  slots: EnergySlot[];
  charged: number | null;
  discharged: number | null;
  throughput: number | null;
  fillPct: number;
  period: Period;
  monthCounter: { charged: number | null; discharged: number | null } | null;
}) {
  const router = useRouter();
  const coverage = h.coverage;

  return (
    <>
      {/* ── Which period, and how to leave it ────────────────────────── */}
      <div className="m-period" style={{ marginTop: 14 }}>
        <button
          className="m-period-step"
          aria-label="Previous period"
          disabled={!canGoBack}
          onClick={() => onStep(1)}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="m-period-title">
          <CalendarDays size={14} />
          <span>{isToday ? `${title} · so far` : title}</span>
        </div>
        <button
          className="m-period-step"
          aria-label="Next period"
          disabled={!canGoForward}
          onClick={() => onStep(-1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* ── The headline ─────────────────────────────────────────────── */}
      <FeatureCard style={{ marginTop: 14, marginBottom: 18 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Energy through the battery</span>
          {h.isFilling && !h.error && <StatusIndicator tone="warn" label={`Loading ${fillPct}%`} />}
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={throughput} unit="kWh" precision={1} />
        </div>
        <ChipRow>
          <Chip>Charged <Value value={charged} unit="kWh" precision={1} /></Chip>
          <Chip>Discharged <Value value={discharged} unit="kWh" precision={1} /></Chip>
          {!unread && h.totals.socMin != null && h.totals.socMax != null && (
            <Chip>SOC {h.totals.socMin.toFixed(0)}–{h.totals.socMax.toFixed(0)}%</Chip>
          )}
        </ChipRow>
      </FeatureCard>

      {/* One block, however many of these are true — the same argument the
          History banner records. Three separate notices on a 375pt phone push
          the chart off the first screenful. */}
      {(h.undecodable > 0 || (!h.isLoading && !h.error && !coverage.complete && coverage.coveredMs > 0) || !canGoBack) && (
        <div className={`m-banner${h.undecodable > 0 ? " is-warn" : ""}`}>
          {h.undecodable > 0
            ? <TriangleAlert size={15} style={{ flex: "none", marginTop: 1 }} />
            : <Info size={15} style={{ flex: "none", marginTop: 1 }} />}
          <div className="m-stack" style={{ gap: 6 }}>
            {h.undecodable > 0 && (
              <span>
                Some readings in this period could not be read and are excluded from the figures
                above, rather than counted as zero.
              </span>
            )}
            {!h.isLoading && !h.error && !coverage.complete && coverage.coveredMs > 0 && (
              <span>
                {h.isFilling ? "Still loading this period." : "This period is incomplete."} The
                figures above cover only what has arrived.
              </span>
            )}
            {!canGoBack && (
              <span>
                This is as far back as the gateway goes — it keeps about {retentionDays} days.
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── The chart ────────────────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title={period === "day" ? "By hour" : "By day"} />
        <FloatingCard>
          {h.isLoading ? (
            <Shimmer w="100%" h={200} r={16} />
          ) : h.error ? (
            <div className="m-empty">
              <span className="m-empty-mark"><TriangleAlert size={19} /></span>
              <span className="m-body m-ink3">{h.error}</span>
            </div>
          ) : !drawn ? (
            <div className="m-empty">
              <span className="m-empty-mark">
                {unread ? <TriangleAlert size={19} /> : <LineIcon size={19} />}
              </span>
              {/* Two facts, two sentences. A read that succeeded and held
                  nothing is a real answer about a plant that was not logging;
                  a period nothing came back for is a statement about this app. */}
              <span className="m-body m-ink3">
                {unread
                  ? "Nothing has loaded for this period yet."
                  : "No energy recorded for this period."}
              </span>
            </div>
          ) : (
            <>
              <div className="m-chart" style={{ height: 220 }}>
                <EnergyProfile slots={slots} />
              </div>
              <div className="m-chart-legend">
                <span className="m-legend-key">
                  <span className="m-legend-swatch" style={{ background: "var(--m-series-1)" }} />
                  Discharged kWh
                </span>
                <span className="m-legend-key">
                  <span className="m-legend-swatch" style={{ background: "var(--m-series-2)" }} />
                  Charged kWh
                </span>
                <span className="m-legend-key">
                  <span className="m-legend-swatch" style={{ background: "var(--m-ink-3)" }} />
                  SOC %
                </span>
              </div>
            </>
          )}
        </FloatingCard>
      </div>

      {/* ── The period, summarised ───────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Period summary" />
        <div className="m-grid2">
          <MetricCard
            label="Discharged"
            icon={<Zap size={15} />}
            loading={h.isLoading}
            value={<Value value={discharged} unit="kWh" precision={1} animate />}
          />
          <MetricCard
            label="Charged"
            icon={<BatteryCharging size={15} />}
            loading={h.isLoading}
            value={<Value value={charged} unit="kWh" precision={1} animate />}
          />
          <MetricCard
            label="Peak power"
            icon={<Gauge size={15} />}
            loading={h.isLoading}
            value={<Value value={unread ? null : h.totals.peakKw} unit="kW" precision={1} animate />}
            footnote="Highest in either direction"
          />
          <MetricCard
            label="Full cycles"
            icon={<BatteryCharging size={15} />}
            loading={h.isLoading}
            /* Throughput expressed in cycles needs a pack capacity in kWh, and
               this gateway reports SOC as a percentage and never states one.
               Named as absent rather than estimated from a nameplate nobody
               has entered — a cycle count that is really a guess is the sort
               of figure warranty conversations get had over. */
            value={<Value value={null} unit="" precision={0} />}
            footnote="Needs a pack capacity, which the gateway does not report"
          />
        </div>
      </div>

      {/* The plant's own register, next to what this app integrated. Shown
          only for the month in progress, because that is the counter's own
          period — bms_1's monthly register resets, and holding it against a
          past month would compare this September to whatever month the plant
          is currently counting. */}
      {monthCounter && (monthCounter.charged != null || monthCounter.discharged != null) && (
        <div className="m-label m-ink3" style={{ padding: "16px 6px 0", lineHeight: 1.55 }}>
          The battery&rsquo;s own monthly counter reads{" "}
          <Value value={monthCounter.charged} unit="kWh" precision={0} /> charged and{" "}
          <Value value={monthCounter.discharged} unit="kWh" precision={0} /> discharged. It is
          measured by the BMS rather than integrated here, so it is the figure to trust where the
          two differ — the chart above can only cover the periods this app has read.
        </div>
      )}

      <div className="m-label m-ink3" style={{ padding: "16px 6px 0", lineHeight: 1.55 }}>
        Import and export are not broken out. The utility meter reports running totals rather than
        energy per period, and on this site it is not communicating — so a figure here would be
        derived from a register that is not being read.
      </div>

      {/* The same historian, read the other way. This screen is deliberately
          coarse — a bar is an hour or a day — and the question it cannot answer
          is what happened at 14:32. That one belongs to History, along with the
          query box, so the way there is offered here rather than left to
          somebody remembering the URL. */}
      <div style={{ marginTop: 22 }}>
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<LineIcon size={17} />}
            title="Power and SOC, minute by minute"
            subtitle="Rolling windows from 15 minutes to 30 days, and a box you can ask questions in"
            onClick={() => router.push("/k/history")}
            trailing={<ChevronRight size={16} className="m-ink3" />}
          />
        </FloatingCard>
      </div>
    </>
  );
}

/* ── Totals and counters ───────────────────────────────────────────────── */

/**
 * The plant's cumulative registers, presented as registers.
 *
 * No chart and no date stepper, because there is nothing behind them: the
 * gateway retains ninety days, so this app cannot draw a year and cannot step
 * back through one. What it can do is read the counters the plant keeps
 * itself, which cover the whole period and are not a summary of anything here.
 *
 * Year and lifetime are shown together rather than behind a switch. They are
 * four numbers between them; making the reader toggle to see two of them would
 * be the clutter this restructure is removing, applied backwards.
 */
function TotalsSection() {
  const site = useSite();

  const yearCharged = site.chargedKwhYear;
  const yearDischarged = site.dischargedKwhYear;
  const lifeCharged = site.acChargedKwhTotal;
  const lifeDischarged = site.acDischargedKwhTotal;

  const nothing =
    yearCharged == null && yearDischarged == null &&
    lifeCharged == null && lifeDischarged == null;

  return (
    <>
      <div style={{ padding: "0 4px 14px" }}>
        <span className="m-h1 m-ink">Totals</span>
      </div>

      <div className="m-banner">
        <Info size={15} style={{ flex: "none", marginTop: 1 }} />
        <span>
          These are the plant&rsquo;s own cumulative registers, read directly — not totals
          assembled by this app. The gateway keeps about {RETENTION_DAYS} days of readings, so
          neither can be charted or stepped through here.
        </span>
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="This year" />
        <div className="m-grid2">
          <MetricCard
            label="Discharged"
            icon={<Zap size={15} />}
            value={<Value value={yearDischarged} unit="kWh" precision={0} grouping="indian" />}
            footnote="BMS yearly register"
          />
          <MetricCard
            label="Charged"
            icon={<BatteryCharging size={15} />}
            value={<Value value={yearCharged} unit="kWh" precision={0} grouping="indian" />}
            footnote="BMS yearly register"
          />
        </div>
        <div className="m-label m-ink3" style={{ padding: "10px 6px 0", lineHeight: 1.55 }}>
          Measured at the battery by the BMS. These do not reset mid-year.
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Since commissioning" />
        <div className="m-grid2">
          <MetricCard
            label="Discharged"
            icon={<Zap size={15} />}
            value={<Value value={lifeDischarged} unit="kWh" precision={0} grouping="indian" />}
            footnote="PCS lifetime AC total"
          />
          <MetricCard
            label="Charged"
            icon={<BatteryCharging size={15} />}
            value={<Value value={lifeCharged} unit="kWh" precision={0} grouping="indian" />}
            footnote="PCS lifetime AC total"
          />
        </div>
        <div className="m-label m-ink3" style={{ padding: "10px 6px 0", lineHeight: 1.55 }}>
          Measured on the AC side by the inverter, so these include conversion losses the
          battery&rsquo;s own counters do not.
        </div>
      </div>

      {/* Named rather than left as four dashes. These registers come from the
          full 1,422-signal snapshot, not the fast profile the rest of the app
          reads, so they can be absent while everything else is live — and a
          reader who is not told that reasonably concludes the app is broken. */}
      {nothing && (
        <div className="m-banner" style={{ marginTop: 14 }}>
          <TriangleAlert size={15} style={{ flex: "none", marginTop: 1 }} />
          <span>
            This gateway is not reporting its cumulative counters. Charge and discharge are
            unaffected — those are integrated from the historian rather than read from a register.
          </span>
        </div>
      )}

      {/* State of health would be the natural companion to a lifetime figure
          and is deliberately not here. The gateway's `soh` held exactly 100.0%
          across the whole reference capture and is treated as a placeholder;
          printing it beside a real throughput total would lend it a
          credibility it has not earned. */}
      <div className="m-label m-ink3" style={{ padding: "16px 6px 0", lineHeight: 1.55 }}>
        Degradation is not shown. The gateway reports state of health as a flat 100.0%, which is a
        placeholder rather than a measurement, and deriving it from throughput needs a pack
        capacity the gateway does not publish.
      </div>
    </>
  );
}

/* ── Solar generation ──────────────────────────────────────────────────── */

/**
 * What the PV inverter is doing, which is all this gateway can say about it.
 *
 * There is no production chart here and there will not be one until the
 * gateway historises PV power. `/api/solis/status` is a state read, and its
 * history sibling is an event log written when the controller acts rather than
 * on a cadence — so the gaps between its rows are not measurement intervals,
 * and kWh integrated across them would be invented. The section says so rather
 * than leaving a reader to wonder why generation has no graph when charge and
 * discharge do.
 */
function GenerationSection() {
  const solar = useSolis();

  if (!solar.isLoading && !solar.available) {
    return (
      <>
        <div style={{ padding: "0 4px 14px" }}>
          <span className="m-h1 m-ink">Solar</span>
        </div>
        <div className="m-empty">
          <span className="m-empty-mark"><Sun size={19} /></span>
          <span className="m-body m-ink3">
            This gateway reports no PV inverter, so there is nothing to generate from here.
          </span>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ padding: "0 4px 14px" }}>
        <span className="m-h1 m-ink">Solar</span>
      </div>

      <FeatureCard style={{ marginBottom: 18 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Generating now</span>
          <StatusIndicator
            tone={solar.online ? "good" : "warn"}
            label={solar.online ? "Online" : "Not answering"}
            live={solar.online}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          {solar.isLoading
            ? <Shimmer w="60%" h={34} r={10} />
            : <Readout value={solar.powerKw} unit="kW" precision={1} />}
        </div>
        {solar.state && (
          <ChipRow>
            <Chip>Inverter {solar.state}</Chip>
          </ChipRow>
        )}
      </FeatureCard>

      <div className="m-banner">
        <Info size={15} style={{ flex: "none", marginTop: 1 }} />
        <div className="m-stack" style={{ gap: 6 }}>
          <span>
            This is a live reading, not a total. The gateway reports the inverter&rsquo;s state and
            its power now; it does not log PV power on a cadence, so generation over a day cannot
            be added up here without inventing the gaps.
          </span>
          {solar.timestampUtc && (
            <span>
              Read at{" "}
              {new Date(solar.timestampUtc).toLocaleTimeString("en-IN", {
                hour: "2-digit", minute: "2-digit", hour12: false,
              })}
              , and refreshed every 30 seconds — this endpoint takes several seconds to answer.
            </span>
          )}
        </div>
      </div>
    </>
  );
}
