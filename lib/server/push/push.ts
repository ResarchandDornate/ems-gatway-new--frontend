/**
 * Web Push for alarms, so a locked phone still hears about one.
 *
 * A web page runs no script while the phone is locked, so the page's own siren
 * (components/TopBar.tsx) cannot reach it. This server can: it watches the
 * alarms and sends a Web Push message to every device that turned on
 * lock-screen alerts; the phone's push service wakes the service worker
 * (public/sw.js), which shows the notification.
 *
 * Same rule as the siren: an active alarm nobody has acknowledged is sent when
 * first seen, then again every 15 minutes while it stays active and
 * unacknowledged. Acknowledgements are the shared ones (app/api/alarm-acks).
 *
 * The alarm list is the bell's own — fetchAlarms, run on the server inside a
 * scope that lends it a token (lib/central/serverScope.ts) — so the raise
 * times, and therefore the acknowledgement keys, match exactly.
 *
 * ── Configuration ────────────────────────────────────────────────────────
 * WEB_PUSH_PUBLIC_KEY / WEB_PUSH_PRIVATE_KEY   VAPID pair
 *                                              (npx web-push generate-vapid-keys)
 * WEB_PUSH_SUBJECT                             mailto: or https: contact
 * The watcher also needs the collector's read-only account and
 * CENTRAL_GATEWAY_ID (see lib/server/central/collector.ts).
 */

import webpush, { type PushSubscription } from "web-push";
import { AsyncLocalStorage } from "node:async_hooks";
import { readJson, writeJson } from "@/lib/server/central/store";
import { fetchAlarms, type CentralAlarm } from "@/lib/api/services/alarmsCentral.service";
import { ackKey, findAck } from "@/lib/alarms/ack";
import { PRIORITY } from "@/lib/alarms/priority";
import type { ServerScope } from "@/lib/central/serverScope";

export const REPEAT_MS = 15 * 60_000;

/** The id the site's documents are kept under — the same one alarm-acks uses. */
export const siteDoc = () =>
  process.env.CENTRAL_GATEWAY_ID?.trim() || process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() || "site";

/* ── Keys ─────────────────────────────────────────────────────────────── */

let vapidSet = false;
export function pushPublicKey(): string | null {
  const pub = process.env.WEB_PUSH_PUBLIC_KEY?.trim(), priv = process.env.WEB_PUSH_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim();
  if (!pub || !priv || !subject) return null;
  if (!vapidSet) { webpush.setVapidDetails(subject, pub, priv); vapidSet = true; }
  return pub;
}

/* ── Subscriptions ────────────────────────────────────────────────────── */

const SUBS = "push-subs";
export interface StoredSub { sub: PushSubscription; by: string; at: number }
type Subs = Record<string, StoredSub>;          // keyed by endpoint

/* Writes one at a time, so two phones subscribing together both land. */
let chain: Promise<unknown> = Promise.resolve();
function update(fn: (s: Subs) => void): Promise<Subs> {
  const next = chain.then(async () => {
    const subs = await readJson<Subs>(siteDoc(), SUBS, {});
    fn(subs);
    await writeJson(siteDoc(), SUBS, subs);
    return subs;
  });
  chain = next.catch(() => undefined);
  return next;
}

export const addSub = (sub: PushSubscription, by: string) =>
  update((s) => { s[sub.endpoint] = { sub, by, at: Date.now() }; });
export const removeSub = (endpoint: string) => update((s) => { delete s[endpoint]; });

/* ── Sending ──────────────────────────────────────────────────────────── */

export interface PushMessage { title: string; body: string; tag: string; url: string; urgent: boolean }

/** To every subscribed device, or only `endpoint`. Gone subscriptions are dropped. */
export async function sendPush(msg: PushMessage, endpoint?: string): Promise<{ sent: number; failed: number }> {
  if (!pushPublicKey()) return { sent: 0, failed: 0 };
  const subs = await readJson<Subs>(siteDoc(), SUBS, {});
  const targets = Object.values(subs).filter((s) => !endpoint || s.sub.endpoint === endpoint);
  let sent = 0, failed = 0;
  const gone: string[] = [];
  await Promise.all(targets.map(async ({ sub }) => {
    try {
      /* Fifteen minutes to live: a repeat follows by then anyway. */
      await webpush.sendNotification(sub, JSON.stringify(msg), { TTL: 900, urgency: msg.urgent ? "high" : "normal" });
      sent++;
    } catch (e) {
      failed++;
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(sub.endpoint);
    }
  }));
  if (gone.length) await update((s) => { for (const g of gone) delete s[g]; });
  return { sent, failed };
}

