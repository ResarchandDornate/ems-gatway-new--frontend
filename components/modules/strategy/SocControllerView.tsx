"use client";

/**
 * The site's SOC controller (S5): what it is doing now, the devices it acts
 * on, the thresholds it acts by, and its recent state changes.
 *
 * Read-only. The controller runs on the gateway; this screen only reports it.
 * X and Y are the controller's own names for the two cabinets (S5: X = bess_1,
 * Y = bess_2); they are shown as BESS 1 / BESS 2, as the header names them.
 * Display only — the record's keys are untouched.
 */

import { useController } from "@/hooks/useController";
import {
  controllerLabel, stateChanges, stateOf,
  type ControllerRecord, type ControllerBess, type ControllerAction,
} from "@/lib/central";
import { LoadingState } from "@/components/shared/LoadingState";
import { ErrorState } from "@/components/shared/ErrorState";
import { timeTooltipLabel } from "@/lib/charts/timeAxis";
import { bessLabel } from "@/lib/api/services/bessLabel";

const num = (v: number | undefined, unit: string, dp = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(dp)} ${unit}` : "—";
const yesNo = (v: boolean | undefined | null, yes = "Yes", no = "No") => (v == null ? "—" : v ? yes : no);
const at = (iso: string | null | undefined) => {
  const t = Date.parse(iso ?? "");
  return Number.isNaN(t) ? "—" : timeTooltipLabel(t);
};

function Reading({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex justify-between gap-3 py-[5px] border-b border-line text-[11.5px]" title={title}>
      <span className="text-muted">{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}

function Card({ eyebrow, note, children }: { eyebrow: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="surface-card" style={{ padding: "var(--pad)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="card-eyebrow">{eyebrow}</p>
        {note && <span className="text-[11px] text-muted">{note}</span>}
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/* ── What the controller decided, in plain words ────────────────────────── */

/* The controller's device ids: X = BESS 1, Y = BESS 2, Solis = the solar inverter. */
const onOff = (t: string | null | undefined) => {
  const v = (t ?? "").toUpperCase();
  return !v ? null : v.startsWith("OFF") ? "Off" : "On";
};
const solarWord = (t: string | null | undefined) => {
  const v = (t ?? "").toUpperCase();
  if (!v) return null;
  if (v.startsWith("OFF")) return "Off";
  if (v.includes("DERAT")) return "Limited";
  return "On";
};

/**
 * What each device was told this cycle, e.g. "BESS 1 On · BESS 2 Off · Solar
 * Derated" — read off the action plan (else the devices' own targets), so
 * every case reads right, including ones the controller adds later.
 */
function planWords(r: ControllerRecord): string | null {
  const plan = new Map((r.data?.action_plan ?? []).map((p) => [(p.id ?? "").toUpperCase(), p.target]));
  const x = onOff(plan.get("X") ?? r.data?.bess?.X?.target_state);
  const y = onOff(plan.get("Y") ?? r.data?.bess?.Y?.target_state);
  const sol = solarWord(plan.get("SOLIS") ?? r.data?.solis?.target_state);
  const parts = [x && `BESS 1 ${x}`, y && `BESS 2 ${y}`, sol && `Solar ${sol}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** Why, in a few words — from the controller's decision code. */
function reasonWords(r: ControllerRecord): string {
  const d = (r.decision ?? r.data?.controller?.decision ?? "").toLowerCase();
  if (!d) return "—";
  if (d.startsWith("normal")) return "Normal Operation";
  if (d.startsWith("post_both_high_recovered")) return "Batteries Back Below The Limit · Solar Restored";
  if (d.startsWith("both_above")) return "Both Batteries Nearly Full · Solar Limited";
  if (d.startsWith("only_x_high")) return "BESS 1 Nearly Full";
  if (d.startsWith("only_y_high")) return "BESS 2 Nearly Full";
  if (d.startsWith("both_high")) return d.includes("waiting_for_recovery") ? "Both Batteries Full · Solar Off Until They Drop" : "Both Batteries Full";
  if (d.includes("low")) return "Battery Low";
  return controllerLabel(d);
}

