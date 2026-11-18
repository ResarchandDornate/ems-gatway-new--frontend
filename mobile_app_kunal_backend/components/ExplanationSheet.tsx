"use client";

/**
 * What a fault bit means, on tap.
 *
 * The Alarms screen lists registers — `bmu_communication_fault`,
 * `sw_fault_ac_over_voltage`. Those are names from a vendor's Modbus map, and
 * an operator can read that one is asserted without being able to read what it
 * means, what usually causes it, or whether it waits until Monday. This sheet
 * is that gap closed.
 *
 * Where the words come from is stated at the bottom of the sheet rather than
 * hidden. Almost always they were written by an engineer and shipped with the
 * build — no network, no cost, no delay — and the sheet says so. When a
 * deployment has an inference service and meets a register this build has no
 * entry for, it says that instead. A reader is entitled to know which they are
 * looking at, and the distinction is not one to be coy about.
 */

import { AlertTriangle, CircleCheck, Search, BookOpen, Sparkles, FileText } from "lucide-react";
import type { ReactNode } from "react";

import { BottomSheet } from "./Overlays";
import { StatusIndicator } from "./Status";
import { useSignalExplanation } from "../data";
import { explainAlarmRow, signalByName } from "../gateway/explanations";
import type { SignalDef } from "../gateway/signals";

/** Urgency drives one indicator and nothing else — no red screens over a clear bit. */
const URGENCY: Record<string, { tone: "good" | "warn" | "bad" | "idle"; label: string; icon: ReactNode }> = {
  routine: { tone: "good", label: "Routine", icon: <CircleCheck size={15} /> },
  investigate: { tone: "warn", label: "Investigate", icon: <Search size={15} /> },
  urgent: { tone: "bad", label: "Needs attention", icon: <AlertTriangle size={15} /> },
};

/**
 * Where the text came from. Said plainly; see the file comment.
 *
 * Rendered as a wrapping caption rather than a Chip: a chip is a single
 * unwrapped line, and these sentences were being cut off mid-word at the right
 * edge of the sheet.
 */
const SOURCE: Record<string, { icon: ReactNode; text: string }> = {
  local: {
    icon: <BookOpen size={13} />,
    text: "Written by our engineers and shipped with the app. No data left your device to show this.",
  },
  model: {
    icon: <Sparkles size={13} />,
    text: "Generated for this signal, which this build carries no written explanation for. The values above were measured by the plant, not by the model.",
  },
  derived: {
    icon: <FileText size={13} />,
    text: "This app carries no written explanation for this particular signal, so only what the site reports about it is shown. Nothing left your device.",
  },
};

