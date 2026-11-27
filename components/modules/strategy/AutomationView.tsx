"use client";

/**
 * Automation (S10 / CG-28) — the scheduled charge-discharge windows the gateway runs on its own.
 *
 * Save does not write a web store the gateway reads: the gateway acts on D1 commands. An on/off-only
 * change goes out as automation_enable / automation_disable (works for a site_operator); any schedule
 * change goes out as automation_set_schedule (admin only) — a full replace the gateway reads back and
 * verifies on S9. While pairs are running the gateway needs confirm_stop_if_active, so Save confirms
 * first. The form loads the gateway's live schedule from /automation-status and reloads on a new
 * config_revision. The config store POST is kept only as a web-side record.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSession } from "@/lib/central";
import { usePasswordGate } from "./controlAuth";

const PAIRS = ["pair_1", "pair_2", "pair_3", "pair_4"] as const;
type PairId = (typeof PAIRS)[number];
const DAYS = [
  { n: 1, label: "Mon" }, { n: 2, label: "Tue" }, { n: 3, label: "Wed" }, { n: 4, label: "Thu" },
  { n: 5, label: "Fri" }, { n: 6, label: "Sat" }, { n: 7, label: "Sun" },
];

const authHeaders = (): Record<string, string> => {
  const s = getSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
};

const CONFIG_URL = (g: string) => `/api/central/automation-config?gateway_id=${encodeURIComponent(g)}`;
const STATUS_URL = (g: string) => `/api/central/automation-status/latest?gateway_id=${encodeURIComponent(g)}&limit=1`;
const EVENTS_URL = (g: string) => `/api/central/automation-events?gateway_id=${encodeURIComponent(g)}&limit=50`;
const COMMANDS_URL = "/api/central/commands";

type StatusRow = {
  automation_enabled: boolean | null; supervisor_alive: boolean | null;
  phase: string | null; direction: string | null; fault_latched: boolean | null;
  safe_stop_requested: boolean | null; received_at_utc: string;
  config_revision?: string | number | null; payload?: Record<string, unknown> | null;
};
type EventRow = {
  event_id: string; event_type: string | null; phase: string | null;
  direction: string | null; timestamp_utc: string | null; received_at_utc: string;
};

// ── form state ──────────────────────────────────────────────────────────────
type PairForm = { enabled: boolean; chargeKw: string; dischargeKw: string };
type Form = {
  enabled: boolean;
  chargeStart: string; chargeStop: string; dischargeStart: string; dischargeStop: string;
  startAboveKw: string; startHoldSeconds: string; stopBelowKw: string; stopHoldSeconds: string; maxAgeSeconds: string;
  prepLeadMin: string; dispatchLeadSec: string;
  days: Set<number>;
  pairs: Record<PairId, PairForm>;
};

const DEFAULTS: Form = {
  enabled: false,
  chargeStart: "09:00", chargeStop: "14:30", dischargeStart: "15:00", dischargeStop: "17:00",
  startAboveKw: "100", startHoldSeconds: "60", stopBelowKw: "80", stopHoldSeconds: "30", maxAgeSeconds: "15",
  prepLeadMin: "15", dispatchLeadSec: "120",
  days: new Set([1, 2, 3, 4, 5, 6, 7]),
  pairs: Object.fromEntries(PAIRS.map((p) => [p, { enabled: true, chargeKw: "5", dischargeKw: "5" }])) as Record<PairId, PairForm>,
};

const str = (v: unknown, d: string) => (v == null ? d : String(v));

/** The stored blob (Flutter shape) → the flat form. */
function fromConfig(c: Record<string, unknown> | null | undefined): Form {
  if (!c || typeof c !== "object") return clone(DEFAULTS);
  const o = c as Record<string, unknown>;
  const m = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});
  const charge = m(o.charge), discharge = m(o.discharge), solar = m(o.solar), timing = m(o.timing);
  const pairsIn = m(o.pairs) as Record<string, unknown>;
  const days = Array.isArray(o.days) ? new Set((o.days as number[]).map(Number)) : new Set(DEFAULTS.days);
  return {
    enabled: o.enabled === true,
    chargeStart: str(charge.start, "09:00"), chargeStop: str(charge.stop, "14:30"),
    dischargeStart: str(discharge.start, "15:00"), dischargeStop: str(discharge.stop, "17:00"),
    startAboveKw: str(solar.start_above_kw, "100"), startHoldSeconds: str(solar.start_hold_seconds, "60"),
    stopBelowKw: str(solar.stop_below_kw, "80"), stopHoldSeconds: str(solar.stop_hold_seconds, "30"),
    maxAgeSeconds: str(solar.max_age_seconds, "15"),
    prepLeadMin: str(timing.preparation_lead_minutes, "15"), dispatchLeadSec: str(timing.power_dispatch_lead_seconds, "120"),
    days,
    pairs: Object.fromEntries(PAIRS.map((p) => {
      const pc = (pairsIn[p] && typeof pairsIn[p] === "object" ? pairsIn[p] as Record<string, unknown> : {}) as Record<string, unknown>;
      return [p, { enabled: pc.enabled !== false, chargeKw: str(pc.charge_kw, "5"), dischargeKw: str(pc.discharge_kw, "5") }];
    })) as Record<PairId, PairForm>,
  };
}

