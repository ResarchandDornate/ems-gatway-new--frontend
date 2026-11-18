"use client";

/**
 * History — what the plant actually did.
 *
 * The series arrives already aggregated from /api/gw/history-series. The phone
 * used to page raw one-second rows itself: 8.7 MB an hour for the four figures
 * this screen draws, sized by a page budget that assumed the wrong resolution.
 * It showed 10,000 samples, a flat zero line and 0.0 kWh of throughput for a
 * battery that was cycling, under a "6h" label covering two hours and sixteen
 * minutes.
 *
 * So this screen now states three things it previously assumed. What resolution
 * the line is drawn at — it is a mean over a bucket, and a sub-bucket spike
 * lives in Peak power rather than on the line. What the window actually covers,
 * measured, not inferred. And whether the gateway returned anything this build
 * could not read, which is a different fact from a quiet plant and must never
 * again look like one.
 */

import { useEffect, useMemo, useState } from "react";
import {
  LineChart as LineIcon, TriangleAlert, Thermometer, Activity, Info, MessageSquare,
} from "lucide-react";
import { useHistory, decimate } from "../data";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, Segmented, Shimmer, MetricCard, Value,
  FeatureCard, Chip, ChipRow, Readout, StatusIndicator,
  SectionMenu, SectionBack, useSection,
} from "../components";
import { PowerCurve } from "../viz/PowerCurve";
import { AskChat, type Turn } from "../components/AskChat";
import { answerQuery, type Answer } from "../gateway/queryAnswer";
import { FIELD_LABEL, type HistoryQuery } from "../gateway/queryParse";

/** Segmented is keyed by string, so the minutes ride alongside the key. */
type Span = "15m" | "1h" | "6h" | "24h" | "7d" | "30d";

const SPANS: { value: Span; label: string }[] = [
  { value: "15m", label: "15m" },
  { value: "1h",  label: "1h" },
  { value: "6h",  label: "6h" },
  { value: "24h", label: "24h" },
  { value: "7d",  label: "7d" },
  { value: "30d", label: "30d" },
];

const MINUTES: Record<Span, number> = {
  "15m": 15, "1h": 60, "6h": 360, "24h": 1440, "7d": 10_080, "30d": 43_200,
};

/* The gateway's retention target is ninety days, so 30d is well inside what it
   holds, and every span here returns a complete window.

   This used to warn that the long spans "will hit the page budget and say so".
   That described the client paging raw rows itself and has not been true since
   series.ts moved the work server-side: the phone now receives fixed-size
   aggregated buckets whatever the window, and the gateway's five-thousand-row
   page cap is the server's problem rather than something a reader ever meets.

   Measured against the commissioned gateway: a cold 1 h window took 42 s and a
   cold 24 h took 99-105 s, both complete; warm, they answer in 5-30 ms from
   the chunk cache. What makes a cold window slow is contention on the board,
   not a limit on how much of it can be fetched — see gateway/pressure.ts. */

const BASE = "/k/history";

/**
 * History, as a contents page.
 *
 * Only two rows, and it is still worth having. The conversation used to open
 * this screen — a chat box, its thread, and whatever it had been asked — above
 * the chart every single visit, including the great majority of visits where
 * nobody wanted to type anything. Choosing between "show me the window" and
 * "let me ask about it" costs one tap and removes the larger of the two from
 * the case that does not want it.
 *
 * Both sections render the same chart and the same summary, because the answer
 * to a typed question IS the window it retargets — separating the reply from
 * the evidence would leave the conversation asserting figures with nothing on
 * screen to check them against.
 */
const HISTORY_SECTIONS = ["window", "ask"] as const;
type HistorySection = (typeof HISTORY_SECTIONS)[number];