/* ── The alarms ───────────────────────────────────────────────────────── */

function scopeStore(): AsyncLocalStorage<ServerScope> {
  const g = globalThis as { __centralScope?: AsyncLocalStorage<ServerScope> };
  return (g.__centralScope ??= new AsyncLocalStorage<ServerScope>());
}

/** The app's own server: the readers' relative URLs go through its proxy and history routes. */
const selfOrigin = () => `http://127.0.0.1:${process.env.PORT || 3000}`;

/** Active alarms nobody has acknowledged, highest priority first. */
export async function ringingAlarms(gatewayId: string, token: string): Promise<CentralAlarm[]> {
  const page = await scopeStore().run({ token, origin: selfOrigin() }, () =>
    fetchAlarms(gatewayId, { page: 1, size: 500 }));
  const acks = await readJson<Record<string, unknown>>(siteDoc(), "alarm-acks", {});
  return page.records.filter((a) => a.status === "active" && !findAck(acks, a));
}

export function alarmMessage(ringing: CentralAlarm[], fresh: number): PushMessage {
  const line = (a: CentralAlarm) => `${PRIORITY[a.priority].label} · ${a.device} — ${a.alertContent}`;
  const urgent = ringing.some((a) => a.priority <= 2);
  if (ringing.length === 1) {
    const a = ringing[0];
    return {
      title: `${fresh ? "New " : ""}${PRIORITY[a.priority].label} alarm · ${a.device}`,
      body: `${a.alertContent}\nStill active — acknowledge it on the Alarms page to stop these.`,
      tag: "ems-alarm", url: "/alarms", urgent,
    };
  }
  const more = ringing.length > 3 ? `\n+${ringing.length - 3} more` : "";
  return {
    title: `${ringing.length} active alarms${fresh ? ` · ${fresh} new` : ""}`,
    body: ringing.slice(0, 3).map(line).join("\n") + more,
    tag: "ems-alarm", url: "/alarms", urgent,
  };
}

/* ── The watcher ──────────────────────────────────────────────────────── */

const STATE = "push-state";
interface State { heard: string[]; lastSent: number }

/** One look at the alarms; sends when one is new or the 15 minutes are up. */
export async function watchOnce(gatewayId: string, token: string): Promise<{ ringing: number; sent: number }> {
  const ringing = await ringingAlarms(gatewayId, token);
  const state = await readJson<State>(siteDoc(), STATE, { heard: [], lastSent: 0 });
  const keys = ringing.map(ackKey);
  const heard = new Set(state.heard);
  const fresh = keys.filter((k) => !heard.has(k)).length;
  let sent = 0;
  const now = Date.now();
  if (ringing.length && (fresh || now - state.lastSent >= REPEAT_MS)) {
    sent = (await sendPush(alarmMessage(ringing, fresh))).sent;
    state.lastSent = now;
  }
  state.heard = keys;
  await writeJson(siteDoc(), STATE, state);
  return { ringing: ringing.length, sent };
}

/* One line per distinct problem per hour. */
const noted = new Map<string, number>();
function note(msg: string) {
  if (Date.now() - (noted.get(msg) ?? 0) < 60 * 60_000) return;
  noted.set(msg, Date.now());
  console.warn(`[push] ${msg}`);
}

export function startPushWatcher(serviceToken: () => Promise<string | null>): void {
  const g = globalThis as { __pushWatcher?: boolean };
  if (g.__pushWatcher) return;                    // dev reloads re-run register()
  g.__pushWatcher = true;

  const gw = process.env.CENTRAL_GATEWAY_ID?.trim() || process.env.NEXT_PUBLIC_CENTRAL_GATEWAY_ID?.trim() || "";
  if (!pushPublicKey() || !gw || !process.env.CENTRAL_COLLECTOR_EMAIL || !process.env.CENTRAL_COLLECTOR_PASSWORD) {
    console.info("[push] off — set WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT, CENTRAL_GATEWAY_ID and the collector account to send lock-screen alarm alerts");
    return;
  }
  console.info(`[push] on — gateway ${gw.slice(0, 8)}`);

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const token = await serviceToken();
      if (!token) { note("no service token"); return; }
      await watchOnce(gw, token);
    } catch (e) { note((e as Error).message); } finally { busy = false; }
  };
  setTimeout(tick, 20_000);                       // after the server is taking requests
  setInterval(tick, 60_000).unref?.();
}
