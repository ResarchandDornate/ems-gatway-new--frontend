"use client";

/**
 * Automation (S10 / CG-28) — the scheduled charge-discharge windows the gateway runs on its own.
 *
 * The editor saves the whole config blob to the central store (POST /automation-config); the
 * gateway polls it, the same way it polls pending commands. Live phase and the event feed are the
 * existing structured reads (/automation-status, /automation-events), site-scoped by the proxy.
 *
 * Only command:write holders can save — the backend enforces it; a refusal surfaces as a notice.
 */

import { useEffect, useMemo, useState } from "react";
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
  config_revision?: number | null; payload?: Record<string, unknown> | null;
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
  startAboveKw: string; startHoldSeconds: string; stopBelowKw: string; stopHoldSeconds: string;
  prepLeadMin: string; dispatchLeadSec: string;
  days: Set<number>;
  pairs: Record<PairId, PairForm>;
};

const DEFAULTS: Form = {
  enabled: false,
  chargeStart: "09:00", chargeStop: "14:30", dischargeStart: "15:00", dischargeStop: "17:00",
  startAboveKw: "100", startHoldSeconds: "60", stopBelowKw: "80", stopHoldSeconds: "30",
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
    prepLeadMin: str(timing.preparation_lead_minutes, "15"), dispatchLeadSec: str(timing.power_dispatch_lead_seconds, "120"),
    days,
    pairs: Object.fromEntries(PAIRS.map((p) => {
      const pc = (pairsIn[p] && typeof pairsIn[p] === "object" ? pairsIn[p] as Record<string, unknown> : {}) as Record<string, unknown>;
      return [p, { enabled: pc.enabled !== false, chargeKw: str(pc.charge_kw, "5"), dischargeKw: str(pc.discharge_kw, "5") }];
    })) as Record<PairId, PairForm>,
  };
}

/** The flat form → the stored blob (Flutter shape). */
function toConfig(f: Form): Record<string, unknown> {
  const n = (s: string) => Number(s);
  return {
    enabled: f.enabled, timezone: "Asia/Kolkata", days: [...f.days].sort((a, b) => a - b),
    charge: { start: f.chargeStart.trim(), stop: f.chargeStop.trim() },
    discharge: { start: f.dischargeStart.trim(), stop: f.dischargeStop.trim() },
    solar: {
      start_above_kw: n(f.startAboveKw), start_hold_seconds: n(f.startHoldSeconds),
      stop_below_kw: n(f.stopBelowKw), stop_hold_seconds: n(f.stopHoldSeconds), max_age_seconds: 15,
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

/** The schedule the gateway is actually running, out of its automation_status record. It echoes
   the config it pulled under payload.config; some builds nest it as payload.schedule. Returns
   null when neither is present, so the stored desired-state is used as the fallback. */
function scheduleOf(row: StatusRow | undefined): Record<string, unknown> | null {
  const p = row?.payload;
  if (!p || typeof p !== "object") return null;
  const c = (p as Record<string, unknown>).config ?? (p as Record<string, unknown>).schedule;
  return c && typeof c === "object" ? c as Record<string, unknown> : null;
}

/** Poll the S9 command read until the gateway closes this command, or we stop waiting. Terminal
   states are the contract's completed/rejected/failed/timeout; accepted/executing keep polling. */
async function awaitReadback(commandId: string): Promise<{ status: string | null; reason: string | null }> {
  const terminal = new Set(["completed", "rejected", "failed", "timeout"]);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2_000));
    try {
      const r = await fetch(`${COMMANDS_URL}?command_id=${encodeURIComponent(commandId)}&limit=1`,
                           { headers: authHeaders(), cache: "no-store" });
      if (!r.ok) continue;
      const row = ((await r.json()).results ?? [])[0];
      const fs = row?.final_status as string | undefined;
      if (fs && terminal.has(fs)) {
        const rb = row.readback_value;
        const reason = rb && typeof rb === "object" ? (rb.reason ?? rb.error ?? null) : rb ?? null;
        return { status: fs, reason: reason != null ? String(reason) : null };
      }
    } catch { /* keep polling */ }
  }
  return { status: null, reason: null };
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

  // Config — loaded once into the editable form.
  useEffect(() => {
    if (!gatewayId) return;
    let alive = true;
    (async () => {
      try {
        // The gateway's running schedule wins over the stored desired-state: open the form on what
        // is live on site, falling back to the saved config, so it never opens on web defaults.
        const [cfgR, stR] = await Promise.all([
          fetch(CONFIG_URL(gatewayId), { headers: authHeaders(), cache: "no-store" }),
          fetch(STATUS_URL(gatewayId), { headers: authHeaders(), cache: "no-store" }).catch(() => null),
        ]);
        if (!cfgR.ok) throw new Error(cfgR.status === 403 ? "You can view automation but not change it." : `Config unavailable (${cfgR.status})`);
        const cfg = (await cfgR.json()).config;
        const live = stR && stR.ok ? scheduleOf(((await stR.json()).results ?? [])[0]) : null;
        if (alive) setForm(fromConfig(live ?? cfg));
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
      // 1. Persist the schedule the gateway will pull on its next config poll.
      const cfg = await fetch(CONFIG_URL(gatewayId), {
        method: "POST", headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(toConfig(form)),
      });
      if (cfg.status === 403) throw new Error("This account is not allowed to change automation.");
      if (cfg.status === 401) throw new Error("Session expired — sign in again.");
      if (!cfg.ok) throw new Error(`Config save rejected (${cfg.status})`);

      // 2. Command the supervisor on or off. Writing the config alone changes nothing on site —
      //    this D1 downlink is what the gateway acts on, and its readback is the real outcome.
      const want = form.enabled ? "automation_enable" : "automation_disable";
      const c = await fetch(COMMANDS_URL, {
        method: "POST", headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ gateway_id: gatewayId, command_type: want, requires_readback: true }),
      });
      if (c.status === 403) throw new Error("This account is not allowed to command automation.");
      if (!c.ok) throw new Error(`Command rejected (${c.status})`);
      const id = (await c.json()).command_id as string;

      setNote("Sent to gateway — awaiting readback…");
      const back = await awaitReadback(id);
      const label = want.replace(/_/g, " ");
      if (back.status === "completed") { setNote(`Gateway completed ${label}.`); status.refetch(); }
      else if (back.status == null) setErr(`No readback in time — the gateway may be offline. ${label} is still pending.`);
      else setErr(`Gateway ${back.status} the ${label}${back.reason ? `: ${back.reason}` : ""}.`);
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