/* ── Now ──────────────────────────────────────────────────────────────────── */

function StatusStrip({ r }: { r: ControllerRecord }) {
  const live = (r.mode ?? "").toUpperCase() === "LIVE";
  return (
    <div className="surface-card flex flex-wrap items-center gap-x-6 gap-y-3" style={{ padding: "12px var(--pad)" }}>
      <div>
        <div className="ps-stat-k">State</div>
        <div className="text-[17px] font-semibold text-ink">{planWords(r) ?? controllerLabel(stateOf(r))}</div>
      </div>
      <div className="min-w-0">
        <div className="ps-stat-k">Reason</div>
        <div className="text-[12.5px] text-ink2">{reasonWords(r)}</div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`pill ${live ? "cyan" : "gray"}`} title={live ? "Acting on the devices" : "Not acting — observe or dry-run"}>
          {live ? "Live Control" : r.mode ?? "Mode Not Reported"}
        </span>
        <span className={`pill ${r.healthy == null ? "gray" : r.healthy ? "green" : "red"}`}>
          <span className="dot" />{r.healthy == null ? "Health Not Reported" : r.healthy ? "Healthy" : "Unhealthy"}
        </span>
        {r.data?.error && <span className="pill red" title={r.data.error}>Error</span>}
      </div>
    </div>
  );
}

function BessCard({ name, b, planned }: { name: string; b: ControllerBess; planned?: string }) {
  return (
    <Card eyebrow={bessLabel(name) || name} note={b.online == null ? undefined : b.online ? "Online" : "Offline"}>
      <Reading label="SOC" value={num(b.soc_percent, "%")} />
      <Reading label="Target" value={onOff(planned ?? b.target_state) ?? "—"} />
    </Card>
  );
}

function SolisCard({ r }: { r: ControllerRecord }) {
  const s = r.data?.solis;
  if (!s) return null;
  return (
    <Card eyebrow="Solar · Solis Inverter" note={s.online == null ? undefined : s.online ? "Online" : "Offline"}>
      <Reading label="State" value={solarWord(s.target_state ?? s.state) ?? "—"} />
      <Reading label="Power Mode" value={solarWord(s.power_mode) === "Limited" ? "Limited" : controllerLabel(s.power_mode)} />
      <Reading label="Active Power" value={num(s.active_power_kw, "kW")} />
      <Reading label="Power Limit" value={typeof s.power_limit_percent === "number" ? `${s.power_limit_percent.toFixed(0)}% · ${num(s.power_limit_equivalent_kw, "kW")}` : "—"} />
    </Card>
  );
}

function ThresholdsCard({ r }: { r: ControllerRecord }) {
  const t = r.data?.thresholds;
  if (!t) return null;
  return (
    <Card eyebrow="Thresholds">
      <div className="grid gap-x-5" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        <Reading label="Limit Solar Above SOC" value={num(t.derate_soc_percent, "%", 0)}
          title="When both batteries are above this charge level, the solar output is limited" />
        <Reading label="Solar Limit" value={num(t.derate_power_kw, "kW", 0)}
          title="The most the solar may produce while it is limited" />
        <Reading label="High SOC Limit" value={num(t.high_soc_percent, "%", 0)}
          title="When both batteries reach this charge level, the solar is switched off" />
        <Reading label="Solar Back On Below SOC" value={num(t.recovery_soc_percent, "%", 0)}
          title="After the solar was switched off, it comes back on once the batteries fall below this level" />
        <Reading label="Low SOC Cutoff" value={t.low_cutoff_enabled ? num(t.low_cutoff_percent, "%", 0) : yesNo(t.low_cutoff_enabled, "On", "Off")}
          title="Stop discharging a battery below this charge level" />
        <Reading label="Restart Discharge Above SOC" value={num(t.low_recovery_percent, "%", 0)}
          title="After a low cutoff, discharging resumes once the battery is back above this level" />
      </div>
      {t.settings_updated_by && (
        <p className="text-[11px] text-muted mt-2">Thresholds Last Changed By {t.settings_updated_by}</p>
      )}
    </Card>
  );
}

