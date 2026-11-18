"use client";

/**
 * Advisor — findings over this unit's own measurements.
 *
 * ── Why this screen exists again ──────────────────────────────────────────
 * The dock carried no Advisor for most of this build's life, and the reason
 * was good: there was no history to reason over, so an advisor would have had
 * nothing to say and would have said it anyway. Both halves of that have
 * changed. The historian holds a real window now, and the findings below are
 * computed from it by rules in gateway/findings.ts rather than generated.
 *
 * ── What a reader is looking at ───────────────────────────────────────────
 * Every number on this screen was measured by the plant and integrated by the
 * historian. Every sentence was written by an engineer and selected by a
 * threshold. Nothing on this screen is generated per-visit, nothing is
 * inferred, and the screen says so at the bottom rather than implying more
 * than it does.
 *
 * The rules are conservative by design: a finding that fires on a healthy
 * plant teaches its reader to ignore the screen, which is worse than silence.
 * An empty findings list over a healthy unit is the intended outcome, not a
 * failure to have something to display.
 */

import { useState } from "react";
import {
  Lightbulb, Gauge, Thermometer, Activity, ChevronDown, ChevronUp,
  ShieldCheck, Sparkles, CircleCheck,
} from "lucide-react";

import { useAdvisor, useBessIds } from "../data";
import { EVIDENCE_LABEL, type EvidenceKey, type Finding } from "../gateway/aiTypes";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, MetricCard, StatusIndicator, Value,
  FeatureCard, Chip, ChipRow, Readout, Segmented, Shimmer, GhostButton,
} from "../components";

/**
 * Windows a customer actually asks about.
 *
 * Keyed by string because Segmented is generic over string — the value is a
 * tab identity, and minutes are recovered with Number() at the one place that
 * needs them rather than threading a parallel lookup through the screen.
 */
const SPANS = [
  { value: "360", label: "6 h" },
  { value: "1440", label: "24 h" },
  { value: "4320", label: "3 d" },
] as const;

/**
 * How each evidence figure reads on a chip.
 *
 * The unit lives here rather than in the vocabulary because the vocabulary is
 * also a prompt and a validator, and neither of those wants "%" appended.
 */
const UNIT: Partial<Record<EvidenceKey, string>> = {
  windowHours: " h",
  roundTripPct: "%",
  chargedKwh: " kWh",
  dischargedKwh: " kWh",
  peakKw: " kW",
  socMinPct: "%",
  socMaxPct: "%",
  tempMaxC: " °C",
  cellSpreadMv: " mV",
  sohPct: "%",
  coveragePct: "%",
  skippedMinutes: " min",
  readingAgeSeconds: " s",
};

const CONFIDENCE: Record<Finding["confidence"], { tone: "good" | "warn" | "bad" | "idle"; label: string }> = {
  high: { tone: "good", label: "High confidence" },
  medium: { tone: "idle", label: "Medium confidence" },
  low: { tone: "warn", label: "Low confidence" },
};

function FindingCard({ finding, values }: { finding: Finding; values: Record<string, number | undefined> }) {
  const [open, setOpen] = useState(false);
  const conf = CONFIDENCE[finding.confidence];

  return (
    <FloatingCard style={{ marginBottom: 12 }}>
      <button
        className="m-spread"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%", background: "none", border: 0, padding: 0,
          textAlign: "left", cursor: "pointer", alignItems: "flex-start", gap: 12,
        }}
      >
        <div className="m-stack" style={{ gap: 6 }}>
          <span className="m-h2 m-ink">{finding.title}</span>
          <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
            {finding.observation}
          </span>
        </div>
        <span className="m-ink3" style={{ flex: "none", marginTop: 2 }}>
          {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
        </span>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          {finding.why_it_matters && (
            <>
              <span className="m-eyebrow">Why it matters</span>
              <div className="m-body m-ink2" style={{ marginTop: 6, lineHeight: 1.6 }}>
                {finding.why_it_matters}
              </div>
            </>
          )}
          {finding.suggested_action && (
            <div style={{ marginTop: 14 }}>
              <span className="m-eyebrow">Suggested action</span>
              <div className="m-body m-ink2" style={{ marginTop: 6, lineHeight: 1.6 }}>
                {finding.suggested_action}
              </div>
            </div>
          )}
        </div>
      )}

      {/* The figures this finding rests on, with their values. A reader can
          check the arithmetic against the same numbers the rule used — which
          is the property that makes a rule defensible and a model's opinion
          not. */}
      <ChipRow>
        <Chip tone={conf.tone === "idle" ? undefined : conf.tone}>{conf.label}</Chip>
        {finding.evidence.map((k) => {
          const v = values[k];
          return (
            <Chip key={k}>
              {EVIDENCE_LABEL[k]}
              {v !== undefined ? ` ${v}${UNIT[k] ?? ""}` : ""}
            </Chip>
          );
        })}
      </ChipRow>
    </FloatingCard>
  );
}

