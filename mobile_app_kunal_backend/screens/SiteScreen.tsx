"use client";

/**
 * Both units, side by side.
 *
 * Every other screen answers for one BESS: the header picks a unit and the
 * whole app follows it. That is the right default — an operator working on a
 * container wants that container — but it makes the one question a two-unit
 * site asks constantly, "are these two doing the same thing?", into a
 * comparison held in someone's head across two taps and a page transition.
 *
 * So this screen puts them in columns. It is a reading, not a summary: every
 * figure here is the same signal the single-unit screens read, through the
 * same functions, labelled by the same freshness rule. Nothing is averaged
 * across units — averaging two SOCs would state a figure for a pack that no
 * instrument measured — and the one aggregate on the page, combined battery
 * power, is a sum of two measured quantities that genuinely add, printed with
 * a count of how many units it is actually over.
 *
 * It costs no extra polling for the battery figures. /api/fast-bess/latest
 * already returns a row per source in one reply; the app was throwing the
 * other row away.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, Layers, TriangleAlert } from "lucide-react";

import {
  decimate, useAlarmList, useFleet, useHistory,
  type CurveSample, type Fleet, type FleetUnit, type HistoryWindow,
} from "../data";
import { useGatewaySelection } from "../gateway/GatewayContext";
import { Header, SOURCE_NAMES } from "../components/Header";
import {
  Chip, ChipRow, FeatureCard, FloatingCard, Readout, SectionHeader, Segmented,
  Shimmer, StatusIndicator, Value,
} from "../components";
import { PowerCurve } from "../viz/PowerCurve";
import { CompareCurve, type CompareSeries } from "../viz/CompareCurve";
import { EnergyBars } from "../viz/EnergyBars";

/** One line of the comparison: a label, and how to read it off a unit. */
interface CmpRow {
  label: string;
  unit?: string;
  dp?: number;
  of: (u: FleetUnit) => number | null;
  /** A qualifying word under the value — direction, state. Never a number. */
  note?: (u: FleetUnit) => string | null;
}

/** BMS charge_discharge_status: 0 Idle, 1 Discharge, 2 Charge. */
function dispatchLabel(state: number | null, kw: number | null): string | null {
  if (state === 1) return "Discharging";
  if (state === 2) return "Charging";
  if (state === 0) return "Idle";
  if (kw == null) return null;
  if (kw > 0.5) return "Discharging";
  if (kw < -0.5) return "Charging";
  return "Standby";
}

const abs = (v: number | null) => (v == null ? null : Math.abs(v));

