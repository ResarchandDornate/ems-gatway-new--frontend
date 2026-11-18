"use client";

/**
 * Alarms — derived from the 25 fault and alarm bits in the fast profile.
 *
 * The gateway has no alarm engine: it exposes register states, and an alarm is
 * a bit that has gone high. That is stated on the screen, because "no active
 * alarms" from a bit scan means something narrower than "nothing is wrong" —
 * it means none of these 25 registers is asserted.
 */

import { useMemo, useState } from "react";
import {
  CircleCheck, ShieldCheck, CloudOff, SlidersHorizontal, TriangleAlert, Activity, Flame,
} from "lucide-react";
import { useAlarmList, useAllSignals, useFireSafety, type FireRow } from "../data";
import type { GatewayAlarm } from "../gateway/client";
import { isFaultBit } from "../gateway/signals";
import { isAlarmState } from "../gateway/client";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, ListItem, Shimmer, StatusIndicator,
  FeatureCard, Chip, ChipRow, Readout, Monogram,
  ExplanationSheet, AlarmRowExplanationSheet,
  SectionMenu, SectionBack, useSection,
} from "../components";
import type { SignalDef } from "../gateway/signals";

const BASE = "/k/alarms";

/**
 * Alarms, as a contents page.
 *
 * The headline stays on the menu rather than moving into a section, because
 * the question this screen is opened for — is anything wrong — has to be
 * answered before anyone chooses where to look. What moves is the four lists
 * underneath it, which between them ran to a hundred and fifty rows.
 *
 * Fire protection is one of those rows now. It used to render above the
 * headline on every visit, so a site with a healthy panel spent the top of the
 * screen saying so.
 */
const ALARM_SECTIONS = ["active", "watch", "setpoints", "fire"] as const;
type Filter = (typeof ALARM_SECTIONS)[number];

/**
 * Fire protection, above everything else on the screen.
 *
 * The gateway reports a fire panel on every source of this site and nothing in
 * this app read it until now. Placed first and outside the Active/Monitored
 * tabs deliberately: a fire alarm is not one row in a list of battery faults
 * to be scrolled to, and it must not be reachable only by choosing the right
 * filter.
 *
 * Three states, because they need three different things from the reader:
 * asserting (act), reporting-and-clear (nothing to do), and not reporting (the
 * panel is unreachable, which is itself worth someone's attention and is NOT
 * the same as no fire).
 */
function FireProtection() {
  const fire = useFireSafety();

  /* Nothing is claimed until a snapshot has landed. A cold start rendering
     "clear" would be the app asserting something it has not been told. */
  if (!fire.ready) {
    return (
      <FloatingCard style={{ marginBottom: 16 }}>
        <SectionHeader title="Fire protection" />
        <Shimmer w="62%" h={15} />
      </FloatingCard>
    );
  }

  /* No panel commissioned on this site. Said plainly rather than shown as an
     offline panel, which would send someone looking for hardware that was
     never installed. */
  if (fire.absent) {
    return (
      <FloatingCard style={{ marginBottom: 16 }}>
        <SectionHeader title="Fire protection" />
        <span className="m-body m-ink3">
          This site does not report a fire protection panel.
        </span>
      </FloatingCard>
    );
  }

  if (!fire.reporting) {
    return (
      <FloatingCard className="m-note" style={{ marginBottom: 16 }}>
        <CloudOff size={16} />
        <span>
          <b>The fire protection panel is not reporting.</b> Nothing on this
          screen can tell you the fire state of the container while that is
          true. Contact your operator.
        </span>
      </FloatingCard>
    );
  }

  const rows = [fire.alarm, fire.fault, ...fire.detectors, ...fire.faults, ...fire.modules];
  const active = rows.filter((r) => r.active);

  return (
    <FloatingCard style={{ marginBottom: 16 }}>
      <div className="m-spread">
        <span className="m-eyebrow">Fire protection</span>
        <StatusIndicator
          tone={fire.anyActive ? "bad" : "good"}
          label={fire.anyActive ? "Action needed" : "Clear"}
          live
        />
      </div>

      {/* The panel's own summary word, not a count of bits. It already says
          which detector tripped, so a headline of "1 active" would be less
          informative than the value itself. */}
      <div style={{ marginTop: 10 }}>
        <span className={fire.anyActive ? "m-h1" : "m-h1 m-ink"} style={fire.anyActive ? { color: "var(--m-bad)" } : undefined}>
          {fire.alarm.word ?? "—"}
        </span>
      </div>

      <ChipRow>
        <Chip tone={fire.fault.active ? "bad" : undefined}>{fire.fault.word ?? "—"}</Chip>
        {fire.temperatureC != null && <Chip>Panel {fire.temperatureC.toFixed(0)}°C</Chip>}
      </ChipRow>

      {/* Only what is asserting. A clear panel is 21 rows of "Normal", which
          buries the two words above that actually carry the state. */}
      {active.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {active.map((r) => (
            <ListItem
              key={r.sig.name}
              wrap
              leading={<Monogram text="FP" />}
              title={r.sig.label}
              subtitle={`fire_protection · ${r.sig.name}`}
              trailing={<StatusIndicator tone="bad" label={r.word ?? "Active"} />}
            />
          ))}
        </div>
      )}
    </FloatingCard>
  );
}