export function AdvisorScreen() {
  const [span, setSpan] = useState<string>("1440");
  const [wantProse, setWantProse] = useState(false);

  const { evidence, advice, prose, proseLoading, aiAvailable, isLoading } =
    useAdvisor(Number(span), wantProse);
  const units = useBessIds();

  /* Prose, when a deployment has an inference service and a person asked for
     it, replaces only the wording. The rules still decide what is shown and
     the evidence chips still carry the measured values. */
  const shown = prose?.findings.length ? prose : advice;

  /* Reassurance does not count towards "worth a look", and does not count in
     the headline number either. A card that exists to tell a customer nothing
     is wrong must not be what makes the screen say something is. */
  const raised = shown.findings.filter((f) => !f.reassurance);
  const reassuring = shown.findings.filter((f) => f.reassurance);

  return (
    <>
      <Header />

      <FeatureCard style={{ marginBottom: 20 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Findings</span>
          <StatusIndicator
            tone={raised.length > 0 ? "warn" : "good"}
            label={raised.length > 0 ? "Worth a look" : "Nothing flagged"}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={raised.length} precision={0} />
        </div>
        <ChipRow>
          {/* Names the unit these findings are about. It read "2 units on
              site", which described the site rather than the scope — and the
              findings are for the selected unit only. */}
          <Chip>{units.length > 1 ? "This unit only" : "This unit"}</Chip>
          <Chip>
            {shown.data_sufficiency === "sufficient"
              ? "Window sufficient"
              : shown.data_sufficiency === "thin"
                ? "Thin window"
                : "Insufficient data"}
          </Chip>
        </ChipRow>
      </FeatureCard>

      <Segmented<string>
        ariaLabel="Window"
        value={span}
        onChange={setSpan}
        options={SPANS.map((s) => ({ value: s.value as string, label: s.label }))}
      />

      {/* The summary sentence, before the list. */}
      {shown.overall && (
        <FloatingCard tone="glass" style={{ marginTop: 20 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span className="m-metric-icon" style={{ width: 34, height: 34, borderRadius: 12 }}>
              <Lightbulb size={17} />
            </span>
            <span className="m-body m-ink2" style={{ lineHeight: 1.6 }}>
              {shown.overall}
            </span>
          </div>
        </FloatingCard>
      )}

      <div style={{ marginTop: 24 }}>
        <SectionHeader
          title="What we noticed"
          action={<span className="m-label m-ink3">{raised.length}</span>}
        />

        {/* Only a cold start shimmers. The findings are computed synchronously
            from whatever evidence is in hand, so once there is anything to say
            it is said — a window still filling in the background is itself one
            of the things the rules report, and blocking the list on it left the
            screen shimmering under a header that already had a count. */}
        {isLoading && raised.length === 0 ? (
          <FloatingCard>
            <div style={{ display: "grid", gap: 14, padding: "6px 0" }}>
              <Shimmer w="78%" h={15} />
              <Shimmer w="56%" h={15} />
            </div>
          </FloatingCard>
        ) : raised.length === 0 ? (
          <FloatingCard>
            <div className="m-empty">
              <span className="m-empty-mark"><CircleCheck size={19} /></span>
              <span className="m-body m-ink3">
                Nothing in this window crossed a threshold worth reporting.
              </span>
            </div>
          </FloatingCard>
        ) : (
          raised.map((f, i) => (
            <FindingCard key={`${f.title}-${i}`} finding={f} values={evidence} />
          ))
        )}
      </div>

      {/* Reassurance sits under its own heading rather than in the numbered
          list. It is not something noticed about the plant — it is context
          about a known gateway defect — and counting it made a healthy site
          read as though it had findings. */}
      {reassuring.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionHeader title="Also worth knowing" />
          {reassuring.map((f, i) => (
            <FindingCard key={`${f.title}-${i}`} finding={f} values={evidence} />
          ))}
        </div>
      )}

      {/* The measurements themselves, under the findings rather than over them.
          A reader who disagrees with a finding needs the figures it was drawn
          from, and a reader who trusts it does not need to scroll past them. */}
      <div style={{ marginTop: 26 }}>
        <SectionHeader title="What this was computed from" />
        <div className="m-grid2">
          <MetricCard
            label="Round-trip"
            icon={<Gauge size={15} />}
            value={<Value value={evidence.roundTripPct ?? null} unit="%" precision={1} animate />}
            footnote="Discharged ÷ charged, this window"
          />
          <MetricCard
            label="Cell spread"
            icon={<Activity size={15} />}
            value={<Value value={evidence.cellSpreadMv ?? null} unit="mV" precision={0} animate />}
            footnote="Highest cell vs lowest, now"
          />
          <MetricCard
            label="Peak temp"
            icon={<Thermometer size={15} />}
            value={<Value value={evidence.tempMaxC ?? null} unit="°C" precision={1} animate />}
            footnote="Highest over this window"
          />
          <MetricCard
            label="Coverage"
            icon={<ShieldCheck size={15} />}
            value={<Value value={evidence.coveragePct ?? null} unit="%" precision={0} animate />}
            footnote="Of the window the historian holds"
          />
        </div>
      </div>

      {/* Offered only where a deployment actually has an inference service.
          Off by default and never automatic: it is a request that costs money
          to serve, and a screen that spends on every visit is a screen nobody
          budgeted for. */}
      {aiAvailable && !wantProse && (
        <div style={{ marginTop: 20 }}>
          <GhostButton onClick={() => setWantProse(true)}>
            <Sparkles size={15} /> Rewrite these findings in plain language
          </GhostButton>
        </div>
      )}
      {proseLoading && (
        <div className="m-body m-ink3" style={{ marginTop: 16 }}>
          Rewriting…
        </div>
      )}

      <div className="m-banner" style={{ marginTop: 22 }}>
        <ShieldCheck size={15} style={{ flex: "none", marginTop: 1 }} />
        <span>
          {prose ? (
            <>
              <b>Findings are computed, wording is generated.</b> Every figure here was
              measured by the plant and every threshold is a written rule; only the
              phrasing was rewritten. No number on this screen came from a model.
            </>
          ) : (
            <>
              <b>These findings are computed, not generated.</b> Each one is a written
              rule applied to your own readings, and the figures it used are shown beside
              it. Thresholds are conservative general guidance, not your equipment's
              commissioned limits — contact your operator for anything requiring action.
            </>
          )}
        </span>
      </div>
    </>
  );
}