function Provenance({ source }: { source: keyof typeof SOURCE }) {
  const s = SOURCE[source];
  return (
    <div
      className="m-label m-ink3"
      style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 18, lineHeight: 1.5 }}
    >
      <span style={{ flex: "none", marginTop: 1 }}>{s.icon}</span>
      <span>{s.text}</span>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 18 }}>
      <span className="m-eyebrow">{title}</span>
      <ul style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 6 }}>
        {items.map((t, i) => (
          <li key={i} className="m-body m-ink2" style={{ lineHeight: 1.55 }}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export function ExplanationSheet({
  signal, value, unitLabel, open, onClose,
}: {
  signal: SignalDef | null;
  value: number | null;
  unitLabel?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { explanation, source, isLoading, error } = useSignalExplanation(signal, value, open);

  if (!signal) return null;
  const urgency = explanation ? URGENCY[explanation.urgency] ?? URGENCY.investigate : null;

  return (
    <BottomSheet open={open} onClose={onClose} title={signal.label}>
      {/* The sheet draws the label as its own heading, so only the protocol
          name is repeated here — an engineer on the phone will be asked for it
          and it is not guessable from the label. */}
      <div className="m-spread" style={{ alignItems: "flex-start", gap: 12 }}>
        {/* minWidth 0 and an explicit break: protocol names run to 48
            characters with no spaces in them, and a flex item defaults to
            min-content width — so the name refused to wrap and shoved the
            urgency indicator off the right edge of the sheet. */}
        <span className="m-label m-ink3" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {signal.asset} · {signal.name}
          {unitLabel ? ` · ${unitLabel}` : ""}
        </span>
        {urgency && (
          <span style={{ flex: "none" }}>
            <StatusIndicator tone={urgency.tone} label={urgency.label} />
          </span>
        )}
      </div>

      {isLoading && (
        <div className="m-body m-ink3" style={{ marginTop: 20 }}>
          Preparing an explanation…
        </div>
      )}

      {explanation && (
        <>
          {/* The one sentence first. A reader who stops after a line should
              have read the line that matters. */}
          <div
            className="m-body m-ink"
            style={{ marginTop: 16, lineHeight: 1.6, fontWeight: 560 }}
          >
            {explanation.bottom_line}
          </div>

          <div className="m-body m-ink2" style={{ marginTop: 12, lineHeight: 1.6 }}>
            {explanation.meaning}
          </div>

          <Section title="Common causes" items={explanation.likely_causes} />
          <Section title="What to check" items={explanation.what_to_check} />

          {/* Standing limitation, on every sheet. This app cannot act and the
              reader may be a customer rather than an engineer. */}
          <div className="m-banner" style={{ marginTop: 20 }}>
            <AlertTriangle size={15} style={{ flex: "none", marginTop: 1 }} />
            <span>
              Guidance only, and not a substitute for your operator. Nothing here should
              be carried out inside the enclosure.
            </span>
          </div>

          {source && <Provenance source={source} />}
        </>
      )}

      {error && !explanation && (
        <div className="m-body m-ink3" style={{ marginTop: 20, lineHeight: 1.6 }}>
          No explanation could be prepared. The readings on screen are unaffected.
        </div>
      )}
    </BottomSheet>
  );
}

/**
 * The same sheet, for a row off the gateway's /api/alarms endpoint.
 *
 * A separate component rather than a mode flag on the one above, because the
 * two differ in the property that matters: this one is answered synchronously
 * and can never reach the network, since every case it handles is either a
 * written entry or the setpoint text. Nothing here can cost money or block on
 * a request, and keeping that guarantee visible in the type is worth a second
 * component.
 */
export function AlarmRowExplanationSheet({
  signalName, label, asset, value, isState, unitLabel, open, onClose,
}: {
  signalName: string;
  label: string;
  asset: string;
  value: number | null;
  /** The caller's own isAlarmState — a real asserted state, or a setpoint. */
  isState: boolean;
  unitLabel?: string;
  open: boolean;
  onClose: () => void;
}) {
  const sig = signalByName(signalName);
  const explanation = explainAlarmRow(signalName, value, isState, sig);
  const urgency = URGENCY[explanation.urgency] ?? URGENCY.investigate;

  /* Which of the two answered. A setpoint row and a dictionary hit are both
     written content; a row from outside the 63-signal profile is not, and
     labelling that "written by our engineers" would be a false provenance
     claim on the one screen where provenance is the point. */
  const source: keyof typeof SOURCE = !isState || sig ? "local" : "derived";

  return (
    <BottomSheet open={open} onClose={onClose} title={label}>
      <div className="m-spread" style={{ alignItems: "flex-start", gap: 12 }}>
        {/* See the note on the signal sheet above: these names are the longest
            strings in the app and will push a sibling off-screen without it. */}
        <span className="m-label m-ink3" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
          {asset} · {signalName}
          {unitLabel ? ` · ${unitLabel}` : ""}
        </span>
        <span style={{ flex: "none" }}>
          <StatusIndicator tone={urgency.tone} label={urgency.label} />
        </span>
      </div>

      <div className="m-body m-ink" style={{ marginTop: 16, lineHeight: 1.6, fontWeight: 560 }}>
        {explanation.bottom_line}
      </div>
      <div className="m-body m-ink2" style={{ marginTop: 12, lineHeight: 1.6 }}>
        {explanation.meaning}
      </div>

      <Section title="Common causes" items={explanation.likely_causes} />
      <Section title="What to check" items={explanation.what_to_check} />

      <div className="m-banner" style={{ marginTop: 20 }}>
        <AlertTriangle size={15} style={{ flex: "none", marginTop: 1 }} />
        <span>
          Guidance only, and not a substitute for your operator. Nothing here should
          be carried out inside the enclosure.
        </span>
      </div>

      <Provenance source={source} />
    </BottomSheet>
  );
}
