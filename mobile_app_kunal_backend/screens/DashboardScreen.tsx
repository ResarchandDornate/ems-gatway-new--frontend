"use client";

/**
 * Dashboard — the site as the gateway reports it.
 *
 * Structured so the 3D container is the hero and everything else frames it: a
 * summary strip above it, the live power triangle around it, its own status
 * card fused to its base, and the history pair below the fold.
 *
 * Every figure is a signal. The battery comes from the 63-signal fast profile
 * at 5 s; grid metering, site load and available power come from the gateway's
 * full 1,422-signal snapshot at 15 s. Nothing is derived from a nameplate, a
 * tariff or an assumption — where the gateway has no signal the screen shows a
 * dash and names what would be needed to fill it.
 */

import { lazy, Suspense, useMemo } from "react";
import {
  Activity, Battery, Building2, Gauge, Thermometer, TriangleAlert, Waves, Zap,
  ArrowDownToLine, ArrowUpFromLine, BarChart3, ChevronRight, Sun, LineChart, Cpu,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { useReadings, useSite, useHistory, useConnectivity, useSolis, decimate } from "../data";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, MetricCard, Shimmer, Value, StationStatus, ListItem,
  SectionMenu, SectionBack, useSection,
} from "../components";
import { PowerCurve, type CurvePoint } from "../viz/PowerCurve";

import { BessHero } from "../viz/BessHero";

/* Deferred, unlike BessHero.
 *
 * The two scenes share three and fiber, so this looked like a split that would
 * save nothing — and measured, it is the opposite. The energy scene reaches far
 * deeper into drei than the hero does, and imported eagerly it took the bundle
 * from 242 kB to 510 kB gzipped: it more than doubled the app. Split, the main
 * chunk is 253 kB and this is 256 kB of its own.
 *
 * Be clear about what that buys, because it is not bytes. The dashboard is the
 * landing screen, so anyone who signs in downloads this anyway — the same total
 * either way. What moves is when: the shell, the login screen and every route
 * that is not the dashboard stop carrying it, and the dashboard paints its
 * cards before the scene arrives instead of after. On the connections this app
 * is used on, that is the difference worth having.
 *
 * React.lazy rather than next/dynamic, because this file compiles under both
 * Next and Vite and only one of them has the latter. */
const PowerFlowStage = lazy(() =>
  import("../viz/PowerFlowStage").then((m) => ({ default: m.PowerFlowStage })),
);

const HOME_SPAN_MINUTES = 24 * 60;

/** BMS charge_discharge_status: 0 Idle, 1 Discharge, 2 Charge.  */

function dispatchLabel(state: number | null, kw: number | null): string {
  if (state === 1) return "Discharging";
  if (state === 2) return "Charging";
  if (state === 0) return "Idle";
  if (kw == null) return "Battery";
  if (kw > 0.5) return "Discharging";
  if (kw < -0.5) return "Charging";
  return "Standby";
}

const BASE = "/k";

/**
 * The dashboard's detail sections, as URL segments under /k.
 *
 * Exported because three files have to agree on them and only one should own
 * them: ScreenRouter resolves each back to this screen, and FloatingNavigation
 * lights the Home slot for them — without which a reader inside Battery sees
 * no dock item selected and cannot tell where they are.
 *
 * The keys map onto the gateway's own asset model rather than onto invented
 * groupings: bms_1, pcs_1, ems_system and the cooling assets are exactly how
 * the dictionary organises its 1,422 signals.
 */
export const DASH_SECTIONS = ["power", "now", "battery", "inverter", "ems", "thermal"] as const;
type SectionKey = (typeof DASH_SECTIONS)[number];
/** The four that are a straight read of one asset. */
type AssetKey = Extract<SectionKey, "battery" | "inverter" | "ems" | "thermal">;

