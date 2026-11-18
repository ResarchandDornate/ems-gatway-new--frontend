"use client";

/**
 * Signals — all 63 points of the fast profile, as read right now.
 *
 * This is the screen that answers "show me the data". No aggregation, no
 * interpretation: the gateway's own signal names, the profile's units, and
 * the current value of each.
 *
 * Opens on readings. The 25 fault and alarm bits are a tap away under Faults,
 * and a fault that is actually asserted is the Alarms screen's job.
 *
 * A "Flagged" filter used to sit here, marking twelve signals that held one
 * value across a 20-hour reference capture. That was an engineering note —
 * its own copy told the reader to confirm them with the gateway team — and it
 * shipped to every customer. The observation still lives in SUSPECT_STATIC for
 * whoever needs it; it is no longer a screen.
 */

import { useMemo, useState } from "react";
import { Search, TriangleAlert, Thermometer, ToggleLeft, Zap } from "lucide-react";
import { useAllSignals, useLive, useConnectivity } from "../data";
import { decode, isFaultBit } from "../gateway/signals";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, ListItem, StatusIndicator,
  FeatureCard, Chip, ChipRow, Readout, Value, Shimmer,
  SectionMenu, SectionBack, useSection,
} from "../components";

const BASE = "/k/signals";

/**
 * The 63 points, grouped the way the dictionary already groups them.
 *
 * This screen used to open on 38 rows behind a four-way segmented filter —
 * Readings, All, Moving, Faults. Those are four ways of slicing the same list
 * and none of them is what a reader arrives wanting; "is the cooling all
 * right" is, and answering it meant scrolling past nineteen voltages.
 *
 * So the split is by what the signal measures, taken from each definition's
 * own `category` rather than invented here. Fault bits keep their own section:
 * 29 of the 63 are fault bits, almost all constant zero because that is what
 * health looks like, and mixing them into the measurements is what buried the
 * measurements.
 */
const SIGNAL_SECTIONS = ["electrical", "thermal", "status", "faults"] as const;
type SignalSection = (typeof SIGNAL_SECTIONS)[number];

/** Which dictionary categories each section gathers. */
const IN_SECTION: Record<SignalSection, (c: string) => boolean> = {
  electrical: (c) => ["power", "current", "voltage", "soc_soh"].includes(c),
  thermal:    (c) => ["temperature", "insulation"].includes(c),
  status:     (c) => ["status", "io", "general"].includes(c),
  faults:     (c) => c === "fault_alarm",
};

const SECTION_TITLE: Record<SignalSection, string> = {
  electrical: "Power, voltage and charge",
  thermal:    "Temperature and insulation",
  status:     "Status and I/O",
  faults:     "Fault bits",
};

