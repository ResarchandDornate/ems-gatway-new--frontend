"use client";

/**
 * Pair Control (S10) — operator control for the four BMS·PCS pairs:
 * precheck, automatic start, set power, zero power, safe stop, abort, and a
 * plant-wide safe-stop-all. Lays out like the SOC Controller.
 *
 * Writes are cloud commands (D1): command_type + arguments only. The gateway
 * injects its own confirmation phrase, so this screen never sends one.
 * power_kw is a magnitude; `direction` supplies the sign.
 *
 * Both calls carry the signed-in session's bearer: the /api/central proxy
 * forwards the caller's token, it does not attach one. site_id is added by the
 * proxy (it is a required query parameter on /charge-discharge/latest).
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSession } from "@/lib/central";

// ── wire-up points ──────────────────────────────────────────────────────────
// Status is the structured read already shipped (S10). Command submit is the
// D1 downlink — point it at the real route once the backend command endpoint
// is live (POST /api/v1/commands does not exist yet: it answers 404).
const STATUS_URL  = (gatewayId: string) =>
  `/api/central/charge-discharge/latest?gateway_id=${encodeURIComponent(gatewayId)}&limit=20`;
const COMMAND_URL = "/api/central/commands";   // TODO: backend D1 submit

const PAIRS = ["pair_1", "pair_2", "pair_3", "pair_4"] as const;
type Pair = (typeof PAIRS)[number];
type Dir  = "charge" | "discharge";

type PairStatus = {
  pair_id: string | null;
  stage: string | null;
  run_status: string | null;
  direction: string | null;
  actual_power_kw: number | null;
  commanded_power_kw: number | null;
  rack_soc_percent: number | null;
  available: boolean | null;
  pcs_running: boolean | null;
  hard_blocked: boolean | null;
  sample_time_utc?: string | null;
};

const num = (v: number | null | undefined, unit: string, dp = 1) =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(dp)} ${unit}` : "—";
const onOff = (v: boolean | null | undefined) => (v == null ? "—" : v ? "Yes" : "No");
const words = (s: string | null | undefined) => (s ? s.replace(/_/g, " ") : "—");
const authHeaders = (): Record<string, string> => {
  const s = getSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
};

/** The seven allow-listed cloud commands, with what each needs. */
const COMMANDS = {
  pair_precheck:        { label: "Precheck",        needsDir: true,  needsPower: true,  danger: false },
  pair_automatic_start: { label: "Automatic Start", needsDir: true,  needsPower: true,  danger: true  },
  pair_set_power:       { label: "Set Power",       needsDir: true,  needsPower: true,  danger: true  },
  pair_zero_power:      { label: "Zero Power",      needsDir: false, needsPower: false, danger: false },
  pair_safe_stop:       { label: "Safe Stop",       needsDir: false, needsPower: false, danger: true  },
  pair_abort:           { label: "Abort",           needsDir: false, needsPower: false, danger: true  },
  safe_stop_all:        { label: "Safe Stop All",   needsDir: false, needsPower: false, danger: true  },
} as const;
type CommandType = keyof typeof COMMANDS;

