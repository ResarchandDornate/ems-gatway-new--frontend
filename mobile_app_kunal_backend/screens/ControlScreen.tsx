"use client";

/**
 * Control — dispatch, for accounts the gateway grants internal_admin.
 *
 * Three independent things must all be true before anything here reaches a
 * battery, and they are enforced in three different places on purpose:
 *
 *   1. The gateway grants this token internal_admin. It decides, on every
 *      request. A customer token gets 403 from the gateway no matter what this
 *      screen does — that is pass-through auth working, not a bug to route
 *      around. `useIsDispatcher` only decides whether the UI is worth drawing.
 *   2. The deployment sets GW_ALLOW_WRITES. Without it the proxy refuses the
 *      POST before the gateway is contacted at all.
 *   3. The path is on the proxy's dispatch allowlist. Enabling control does
 *      not enable storage/cleanup, storage/vacuum or logs/test.
 *
 * The interaction is staged, never immediate. Nothing is sent as a control is
 * moved: a change becomes *pending*, the pending change is restated in a
 * confirmation sheet with the actual numbers, and only an explicit press
 * dispatches it. This screen commands a megawatt-hour-class battery — a
 * mis-tap must not be able to do that, and an operator must be able to see
 * exactly what they are about to send before it is sent.
 *
 * Dispatch is refused outright while telemetry is stale. A system whose
 * current state is unknown is never commanded; that rule is inherited from the
 * earlier control design and matters more here, not less, because this one is
 * wired to a real endpoint.
 */

import { useState } from "react";
import { ShieldAlert, TriangleAlert, Zap } from "lucide-react";

import { useLive, useSite, useIsDispatcher, useSocProtection, useConnectivity } from "../data";
import { useGatewaySelection } from "../gateway/GatewayContext";
import { cmdCharge, cmdDischarge, cmdStandby, ControlError } from "../gateway/client";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, Segmented, PrimaryButton, SecondaryButton,
  BottomSheet, StatusIndicator, Value, FeatureCard, Chip, ChipRow, Readout,
} from "../components";

type Mode = "charge" | "discharge" | "standby";

const MODE_LABEL: Record<Mode, string> = {
  charge: "Charge",
  discharge: "Discharge",
  standby: "Standby",
};

/**
 * Fallback ceiling for the setpoint slider, kW.
 *
 * Only used where the site does not report `pcs_1.rated_power`. It previously
 * bounded the slider unconditionally at 250 kW on the stated grounds that "no
 * rated-power signal exists in the profile" — true of the 63-signal fast
 * profile, but the figure is on the /api/telemetry snapshot this app already
 * fetches, and on the commissioned site it reads 130 kW.
 *
 * So the slider was offering a dispatcher nearly double the inverter's actual
 * rating, labelled "UI limit" as though that were a fact about the plant. The
 * real nameplate is used where it is reported; the gateway still clamps to the
 * true limit either way, and remains the only thing that knows it.
 */
const FALLBACK_MAX_KW = 250;