export function SignalsScreen() {
  const rows = useAllSignals();
  const live = useLive();
  const conn = useConnectivity();
  const section = useSection(BASE, SIGNAL_SECTIONS) as SignalSection | null;
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    if (!section) return [];
    const needle = q.trim().toLowerCase();
    const inSection = IN_SECTION[section];
    return rows.filter(({ def }) => {
      if (needle && !def.name.toLowerCase().includes(needle) && !def.label.toLowerCase().includes(needle)) {
        return false;
      }
      return inSection(def.category);
    });
  }, [rows, section, q]);

  /* Counts for the menu, over every signal rather than over the search. They
     describe what a section holds, not what a half-typed query leaves. */
  const counts = useMemo(() => {
    const out = {} as Record<SignalSection, number>;
    for (const k of SIGNAL_SECTIONS) out[k] = rows.filter(({ def }) => IN_SECTION[k](def.category)).length;
    return out;
  }, [rows]);

  const activeFaults = rows.filter(({ def, value }) => isFaultBit(def) && value != null && value > 0).length;

  return (
    <>
      <Header />
      {section && <SectionBack title="Signals" base={BASE} />}

      <FeatureCard style={{ marginBottom: 18 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Signals reported</span>
          <StatusIndicator
            /* The shared rule, not a second one. This screen used to decide
               "stale" for itself against its own threshold, which is how the
               dashboard came to call the same reading current while this one
               called it stale. */
            tone={conn.tone}
            /* "Streaming" is a claim that readings are arriving now. Against
               the bundled capture they are not — the rows are a recording, and
               the Header is saying exactly that in an amber bar a hundred
               pixels above this badge. Two statements that contradict each
               other on one screen make the reader distrust both, and the
               banner is the one that is right.

               The connectivity tone is left alone: within the capture the
               freshness logic is still answering a real question about the
               row being shown, and it is only the word "Streaming" and the
               pulsing dot that overclaim. */
            label={
              live.mode === "capture"
                ? "Capture"
                : conn.status === "live" ? "Streaming" : conn.label
            }
            live={conn.isLive && live.mode !== "capture"}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={rows.length} precision={0} />
        </div>
        <ChipRow>
          {/* "N moving" and "1 s logger" describe the logger's behaviour, not
              the plant's. The fault count is the one a reader acts on. */}
          <Chip tone={activeFaults > 0 ? "bad" : undefined}>
            {activeFaults} active {activeFaults === 1 ? "fault" : "faults"}
          </Chip>
        </ChipRow>
      </FeatureCard>

      {!section && (
        <SectionMenu
          base={BASE}
          items={SIGNAL_SECTIONS.map((k) => ({
            key: k,
            title: SECTION_TITLE[k],
            subtitle: k === "faults"
              ? "Almost all read zero, which is what a healthy plant looks like"
              : "The gateway's own signal names, units and current values",
            icon: k === "faults" ? <TriangleAlert size={17} />
              : k === "thermal" ? <Thermometer size={17} />
              : k === "status" ? <ToggleLeft size={17} />
              : <Zap size={17} />,
            value: String(counts[k]),
          }))}
        />
      )}

      {section && (
      <>
      <label className="m-search" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Search size={15} className="m-ink3" />
        <input
          className="m-search-input"
          placeholder="Filter by signal name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter signals by name"
        />
      </label>

      <div style={{ marginTop: 20 }}>
        <SectionHeader
          title={SECTION_TITLE[section]}
          action={<span className="m-label m-ink3">{shown.length} shown</span>}
        />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          {live.isLoading ? (
            <div style={{ padding: "16px 0", display: "grid", gap: 14 }}>
              <Shimmer w="82%" h={15} /><Shimmer w="64%" h={15} /><Shimmer w="73%" h={15} />
            </div>
          ) : shown.length === 0 ? (
            <div className="m-empty">
              <span className="m-body m-ink3">No signal matches that filter.</span>
            </div>
          ) : (
            shown.map(({ def, value }) => {
              const word = decode(def, value);
              const faulted = isFaultBit(def) && value != null && value > 0;
              return (
                <ListItem
                  key={`${def.asset}.${def.name}`}
                  wrap
                  title={def.label}
                  subtitle={`${def.asset} · ${def.name}`}
                  trailing={
                    <span className={faulted ? "m-h2" : "m-h2 m-ink"} style={faulted ? { color: "var(--m-bad)" } : undefined}>
                      {word ?? <Value value={value} unit={def.unit ?? undefined} precision={def.unit === "mV" || def.unit === "%" ? 0 : 2} />}
                    </span>
                  }
                />
              );
            })
          )}
        </FloatingCard>
      </div>

      {/* The provenance point is worth keeping — these names and units are the
          site's own, not this app's invention — without naming the endpoint. */}
      <div className="m-label m-ink3" style={{ padding: "16px 6px 0", lineHeight: 1.55 }}>
        Names and units are reported by the site itself. Nothing on this screen is
        renamed, rescaled or derived by this app.
      </div>
      </>
      )}
    </>
  );
}