const clock = (t: number) =>
  new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function HistoryScreen() {
  const section = useSection(BASE, HISTORY_SECTIONS) as HistorySection | null;
  const [span, setSpan] = useState<Span>("1h");

  /* A typed question, when there is one. It owns the window while it is set,
     and the span buttons drop it — those are two ways of asking the same
     screen for a period, and leaving both live would put a "25 August" heading
     over the last hour. */
  const [ask, setAsk] = useState<HistoryQuery | null>(null);

  /* The conversation. Only the newest turn is ever awaiting an answer — a
     question retargets the window, so an earlier turn's figures cannot be
     recomputed once the window has moved on. Answered turns keep the answer
     they were given, which is also what makes the thread readable: each
     bubble stays true to the moment it was asked. */
  const [turns, setTurns] = useState<Turn[]>([]);

  /* Read once per render rather than per call, so the parser, the window and
     the heading all agree about when "yesterday" was even if the render
     straddles midnight. */
  const now = Date.now();

  /* An asked window is absolute; a span is the last N minutes. `minutes` still
     sizes the bucket in both cases, so it is derived from the window's own
     width rather than left at the span's. */
  const askedMinutes = ask
    ? Math.max(1, Math.round((ask.range.to - ask.range.from) / 60_000))
    : null;
  const minutes = askedMinutes ?? MINUTES[span];
  const h = useHistory(
    minutes,
    undefined,
    ask ? { from: ask.range.from, to: ask.range.to } : undefined,
  );
  const { totals, coverage } = h;

  /* Three states, not two.

     Answering from an empty window would report "did not cross that level"
     about a period nobody has read yet — the same confident-claim-about-
     nothing this screen guards against elsewhere. But holding the "reading…"
     line forever is its own version of that: a wide cold window on this
     gateway can take a hundred seconds and can also simply fail, and a
     question that never resolves tells the reader nothing about which.

     So: null while it is genuinely still arriving, an explicit note once it
     has settled with nothing, and a real answer otherwise. */
  const answer: Answer | null = useMemo(() => {
    if (!ask) return null;
    if (coverage.ready > 0) return answerQuery(ask, h.samples, totals);
    if (h.isLoading || h.isFilling) return null;
    return {
      kind: "unanswerable",
      label: FIELD_LABEL[ask.field],
      reason: h.error
        ? "This period could not be read from the site, so there is nothing to answer from. The readings themselves are unaffected."
        : "Nothing has been recorded for this period yet, so there is nothing to answer from. This is an absence of data, not a reading of zero.",
    };
  }, [ask, h.isLoading, h.isFilling, h.error, h.samples, totals, coverage.ready]);

  /* Fill in the newest turn once its window resolves. Keyed on the turn id so
     a slow answer arriving after another question was asked cannot overwrite
     the newer one. */
  useEffect(() => {
    if (!answer) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.answer !== null) return prev;
      return [...prev.slice(0, -1), { ...last, answer }];
    });
  }, [answer]);

  /* Nothing landed for this window.
  
     `ready` is how many chunks came back holding anything; zero of them means
     no part of this period was successfully read — the gateway was unreachable,
     or every attempt is still outstanding. It is emphatically NOT the same as a
     plant that sat idle, and the two were rendering identically: "No data
     recorded for this period" over four tiles of 0.00 kWh, which is a
     confident statement about a battery nobody managed to ask.
  
     Distinguished here rather than server-side because the server already
     reports it correctly — coverage.ready and coverage.total are exactly this
     fact, and the screen was simply not reading them.

     `total > 0` used to be part of this test, and was the hole in it. Coverage
     reads 0 of 0 when the request produced no answer at all — the query never
     ran, or it came back with no chunks to report on — and that fell straight
     past this guard into "No data recorded for this period": the same
     confident claim about the plant the check exists to prevent, made in the
     one situation where the app knows the least. Zero chunks read is zero
     chunks read, however many were asked for. */
  const unread = !h.isLoading && !h.error && coverage.ready === 0;

  const curve = useMemo(
    () =>
      decimate(h.samples).map((s) => ({
        /* The raw instant. Formatting belongs to the axis now, which needs the
           number to place the point at all — see CurvePoint.t. */
        t: s.t,
        /* No `?? 0`. A missing measurement is a gap in the line. */
        power: s.powerKw,
        soc: s.soc,
      })),
    [h.samples],
  );

  /* Charged, discharged and their total, rounded once and consistently.

     throughput is charged + discharged exactly, but each was being rounded to
     one decimal independently — so at a boundary the headline disagreed with
     the two chips beneath it. Observed on screen: "8.1" over chips reading 8.0
     and 0.2, which a reader checks by adding and finds wrong.

     The parts are rounded first and the total is their sum, so the arithmetic
     on screen is always right. The cost is at most 0.05 kWh of drift from the
     exact total on a figure displayed to a tenth — far below what this screen
     is read for, and the coverage banner already governs how complete the
     window is. Consistency is worth more here than the last hundredth. */
  const dp1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  const charged = dp1(totals.charged);
  const discharged = dp1(totals.discharged);
  const throughput = charged == null || discharged == null ? null : charged + discharged;

  /* The line is a mean over the bucket, so it is labelled as one. Calling a
     five-second mean "1s resolution" would misdescribe what sits between two
     points, which is the same class of claim this screen exists to avoid. */
  const fillPct = coverage.windowMs
    ? Math.min(100, Math.round((coverage.coveredMs / coverage.windowMs) * 100))
    : 0;

  /* Everything this window needs to say about itself, gathered before the
     render so the banner below can be one block rather than three. Order is
     deliberate: what was discarded, then what the data actually is, then how
     much of it arrived. */
  const notes: React.ReactNode[] = [];

  if (h.undecodable > 0) {
    notes.push(
      <>
        Some readings in this window could not be read and are excluded from the
        figures below, rather than counted as zero.
      </>,
    );
  }

  if (h.burstWindow) {
    notes.push(
      <>
        One-second data is only retained for a fixed stretch of the reference capture, so this
        window is answered with that stretch as it actually occurred —{" "}
        {new Date(h.burstWindow[0]).toLocaleString("en-IN", { hour12: false })} to{" "}
        {clock(h.burstWindow[1])} — rather than restamped onto the range requested. A live
        gateway serves the range asked for.
      </>,
    );
  }

  /* Not an error. The window is filling, the chart is drawing what has landed,
     and the gaps are named so nobody reads a partial series as a complete one.
     This replaces "page limit reached", which announced a client-side budget as
     though it were a limit of the plant. */
  if (!h.isLoading && !h.error && !coverage.complete && coverage.coveredMs > 0) {
    notes.push(
      <>
        {h.isFilling ? "Still loading this period." : "This period is incomplete."}
        {coverage.gaps.length > 0 && (
          <>
            {" No data for "}
            {coverage.gaps.slice(0, 2).map(([a, b]) => `${clock(a)}–${clock(b)}`).join(", ")}
            {coverage.gaps.length > 2 ? ` and ${coverage.gaps.length - 2} other periods` : ""}
            {"."}
          </>
        )}
        {" The figures above cover only what is shown."}
      </>,
    );
  }

  return (
    <>
      <Header />

      {!section && (
        <>
          <div style={{ padding: "0 4px 18px" }}>
            <span className="m-h1 m-ink">History</span>
          </div>
          <SectionMenu
            base={BASE}
            items={[
              {
                key: "window",
                title: "Power and SOC",
                subtitle: "Rolling windows from 15 minutes to 30 days, with what the plant moved in each",
                icon: <LineIcon size={17} />,
              },
              {
                key: "ask",
                title: "Ask a question",
                subtitle: "Type a period or a reading in your own words — \u201cSOC on 25 August\u201d",
                icon: <MessageSquare size={17} />,
              },
            ]}
          />
        </>
      )}

      {section && <SectionBack title="History" base={BASE} />}

      {section === "ask" && <AskChat
        turns={turns}
        pending={Boolean(ask) && answer === null}
        onAsk={(q, asked, assumptions, readAs) => {
          setAsk(q);
          setTurns((prev) => [...prev, { id: prev.length + 1, asked, answer: null, query: q, assumptions, readAs }]);
        }}
        onClear={() => { setAsk(null); setTurns([]); }}
        now={now}
      />}

      {section && <>

      {/* What the window was, in the customer's terms.
      
          This card used to headline the row count — "21,557" under "Rows
          behind this window" — beside a "30 s mean" pill. Both are facts about
          how the app fetched the data, not about the plant, and neither is
          actionable by the person reading it. The figures that are: how much
          energy moved, and where the state of charge went. */}
      <FeatureCard style={{ marginBottom: 18 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Energy this period</span>
          {/* Still shown while a wide window is being assembled, because the
              totals beneath it are incomplete until it finishes. Silent once
              the window is whole. */}
          {h.isFilling && !h.error && (
            <StatusIndicator tone="warn" label={`Loading ${fillPct}%`} />
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          {/* kWh, same as the two chips below it. Without the unit this
              rendered a bare "7.0" under "Energy this period" — the only
              headline figure in the app carrying a physical quantity and not
              naming it, next to chips that do. It also fixes the empty state:
              Readout puts the unit after the em-dash, so an unread window now
              reads "— kWh" rather than a dash with no indication of what was
              being measured. */}
          <Readout value={unread ? null : throughput} unit="kWh" precision={1} />
        </div>
        <ChipRow>
          <Chip>Charged <Value value={unread ? null : charged} unit="kWh" precision={1} /></Chip>
          <Chip>Discharged <Value value={unread ? null : discharged} unit="kWh" precision={1} /></Chip>
          {!unread && totals.socMin != null && totals.socMax != null && (
            <Chip>SOC {totals.socMin.toFixed(0)}–{totals.socMax.toFixed(0)}%</Chip>
          )}
        </ChipRow>
      </FeatureCard>

      {/* Picking a span drops the question. They are two ways of asking this
          screen for a period, and leaving both live would leave "25 August"
          heading a chart of the last hour. */}
      <Segmented<Span>
        ariaLabel="History window"
        /* Nothing is selected while a question owns the window. Leaving "1h"
           lit under a "25 August" heading claims the chart is the last hour,
           which is exactly the kind of confident-but-wrong label the rest of
           this screen exists to avoid. `""` matches no option, and tapping any
           of them takes the window back. */
        value={ask ? ("" as Span) : span}
        onChange={(v) => { setSpan(v); setAsk(null); }}
        options={SPANS}
      />

      {/* Still reported, because excluding readings silently would be worse —
          but as a condition, not as a stack trace. The column names this used
          to print are a diagnostic for whoever maintains the gateway, and mean
          nothing to the person whose plant this is. They remain available in
          the API response for anyone debugging. */}
      {/* One banner, however many of these are true.

          There were three, each with its own copy of the same warning
          triangle and its own 14px of margin. They are not mutually
          exclusive — a window can be incomplete AND hold rows this build
          could not decode AND be answered from the capture's burst — so on a
          375pt phone three stacked notices pushed the chart, the thing the
          screen exists to show, off the first screenful entirely.

          Merged, they are one bordered block with one icon and a line each.
          Nothing is dropped and no wording is softened; they simply stop each
          claiming a card's worth of vertical space. */}
      {notes.length > 0 && (
        <div
          className={`m-banner${h.undecodable > 0 ? " is-warn" : ""}`}
          style={{ marginTop: 14 }}
        >
          {/* The triangle is earned only by the undecodable case, which is the
              one saying a reading was thrown away. "Still loading" and "this
              window came from the capture's burst" are statements of fact
              about a working screen, and an alarm glyph over them is the
              crying-wolf this file argues against elsewhere. */}
          {h.undecodable > 0
            ? <TriangleAlert size={15} style={{ flex: "none", marginTop: 1 }} />
            : <Info size={15} style={{ flex: "none", marginTop: 1 }} />}
          <div className="m-stack" style={{ gap: 6 }}>
            {notes.map((n, i) => <span key={i}>{n}</span>)}
          </div>
        </div>
      )}

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Power and SOC" />
        <FloatingCard>
          {h.isLoading ? (
            <Shimmer w="100%" h={200} r={16} />
          ) : h.error ? (
            <div className="m-empty">
              <span className="m-empty-mark"><TriangleAlert size={19} /></span>
              <span className="m-body m-ink3">{h.error}</span>
            </div>
          ) : curve.length === 0 ? (
            <div className="m-empty">
              <span className="m-empty-mark">
                {unread ? <TriangleAlert size={19} /> : <LineIcon size={19} />}
              </span>
              {/* Two different sentences, because they are two different facts.
                  A read that succeeded and held nothing is a real answer about a
                  plant that was not logging. A window nothing came back for is a
                  statement about this app, and saying the first when the second
                  is true is the failure this screen exists to prevent. */}
              <span className="m-body m-ink3">
                {unread
                  ? "Nothing has loaded for this period yet."
                  : "No data recorded for this period."}
              </span>
            </div>
          ) : (
            <>
              <div className="m-chart" style={{ height: 220 }}>
                  {/* The requested window, not the loaded one. A period still
                      filling should read as a period still filling. */}
                  <PowerCurve data={curve} window={h.requested} />
                </div>
              <div className="m-chart-legend">
                <span className="m-legend-key">
                  <span className="m-legend-swatch" style={{ background: "var(--m-cyan)" }} />Power kW
                </span>
                <span className="m-legend-key">
                  <span className="m-legend-swatch" style={{ background: "var(--m-primary)" }} />SOC %
                </span>
              </div>
            </>
          )}
        </FloatingCard>
      </div>

      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Period summary" />
        <div className="m-grid2">
          <MetricCard
            label="Discharged"
            icon={<Activity size={15} />}
            loading={h.isLoading}
            value={<Value value={unread ? null : totals.discharged} unit="kWh" precision={2} animate />}
          />
          <MetricCard
            label="Charged"
            icon={<Activity size={15} />}
            loading={h.isLoading}
            value={<Value value={unread ? null : totals.charged} unit="kWh" precision={2} animate />}
          />
          <MetricCard
            label="Peak power"
            icon={<Activity size={15} />}
            loading={h.isLoading}
            value={<Value value={unread ? null : totals.peakKw} unit="kW" precision={1} animate />}
            footnote="Highest in either direction"
          />
          <MetricCard
            label="Peak cell temp"
            icon={<Thermometer size={15} />}
            loading={h.isLoading}
            value={<Value value={unread ? null : totals.tempMax} unit="°C" precision={1} animate />}
          />
        </div>
      </div>

      {/* The caveat stays — a throughput ratio presented as efficiency would
          be the first dishonest number in the app — but as one sentence rather
          than the four-line explanation that was here. The reader needs to
          know not to read it as efficiency; they do not need the derivation. */}
      <div className="m-label m-ink3" style={{ padding: "16px 6px 0", lineHeight: 1.55 }}>
        Discharged ÷ charged over this period is{" "}
        {unread || totals.ratioPct == null ? "—" : `${totals.ratioPct.toFixed(0)}%`}. This is not
        round-trip efficiency, which needs complete charge and discharge cycles.
      </div>
    </>}
    </>
  );
}
