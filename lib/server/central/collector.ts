/**
 * The central-backend collector: keeps what the backend would otherwise drop.
 *
 * Most endpoints answer only their newest rows and take no date range, so
 * history older than a few hours (the SOC controller, the inverter) or a few
 * days (the energy counters) is simply not available to the app. This walks
 * them on a timer and appends anything new to the store (store.ts):
 *
 *   every 5 min   S2 key points (PCS energy counters p0203–p0206, EMS SOC
 *                 p0041, battery DC power p0075, BMS month/year p1063–p1066),
 *                 S5 /controller, S6 /solis, S4 /alarms, S7 /edge-ai, S3 /health
 *   every minute  one S1 /fast-bess sample per cabinet, the key fields only
 *                 (1 Hz in full is ~3 MB per 20 minutes per cabinet)
 *
 * It cannot recover what the gateway never uploaded — the overnight gaps stay
 * gaps — and it cannot reach back past the day it starts. From then on, the
 * history readers (app/api/history) merge this with the live reads.
 *
 * ── Its own account ─────────────────────────────────────────────────────
 * A timer has no signed-in person behind it, so it signs in with
 * CENTRAL_COLLECTOR_EMAIL / CENTRAL_COLLECTOR_PASSWORD — a read-only account.
 * Unset, it does nothing and says so once at startup.
 */

import { CENTRAL_BASE } from "./auth";
import { appendRows, readJson, readRange, recentKeys, STORE_ROOT, writeJson, type StoredRow } from "./store";
import { foldLifetime, foldMonthly, monthStartMs, prevIstMonth, type LifetimeDoc, type MonthlyDoc } from "@/lib/revenue/monthly";

const SLOW_MS = 5 * 60_000;
const FAST_MS = 60_000;
const POINTS = ["p0203", "p0204", "p0205", "p0206", "p0041", "p0075", "p1063", "p1064", "p1065", "p1066",
  /* PCS per-phase active power, for the dashboard's Power Per Phase. */
  "p0181", "p0182", "p0183"];

type Json = Record<string, unknown>;

let token: string | null = null;
let tokenAt = 0;

async function login(): Promise<string | null> {
  const email = process.env.CENTRAL_COLLECTOR_EMAIL, password = process.env.CENTRAL_COLLECTOR_PASSWORD;
  if (!email || !password) return null;
  const r = await fetch(`${CENTRAL_BASE}/api/v1/auth/login`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email, password }), cache: "no-store",
  });
  if (!r.ok) throw new Error(`login ${r.status}`);
  const j = (await r.json()) as { access_token?: string };
  token = j.access_token ?? null;
  tokenAt = Date.now();
  return token;
}

/** The read-only account's token, for other server jobs (the push watcher). */
export async function serviceToken(): Promise<string | null> {
  if (!token || Date.now() - tokenAt > 50 * 60_000) await login();
  return token;
}