export function ControlScreen() {
  const { isDispatcher, role, isLoading } = useIsDispatcher();
  const { sourceId, bessId } = useGatewaySelection();
  const live = useLive();
  const site = useSite();
  const conn = useConnectivity();
  const { soc } = useSocProtection();

  const [mode, setMode] = useState<Mode>("standby");
  const [setpoint, setSetpoint] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  /* Commanding on telemetry we cannot trust is the one thing this screen must
     never do. Absent is as disqualifying as stale — both mean the present
     state is unknown. */
  /* Not this screen's own definition. Dispatching on telemetry the dashboard
     is already labelling "last known" must be impossible, and that only holds
     if both read the same rule. */
  const blind = !conn.isLive;

  if (isLoading) {
    return (
      <>
        <Header />
        <div className="m-label m-ink3" style={{ padding: "40px 4px" }}>
          Checking what this account may do…
        </div>
      </>
    );
  }

  /* The role no longer decides whether this screen renders. It was an
     absence — "a disabled control still advertises a capability" — and that is
     still the better default; it is overridden here by explicit instruction so
     that dispatch is reachable on any login.

     What has not moved, and cannot be moved from the client: the gateway
     refuses a dispatch from a token it has not granted internal_admin, and the
     proxy refuses one before the gateway is contacted unless the deployment
     sets GW_ALLOW_WRITES. So the controls below are real, and for an account
     without the role they will fail — with an error that says which of the two
     stopped it. The banner states that up front rather than letting someone
     find out by commanding a battery. */

  async function dispatch() {
    setBusy(true);
    setResult(null);
    try {
      if (mode === "standby") await cmdStandby(sourceId);
      else if (mode === "charge") await cmdCharge(sourceId, setpoint);
      else await cmdDischarge(sourceId, setpoint);
      setResult({ ok: true, text: `${MODE_LABEL[mode]} sent to ${bessId}.` });
      setConfirm(false);
    } catch (e) {
      const msg =
        e instanceof ControlError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Dispatch failed.";
      setResult({ ok: false, text: msg });
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }

  /* The inverter's own nameplate where the site reports it. */
  const maxKw = site.ratedPowerKw ?? FALLBACK_MAX_KW;

  const needsSetpoint = mode !== "standby";

  return (
    <>
      <Header />

      <div style={{ padding: "0 4px 18px" }}>
        <span className="m-h1 m-ink">Control</span>
      </div>

      <FeatureCard style={{ marginBottom: 16 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Dispatching</span>
          {/* Same correction as the Signals badge: "Live" over the bundled
              capture contradicts the Header's own banner, and on the one
              screen that sends commands it is the worst place in the app to
              imply the numbers are current. Staleness still wins over the
              capture label — a stale capture row is worth saying out loud
              before anyone reads a dispatch figure off it. */}
          <StatusIndicator
            tone={blind ? "bad" : "good"}
            label={blind ? "Telemetry stale" : live.mode === "capture" ? "Capture" : "Live"}
            live={!blind && live.mode !== "capture"}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={live.get("PCS", "total_active_power")} unit="kW" precision={1} />
        </div>
        <ChipRow>
          {/* Explicit precision, matching line 275 further down this same
              screen and the three SOC readings on the dashboard. Value
              defaults to 0, so this chip rendered "56%" directly above a
              "55.9%" reading of the identical signal. */}
          <Chip>SOC <Value value={live.get("BMS", "display_soc")} unit="%" precision={1} /></Chip>
          <Chip>{bessId}</Chip>
          <Chip tone={isDispatcher ? undefined : "warn"}>{role ?? "no role"}</Chip>
        </ChipRow>
      </FeatureCard>

      {!isDispatcher && (
        <div className="m-banner is-warn" style={{ marginBottom: 12 }}>
          <ShieldAlert size={15} style={{ flex: "none", marginTop: 1 }} />
          <span>
            This account is not permitted to dispatch. The controls below will send
            and the site will refuse them — only the site can grant that permission,
            and it checks on every command. Ask whoever commissioned the site if you
            need dispatch access.
          </span>
        </div>
      )}

      {blind && (
        <div className="m-banner is-bad" style={{ marginBottom: 12 }}>
          <TriangleAlert size={15} style={{ flex: "none", marginTop: 1 }} />
          <span>
            Telemetry is stale or absent. A system whose present state is unknown is
            never commanded, so dispatch is blocked until readings resume.
          </span>
        </div>
      )}

      {result && (
        <div className={`m-banner ${result.ok ? "is-good" : "is-bad"}`} style={{ marginBottom: 12 }} role="status">
          {result.ok ? <Zap size={15} style={{ flex: "none", marginTop: 1 }} />
                     : <ShieldAlert size={15} style={{ flex: "none", marginTop: 1 }} />}
          <span>{result.text}</span>
        </div>
      )}

      <div>
        <SectionHeader title="Dispatch" />
        <FloatingCard>
          <Segmented<Mode>
            ariaLabel="Dispatch mode"
            value={mode}
            onChange={(m) => { setMode(m); setResult(null); }}
            options={[
              { value: "standby",   label: "Standby" },
              { value: "charge",    label: "Charge" },
              { value: "discharge", label: "Discharge" },
            ]}
          />

          <div className="m-spread" style={{ marginTop: 20 }}>
            <span className="m-label m-ink2">Setpoint</span>
            <span className="m-h2 m-ink">
              <Value value={needsSetpoint ? setpoint : null} unit="kW" precision={0} />
            </span>
          </div>

          <input
            type="range"
            className="m-range"
            min={0}
            max={maxKw}
            step={5}
            value={setpoint}
            disabled={!needsSetpoint}
            onChange={(e) => { setSetpoint(Number(e.target.value)); setResult(null); }}
            aria-label="Dispatch setpoint in kilowatts"
          />

          <div className="m-spread" style={{ marginTop: 6 }}>
            <span className="m-label m-ink3">0 kW</span>
            {/* Stated as a UI bound, not as the plant's rating. The profile
                carries no rated-power signal, and presenting a guess as a
                limit on a dispatch screen would be worse than presenting none. */}
            <span className="m-label m-ink3">
              {maxKw} kW {site.ratedPowerKw != null ? "(PCS rated)" : "(app limit)"}
            </span>
          </div>

          <div style={{ marginTop: 18 }}>
            <PrimaryButton full disabled={blind || busy} onClick={() => setConfirm(true)}>
              Review {MODE_LABEL[mode].toLowerCase()}
            </PrimaryButton>
          </div>
        </FloatingCard>
      </div>

      {soc && (
        <div style={{ marginTop: 22 }}>
          <SectionHeader title="SOC protection" />
          <FloatingCard>
            <span className="m-body m-ink2" style={{ lineHeight: 1.55 }}>
              The gateway runs its own SOC protection controller. It can override or
              refuse a dispatch that would take the pack outside its limits, and it
              is the last word regardless of what is sent from here.
            </span>
          </FloatingCard>
        </div>
      )}

      {/* Confirmation restates the command in the same words it will be sent
          in. A sheet that said "are you sure?" without the numbers would be a
          speed bump rather than a check. */}
      <BottomSheet open={confirm} onClose={() => setConfirm(false)} title="Confirm dispatch">
        <div className="m-stack" style={{ gap: 14 }}>
          <span className="m-body m-ink2" style={{ lineHeight: 1.6 }}>
            This sends a real command to <b className="m-ink">{bessId}</b> on{" "}
            <b className="m-ink">{sourceId}</b>.
          </span>

          <FloatingCard>
            <div className="m-spread">
              <span className="m-label m-ink2">Mode</span>
              <span className="m-h2 m-ink">{MODE_LABEL[mode]}</span>
            </div>
            {needsSetpoint && (
              <div className="m-spread" style={{ marginTop: 10 }}>
                <span className="m-label m-ink2">Power</span>
                <span className="m-h2 m-ink"><Value value={setpoint} unit="kW" precision={0} /></span>
              </div>
            )}
            <div className="m-spread" style={{ marginTop: 10 }}>
              <span className="m-label m-ink2">SOC now</span>
              <span className="m-h2 m-ink">
                <Value value={live.get("BMS", "display_soc")} unit="%" precision={1} />
              </span>
            </div>
          </FloatingCard>

          <span className="m-label m-ink3" style={{ lineHeight: 1.55 }}>
            The gateway checks your role and its own SOC protection limits before
            acting, and may still refuse this.
          </span>

          <PrimaryButton full disabled={busy} onClick={dispatch}>
            {busy ? "Dispatching…" : `Dispatch ${MODE_LABEL[mode].toLowerCase()}`}
          </PrimaryButton>
          <SecondaryButton full disabled={busy} onClick={() => setConfirm(false)}>
            Cancel
          </SecondaryButton>
        </div>
      </BottomSheet>
    </>
  );
}
