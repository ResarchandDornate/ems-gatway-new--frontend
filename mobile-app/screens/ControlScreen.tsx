"use client";

/**
 * Control — §8.
 *
 * The full interaction is built: adjust a control, see it staged as pending,
 * review the delta in a confirmation sheet, dispatch. What is NOT built is the
 * dispatch itself, because there is nothing to dispatch to — UGX exposes no
 * command, setpoint, schedule or configuration write endpoint (§3.3), and our
 * command service (§8.3) does not exist yet.
 *
 * So the screen is deliberately inert, and says so at the top. This follows
 * §8.5 exactly: "Backend unreachable → controls disabled with an explicit
 * banner; no offline queuing." A control that looks live and silently does
 * nothing would be the worst possible outcome on a screen that commands a
 * 261 kWh battery.
 *
 * Building it now is still worth it: when the write API lands, only the
 * dispatch call is added — the staging, bounds, confirmation and audit copy are
 * already specified and validated here.
 */

import { useState } from "react";
import { Lock, Zap, BatteryCharging, Clock, Fingerprint } from "lucide-react";
import { useMobileStation, useLive, useSummary } from "../data";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, ListItem, Segmented, Toggle,
  PrimaryButton, SecondaryButton, BottomSheet, StatusIndicator, Value,
  FeatureCard, Chip, ChipRow, Readout,
} from "../components";

type Mode = "auto" | "charge" | "discharge" | "standby";