async function get(pathAndQuery: string): Promise<unknown[]> {
  if (!token || Date.now() - tokenAt > 50 * 60_000) await login();
  const call = () => fetch(`${CENTRAL_BASE}/api/v1/${pathAndQuery}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }, cache: "no-store",
  });
  let r = await call();
  if (r.status === 401) { await login(); r = await call(); }
  if (!r.ok) throw new Error(`${pathAndQuery.split("?")[0]} ${r.status}`);
  const body = await r.json();
  return Array.isArray(body) ? body : [];
}

const tsOf = (r: Json, field = "sample_time_utc") => Date.parse(String(r[field] ?? ""));

/** Per stream, the keys already stored recently — so a re-read appends nothing. */
const seen = new Map<string, Set<string>>();
async function keep(gw: string, stream: string, rows: unknown[], keyOf: (r: Json) => string, timeOf: (r: Json) => number = (r) => tsOf(r)) {
  let s = seen.get(stream);
  if (!s) { s = await recentKeys(gw, stream); seen.set(stream, s); }
  const fresh: StoredRow[] = [];
  for (const raw of rows) {
    const r = raw as Json;
    const ts = timeOf(r);
    if (!Number.isFinite(ts)) continue;
    const k = keyOf(r);
    if (s.has(k)) continue;
    s.add(k);
    fresh.push({ ts, k, r });
  }
  await appendRows(gw, stream, fresh);
  /* Keep the dedupe set to about three days of keys. */
  if (s.size > 400_000) seen.delete(stream);
  return fresh.length;
}

/** Each month's highest BMS discharge counter per cabinet (lib/revenue/monthly). */
export const MONTHLY_DOC = "monthly-discharge";
async function keepMonthly(gw: string, rows: unknown[]) {
  const doc = await readJson<MonthlyDoc>(gw, MONTHLY_DOC, {});
  if (foldMonthly(doc, rows as Parameters<typeof foldMonthly>[1])) await writeJson(gw, MONTHLY_DOC, doc);
}

/** Each month's first and last PCS DC lifetime discharge reading (p0206) per
 *  cabinet. Its own name: "monthly-lifetime" held the AC counter (p0204),
 *  which reads high, and the two must not be mixed in one month. */
export const LIFETIME_DOC = "monthly-lifetime-dc";
async function keepLifetime(gw: string, rows: unknown[]) {
  const doc = await readJson<LifetimeDoc>(gw, LIFETIME_DOC, {});
  if (foldLifetime(doc, rows as Parameters<typeof foldLifetime>[1])) await writeJson(gw, LIFETIME_DOC, doc);
}

/* Once at startup: fold in what the store already holds since last month's
   1st, so a month the collector was running through is not lost to having
   added these documents mid-month. */
async function seedMonthly(gw: string) {
  const from = monthStartMs(prevIstMonth(Date.now()));
  const rows = (await readRange(gw, "general", from, Date.now() + 60_000, 2_000_000)).map((x) => x.r as Json);
  await keepMonthly(gw, rows.filter((r) => r.point_id === "p1064"));
  await keepLifetime(gw, rows.filter((r) => r.point_id === "p0206"));
}

async function slowPass(gw: string) {
  const g = encodeURIComponent(gw);
  const jobs: [string, () => Promise<number>][] = [
    ...POINTS.map((p) => [`general:${p}`, async () => {
      const rows = await get(`gateways/${g}/general?point_id=${p}&limit=200`);
      /* The month-to-date discharge, kept per month for last month's revenue. */
      if (p === "p1064") await keepMonthly(gw, rows);
      /* The DC lifetime discharge, its first and last reading per month. */
      if (p === "p0206") await keepLifetime(gw, rows);
      return keep(gw, "general", rows, (r) => `${r.asset_id}|${r.point_id}|${r.sample_time_utc}`);
    }] as [string, () => Promise<number>]),
    ["controller", async () => keep(gw, "controller", await get(`gateways/${g}/controller?limit=200`),
      (r) => `${r.sample_time_utc}|${(r.data as Json | undefined)?.event ? JSON.stringify((r.data as Json).event).slice(0, 80) : ""}`)],
    ["solis", async () => keep(gw, "solis", await get(`gateways/${g}/solis?limit=200`),
      (r) => `${r.sample_time_utc}|${(r.data as Json | undefined)?.event ? "e" : "s"}`)],
    ["alarms", async () => keep(gw, "alarms", await get(`gateways/${g}/alarms?limit=200`),
      (r) => String(r.event_id ?? `${r.dedupe_key}|${r.state}|${r.event_time_utc}`), (r) => tsOf(r, "event_time_utc"))],
    ["edge-ai", async () => keep(gw, "edge-ai", await get(`gateways/${g}/edge-ai?limit=100`),
      (r) => `${r.sample_time_utc}|${r.bess_id ?? ""}`)],
    ["health", async () => keep(gw, "health", await get(`gateways/${g}/health?limit=5`),
      (r) => String(r.sample_time_utc))],
  ];
  for (const [name, job] of jobs) {
    try { await job(); } catch (e) { note(`${name}: ${(e as Error).message}`); }
  }
}

let bessIds: string[] = [];
let bessAt = 0;
async function fastPass(gw: string) {
  const g = encodeURIComponent(gw);
  if (!bessIds.length || Date.now() - bessAt > 60 * 60_000) {
    const probe = (await get(`gateways/${g}/fast-bess?limit=10`)) as Json[];
    const ids = [...new Set(probe.map((r) => String(r.bess_id ?? "")).filter(Boolean))].sort();
    if (ids.length) { bessIds = ids; bessAt = Date.now(); }
  }
  for (const b of bessIds) {
    const rows = (await get(`gateways/${g}/fast-bess?limit=1&bess_id=${encodeURIComponent(b)}`)) as Json[];
    /* The fields the history screens read, not the whole 63-signal sample. */
    const slim = rows.map((r) => {
      const d = (r.data ?? {}) as { pcs_values?: Json; bms_values?: Json };
      const pick = (o: Json | undefined, ks: string[]) => Object.fromEntries(ks.filter((k) => o && k in o).map((k) => [k, o![k]]));
      return {
        bess_id: r.bess_id, source_id: r.source_id, sample_time_utc: r.sample_time_utc, quality: r.quality,
        data: {
          pcs_values: pick(d.pcs_values, ["total_active_power", "dc_voltage", "dc_current", "grid_frequency", "soc"]),
          bms_values: pick(d.bms_values, ["display_soc", "soh", "average_temperature", "battery_max_temperature",
            "battery_min_temperature", "cell_max_voltage", "cell_min_voltage", "max_min_cell_voltage_diff"]),
        },
      };
    });
    await keep(gw, "fast", slim, (r) => `${r.bess_id}|${r.sample_time_utc}`);
  }
}

/* One line per distinct problem per hour, not one per failed request. */
const noted = new Map<string, number>();
function note(msg: string) {
  const last = noted.get(msg) ?? 0;
  if (Date.now() - last < 60 * 60_000) return;
  noted.set(msg, Date.now());
  console.warn(`[collector] ${msg}`);
}

export function startCollector(): void {
  const g = globalThis as unknown as { __centralCollector?: boolean };
  if (g.__centralCollector) return;                 // dev reloads re-run register()
  g.__centralCollector = true;

  const gw = process.env.CENTRAL_GATEWAY_ID?.trim() || process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() || "";
  if (!gw || !process.env.CENTRAL_COLLECTOR_EMAIL || !process.env.CENTRAL_COLLECTOR_PASSWORD) {
    console.info("[collector] off — set CENTRAL_GATEWAY_ID, CENTRAL_COLLECTOR_EMAIL and CENTRAL_COLLECTOR_PASSWORD to keep history beyond the backend's window");
    return;
  }
  console.info(`[collector] on — gateway ${gw.slice(0, 8)}, store ${STORE_ROOT}`);

  let slowBusy = false, fastBusy = false;
  const slow = async () => { if (slowBusy) return; slowBusy = true; try { await slowPass(gw); } catch (e) { note((e as Error).message); } finally { slowBusy = false; } };
  const fast = async () => { if (fastBusy) return; fastBusy = true; try { await fastPass(gw); } catch (e) { note(`fast: ${(e as Error).message}`); } finally { fastBusy = false; } };
  void seedMonthly(gw).catch((e) => note(`seed: ${(e as Error).message}`));
  setTimeout(slow, 5_000);
  setTimeout(fast, 8_000);
  setInterval(slow, SLOW_MS).unref?.();
  setInterval(fast, FAST_MS).unref?.();
}