function usePairStatus(gatewayId: string) {
  return useQuery({
    queryKey: ["central", "charge-discharge", gatewayId],
    queryFn: async () => {
      const r = await fetch(STATUS_URL(gatewayId), { headers: authHeaders(), cache: "no-store" });
      if (!r.ok) throw new Error(`Pair status unavailable (${r.status})`);
      const j = await r.json();
      return (j.results ?? []) as PairStatus[];
    },
    enabled: !!gatewayId,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
}

// ── small UI atoms, matching the house design ───────────────────────────────
function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-[5px] border-b border-line text-[11.5px]">
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

// ── view ─────────────────────────────────────────────────────────────────────
export function PairControlView({ gatewayId }: { gatewayId: string }) {
  const { data: rows, error: statusErr } = usePairStatus(gatewayId);
  /* Newest per pair: rows arrive newest first. */
  const byPair = new Map<string, PairStatus>();
  for (const r of rows ?? []) if (r.pair_id && !byPair.has(r.pair_id)) byPair.set(r.pair_id, r);

  const [pair, setPair]           = useState<Pair>("pair_1");
  const [direction, setDirection] = useState<Dir>("charge");
  const [powerKw, setPowerKw]     = useState("50");
  const [rampStep, setRampStep]   = useState("10");
  const [rampInt, setRampInt]     = useState("5");
  const [openBms, setOpenBms]     = useState(false);

  const [pending, setPending]     = useState<CommandType | null>(null);  // awaiting confirm
  const [busy, setBusy]           = useState(false);
  const [note, setNote]           = useState<string | null>(null);
  const [err, setErr]             = useState<string | null>(null);

  const sel = byPair.get(pair);
  const sign = direction === "charge" ? "−" : "+";
  const powerMag = Math.abs(Number(powerKw));
  const powerOk = Number.isFinite(powerMag) && powerMag > 0;

  /* Start / set-power / precheck need a real magnitude; refused here rather
     than sent as 0 kW. */
  function request(type: CommandType) {
    setErr(null); setNote(null);
    if (COMMANDS[type].needsPower && !powerOk) { setErr("Enter a power above 0 kW."); return; }
    if (COMMANDS[type].danger) setPending(type); else void submit(type);
  }

  async function submit(type: CommandType) {
    setBusy(true); setErr(null); setNote(null); setPending(null);
    const c = COMMANDS[type];
    const args: Record<string, unknown> = {};
    if (type !== "safe_stop_all") args.pair_id = pair;
    if (c.needsDir) args.direction = direction;
    if (c.needsPower) args.power_kw = powerMag;  // magnitude only
    if (type === "pair_automatic_start") {
      args.ramp_step_kw = Number(rampStep) || undefined;
      args.ramp_interval_seconds = Number(rampInt) || undefined;
    }
    if (type === "pair_safe_stop" || type === "pair_abort" || type === "safe_stop_all") {
      args.open_bms = openBms;
    }
    try {
      const r = await fetch(COMMAND_URL, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          gateway_id: gatewayId,
          command_type: type,
          arguments: args,
          requires_readback: true,
        }),
      });
      if (r.status === 404 || r.status === 405) throw new Error("Command submit is not available on the backend yet.");
      if (r.status === 401) throw new Error("Session expired — sign in again.");
      if (r.status === 403) throw new Error("This account is not allowed to send commands.");
      if (!r.ok) throw new Error(`Command rejected (${r.status})`);
      setNote(`${c.label} accepted${type === "safe_stop_all" ? "" : ` for ${pair}`}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Command failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Selected-pair live status */}
      <div className="surface-card flex flex-wrap items-center gap-x-6 gap-y-3" style={{ padding: "12px var(--pad)" }}>
        <div>
          <div className="ps-stat-k">Pair</div>
          <div className="text-[17px] font-semibold text-ink">{pair.replace("_", " ").toUpperCase()}</div>
        </div>
        <div className="min-w-0">
          <div className="ps-stat-k">Stage</div>
          <div className="text-[12.5px] text-ink2 capitalize">{words(sel?.stage)}</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`pill ${sel?.pcs_running ? "cyan" : "gray"}`}>
            {sel?.run_status ? words(sel.run_status) : "—"}
          </span>
          <span className={`pill ${sel?.hard_blocked == null ? "gray" : sel.hard_blocked ? "red" : "green"}`}>
            <span className="dot" />{sel?.hard_blocked == null ? "—" : sel.hard_blocked ? "Blocked" : "Clear"}
          </span>
        </div>
        {statusErr && <span className="text-[11.5px]" style={{ color: "var(--red)" }}>{(statusErr as Error).message}</span>}
      </div>

      {/* The four pairs — click to select */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
        {PAIRS.map((p) => {
          const s = byPair.get(p);
          const on = p === pair;
          return (
            <button key={p} onClick={() => setPair(p)} className="text-left"
              style={{ outline: on ? "2px solid var(--accent)" : "none", borderRadius: 12 }}>
              <Card eyebrow={p.replace("_", " ").toUpperCase()} note={s?.available == null ? undefined : s.available ? "Available" : "Unavailable"}>
                <Reading label="Run Status"      value={words(s?.run_status)} />
                <Reading label="Direction"       value={words(s?.direction)} />
                <Reading label="Commanded Power" value={num(s?.commanded_power_kw, "kW")} />
                <Reading label="Actual Power"    value={num(s?.actual_power_kw, "kW")} />
                <Reading label="Rack SOC"        value={num(s?.rack_soc_percent, "%", 1)} />
                <Reading label="PCS Running"     value={onOff(s?.pcs_running)} />
              </Card>
            </button>
          );
        })}
      </div>

      {/* Command panel */}
      <Card eyebrow="Command" note="Negative power = charging · positive = discharging">
        <div className="flex flex-wrap items-end gap-4 mb-3">
          {/* direction toggle */}
          <div>
            <div className="ps-stat-k mb-1">Direction</div>
            <div className="flex items-center gap-0.5 bg-surface/80 ring-1 ring-line rounded-md p-0.5">
              {(["charge", "discharge"] as Dir[]).map((d) => (
                <button key={d} onClick={() => setDirection(d)}
                  className={["px-3 py-1.5 rounded text-[12px] font-medium capitalize transition-colors",
                    direction === d ? "bg-accent/15 text-accent ring-1 ring-accent/20" : "text-muted hover:text-ink"].join(" ")}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* power magnitude */}
          <div>
            <div className="ps-stat-k mb-1">Power ({sign}kW)</div>
            <input value={powerKw} onChange={(e) => setPowerKw(e.target.value)} inputMode="decimal"
              className="filter-input h-8 text-[11.5px] w-[110px]" />
          </div>

          {/* ramp (automatic start only) */}
          <div>
            <div className="ps-stat-k mb-1">Ramp Step (kW)</div>
            <input value={rampStep} onChange={(e) => setRampStep(e.target.value)} inputMode="decimal"
              className="filter-input h-8 text-[11.5px] w-[110px]" />
          </div>
          <div>
            <div className="ps-stat-k mb-1">Ramp Interval (s)</div>
            <input value={rampInt} onChange={(e) => setRampInt(e.target.value)} inputMode="decimal"
              className="filter-input h-8 text-[11.5px] w-[110px]" />
          </div>

          <label className="flex items-center gap-2 text-[11.5px] text-ink2">
            <input type="checkbox" checked={openBms} onChange={(e) => setOpenBms(e.target.checked)} />
            Open BMS on stop / abort
          </label>
        </div>

        {/* action buttons — dangerous ones ask to confirm inline first */}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(COMMANDS) as CommandType[]).map((type) => {
            const c = COMMANDS[type];
            return (
              <button key={type} disabled={busy}
                onClick={() => request(type)}
                className={c.danger ? "btn-outline" : "btn-primary"}
                style={c.danger ? { color: "var(--red)", borderColor: "var(--red)" } : undefined}>
                {c.label}
              </button>
            );
          })}
        </div>

        {/* inline confirm for a dangerous action */}
        {pending && (
          <div role="alertdialog" className="flex items-center gap-3 flex-wrap mt-3">
            <span className="text-[11.5px] text-ink2">
              {COMMANDS[pending].label} {pending === "safe_stop_all" ? "every pair" : pair}
              {COMMANDS[pending].needsPower ? ` at ${sign}${powerMag} kW` : ""}?
            </span>
            <button onClick={() => submit(pending)} autoFocus
              className="text-[12px] font-semibold text-[var(--red)] underline underline-offset-2 hover:opacity-80">
              Yes, Execute
            </button>
            <button onClick={() => setPending(null)}
              className="text-[12px] font-medium text-ink2 underline underline-offset-2 hover:opacity-80">
              Cancel
            </button>
          </div>
        )}

        {note && <p className="text-[11.5px] mt-3" style={{ color: "var(--accent)" }}>{note}</p>}
        {err  && <p className="text-[11.5px] mt-3" style={{ color: "var(--red)" }}>{err}</p>}
      </Card>
    </div>
  );
}