export function ControlScreen() {
  const { stationId } = useMobileStation();
  const live = useLive(stationId);
  const summary = useSummary(stationId);

  /* Staged, not applied. Nothing here reaches a battery. */
  const [mode, setMode] = useState<Mode>("auto");
  const [setpoint, setSetpoint] = useState(0);
  const [minSoc, setMinSoc] = useState(15);
  const [maxSoc, setMaxSoc] = useState(95);
  const [confirm, setConfirm] = useState(false);

  /* Bounds come from device configuration, never from the client (§8.2).
     Rated power is the real installed figure from the station summary. */
  const ratedKw = summary.data?.installedKw ?? null;

  const dirty = mode !== "auto" || setpoint !== 0 || minSoc !== 15 || maxSoc !== 95;

  /* Telemetry we cannot trust is telemetry we must not command against (§8.5). */
  const blocked = true;                        // no command service exists
  const staleBlocked = live.isStale || !live.isLive;

  return (
    <>
      <Header />

      <FeatureCard style={{ marginBottom: 16 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Dispatch now</span>
          <StatusIndicator tone="idle" label="Read-only" />
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={live.battKw} unit="kW" precision={1} />
        </div>
        <ChipRow>
          <Chip>SOC <Value value={live.soc} unit="%" /></Chip>
          <Chip>{ratedKw != null ? `${ratedKw} kW rated` : "Rated —"}</Chip>
          <Chip>Mode: auto</Chip>
        </ChipRow>
      </FeatureCard>

      <div className="m-banner is-warn">
        <Lock size={15} style={{ flex: "none", marginTop: 1 }} />
        <span>
          Dispatch is disabled. UGX exposes no write endpoint and the command service
          in §8.3 is not deployed, so nothing on this screen can reach the hardware.
          Controls are shown to validate the flow, not to operate the plant.
        </span>
      </div>

      {staleBlocked && (
        <div className="m-banner is-bad" style={{ marginTop: 10 }}>
          <Zap size={15} style={{ flex: "none", marginTop: 1 }} />
          <span>Telemetry is stale or absent. A system whose state is unknown is never commanded.</span>
        </div>
      )}

      {/* ── Dispatch ─────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 24 }}>
        <SectionHeader title="Dispatch" />
        <FloatingCard>
          <Segmented<Mode>
            ariaLabel="Dispatch mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "auto",      label: "Auto" },
              { value: "charge",    label: "Charge" },
              { value: "discharge", label: "Discharge" },
              { value: "standby",   label: "Standby" },
            ]}
          />

          <div className="m-spread" style={{ marginTop: 20 }}>
            <span className="m-label m-ink2">Setpoint</span>
            <span className="m-h2 m-ink">
              <Value value={setpoint} unit="kW" precision={0} />
            </span>
          </div>

          <input
            type="range"
            className="m-range"
            min={0}
            max={ratedKw ?? 100}
            step={1}
            value={setpoint}
            disabled={mode === "auto" || mode === "standby"}
            onChange={(e) => setSetpoint(Number(e.target.value))}
            aria-label="Dispatch setpoint in kilowatts"
          />

          <div className="m-spread" style={{ marginTop: 6 }}>
            <span className="m-label m-ink3">0 kW</span>
            <span className="m-label m-ink3">
              {ratedKw != null ? `${ratedKw} kW rated` : "Rated power —"}
            </span>
          </div>

          <div className="m-label m-ink3" style={{ marginTop: 14, lineHeight: 1.5 }}>
            Current: <Value value={live.battKw} unit="kW" precision={1} /> ·
            SOC <Value value={live.soc} unit="%" />
          </div>
        </FloatingCard>
      </div>

      {/* ── SOC limits ───────────────────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="SOC limits" />
        <FloatingCard>
          <div className="m-spread">
            <span className="m-label m-ink2">Minimum</span>
            <span className="m-h2 m-ink"><Value value={minSoc} unit="%" /></span>
          </div>
          <input
            type="range" className="m-range" min={5} max={50} value={minSoc}
            onChange={(e) => setMinSoc(Math.min(Number(e.target.value), maxSoc - 5))}
            aria-label="Minimum state of charge"
          />

          <div className="m-spread" style={{ marginTop: 18 }}>
            <span className="m-label m-ink2">Maximum</span>
            <span className="m-h2 m-ink"><Value value={maxSoc} unit="%" /></span>
          </div>
          <input
            type="range" className="m-range" min={60} max={100} value={maxSoc}
            onChange={(e) => setMaxSoc(Math.max(Number(e.target.value), minSoc + 5))}
            aria-label="Maximum state of charge"
          />

          <div className="m-label m-ink3" style={{ marginTop: 14, lineHeight: 1.5 }}>
            The warranty floor is enforced server-side. The client renders bounds; it never widens them.
          </div>
        </FloatingCard>
      </div>

      {/* ── Schedule ─────────────────────────────────────────────────────── */}
      <div style={{ marginTop: 22 }}>
        <SectionHeader title="Time-of-day schedule" />
        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          <ListItem
            leading={<Clock size={17} />}
            title="Off-peak charge window"
            subtitle="Requires a DISCOM tariff table"
            trailing={<Toggle checked={false} onChange={() => {}} label="Off-peak charge window" disabled />}
          />
          <ListItem
            leading={<BatteryCharging size={17} />}
            title="Peak discharge window"
            subtitle="Requires a DISCOM tariff table"
            trailing={<Toggle checked={false} onChange={() => {}} label="Peak discharge window" disabled />}
          />
        </FloatingCard>
      </div>

      {/* ── Dispatch action ──────────────────────────────────────────────── */}
      <div style={{ marginTop: 24, display: "flex", gap: 10 }}>
        <SecondaryButton
          full
          disabled={!dirty}
          onClick={() => { setMode("auto"); setSetpoint(0); setMinSoc(15); setMaxSoc(95); }}
        >
          Reset
        </SecondaryButton>
        <PrimaryButton full disabled={blocked || staleBlocked || !dirty} onClick={() => setConfirm(true)}>
          Review
        </PrimaryButton>
      </div>

      {/* The confirmation sheet from §8.4 — the delta stated in plain language,
          with the biometric gate named. */}
      <BottomSheet open={confirm} onClose={() => setConfirm(false)} title="Confirm dispatch">
        <FloatingCard tone="lit">
          <div className="m-spread">
            <span className="m-label m-ink3">Mode</span>
            <span className="m-label m-ink">auto → {mode}</span>
          </div>
          <div className="m-spread" style={{ marginTop: 10 }}>
            <span className="m-label m-ink3">Setpoint</span>
            <span className="m-label m-ink"><Value value={live.battKw} unit="kW" precision={1} /> → <Value value={setpoint} unit="kW" /></span>
          </div>
          <div className="m-spread" style={{ marginTop: 10 }}>
            <span className="m-label m-ink3">SOC window</span>
            <span className="m-label m-ink">{minSoc}% – {maxSoc}%</span>
          </div>
        </FloatingCard>

        <div className="m-banner is-warn" style={{ marginTop: 14 }}>
          <Fingerprint size={15} style={{ flex: "none", marginTop: 1 }} />
          <span>Dispatch requires biometric re-authentication and is logged immutably for seven years.</span>
        </div>

        <div style={{ marginTop: 18 }}>
          <PrimaryButton full disabled>Dispatch unavailable</PrimaryButton>
        </div>
      </BottomSheet>
    </>
  );
}