export function AlarmsScreen() {
  const { alarms, setpoints, isLoading } = useAlarmList();
  const all = useAllSignals();
  const filter = useSection(BASE, ALARM_SECTIONS) as Filter | null;

  /* What the reader tapped. Two kinds, because the Active and Setpoints tabs
     list rows from the gateway's plant-wide alarm endpoint while Monitored
     lists the 63-signal profile — different shapes, and only the second is
     guaranteed to resolve in the dictionary. Both are explained without a
     network request; see gateway/explanations.ts. */
  const [openRow, setOpenRow] = useState<GatewayAlarm | null>(null);
  const [openSignal, setOpenSignal] = useState<{ def: SignalDef; value: number | null } | null>(null);

  const bits = useMemo(() => all.filter(({ def }) => isFaultBit(def)), [all]);
  const pcsBits = bits.filter(({ def }) => def.asset === "PCS").length;
  const bmsBits = bits.filter(({ def }) => def.asset === "BMS").length;

  return (
    <>
      <Header />
      {filter && <SectionBack title="Alarms" base={BASE} />}

      <FeatureCard style={{ marginBottom: 20 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Asserted fault bits</span>
          <StatusIndicator
            tone={alarms.length > 0 ? "bad" : "good"}
            label={alarms.length > 0 ? "Action needed" : "Nominal"}
            live
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={alarms.length} precision={0} />
        </div>
        <ChipRow>
          <Chip>{bits.length} bits monitored</Chip>
          <Chip>{pcsBits} PCS</Chip>
          <Chip>{bmsBits} BMS</Chip>
        </ChipRow>
      </FeatureCard>

      {/* Said out loud, and never as a silent filter.

          The gateway raises its configured protection limits as active alarms:
          148 of the site's 149. Hiding them without a word would replace one
          wrong number with another one nobody could check, so the count is
          stated, the reason is given, and every excluded row is one tap away
          under Setpoints. */}
      {setpoints.length > 0 && (
        <div className="m-banner" style={{ marginBottom: 18 }}>
          <SlidersHorizontal size={15} style={{ flex: "none", marginTop: 1 }} />
          <span>
            <b>{setpoints.length} configured protection limits</b> are being reported by the
            site as active alarms. They are protection settings holding their proper values,
            not faults, so they are listed separately under Setpoints.
          </span>
        </div>
      )}

      {!filter && (
        <SectionMenu
          base={BASE}
          items={[
            {
              key: "active",
              title: "Active faults",
              subtitle: "Bits the site is asserting right now, each with what it means",
              icon: <TriangleAlert size={17} />,
              value: String(alarms.length),
            },
            {
              key: "watch",
              title: "Monitored",
              subtitle: `Every fault bit this app watches — ${pcsBits} on the inverter, ${bmsBits} on the battery`,
              icon: <Activity size={17} />,
              value: String(bits.length),
            },
            {
              key: "setpoints",
              title: "Setpoints",
              subtitle: "Protection limits the site reports as alarms. Settings holding their values, not faults",
              icon: <SlidersHorizontal size={17} />,
              value: String(setpoints.length),
            },
            {
              key: "fire",
              title: "Fire protection",
              subtitle: "The panel, its detectors and its fault lines",
              icon: <Flame size={17} />,
            },
          ]}
        />
      )}

      {filter === "fire" && <FireProtection />}

      {filter === "active" ? (
        <div style={{ marginTop: 22 }}>
          <SectionHeader title="Active" action={<span className="m-label m-ink3">{alarms.length}</span>} />
          <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
            {isLoading ? (
              <div style={{ padding: "16px 0", display: "grid", gap: 14 }}>
                <Shimmer w="82%" h={15} /><Shimmer w="64%" h={15} />
              </div>
            ) : alarms.length === 0 ? (
              <div className="m-empty">
                <span className="m-empty-mark"><CircleCheck size={19} /></span>
                <span className="m-body m-ink3">
                  No faults reported.
                </span>
              </div>
            ) : (
              alarms.map((a) => (
                <ListItem
                  key={`${a.source_id}.${a.asset}.${a.signal_name}`}
                  wrap
                  onClick={() => setOpenRow(a)}
                  leading={<Monogram text={a.asset} />}
                  title={a.label}
                  /* The protocol signal name and the raw register value were
                     here — "pcs · sw_fault_ac_over_voltage · bess_1" and
                     "= 1". Those are how an engineer finds the bit in the
                     register map; the person whose plant this is needs to know
                     which unit and which asset it is on. */
                  subtitle={`${a.asset} · ${a.bess_id.replace("bess_", "BESS ")}`}
                  trailing={<StatusIndicator tone="bad" label="Active" />}
                />
              ))
            )}
          </FloatingCard>
        </div>
      ) : filter === "setpoints" ? (
        <div style={{ marginTop: 22 }}>
          <SectionHeader
            title="Configured limits"
            action={<span className="m-label m-ink3">{setpoints.length}</span>}
          />
          <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
            {setpoints.length === 0 ? (
              <div className="m-empty">
                <span className="m-body m-ink3">The site is reporting no configured limits.</span>
              </div>
            ) : (
              setpoints.map((a) => (
                <ListItem
                  key={`${a.source_id}.${a.asset}.${a.signal_name}`}
                  wrap
                  onClick={() => setOpenRow(a)}
                  leading={<Monogram text={a.asset} />}
                  title={a.label}
                  subtitle={`${a.asset} · ${a.bess_id.replace("bess_", "BESS ")}`}
                  /* The value is the point of this list — a limit is only
                     meaningful as the number it is set to, and someone checking
                     whether protection is commissioned correctly is here to
                     read exactly that. */
                  trailing={<span className="m-h2 m-ink">{a.value}</span>}
                />
              ))
            )}
          </FloatingCard>
          <div className="m-label m-ink3" style={{ padding: "16px 6px 0", lineHeight: 1.55 }}>
            These are protection settings, not faults. They appear here because the site
            reports them on its alarm endpoint alongside genuine alarms.
          </div>
        </div>
      ) : filter === "watch" ? (
        <div style={{ marginTop: 22 }}>
          <SectionHeader title="Monitored" action={<span className="m-label m-ink3">{bits.length}</span>} />
          <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
            {bits.map(({ def, value }) => (
              <ListItem
                key={`${def.asset}.${def.name}`}
                wrap
                onClick={() => setOpenSignal({ def, value })}
                title={def.label}
                subtitle={`${def.asset} · ${def.name}`}
                trailing={
                  <StatusIndicator
                    tone={value == null ? "idle" : value > 0 ? "bad" : "good"}
                    label={value == null ? "—" : value > 0 ? "Asserted" : "Clear"}
                  />
                }
              />
            ))}
          </FloatingCard>
        </div>
      ) : null}

      <div className="m-banner" style={{ marginTop: 20 }}>
        <ShieldCheck size={15} style={{ flex: "none", marginTop: 1 }} />
        {/* The limitation is real and worth stating — someone must not assume
            this list is ranked or acknowledgeable. What they do not need is the
            endpoint that would carry the history instead. */}
        <span>
          Faults are shown as reported by the site, without severity ranking or
          acknowledgement. <b>Tap any row</b> for what it means and what to check.
          Contact your operator for anything requiring action.
        </span>
      </div>

      {/* Both sheets answer from content shipped with the app — no request, no
          delay, and nothing about this plant leaves the device to show them. */}
      <AlarmRowExplanationSheet
        open={Boolean(openRow)}
        onClose={() => setOpenRow(null)}
        signalName={openRow?.signal_name ?? ""}
        label={openRow?.label ?? ""}
        asset={openRow?.asset ?? ""}
        value={openRow?.value ?? null}
        isState={openRow ? isAlarmState(openRow) : false}
        unitLabel={openRow?.bess_id.replace("bess_", "BESS ")}
      />
      <ExplanationSheet
        open={Boolean(openSignal)}
        onClose={() => setOpenSignal(null)}
        signal={openSignal?.def ?? null}
        value={openSignal?.value ?? null}
      />
    </>
  );
}