/** The flat form → the stored blob / set_schedule shape (gateway keys). Sends every field so the
   gateway never fills a gap from its own defaults. */
function toConfig(f: Form): Record<string, unknown> {
  const n = (s: string) => Number(s);
  return {
    enabled: f.enabled, timezone: "Asia/Kolkata", days: [...f.days].sort((a, b) => a - b),
    charge: { start: f.chargeStart.trim(), stop: f.chargeStop.trim() },
    discharge: { start: f.dischargeStart.trim(), stop: f.dischargeStop.trim() },
    solar: {
      start_above_kw: n(f.startAboveKw), start_hold_seconds: n(f.startHoldSeconds),
      stop_below_kw: n(f.stopBelowKw), stop_hold_seconds: n(f.stopHoldSeconds), max_age_seconds: n(f.maxAgeSeconds),
    },
    timing: { preparation_lead_minutes: n(f.prepLeadMin), power_dispatch_lead_seconds: n(f.dispatchLeadSec) },
    pairs: Object.fromEntries(PAIRS.map((p) => [p, {
      enabled: f.pairs[p].enabled, charge_kw: n(f.pairs[p].chargeKw), discharge_kw: n(f.pairs[p].dischargeKw),
    }])),
  };
}

function clone(f: Form): Form {
  return { ...f, days: new Set(f.days), pairs: Object.fromEntries(PAIRS.map((p) => [p, { ...f.pairs[p] }])) as Record<PairId, PairForm> };
}

/** The schedule the gateway is actually running, out of its automation_status record. The gateway
   reports it at the record's top level, with charge_window/discharge_window where the form's config
   uses charge/discharge and automation_enabled where it uses enabled; the rest of the keys match.
   Returns null when the record carries no schedule, so the stored config is used as the fallback. */
function scheduleOf(row: StatusRow | undefined): Record<string, unknown> | null {
  const p = row?.payload;
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (!o.charge_window && !o.discharge_window && !o.pairs) return null;
  return {
    enabled: o.automation_enabled === true,
    days: o.days, solar: o.solar, timing: o.timing, pairs: o.pairs,
    charge: o.charge_window, discharge: o.discharge_window,
  };
}

/** Poll the S9 command read until the gateway closes this command, or we stop waiting. Terminal
   states are the contract's completed/rejected/failed/timeout; accepted/executing keep polling.
   Carries back the gateway's verified flag and error code so Save reports the real outcome. */
async function awaitReadback(commandId: string): Promise<{ status: string | null; reason: string | null; verified: boolean; errorCode: string | null }> {
  const terminal = new Set(["completed", "rejected", "failed", "timeout"]);
  const deadline = Date.now() + 30_000;
  const pick = (o: unknown, k: string) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    try {
      const r = await fetch(`${COMMANDS_URL}?command_id=${encodeURIComponent(commandId)}&limit=1`,
                           { headers: authHeaders(), cache: "no-store" });
      if (!r.ok) continue;
      const row = ((await r.json()).results ?? [])[0];
      const fs = row?.final_status as string | undefined;
      if (fs && terminal.has(fs)) {
        const rb = row.readback_value, pl = row.payload;
        const reason = pick(pl, "validation_reason") ?? pick(rb, "reason") ?? pick(rb, "error") ?? null;
        const errorCode = pick(pl, "gateway_error_code") ?? pick(rb, "gateway_error_code") ?? null;
        const verified = pick(pl, "verified") === true || pick(rb, "verified") === true;
        return { status: fs, reason: reason != null ? String(reason) : null, verified, errorCode: errorCode != null ? String(errorCode) : null };
      }
    } catch { /* keep polling */ }
  }
  return { status: null, reason: null, verified: false, errorCode: null };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