const GROUPS: { title: string; rows: CmpRow[] }[] = [
  {
    title: "Right now",
    rows: [
      { label: "State of charge", unit: "%", dp: 1, of: (u) => u.readings.soc },
      {
        label: "Battery power", unit: "kW", dp: 1,
        of: (u) => abs(u.readings.powerKw),
        /* The sign is the direction, and the direction is the point of the
           comparison — one unit charging while the other discharges is the
           single most useful thing this screen can show at a glance. */
        note: (u) => dispatchLabel(u.readings.chargeState, u.readings.powerKw),
      },
      { label: "State of health", unit: "%", dp: 1, of: (u) => u.readings.soh },
      { label: "Cell temp, max", unit: "°C", dp: 1, of: (u) => u.readings.tempMax },
    ],
  },
  {
    title: "Battery",
    rows: [
      { label: "Cluster voltage", unit: "V", dp: 1, of: (u) => u.readings.clusterV },
      { label: "Cluster current", unit: "A", dp: 1, of: (u) => u.readings.clusterA },
      { label: "Cell spread", unit: "mV", dp: 0, of: (u) => u.readings.cellSpreadMv },
      { label: "Cell temp, min", unit: "°C", dp: 1, of: (u) => u.readings.tempMin },
      { label: "Temp spread", unit: "°C", dp: 1, of: (u) => u.readings.tempSpread },
    ],
  },
  {
    title: "Inverter",
    rows: [
      { label: "DC voltage", unit: "V", dp: 1, of: (u) => u.readings.dcVoltage },
      { label: "DC current", unit: "A", dp: 1, of: (u) => u.readings.dcCurrent },
      { label: "Grid frequency", unit: "Hz", dp: 2, of: (u) => u.readings.gridHz },
      { label: "Phase A voltage", unit: "V", dp: 1, of: (u) => u.readings.phaseV[0] },
      { label: "Phase B voltage", unit: "V", dp: 1, of: (u) => u.readings.phaseV[1] },
      { label: "Phase C voltage", unit: "V", dp: 1, of: (u) => u.readings.phaseV[2] },
    ],
  },
  {
    /* Per unit, not per plant. /api/telemetry is scoped to a source and the
       meter behind external_ems_1 is external_ems_1_grid_meter, so these are
       two instruments, not one figure read twice. They are compared rather
       than added for exactly that reason: if the two meters turn out to be on
       the same connection, a total would be double the truth. */
    title: "EMS and metering",
    rows: [
      { label: "Site load", unit: "kW", dp: 1, of: (u) => u.site.loadKw },
      { label: "Demand", unit: "kW", dp: 1, of: (u) => u.site.demandKw },
      { label: "Available out", unit: "kW", dp: 0, of: (u) => u.site.availDischargeKw },
      { label: "Available in", unit: "kW", dp: 0, of: (u) => u.site.availChargeKw },
      { label: "EMS SOC", unit: "%", dp: 1, of: (u) => u.site.emsSoc },
      {
        label: "Grid meter", unit: "kW", dp: 1,
        of: (u) => abs(u.site.gridKw),
        /* A dash under "Grid meter" is ambiguous between a meter that has not
           loaded and one that is not there. Where the meter is not answering
           the gateway, the column says so — this is the only row on the screen
           whose blank has a known cause worth naming. */
        note: (u) =>
          !u.site.gridReporting
            ? "Meter offline"
            : u.site.gridKw == null ? null : u.site.gridKw >= 0 ? "Importing" : "Exporting",
      },
      { label: "Charged, month", unit: "kWh", dp: 0, of: (u) => u.site.chargedKwhMonth },
      { label: "Discharged, month", unit: "kWh", dp: 0, of: (u) => u.site.dischargedKwhMonth },
    ],
  },
];

