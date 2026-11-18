/**
 * Alarm acknowledgements, shared through this app's own server.
 *
 * The central backend has no acknowledge endpoint, so app/api/alarm-acks
 * keeps them for everyone on the site: who acknowledged, and when. This
 * module is the browser's side of it — a local copy that is read at once,
 * synced from the server every 30 s, and written to the server on change.
 *
 * If the server cannot be reached the acknowledgement still holds on this
 * device (`local`), and is sent again on the next sync, so a dropped request
 * never silently un-acknowledges an alarm.
 *
 * Keyed by cabinet, signal and raise time, so the same flag raised again
 * later is a new, unacknowledged alarm. Not by the row id: one alarm reaches
 * the list either as its S2 flag or, when that flag is missing from the
 * newest rows read, as the bare S4 log event — two ids for the same alarm.
 * Keyed by id, an acknowledgement fell off whenever the alarm switched form,
 * and the siren sounded again for an alarm already acknowledged.
 */

import { getSession } from "@/lib/central";

const KEY = "ems.alarmAcks.v2";
export interface Ack { at: number; by?: string; /** Not yet on the server. */ local?: boolean }
type Acks = Record<string, Ack>;

const listeners = new Set<() => void>();
let cache: Acks | null = null;

function read(): Acks {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Acks;
    /* The browser-only store this replaced: carried over, to be sent up. */
    const old = JSON.parse(localStorage.getItem("ems.alarmAcks") ?? "{}") as Record<string, number>;
    for (const [k, at] of Object.entries(old)) if (!cache![k]) cache![k] = { at, local: true };
    localStorage.removeItem("ems.alarmAcks");
  } catch { cache = {}; }
  return cache!;
}
function write(next: Acks) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: memory only */ }
  listeners.forEach((l) => l());
}

export interface AlarmRef { id: string; raisedAt?: string; device?: string; signal?: string }

/** `external_ems_2_dehumidifier` → `external_ems_2`: the cabinet both S2 and S4 name. */
const cabinetOf = (device: string) => /^(external_ems_\d+)/.exec(device)?.[1] ?? device;

/* Cabinet + signal + raise time is the same for an alarm's S2 and S4 forms —
   the pairing alarmsCentral already uses to give a flag its raise time.
   Without a raise time there is nothing to tell two assets' same-named
   signals apart, so the row id stays the key. */
export const ackKey = (a: AlarmRef) =>
  a.raisedAt && a.device && a.signal
    ? `${cabinetOf(a.device)}|${a.signal}@${a.raisedAt}`
    : `${a.id}@${a.raisedAt ?? ""}`;

/** The id-based key acknowledgements were stored under before. */
const legacyKey = (a: AlarmRef) => `${a.id}@${a.raisedAt ?? ""}`;

/** Every key an acknowledgement of this alarm may be stored under. */
export const ackKeys = (a: AlarmRef) => [...new Set([ackKey(a), legacyKey(a)])];

/** This alarm's acknowledgement in a set of them — the server's or this device's. */
export function findAck<T>(acks: Record<string, T>, a: AlarmRef): T | null {
  for (const k of ackKeys(a)) if (acks[k]) return acks[k];
  return null;
}

export function ackOf(a: AlarmRef): Ack | null {
  if (typeof window === "undefined") return null;
  return findAck(read(), a);
}
export const ackedAt = (a: AlarmRef): number | null => ackOf(a)?.at ?? null;

async function post(key: string, ack: boolean): Promise<Acks | null> {
  const s = getSession();
  if (!s) return null;
  try {
    const r = await fetch("/api/alarm-acks", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${s.token}` },
      body: JSON.stringify({ key, ack }), cache: "no-store",
    });
    if (!r.ok) return null;
    return ((await r.json()) as { acks: Acks }).acks;
  } catch { return null; }
}

/** Removed here but not yet on the server — sent on the next sync. */
const pendingRemove = new Set<string>();

export function acknowledge(a: AlarmRef, on = true) {
  const k = ackKey(a);
  const next = { ...read() };
  if (on) {
    next[k] = { at: Date.now(), by: getSession()?.username, local: true }; pendingRemove.delete(k);
    void post(k, true).then((server) => { if (server) merge(server); });
  } else {
    /* Undo removes it under every key it may be stored by, the old one included. */
    for (const key of ackKeys(a)) {
      if (!next[key] && key !== k) continue;
      delete next[key]; pendingRemove.add(key);
      void post(key, false).then((server) => {
        if (!server) return;
        pendingRemove.delete(key);
        merge(server);
      });
    }
  }
  write(next);
}

/** The server's set, plus anything this device holds that has not reached it. */
function merge(server: Acks) {
  const cur = read();
  const next: Acks = { ...server };
  for (const [k, v] of Object.entries(cur)) if (v.local && !next[k]) next[k] = v;
  for (const k of pendingRemove) delete next[k];
  write(next);
}

let syncing = false;
export async function syncAcks(): Promise<void> {
  const s = getSession();
  if (!s || syncing) return;
  syncing = true;
  try {
    /* Push what never landed first, then read the shared set. */
    for (const [k, v] of Object.entries(read())) if (v.local) await post(k, true);
    for (const k of [...pendingRemove]) if (await post(k, false)) pendingRemove.delete(k);
    const r = await fetch("/api/alarm-acks", { headers: { authorization: `Bearer ${s.token}` }, cache: "no-store" });
    if (r.ok) {
      const server = ((await r.json()) as { acks: Acks }).acks;
      const cur = read();
      for (const k of Object.keys(cur)) if (cur[k].local && server[k]) delete cur[k].local;
      merge(server);
    }
  } catch { /* offline: the local copy stands */ } finally { syncing = false; }
}

/** Forget acknowledgements for alarms no longer raised (this device's copy only). */
export function pruneAcks(activeKeys: string[]) {
  const keep = new Set(activeKeys);
  const cur = read();
  const next = Object.fromEntries(Object.entries(cur).filter(([k]) => keep.has(k)));
  if (Object.keys(next).length !== Object.keys(cur).length) write(next);
}

let timer: ReturnType<typeof setInterval> | null = null;
export function subscribeAcks(l: () => void): () => void {
  listeners.add(l);
  if (!timer && typeof window !== "undefined") {
    void syncAcks();
    timer = setInterval(() => void syncAcks(), 30_000);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) { clearInterval(timer); timer = null; }
  };
}
/** A value that changes whenever the set does — for useSyncExternalStore. */
export const acksVersion = () => (typeof window === "undefined" ? "" : JSON.stringify(read()));