/** Client-side checks mirroring the gateway's AUTOMATION_SCHEDULE_INVALID rules, so an invalid
   schedule is caught in the form instead of bouncing off S9. Returns a message, or null if valid. */
function validate(f: Form): string | null {
  for (const [lbl, s, e] of [["Charge", f.chargeStart, f.chargeStop], ["Discharge", f.dischargeStart, f.dischargeStop]] as const) {
    if (!HHMM.test(s.trim()) || !HHMM.test(e.trim())) return `${lbl} times must be HH:MM (24-hour).`;
    if (mins(s) >= mins(e)) return `${lbl} start must be before its stop (no crossing midnight).`;
  }
  const cs = mins(f.chargeStart), ce = mins(f.chargeStop), ds = mins(f.dischargeStart), de = mins(f.dischargeStop);
  if (cs < de && ds < ce) return "Charge and discharge windows must not overlap.";
  const enabledPairs = PAIRS.filter((p) => f.pairs[p].enabled);
  if (f.enabled && enabledPairs.length === 0) return "Enable at least one pair, or switch automation off.";
  for (const p of enabledPairs) {
    for (const [lbl, v] of [["charge", f.pairs[p].chargeKw], ["discharge", f.pairs[p].dischargeKw]] as const) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 250) return `${p.replace("_", " ")} ${lbl} power must be 0–250 kW (disable the pair to leave it out).`;
    }
  }
  if (!(Number(f.startAboveKw) > Number(f.stopBelowKw))) return "Solar start-above must be greater than stop-below.";
  for (const [lbl, v] of [["start hold", f.startHoldSeconds], ["stop hold", f.stopHoldSeconds], ["max-age", f.maxAgeSeconds]] as const)
    if (!(Number(v) >= 1)) return `Solar ${lbl} must be at least 1 second.`;
  const prep = Number(f.prepLeadMin), disp = Number(f.dispatchLeadSec);
  if (!(prep >= 5 && prep <= 60)) return "Preparation lead must be 5–60 minutes.";
  if (!(disp >= 0 && disp <= 300)) return "Power dispatch lead must be 0–300 seconds.";
  if (disp >= prep * 60) return "Power dispatch lead must be shorter than the preparation lead.";
  return null;
}

/** Everything the gateway treats as the schedule — i.e. not the on/off flag. */
function sameSchedule(a: Form, b: Form): boolean {
  const days = (f: Form) => [...f.days].sort((x, y) => x - y).join(",");
  const pairs = (f: Form) => PAIRS.map((p) => `${f.pairs[p].enabled}:${f.pairs[p].chargeKw}:${f.pairs[p].dischargeKw}`).join("|");
  return a.chargeStart === b.chargeStart && a.chargeStop === b.chargeStop &&
         a.dischargeStart === b.dischargeStart && a.dischargeStop === b.dischargeStop &&
         a.startAboveKw === b.startAboveKw && a.startHoldSeconds === b.startHoldSeconds &&
         a.stopBelowKw === b.stopBelowKw && a.stopHoldSeconds === b.stopHoldSeconds && a.maxAgeSeconds === b.maxAgeSeconds &&
         a.prepLeadMin === b.prepLeadMin && a.dispatchLeadSec === b.dispatchLeadSec &&
         days(a) === days(b) && pairs(a) === pairs(b);
}

// ── atoms ───────────────────────────────────────────────────────────────────
function Field({ label, value, onChange, type = "text", w = 110 }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; w?: number;
}) {
  return (
    <label className="block">
      <span className="ps-stat-k mb-1 block">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} inputMode={type === "text" ? "decimal" : undefined}
             className="filter-input h-8 text-[11.5px]" style={{ width: w }} />
    </label>
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

const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "—");