/** The controller's device ids, as the rest of the site names them. */
function deviceWord(id: string | null | undefined): string {
  const v = (id ?? "").toUpperCase();
  if (!v) return "—";
  if (v === "SOLIS") return "Solar Inverter";
  return bessLabel(id!) || id!;
}
/** ON / OFF / ON_DERATED → On / Off / On · Limited. */
function targetWord(device: string | null | undefined, target: string | null | undefined): string {
  if (!target) return "—";
  return (device ?? "").toUpperCase() === "SOLIS"
    ? (solarWord(target) === "Limited" ? "On · Limited" : solarWord(target) ?? target)
    : onOff(target) ?? target;
}

function outcome(a: ControllerAction): string {
  if (a.dry_run) return "Dry Run";
  if (a.skipped) return a.verified ? "No Change Needed · Confirmed" : "Skipped";
  return a.verified ? "Sent · Confirmed" : "Sent · Not Yet Confirmed";
}

function ActionsCard({ r }: { r: ControllerRecord }) {
  const acts = r.data?.last_actions ?? [];
  if (!acts.length) return null;
  return (
    <Card eyebrow="Last Actions">
      {acts.map((a, i) => (
        <div key={i} className="flex justify-between gap-3 py-[5px] border-b border-line text-[11.5px]" title={a.reason ? controllerLabel(a.reason) : undefined}>
          <span className="text-muted">{deviceWord(a.device)}</span>
          <span className="font-mono text-ink">{targetWord(a.device, a.target)}</span>
          <span className="text-ink3">{outcome(a)}</span>
        </div>
      ))}
    </Card>
  );
}

/* ── History ──────────────────────────────────────────────────────────────── */

function HistoryCard({ rows }: { rows: ControllerRecord[] }) {
  const changes = stateChanges(rows);
  return (
    <Card eyebrow="State Changes">
      {changes.map((r, i) => (
        <div key={r.sample_time_utc + i} className="flex flex-wrap justify-between gap-x-3 py-[5px] border-b border-line text-[11.5px]">
          <span className="font-mono text-muted">{at(r.sample_time_utc)}</span>
          <span className="text-ink">{planWords(r) ?? controllerLabel(stateOf(r))}</span>
          <span className="text-ink3">{reasonWords(r)}</span>
        </div>
      ))}
      {changes.length === 1 && (
        <p className="text-[11px] text-muted mt-2">No State Changes</p>
      )}
    </Card>
  );
}

/* ── View ─────────────────────────────────────────────────────────────────── */

export function SocControllerView({ gatewayId }: { gatewayId: string }) {
  const { data, isLoading, isError, refetch } = useController(gatewayId);
  if (isLoading) return <LoadingState rows={5} />;
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (!data?.length) {
    return (
      <p className="text-[12px] text-ink3 p-4">
        No Controller Reports Yet
      </p>
    );
  }

  const now = data[0];
  const plan = new Map((now.data?.action_plan ?? []).map((p) => [p.id ?? "", p.target]));
  const bess = Object.entries(now.data?.bess ?? {});

  return (
    <div className="flex flex-col gap-3">
      <StatusStrip r={now} />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {bess.map(([name, b]) => <BessCard key={name} name={name} b={b} planned={plan.get(name)} />)}
        <SolisCard r={now} />
      </div>
      <ThresholdsCard r={now} />
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))" }}>
        <ActionsCard r={now} />
        <HistoryCard rows={data} />
      </div>
    </div>
  );
}