/**
 * Grid frequency, preferring the utility meter but not when it reads zero.
 *
 * This was `site.gridHz ?? r.gridHz`, and `??` only falls through on null or
 * undefined. The utility meter returns 0.0 at `quality: "good"` — §8 of the
 * handoff records it reading a flat zero and notes it is unconfirmed whether
 * that meter is wired — so leafValue() yields 0, not null, and `0 ?? 50.19`
 * is 0. The card showed 0.00 Hz on a live grid while the PCS was reporting
 * 50.19 the whole time.
 *
 * The cause is now established: `utility_meter.communication_status` reads 0
 * on this site, and the gateway sends zero for every signal on a meter that is
 * not answering. siteOf gates the whole meter on that bit, so the usual path
 * to this function is now a null rather than a zero.
 *
 * The zero test stays regardless. It covers the narrower case the comm bit
 * cannot — a meter that is communicating and still reporting 0.00 Hz — and it
 * costs one comparison to keep.
 *
 * Zero is treated as absent for frequency specifically, and only here. A grid
 * that is actually connected never measures exactly 0.00 Hz, so a zero from
 * the meter means "no measurement" rather than "no frequency". That reasoning
 * does NOT generalise: 0 kW and a 0.00 power factor are real readings on an
 * idle plant, so those keep the meter's value and are left alone.
 */
function gridHz(meter: number | null, pcs: number | null): number | null {
  return meter != null && meter !== 0 ? meter : pcs;
}

/**
 * Coolant temperature rise across the loop, °C.
 *
 * Computed rather than read. The gateway publishes
 * `inlet_outlet_water_temperature_diff`, but its pressure sibling decodes
 * negative values as unsigned and returns ~6553 — so until the gateway team
 * confirm the temperature one is decoded differently, subtracting two readings
 * this build already trusts is the safer arithmetic.
 */
function loopDelta(inC: number | null, outC: number | null): number | null {
  return inC == null || outC == null ? null : outC - inC;
}