// ── view ────────────────────────────────────────────────────────────────────
export function AutomationView({ gatewayId }: { gatewayId: string }) {
  const [form, setForm] = useState<Form>(() => clone(DEFAULTS));
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"All" | "Operations" | "Warnings">("All");
  const { requireAuth, gate } = usePasswordGate();
  const baselineRef = useRef<Form | null>(null);   // the form as last loaded from the gateway
  const lastRevRef = useRef<string | number | null>(null);

  // Config — loaded once into the editable form, with the gateway's live schedule preferred.
  useEffect(() => {
    if (!gatewayId) return;
    let alive = true;
    (async () => {
      try {
        const [cfgR, stR] = await Promise.all([
          fetch(CONFIG_URL(gatewayId), { headers: authHeaders(), cache: "no-store" }),
          fetch(STATUS_URL(gatewayId), { headers: authHeaders(), cache: "no-store" }).catch(() => null),
        ]);
        if (!cfgR.ok) throw new Error(cfgR.status === 403 ? "You can view automation but not change it." : `Config unavailable (${cfgR.status})`);
        const cfg = (await cfgR.json()).config;
        const live = stR && stR.ok ? scheduleOf(((await stR.json()).results ?? [])[0]) : null;
        if (alive) { const f = fromConfig(live ?? cfg); setForm(f); baselineRef.current = clone(f); }
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : "Could not load automation config.");
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => { alive = false; };
  }, [gatewayId]);

  const status = useQuery({
    queryKey: ["central", "automation-status", gatewayId],
    queryFn: async () => {
      const r = await fetch(STATUS_URL(gatewayId), { headers: authHeaders(), cache: "no-store" });
      if (!r.ok) throw new Error(`Status unavailable (${r.status})`);
      return ((await r.json()).results ?? []) as StatusRow[];
    },
    enabled: !!gatewayId, refetchInterval: 10_000, staleTime: 8_000,
  });

  const events = useQuery({
    queryKey: ["central", "automation-events", gatewayId],
    queryFn: async () => {
      const r = await fetch(EVENTS_URL(gatewayId), { headers: authHeaders(), cache: "no-store" });
      if (!r.ok) throw new Error(`Events unavailable (${r.status})`);
      return ((await r.json()).results ?? []) as EventRow[];
    },
    enabled: !!gatewayId, refetchInterval: 15_000, staleTime: 12_000,
  });

  const st = status.data?.[0];

  // A new config_revision means the gateway's schedule changed (ours or someone else's). Reload the
  // form from it — but never over unsaved edits, so an operator mid-change is not clobbered.
  useEffect(() => {
    const rev = st?.config_revision ?? null;
    if (rev == null || rev === lastRevRef.current) return;
    lastRevRef.current = rev;
    const live = scheduleOf(st);
    if (!live) return;
    const base = baselineRef.current;
    if (base && !sameSchedule(base, form)) return;
    const f = fromConfig(live);
    setForm(f); baselineRef.current = clone(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.config_revision]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setPair = (p: PairId, patch: Partial<PairForm>) =>
    setForm((f) => ({ ...f, pairs: { ...f.pairs, [p]: { ...f.pairs[p], ...patch } } }));

  const shownEvents = useMemo(() => {
    const rows = events.data ?? [];
    if (filter === "All") return rows;
    return rows.filter((e) => {
      const k = (e.event_type ?? "").toLowerCase();
      const warn = /fault|loss|mismatch|failed/.test(k);
      return filter === "Warnings" ? warn : !warn;
    });
  }, [events.data, filter]);

  async function save() {
    setSaving(true); setErr(null); setNote(null);
    try {
      const bad = validate(form);
      if (bad) { setErr(bad); return; }

      const base = baselineRef.current;
      const scheduleChanged = !base || !sameSchedule(base, form);
      const toggleChanged = !base || base.enabled !== form.enabled;
      if (!scheduleChanged && !toggleChanged) { setNote("No changes to save."); return; }

      const engaged = (st?.payload as Record<string, unknown> | undefined)?.hardware_engaged === true;

      // On/off only -> enable/disable (a site_operator may disable; disable never needs confirm).
      // Any schedule change -> set_schedule (admin only), a full replace the gateway reads back.
      let commandType: string;
      let args: Record<string, unknown>;
      if (!scheduleChanged) {
        commandType = form.enabled ? "automation_enable" : "automation_disable";
        args = {};
      } else {
        commandType = "automation_set_schedule";
        args = { schedule: toConfig(form) };
      }

      // Enabling or re-scheduling while pairs are running stops and restarts them — confirm first.
      if (commandType !== "automation_disable" && engaged) {
        if (!window.confirm("Pairs are running. Applying this will stop all pairs and restart them with the new settings. Continue?")) {
          setNote("Cancelled — nothing sent."); return;
        }
        args = { ...args, confirm_stop_if_active: true };
      }

      // The config store is a web-side record only (the gateway does not poll it); keep it in step
      // when the schedule changed.
      if (scheduleChanged) {
        const cfg = await fetch(CONFIG_URL(gatewayId), {
          method: "POST", headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(toConfig(form)),
        });
        if (cfg.status === 401) throw new Error("Session expired — sign in again.");
        if (!cfg.ok && cfg.status !== 403) throw new Error(`Config save rejected (${cfg.status})`);
      }

      const c = await fetch(COMMANDS_URL, {
        method: "POST", headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ gateway_id: gatewayId, command_type: commandType, arguments: args, requires_readback: true }),
      });
      if (c.status === 403) throw new Error(commandType === "automation_set_schedule"
        ? "Only an admin can change the schedule — an operator can switch automation on or off."
        : "This account is not allowed to command automation.");
      if (!c.ok) throw new Error(`Command rejected (${c.status})`);
      const id = (await c.json()).command_id as string;

      setNote("Sent to gateway — awaiting readback…");
      const back = await awaitReadback(id);
      const label = commandType.replace(/_/g, " ");
      if (back.status === "completed") {
        setNote(`Gateway completed ${label}${back.verified ? " (verified)" : ""}.`);
        baselineRef.current = clone(form);
        status.refetch();                          // the new config_revision reloads the form
      } else if (back.status == null) {
        setErr(`No readback in time — the gateway may be offline. ${label} is still pending.`);
      } else {
        setErr(`Gateway ${back.status} ${label}${back.errorCode ? ` [${back.errorCode}]` : ""}${back.reason ? `: ${back.reason}` : ""}.`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Live phase */}
      <div className="surface-card flex flex-wrap items-center gap-x-6 gap-y-3" style={{ padding: "12px var(--pad)" }}>
        <div>
          <div className="ps-stat-k">State</div>
          <div className="text-[13px] font-semibold text-ink capitalize">
            {st ? `${words(st.phase)}${st.direction ? ` · ${words(st.direction)}` : ""}` : "—"}
          </div>
        </div>
        <span className={`pill ${st?.automation_enabled ? "cyan" : "gray"}`}>
          {st?.automation_enabled == null ? "—" : st.automation_enabled ? "Automation On" : "Automation Off"}
        </span>
        <span className={`pill ${st?.supervisor_alive == null ? "gray" : st.supervisor_alive ? "green" : "red"}`}>
          <span className="dot" />{st?.supervisor_alive == null ? "Supervisor —" : st.supervisor_alive ? "Supervisor Alive" : "Supervisor Down"}
        </span>
        {st?.fault_latched && <span className="pill red"><span className="dot" />Fault Latched</span>}
        {st?.safe_stop_requested && <span className="pill red"><span className="dot" />Safe Stop Requested</span>}
      </div>

      {/* Editor */}
      <Card eyebrow="Schedule" note="Times in site timezone (Asia/Kolkata)">
        <div className="flex items-center gap-2 mb-4">
          <button onClick={() => set("enabled", !form.enabled)}
            className={`px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-colors ${
              form.enabled ? "bg-accent/15 text-accent border-accent/40" : "bg-surface border-line text-muted"}`}>
            {form.enabled ? "Automation Enabled" : "Automation Disabled"}
          </button>
          <span className="text-[11px] text-muted">Click to {form.enabled ? "disable" : "enable"}. Takes effect on save.</span>
        </div>

        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))" }}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Charge Start" type="time" value={form.chargeStart} onChange={(v) => set("chargeStart", v)} w={130} />
            <Field label="Charge Stop"  type="time" value={form.chargeStop}  onChange={(v) => set("chargeStop", v)}  w={130} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Discharge Start" type="time" value={form.dischargeStart} onChange={(v) => set("dischargeStart", v)} w={130} />
            <Field label="Discharge Stop"  type="time" value={form.dischargeStop}  onChange={(v) => set("dischargeStop", v)}  w={130} />
          </div>
        </div>

        {/* Days */}
        <div className="mb-4">
          <div className="ps-stat-k mb-1.5">Active Days</div>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = form.days.has(d.n);
              return (
                <button key={d.n} type="button"
                  onClick={() => setForm((f) => { const days = new Set(f.days); days.has(d.n) ? days.delete(d.n) : days.add(d.n); return { ...f, days }; })}
                  className={`px-2.5 py-1 rounded-md text-[11.5px] border transition-colors ${
                    on ? "bg-accent/15 text-accent border-accent/40" : "bg-surface border-line text-ink3 hover:border-line2"}`}>
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Solar qualification + timing */}
        <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))" }}>
          <div>
            <div className="ps-stat-k mb-1.5">Solar Qualification</div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Start Above (kW)" value={form.startAboveKw} onChange={(v) => set("startAboveKw", v)} />
              <Field label="Hold (s)" value={form.startHoldSeconds} onChange={(v) => set("startHoldSeconds", v)} w={90} />
              <Field label="Stop Below (kW)" value={form.stopBelowKw} onChange={(v) => set("stopBelowKw", v)} />
              <Field label="Hold (s)" value={form.stopHoldSeconds} onChange={(v) => set("stopHoldSeconds", v)} w={90} />
            </div>
          </div>
          <div>
            <div className="ps-stat-k mb-1.5">Timing Leads</div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Preparation (min)" value={form.prepLeadMin} onChange={(v) => set("prepLeadMin", v)} />
              <Field label="Power Dispatch (s)" value={form.dispatchLeadSec} onChange={(v) => set("dispatchLeadSec", v)} />
            </div>
          </div>
        </div>

        {/* Per-pair */}
        <div className="ps-stat-k mb-1.5">Per-Pair Power</div>
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
          {PAIRS.map((p) => {
            const pf = form.pairs[p];
            return (
              <div key={p} className="surface-card" style={{ padding: "10px 12px" }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[12px] font-semibold text-ink">{p.replace("_", " ").toUpperCase()}</span>
                  <button type="button" onClick={() => setPair(p, { enabled: !pf.enabled })}
                    className={`px-2 py-0.5 rounded text-[10.5px] font-semibold border ${
                      pf.enabled ? "bg-good/15 text-good border-good/40" : "bg-surface border-line text-muted"}`}>
                    {pf.enabled ? "Enabled" : "Disabled"}
                  </button>
                </div>
                <div className="flex items-end gap-2">
                  <Field label="Charge (kW)" value={pf.chargeKw} onChange={(v) => setPair(p, { chargeKw: v })} w={90} />
                  <Field label="Discharge (kW)" value={pf.dischargeKw} onChange={(v) => setPair(p, { dischargeKw: v })} w={90} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button onClick={() => requireAuth(save)} disabled={saving || !loaded} className="btn-primary">
            {saving ? "Saving…" : "Save Automation"}
          </button>
          {note && <span className="text-[11.5px]" style={{ color: "var(--accent)" }}>{note}</span>}
          {err && <span className="text-[11.5px]" style={{ color: "var(--red)" }}>{err}</span>}
        </div>
      </Card>

      {/* Event log */}
      <Card eyebrow="Automation Events" note={`${shownEvents.length} shown`}>
        <div className="flex items-center gap-0.5 bg-surface/80 ring-1 ring-line rounded-md p-0.5 mb-3 w-fit">
          {(["All", "Operations", "Warnings"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={["px-3 py-1.5 rounded text-[12px] font-medium transition-colors",
                filter === f ? "bg-accent/15 text-accent ring-1 ring-accent/20" : "text-muted hover:text-ink"].join(" ")}>
              {f}
            </button>
          ))}
        </div>
        {events.isLoading ? (
          <p className="text-[12px] text-muted py-6 text-center">Loading events…</p>
        ) : !shownEvents.length ? (
          <p className="text-[12px] text-muted py-6 text-center">No automation events.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="py-2 pr-4 font-medium">Time</th>
                  <th className="py-2 pr-4 font-medium">Event</th>
                  <th className="py-2 pr-4 font-medium">Phase</th>
                  <th className="py-2 font-medium">Direction</th>
                </tr>
              </thead>
              <tbody>
                {shownEvents.map((e) => {
                  const k = (e.event_type ?? "").toLowerCase();
                  const warn = /fault|loss|mismatch|failed/.test(k);
                  const t = e.timestamp_utc ?? e.received_at_utc;
                  return (
                    <tr key={e.event_id} className="border-b border-line/40 last:border-none">
                      <td className="py-2 pr-4 font-mono text-ink3">{t ? new Date(t).toLocaleString("en-IN", { hour12: false }) : "—"}</td>
                      <td className="py-2 pr-4"><span className={warn ? "text-[var(--red)]" : "text-ink2"}>{words(e.event_type)}</span></td>
                      <td className="py-2 pr-4 text-ink3 capitalize">{words(e.phase)}</td>
                      <td className="py-2 text-ink3 capitalize">{words(e.direction)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {gate}
    </div>
  );
}