export function SiteScreen() {
  const fleet = useFleet();
  const { alarms } = useAlarmList();
  const { units } = fleet;

  /* Asserted fault bits per unit, from the same list the Alarms screen reads.
     A count rather than the faults themselves: this screen's job is to say
     which container needs opening, and Alarms says what is wrong inside it. */
  const faults = useMemo(() => {
    const n = new Map<string, number>();
    alarms.forEach((a) => n.set(a.source_id, (n.get(a.source_id) ?? 0) + 1));
    return n;
  }, [alarms]);

  return (
    <>
      <Header />

      <CombinedCard fleet={fleet} />

      {units.length === 1 && (
        <div className="m-absent" style={{ margin: "0 0 14px" }}>
          <span>
            The gateway reports <b>one</b> unit at this site. This screen compares every unit it
            knows about, so there is a single column until a second one appears.
          </span>
        </div>
      )}

      {fleet.isLoading ? (
        <FloatingCard>
          <div style={{ display: "grid", gap: 14, padding: "6px 0" }}>
            <Shimmer w="70%" h={15} /><Shimmer w="90%" h={15} /><Shimmer w="80%" h={15} />
          </div>
        </FloatingCard>
      ) : units.length === 0 ? (
        <FloatingCard>
          <div className="m-empty">
            <span className="m-empty-mark"><Layers size={19} /></span>
            <span className="m-body m-ink3">The gateway has not reported a unit yet.</span>
          </div>
        </FloatingCard>
      ) : (
        <>
          <div className="m-cmp-stack" style={{ ["--m-cmp-cols" as string]: units.length }}>
            <FloatingCard className="m-cmp">
              <UnitHeads units={units} faults={faults} />
              <CmpRows units={units} rows={GROUPS[0].rows} />
            </FloatingCard>

            {GROUPS.slice(1).map((g) => (
              <div key={g.title}>
                <SectionHeader title={g.title} />
                <FloatingCard className="m-cmp">
                  <UnitHeads units={units} compact />
                  <CmpRows units={units} rows={g.rows} />
                </FloatingCard>
              </div>
            ))}
          </div>

          <OverTime units={units} />

          <div className="m-banner" style={{ marginTop: 18 }}>
            <TriangleAlert size={15} style={{ flex: "none", marginTop: 1 }} />
            <span>
              Each column is that unit&apos;s own reading, at that unit&apos;s own freshness. A
              column headed <b>Offline</b> or <b>Data delayed</b> is showing the last values that
              arrived, not the present state — and nothing on this page is averaged between units.
            </span>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The one aggregate on the page.
 *
 * Stated with the count it is over, because a "site total" that is silently
 * one unit's power while the other is offline is the kind of figure someone
 * makes a dispatch decision on.
 */
function CombinedCard({ fleet }: { fleet: Fleet }) {
  const { totalPowerKw, contributing, total } = fleet;
  const direction =
    totalPowerKw == null ? null
    : totalPowerKw > 0.5 ? "Discharging"
    : totalPowerKw < -0.5 ? "Charging"
    : "Balanced";

  return (
    <FeatureCard style={{ marginBottom: 20 }}>
      <div className="m-spread">
        <span className="m-eyebrow">Combined battery power</span>
        <StatusIndicator
          tone={contributing === total && total > 0 ? "good" : contributing > 0 ? "warn" : "idle"}
          label={`${contributing} of ${total} reporting`}
          live={contributing > 0}
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <Readout value={totalPowerKw == null ? null : Math.abs(totalPowerKw)} unit="kW" precision={1} />
      </div>
      <ChipRow>
        {direction && <Chip>{direction}</Chip>}
        {/* Named as a sum rather than presented as a site meter reading. The
            gateway meters the plant separately, per source, and this is not
            that number. */}
        <Chip>Sum of {contributing === 1 ? "1 unit" : `${contributing} units`}</Chip>
      </ChipRow>
    </FeatureCard>
  );
}

/** The column heads: which unit, how fresh, and how to open it. */
function UnitHeads({
  units, faults, compact,
}: { units: FleetUnit[]; faults?: Map<string, number>; compact?: boolean }) {
  const { select } = useGatewaySelection();
  const router = useRouter();

  return (
    <div className={`m-cmp-row is-head${compact ? " is-compact" : ""}`}>
      <span className="m-eyebrow">{compact ? "" : "Unit"}</span>
      {units.map((u) => (
        <div key={u.sourceId} className="m-cmp-head">
          <button
            className="m-cmp-name"
            /* Selecting sets the app's unit and goes home, which is what
               "open this one" means everywhere else in this app. The
               comparison is for spotting the odd one out; the single-unit
               screens are for working on it. */
            onClick={() => { select(u.sourceId); router.push("/k"); }}
            aria-label={`Open ${u.label} — ${SOURCE_NAMES[u.sourceId] ?? u.sourceId}`}
          >
            <span className="m-cmp-name-text">{u.label}</span>
            {!compact && <ArrowRight size={12} aria-hidden />}
          </button>

          {!compact && (
            <>
              <span className="m-cmp-sub">{SOURCE_NAMES[u.sourceId] ?? u.sourceId}</span>
              <StatusIndicator tone={u.conn.tone} label={u.conn.label} live={u.conn.isLive} />
              <span className="m-cmp-sub">{u.conn.detail}</span>
              {faults && (
                <span className={`m-cmp-faults${(faults.get(u.sourceId) ?? 0) > 0 ? " is-bad" : ""}`}>
                  {(faults.get(u.sourceId) ?? 0) === 0
                    ? "No faults asserted"
                    : `${faults.get(u.sourceId)} fault bit${faults.get(u.sourceId) === 1 ? "" : "s"}`}
                </span>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function CmpRows({ units, rows }: { units: FleetUnit[]; rows: CmpRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <div key={row.label} className="m-cmp-row">
          <span className="m-cmp-label">{row.label}</span>
          {units.map((u) => {
            const note = row.note?.(u) ?? null;
            return (
              <span key={u.sourceId} className="m-cmp-cell">
                <Value
                  value={row.of(u)}
                  unit={row.unit}
                  precision={row.dp ?? 1}
                  className="m-cmp-num"
                />
                {/* Only while the reading is current. A direction is a claim
                    about now, and an hour-old row cannot support one — the
                    number stays, labelled by the column head as last known. */}
                {note && u.conn.isLive && <span className="m-cmp-sub">{note}</span>}
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
}


/* ── Over time ─────────────────────────────────────────────────────────────
   Two ways of looking at the same window, because they answer different
   questions and neither substitutes for the other.

   The comparison charts put every unit on ONE pair of axes. That is the only
   arrangement in which height means the same thing twice, and it is what makes
   "BESS 2 is working harder than BESS 1" a thing you can see rather than a
   thing you work out from two axes and some arithmetic.

   The per-unit charts underneath keep their own scale, their own coverage and
   their own totals. A unit whose window is still filling says so on its own
   card, and a unit that swung 40 kW while the other sat idle gets an axis that
   shows its detail instead of being flattened against the louder one.

   One fetch, though. The per-unit cards below own the queries — they always
   have — and report what arrived up to here, so the comparison draws the same
   rows the unit charts drew. A second fetch path would be a second answer to
   "what does this window hold", and the two would disagree the first time one
   of them finished filling before the other. */

type Span = "15m" | "1h" | "6h" | "24h";

const SPANS: { value: Span; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h",  label: "1h" },
  { value: "6h",  label: "6h" },
  { value: "24h", label: "24h" },
];

const MINUTES: Record<Span, number> = { "15m": 15, "1h": 60, "6h": 360, "24h": 1440 };

/* The spans are the short end of History's ladder. Every unit fetches its own
   window, so a month across a two-BESS site is twice the work of the screen
   that already warns about the page budget; the comparison is a live-and-
   recent question and the long windows stay where they belong. */

type Metric = "power" | "soc" | "temp" | "spread";

const METRICS: {
  value: Metric; label: string; title: string; unit: string; dp: number;
  of: (s: CurveSample) => number | null;
  fixedDomain?: [number, number];
  zeroLine?: boolean;
}[] = [
  {
    value: "power", label: "Power", title: "Battery power", unit: "kW", dp: 1,
    of: (s) => s.powerKw,
    /* Signed, so zero is the boundary between charging and discharging and
       every magnitude is read against it. */
    zeroLine: true,
  },
  {
    value: "soc", label: "SOC", title: "State of charge", unit: "%", dp: 1,
    of: (s) => s.soc,
    /* Pinned 0–100 rather than fitted to the data. SOC is bounded by
       definition, and an axis that zoomed to 54–62% would make a six-point
       drift look like a discharge to empty. */
    fixedDomain: [0, 100],
  },
  {
    value: "temp", label: "Temp", title: "Cell temperature, max", unit: "°C", dp: 1,
    of: (s) => s.tempMax,
  },
  {
    value: "spread", label: "Spread", title: "Cell voltage spread, max", unit: "mV", dp: 0,
    of: (s) => s.cellSpreadMv,
    zeroLine: true,
  },
];

/** What one unit's chart reports back for the comparison above it. */
interface UnitWindow {
  samples: CurveSample[];
  totals: HistoryWindow["totals"];
  from: number;
  to: number;
}

function OverTime({ units }: { units: FleetUnit[] }) {
  const [span, setSpan] = useState<Span>("1h");
  const [metric, setMetric] = useState<Metric>("power");
  const [windows, setWindows] = useState<Record<string, UnitWindow>>({});

  /* Identity-guarded, and that is what stops this being a render loop. Both
     `samples` and `totals` are memoised on the query's data, so they only
     change when new rows arrive; from/to are numbers. Setting state from a
     child's effect is worth this much care and no less. */
  const report = useCallback(
    (id: string, samples: CurveSample[], totals: HistoryWindow["totals"], from: number, to: number) => {
      setWindows((prev) => {
        const had = prev[id];
        if (had && had.samples === samples && had.totals === totals && had.from === from && had.to === to) {
          return prev;
        }
        return { ...prev, [id]: { samples, totals, from, to } };
      });
    },
    [],
  );

  /* A window from the previous span is a real series drawn under the wrong
     heading — the exact failure useHistory's placeholderData comment describes,
     arriving by a different route. Cleared on the way in rather than filtered
     on the way out. */
  useEffect(() => { setWindows({}); }, [span]);

  const m = METRICS.find((x) => x.value === metric)!;

  /* Only units that have actually reported a window. A unit with no rows yet
     would otherwise contribute an empty line and a legend entry for it, which
     reads as "this unit was flat" rather than "this unit has not answered". */
  const present = units.filter((u) => windows[u.sourceId]?.samples.length);

  const series = useMemo<CompareSeries[]>(
    () =>
      present.map((u) => ({
        id: u.sourceId,
        label: u.label,
        points: decimate(windows[u.sourceId].samples, 600).map((s) => ({ t: s.t, v: m.of(s) })),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [present.map((u) => u.sourceId).join(), windows, m],
  );

  /* Every unit asked for the same window, so any of them states it. Taken from
     a reporting unit rather than recomputed here, so the axis spans exactly
     what was requested of the server. */
  const win = present.length
    ? ([windows[present[0].sourceId].from, windows[present[0].sourceId].to] as [number, number])
    : null;

  const energy = present.map((u) => ({
    label: u.label,
    chargedKwh: windows[u.sourceId].totals.charged,
    dischargedKwh: windows[u.sourceId].totals.discharged,
  }));

  return (
    <div style={{ marginTop: 24 }}>
      <SectionHeader title="Over time" />
      <Segmented<Span> ariaLabel="Window" value={span} onChange={setSpan} options={SPANS} />

      {/* ── Both units, one axis ──────────────────────────────────────── */}
      <div style={{ marginTop: 16 }}>
        <SectionHeader
          title={m.title}
          action={<span className="m-label m-ink3">{m.unit}</span>}
        />
        <Segmented<Metric>
          ariaLabel="Metric"
          value={metric}
          onChange={setMetric}
          options={METRICS.map((x) => ({ value: x.value, label: x.label }))}
        />
        <FloatingCard style={{ marginTop: 12 }}>
          {!win || series.length === 0 ? (
            <div className="m-empty">
              <span className="m-empty-mark"><Activity size={19} /></span>
              <span className="m-body m-ink3">
                Waiting for a window to compare. Each unit&apos;s own chart below says how far
                its own has filled.
              </span>
            </div>
          ) : (
            <CompareCurve
              series={series}
              window={win}
              unit={m.unit}
              precision={m.dp}
              fixedDomain={m.fixedDomain}
              zeroLine={m.zeroLine}
            />
          )}
        </FloatingCard>
      </div>

      {/* ── What each unit actually moved ─────────────────────────────── */}
      {/* Shown whenever a window has arrived, including one in which nothing
          moved. Zero is a real answer here — it is integrated from rows the
          server actually read — and hiding the chart on an idle window would
          make "the plant did nothing" and "the window has not loaded" look
          identical, which is the confusion this screen keeps refusing to
          make. `energy` is empty until a unit reports, and that is the only
          case with nothing to draw. */}
      {energy.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <SectionHeader title="Energy this window" />
          <FloatingCard>
            <EnergyBars data={energy} />
            <div className="m-cmp-sub" style={{ paddingTop: 10 }}>
              Integrated over every recorded row, not off the line above — the curve is a mean
              over its bucket and totalling it would under-report a unit that spiked between
              samples.
            </div>
          </FloatingCard>
        </div>
      )}

      {/* ── Each unit on its own scale ────────────────────────────────── */}
      <div style={{ marginTop: 20 }}>
        <SectionHeader title="Each unit" />
        {/* One chart per unit, each mounted as its own component — the unit
            list is data, and a hook per unit inside a loop would break the
            first time a site went from two units to one. */}
        {units.map((u) => (
          <UnitCurve key={u.sourceId} unit={u} minutes={MINUTES[span]} report={report} />
        ))}
      </div>

      <div className="m-absent" style={{ margin: "10px 0 0" }}>
        <span>
          {/* The explicit space is load-bearing. A text node that spans several
              source lines has its leading whitespace trimmed by the JSX
              transform, and this one renders as "Each unitare" without it. */}
          The charts under <b>Each unit</b>{" "}
          are scaled to their own unit&apos;s range, so a
          taller line there is not necessarily a bigger number — the comparison above is the
          one drawn on a single axis. Both are means over a bucket; a spike shorter than that
          lives in <b>Peak power</b> rather than on the curve.
        </span>
      </div>
    </div>
  );
}

function UnitCurve({
  unit, minutes, report,
}: {
  unit: FleetUnit;
  minutes: number;
  report: (id: string, samples: CurveSample[], totals: HistoryWindow["totals"], from: number, to: number) => void;
}) {
  const h = useHistory(minutes, unit);
  const [from, to] = h.requested;

  /* Reported up rather than fetched twice — see the section docblock. */
  useEffect(() => {
    report(unit.sourceId, h.samples, h.totals, from, to);
  }, [report, unit.sourceId, h.samples, h.totals, from, to]);

  const curve = useMemo(
    /* No `?? 0` anywhere in here. A missing measurement is a gap in the line,
       which is the one rendering of it that cannot be read as a measured zero. */
    () => decimate(h.samples).map((s) => ({ t: s.t, power: s.powerKw, soc: s.soc })),
    [h.samples],
  );

  /* Zero chunks read is not an idle plant. Same distinction History draws, and
     for the same reason: the alternative is a confident 0.00 kWh about a unit
     nobody managed to ask. */
  const unread = !h.isLoading && !h.error && h.coverage.ready === 0;

  return (
    <div style={{ marginTop: 14 }}>
      <div className="m-spread" style={{ padding: "0 4px 8px" }}>
        <span className="m-label m-ink2">{unit.label}</span>
        <StatusIndicator tone={unit.conn.tone} label={unit.conn.label} live={unit.conn.isLive} />
      </div>

      <FloatingCard>
        {h.isLoading ? (
          <Shimmer h={150} />
        ) : h.error ? (
          <div className="m-empty">
            <span className="m-empty-mark"><TriangleAlert size={19} /></span>
            <span className="m-body m-ink3">{h.error}</span>
          </div>
        ) : unread ? (
          <div className="m-empty">
            <span className="m-empty-mark"><Activity size={19} /></span>
            <span className="m-body m-ink3">
              None of this window could be read from the gateway. That is not the same as a
              quiet plant — no part of the period came back.
            </span>
          </div>
        ) : curve.length === 0 ? (
          <div className="m-empty">
            <span className="m-empty-mark"><Activity size={19} /></span>
            <span className="m-body m-ink3">Nothing recorded for this window.</span>
          </div>
        ) : (
          <>
            <div className="m-chart"><PowerCurve data={curve} window={h.requested} /></div>
            <ChipRow>
              <Chip>{h.totals.charged.toFixed(1)} kWh in</Chip>
              <Chip>{h.totals.discharged.toFixed(1)} kWh out</Chip>
              {h.totals.peakKw != null && <Chip>Peak {h.totals.peakKw.toFixed(1)} kW</Chip>}
              {h.totals.socMin != null && h.totals.socMax != null && (
                <Chip>SOC {h.totals.socMin.toFixed(0)}–{h.totals.socMax.toFixed(0)}%</Chip>
              )}
              {/* Said on the chart it applies to, not once for the page. The
                  two units fill independently and one can be complete while
                  the other is still arriving. */}
              {h.isFilling && (
                <Chip tone="warn">
                  Filling · {h.coverage.ready} of {h.coverage.total}
                </Chip>
              )}
            </ChipRow>
          </>
        )}
      </FloatingCard>
    </div>
  );
}