export function DashboardScreen() {
  const r = useReadings();
  const site = useSite();
  /* Decides how every figure below is labelled. One source of truth, shared
     with Signals, Control and the connection banner. */
  const conn = useConnectivity();
  /* The PV inverter, when the site has one. Its own endpoint and its own
     cadence — see useSolis. */
  const solar = useSolis();
  const section = useSection(BASE, DASH_SECTIONS) as SectionKey | null;

  const hist = useHistory(HOME_SPAN_MINUTES);
  const curve = useMemo(
    () =>
      decimate(hist.samples).map((s) => ({
        t: s.t,
        power: s.powerKw,
        soc: s.soc,
      })),
    [hist.samples],
  );

  const dispatch = dispatchLabel(r.chargeState, r.powerKw);

  /* The grid meter reports one signed number. Rendering "imported" and
     "exported" side by side as the reference does would imply two meters and
     invent whichever is not currently true — so it is one slot that names its
     own direction. */
  /* "Importing" is a claim about direction, and a meter that is not
     communicating supports no such claim. It used to read "Importing" over
     0.0 kW because the gateway sends zero for every signal on a dead meter —
     see siteOf. With nothing measured the slot is labelled for what it is. */
  const gridDir = !site.gridReporting
    ? "Grid meter offline"
    : site.gridKw == null ? "Grid" : site.gridKw >= 0 ? "Importing" : "Exporting";
  const absKw = (v: number | null) => (v == null ? null : Math.abs(v));

  /* A section replaces the screen rather than appearing beneath it.

     Rendering the detail under the hero is what the tab strip did, and it is
     why this screen had grown past three screenfuls: the at-a-glance half was
     always paying for the detail half whether or not anyone wanted it. Here
     the reader is either glancing or reading, never scrolling past one to get
     to the other. */
  if (section) {
    return (
      <div className="m-screen">
        <Header />
        <SectionBack title="Overview" base={BASE} />
        {section === "power" ? (
          <PowerSection r={r} site={site} curve={curve} hist={hist} />
        ) : section === "now" ? (
          <NowSection r={r} site={site} />
        ) : (
          <AssetPanel tab={section} r={r} site={site} />
        )}
      </div>
    );
  }

  return (
    <div className="m-screen">
      <Header />

      {/* First, before any number: is what follows current? An operator who
          reads the figures without reading this is the failure this screen is
          being fixed for. */}
      <StationStatus />

      {/* A dash with no explanation reads as a loading state. This says which
          instrument is missing, so nobody spends time wondering whether the
          app is broken — and, more to the point, so nobody reads the battery's
          power as the whole story of where the energy is going. */}
      {site.ready && !site.gridReporting && (
        <FloatingCard className="m-note">
          <TriangleAlert size={16} />
          <span>
            The utility meter is not communicating with the site controller, so grid
            power, frequency, power factor and the import and export totals cannot be
            shown. Battery and site figures are unaffected.
          </span>
        </FloatingCard>
      )}

      {/* ── Summary ────────────────────────────────────────────────────── */}
      <section className="m-summary" aria-label="Site summary">
        <div className="m-summary-cell">
          <Value value={r.soc} unit="%" precision={1} animate className="m-summary-num" />
          <span className="m-summary-label">{conn.isLive ? "State of charge" : "Last known SOC"}</span>
        </div>
        <span className="m-summary-rule" aria-hidden />
        <div className="m-summary-cell">
          <Value value={absKw(r.powerKw)} unit="kW" precision={1} animate className="m-summary-num" />
          {/* "Charging" is a claim about now. Where now is not what is on
              screen the claim is dropped, not qualified — "Last known
              charging" does not fit a third of a phone and truncated to "Last
              known ch…", which is worse than either. The direction is still
              readable from the sign and from the hero. */}
          <span className="m-summary-label">{conn.isLive ? dispatch : "Last known power"}</span>
        </div>
        <span className="m-summary-rule" aria-hidden />
        <div className="m-summary-cell">
          <Value value={absKw(site.gridKw)} unit="kW" precision={1} animate className="m-summary-num" />
          <span className="m-summary-label">{conn.isLive ? gridDir : "Last known grid"}</span>
        </div>
      </section>

      {/* Stored energy and today's savings used to be named here as absent.
          They are still absent — the gateway reports SOC and never kWh in the
          pack, and it meters energy but prices nothing — but the dashboard is
          not the place to say so. It is the screen an operator looks at to
          read the plant, and two lines about what cannot be shown pushed the
          readings that can be down the page. The explanation now lives once,
          under System → What this gateway does not report. */}

      {/* ── Power flow ─────────────────────────────────────────────────── */}
      {/* Four nodes where the site generates, three where it does not.

          Solar is first, because that is the direction energy travels on a
          site that has it — and because a reader scanning left to right should
          meet the source before the sinks. It is drawn only when the gateway
          reports an inverter: a permanent "— kW / SOLAR" slot on a
          battery-only site claims an instrument that was never installed, and
          this row has three slots' worth of room to spare on those sites. */}
      <div
        className={`m-flowrow${solar.available ? " is-quad" : ""}`}
        aria-label={conn.isLive ? "Live power" : "Last known power flow"}
      >
        {solar.available && (
          <FlowNode
            icon={<Sun size={14} />}
            value={solar.powerKw}
            /* Not "Solar" flat. An inverter that is not answering has no
               generation to report, and labelling its dash "Solar" reads as a
               plant producing nothing rather than as a device nobody can
               reach — the same failure the grid meter had.

               "PV offline" rather than "Inverter offline", which is what this
               said first: measured in the quad row, that label needs 86px
               against the 71px a node has, so it ellipsed to "INVERTER
               OFFLI…". Same trade the grid node already makes with "No
               meter" — the slot gets the short form and the banner above
               carries the sentence. "PV" over "Solar" because it is the
               device that is offline, not the sunshine. */
            label={solar.online ? "Generating" : "PV offline"}
          />
        )}
        <FlowNode
          icon={site.gridKw != null && site.gridKw < 0 ? <ArrowUpFromLine size={14} /> : <ArrowDownToLine size={14} />}
          value={absKw(site.gridKw)}
          /* Not `gridDir`. A flow node is a third of a 375pt screen and
             "Grid meter offline" truncated to "GRID METER OF…", which is worse
             than either the full phrase or a short one. The summary strip
             above has room for the sentence; this slot gets the short form,
             and the banner above them both carries the explanation. */
          label={site.gridReporting ? gridDir : "No meter"}
        />
        <FlowNode
          icon={<Zap size={14} />}
          value={absKw(r.powerKw)}
          label={conn.isLive ? dispatch : "Battery"}
          accent
        />
        <FlowNode icon={<Building2 size={14} />} value={site.loadKw} label="Site load" />
      </div>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <BessHero
        gridKw={site.gridKw}
        batteryKw={r.powerKw}
        loadKw={site.loadKw}
        chargeState={r.chargeState}
        live={conn.isLive}
      />

      {/* Fused to the base of the scene rather than floating free below it, so
          it reads as the container's own label. That is what stops the hero
          becoming one more card in a stack. */}
      <div className="m-herocard">
        {/* No SOC cell here any more.
            It was the summary strip's own figure again, a few hundred
            pixels below it and two points smaller. What this card
            uniquely carries is the headroom either side of the battery,
            so that is now all it carries. */}
        <div className="m-herocard-cell">
          <span className="m-herocard-stack">
            <Value value={site.availDischargeKw} unit="kW" precision={0} className="m-herocard-num" />
            <span className="m-herocard-label">Available out</span>
          </span>
        </div>
        <span className="m-herocard-rule" aria-hidden />
        <div className="m-herocard-cell">
          <span className="m-herocard-stack">
            <Value value={site.availChargeKw} unit="kW" precision={0} className="m-herocard-num" />
            <span className="m-herocard-label">Available in</span>
          </span>
        </div>
      </div>

      {/* ── Single-line ────────────────────────────────────────────────
          The web dashboard's power-flow scene, reading this app's gateway
          rather than UGX. Below the hero and not in place of it: the hero
          answers "what is my battery doing", this answers "where is the energy
          going", and on a phone those are two scrolls rather than one crowded
          one.

          Given a fixed height because the stage sizes itself to its container
          and a flex child with none collapses to zero. 260px is the smallest
          that keeps all five callouts legible at this width — measured, not
          chosen. */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Power flow" />
        <FloatingCard style={{ padding: 0, overflow: "hidden" }}>
          {/* The fallback holds the same 260px the scene will fill, so the
              chunk arriving does not shove the rest of the page down. */}
          <div style={{ height: 260 }}>
            <Suspense fallback={<Shimmer h={260} r={0} />}>
              <PowerFlowStage />
            </Suspense>
          </div>
        </FloatingCard>
      </div>

      {/* ── What else this screen can answer ───────────────────────────
          A row of five tabs used to sit here, and whichever was selected
          rendered its panel inline — so the screen was always showing one
          reading set nobody had asked for, roughly seven hundred pixels below
          the control that chose it.

          The at-a-glance half above is untouched: state of charge, the power
          flow and the container are what this screen is opened for, and they
          are still the first thing on it. Everything that used to be a tab is
          now a destination, so the page ends after the hero unless the reader
          asks it not to. */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Look closer" />
        <SectionMenu
          base={BASE}
          items={[
            {
              key: "power",
              title: "Power over 24 hours",
              subtitle: "The curve, the peak, and how much moved through the battery",
              icon: <LineChart size={17} />,
            },
            {
              key: "now",
              title: "Right now",
              subtitle: "Grid frequency, cell temperature and state of health",
              icon: <Activity size={17} />,
            },
            {
              key: "battery",
              title: "Battery",
              subtitle: "Cluster voltage and current, cell spread and temperatures",
              icon: <Battery size={17} />,
            },
            {
              key: "inverter",
              title: "Inverter",
              subtitle: "DC side, phase voltages, and active against reactive power",
              icon: <Zap size={17} />,
            },
            {
              key: "ems",
              title: "EMS",
              subtitle: "Site load, demand, and the headroom either side of the battery",
              icon: <Cpu size={17} />,
            },
            {
              key: "thermal",
              title: "Thermal",
              subtitle: "Coolant temperatures and pressures across the loop",
              icon: <Thermometer size={17} />,
            },
          ]}
        />
      </div>
    </div>
  );
}

function FlowNode({
  icon, value, label, accent,
}: { icon: React.ReactNode; value: number | null; label: string; accent?: boolean }) {
  return (
    <div className={`m-flownode${accent ? " is-accent" : ""}`}>
      <span className="m-flownode-icon">{icon}</span>
      <Value value={value} unit="kW" precision={1} animate className="m-flownode-num" />
      <span className="m-flownode-label">{label}</span>
    </div>
  );
}




function PowerSection({
  r, site, curve, hist,
}: {
  r: ReturnType<typeof useReadings>;
  site: ReturnType<typeof useSite>;
  /* The whole window, not just its plotted points. The totals beside the chart
     are integrated over raw rows on the server and cannot be recovered from
     `curve`, which is a decimated series of per-bucket means. */
  hist: ReturnType<typeof useHistory>;
  /* CurvePoint rather than a restatement of it, so `t` changing shape is a
     compile error here instead of a chart that silently plots by index.
     `power` is nullable end to end: a gap in the line is the only rendering
     of a missing measurement that cannot be misread as a measured zero. */
  curve: CurvePoint[];
}) {
  /* Derived here rather than passed in. It was a `loading` prop alongside
     `hist`, which is the same fact twice and one more thing a caller could
     get out of step with the window it describes. */
  const loading = hist.isLoading;
  const router = useRouter();

  return (
    <>
      {/* The SOC and Power rings stood here.

          Both were duplicates: their centres read 97.1% and 1.3 kW, which are
          the summary strip's own two numbers. Neither added a fact. The SOC
          ring restated a percentage as a percentage, and the Power ring could
          not draw its arc at all on a site reporting no available-power figure
          — a bare track captioned "no headroom figure", which reads as a gauge
          at zero beside a full one. They cost a card-pair of height above the
          chart, which is what this panel is actually scrolled for. */}
      <SectionHeader title="Last 24 hours" />
      <FloatingCard>
        {loading ? (
          <Shimmer />
        ) : curve.length === 0 ? (
          <div className="m-empty">
            <span className="m-empty-mark"><Activity size={19} /></span>
            <span className="m-body m-ink3">Nothing to plot for this window.</span>
          </div>
        ) : (
          <div className="m-chart"><PowerCurve data={curve} /></div>
        )}
      </FloatingCard>

      {/* What the curve above cannot be read for.

          The chart says what the plant was doing; these say how much of it
          there was, and the highest it reached — and a peak is specifically
          what a mean-per-bucket line hides, since a spike between two samples
          never becomes a pixel. All three are integrated over raw rows on the
          server, so they are exact over the window the chart is drawn from.

          Deliberately not "Latest power": that is the summary strip's own
          figure at the top of this screen, and this panel already had two
          rings removed for restating it. */}
      <div className="m-grid2" style={{ marginTop: 12 }}>
        <MetricCard
          label="Peak power"
          icon={<Gauge size={15} />}
          loading={loading}
          value={<Value value={hist.totals.peakKw} unit="kW" precision={1} animate />}
          footnote="Highest in either direction"
        />
        <MetricCard
          label="Discharged"
          icon={<ArrowUpFromLine size={15} />}
          loading={loading}
          value={<Value value={hist.totals.discharged} unit="kWh" precision={1} animate />}
          footnote="Over these 24 hours"
        />
      </div>

      {/* A rolling 24 hours is not a day, and this screen must not imply it
          is — the plant's actual days, weeks and months are one tap away and
          that is where a figure gets compared against yesterday's. */}
      <FloatingCard style={{ marginTop: 12, paddingTop: 4, paddingBottom: 4 }}>
        <ListItem
          leading={<BarChart3 size={17} />}
          title="Energy by day, week and month"
          subtitle="Calendar periods you can step back through, not a rolling window"
          onClick={() => router.push("/k/energy")}
          trailing={<ChevronRight size={16} className="m-ink3" />}
        />
      </FloatingCard>

    </>
  );
}

/* ── Right now ─────────────────────────────────────────────────────────── */

/**
 * The readings that are true at this instant and nowhere else on the screen.
 *
 * Deliberately not the summary strip's three figures again. Those are on the
 * overview, above the fold, and restating them here is what got two rings
 * deleted from this panel once already.
 */
function NowSection({ r, site }: {
  r: ReturnType<typeof useReadings>;
  site: ReturnType<typeof useSite>;
}) {
  const conn = useConnectivity();
  return (
    <>
      <SectionHeader title={conn.isLive ? "Right now" : "Last known values"} />
      <div className="m-grid2">
        <MetricCard
          label="Grid frequency"
          icon={<Waves size={15} />}
          value={<Value value={gridHz(site.gridHz, r.gridHz)} unit="Hz" precision={2} />}
        />
        <MetricCard
          label="Power factor"
          icon={<Gauge size={15} />}
          value={<Value value={site.gridPf} unit="" precision={2} />}
        />
        <MetricCard
          label="Cell temp, max"
          icon={<Thermometer size={15} />}
          value={<Value value={r.tempMax} unit="°C" precision={1} />}
        />
        <MetricCard
          label="State of health"
          icon={<Activity size={15} />}
          value={<Value value={r.soh} unit="%" precision={1} />}
        />
      </div>
    </>
  );
}

/**
 * The non-overview tabs.
 *
 * Each reads its own asset rather than re-slicing the battery. Where the whole
 * asset is absent from the gateway's reply — a site with no liquid cooling,
 * say — the panel says so, instead of rendering four dashes and leaving the
 * reader to guess whether the equipment is missing or merely broken.
 */
function AssetPanel({
  tab, r, site,
}: {
  tab: AssetKey;
  r: ReturnType<typeof useReadings>;
  site: ReturnType<typeof useSite>;
}) {
  const groups = {
    battery: {
      asset: "bms_1",
      rows: [
        { label: "Cluster voltage", icon: <Battery size={15} />, value: r.clusterV, unit: "V", dp: 1 },
        { label: "Cluster current", icon: <Activity size={15} />, value: r.clusterA, unit: "A", dp: 1 },
        { label: "Cell spread", icon: <Zap size={15} />, value: r.cellSpreadMv, unit: "mV", dp: 0 },
        { label: "Cell temp, max", icon: <Thermometer size={15} />, value: r.tempMax, unit: "°C", dp: 1 },
        { label: "Cell temp, min", icon: <Thermometer size={15} />, value: r.tempMin, unit: "°C", dp: 1 },
        { label: "State of health", icon: <Activity size={15} />, value: r.soh, unit: "%", dp: 1 },
      ],
    },
    inverter: {
      asset: "pcs_1",
      rows: [
        /* Active and reactive, side by side and from the same snapshot.

           Both are read off useSite rather than taking active from the fast
           profile, so the two describe one instant. Apparent power and power
           factor are published beside them and are not shown — see the note
           on pcsActiveKw in data.ts for the readings that disqualified them. */
        { label: "Active power", icon: <Zap size={15} />, value: site.pcsActiveKw, unit: "kW", dp: 1 },
        { label: "Reactive power", icon: <Waves size={15} />, value: site.pcsReactiveKvar, unit: "kVar", dp: 1 },
        { label: "DC voltage", icon: <Zap size={15} />, value: r.dcVoltage, unit: "V", dp: 1 },
        { label: "DC current", icon: <Activity size={15} />, value: r.dcCurrent, unit: "A", dp: 1 },
        { label: "Grid frequency", icon: <Waves size={15} />, value: r.gridHz, unit: "Hz", dp: 2 },
        { label: "Phase A voltage", icon: <Gauge size={15} />, value: r.phaseV[0], unit: "V", dp: 1 },
        { label: "Phase B voltage", icon: <Gauge size={15} />, value: r.phaseV[1], unit: "V", dp: 1 },
        { label: "Phase C voltage", icon: <Gauge size={15} />, value: r.phaseV[2], unit: "V", dp: 1 },
      ],
    },
    ems: {
      asset: "ems_system",
      rows: [
        { label: "Site load", icon: <Building2 size={15} />, value: site.loadKw, unit: "kW", dp: 1 },
        { label: "Demand", icon: <Gauge size={15} />, value: site.demandKw, unit: "kW", dp: 1 },
        { label: "Available out", icon: <ArrowUpFromLine size={15} />, value: site.availDischargeKw, unit: "kW", dp: 0 },
        { label: "Available in", icon: <ArrowDownToLine size={15} />, value: site.availChargeKw, unit: "kW", dp: 0 },
        { label: "EMS SOC", icon: <Battery size={15} />, value: site.emsSoc, unit: "%", dp: 1 },
        { label: "Charged, month", icon: <Activity size={15} />, value: site.chargedKwhMonth, unit: "kWh", dp: 0 },
      ],
    },
    /* The cooling system, which this tab named and did not read.

       It listed four BMS cell temperatures — two of them already on the
       Battery tab — under an asset header of `liquid_cooling`, so it was a
       re-slice of the battery wearing the cooling system's name. The gateway
       reports 113 liquid_cooling signals on this site; these six say whether
       the loop is doing its job, and the cell temperatures it is holding down
       remain one tap away under Battery. */
    thermal: {
      asset: "liquid_cooling",
      rows: [
        { label: "Coolant in", icon: <Thermometer size={15} />, value: site.coolantInC, unit: "°C", dp: 1 },
        { label: "Coolant out", icon: <Thermometer size={15} />, value: site.coolantOutC, unit: "°C", dp: 1 },
        { label: "Loop ΔT", icon: <Activity size={15} />, value: loopDelta(site.coolantInC, site.coolantOutC), unit: "°C", dp: 1 },
        { label: "Pressure in", icon: <Gauge size={15} />, value: site.coolantInBar, unit: "Bar", dp: 1 },
        { label: "Pressure out", icon: <Gauge size={15} />, value: site.coolantOutBar, unit: "Bar", dp: 1 },
        { label: "Outdoor temp", icon: <Thermometer size={15} />, value: site.outdoorC, unit: "°C", dp: 1 },
      ],
    },
  } as const;

  const g = groups[tab];
  /* Only claim absence once the snapshot has actually arrived — before that,
     `assets` is empty for the ordinary reason that nothing has loaded. */
  const missing = site.ready && !site.assets.includes(g.asset);

  return (
    <>
      {missing && (
        <FloatingCard className="m-note">
          <TriangleAlert size={16} />
          <span>
            This site does not report a separate {g.asset.replace(/_/g, " ")} unit. The readings
            below are what it does report.
          </span>
        </FloatingCard>
      )}
      <div className="m-grid2">
        {g.rows.map((row) => (
          <MetricCard
            key={row.label}
            label={row.label}
            icon={row.icon}
            value={<Value value={row.value} unit={row.unit} precision={row.dp} />}
          />
        ))}
      </div>
    </>
  );
}
