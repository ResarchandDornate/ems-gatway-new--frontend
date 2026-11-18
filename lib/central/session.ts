/**
 * The website's signed-in session, against the Ornate Central EMS Backend.
 *
 * Replaces lib/gateway/session.ts, which went dark with the rest of the
 * NorthBound integration on 24 September 2026. The component contract is
 * unchanged on purpose — getSession/subscribe/login/logout/revalidateSession,
 * plus ensureSite/activeSiteName — so AuthGate, LoginModal and TopBar only
 * change which module they import from.
 *
 * WHAT THE BACKEND GIVES US, and what it does not:
 *   POST /auth/login  → { access_token, token_type }   (HS256 JWT, 1 h)
 *   GET  /auth/me     → { id, username, email, roles }
 *   POST /auth/refresh → planned, 404 today
 *
 * There is no refresh endpoint yet, so an expired token means signing in again
 * rather than a silent renewal. When /auth/refresh lands, it belongs in
 * revalidateSession() and nowhere else.
 */

import { serverScope } from "./serverScope";

const KEY = "ems.central.session";

export interface Session {
  token: string;
  /** Expiry in epoch ms, read off the JWT rather than assumed from a TTL. */
  expiresAtMs: number;
  id: string;
  username: string;
  email: string;
  roles: string[];
}

export class LoginError extends Error {
  constructor(msg: string) { super(msg); this.name = "LoginError"; }
}

/* ── Store ────────────────────────────────────────────────────────────────── */

let cached: Session | null = null;
let loaded = false;
const listeners = new Set<() => void>();

const notify = () => { for (const fn of listeners) fn(); };

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/* Whether this tab has shown the demo account (role "demo", served by
   lib/server/central/demo.ts) or a real one. Readers cache in memory, and a
   switch between the two without a reload would carry one's rows under the
   other, so signing in to the other kind reloads the page. */
let tabKind: "demo" | "real" | null = null;

/* ── Browser storage belongs to one account ─────────────────────────────────

   The query cache (EMS_QUERY_CACHE, persisted 24 h by app/providers), the
   chosen station and device are all kept in localStorage, which outlives a
   sign-out. Without an owner on them, the next account to sign in in this
   browser rehydrated the last one's — on 21 Oct the admin opened the demo's
   gateway id and an empty dashboard, because the demo had been used here
   first. So the storage records whose it is, and a different account (or a
   session opened over someone else's storage) wipes it and reloads once. */
export const OWNER_KEY = "ems.cacheOwner";
/* The query cache is also keyed by owner (app/providers), so a save that lands
   during the reload can only ever write to its own account's slot. */
const ACCOUNT_STORAGE = ["EMS_QUERY_CACHE", "EMS_STATION_SEL", "EMS_DEVICE_SEL", "EMS_UNIT_SEL"];
/* Site data the readers keep for themselves. Display preferences (theme,
   alarm sound, line style) are the person's, not the account's, and stay. */
const SITE_DATA_PREFIXES = ["ems.alarmAcks", "ems.cellPointIds", "ems.todDay", "ems.lastCells"];
const isAccountKey = (k: string) =>
  ACCOUNT_STORAGE.some((p) => k === p || k.startsWith(`${p}:`)) || SITE_DATA_PREFIXES.some((p) => k.startsWith(p));
const ownerOf = (s: Session) => `${s.roles?.includes("demo") ? "demo" : "real"}:${s.id || s.email}`;

/** Clears another account's stored state; true when the page must reload to drop it from memory too. */
function claimStorage(s: Session): boolean {
  try {
    const owner = window.localStorage.getItem(OWNER_KEY);
    if (owner === ownerOf(s)) return false;
    const keys = Array.from({ length: window.localStorage.length }, (_, i) => window.localStorage.key(i) ?? "").filter(isAccountKey);
    const hadState = keys.length > 0;
    for (const k of keys) window.localStorage.removeItem(k);
    window.localStorage.setItem(OWNER_KEY, ownerOf(s));
    return hadState;
  } catch {
    return false;          // storage blocked: nothing was persisted to leak
  }
}

function read(): Session | null {
  if (typeof window === "undefined") return null;
  if (!loaded) {
    try {
      const raw = window.localStorage.getItem(KEY);
      cached = raw ? (JSON.parse(raw) as Session) : null;
      if (cached) tabKind = cached.roles?.includes("demo") ? "demo" : "real";
    } catch { cached = null; }
    loaded = true;
    /* Opened over another account's storage: clear it before anything reads it. */
    if (cached && claimStorage(cached)) { window.location.reload(); return null; }
  }
  return cached;
}

function write(s: Session | null, { deferNotify = false } = {}) {
  const kind = s ? (s.roles.includes("demo") ? "demo" : "real") : null;
  /* A different account than the stored state belongs to: wipe it, and reload
     if anything had been kept (claimStorage). */
  const switched = (kind && tabKind && kind !== tabKind) || (s != null && typeof window !== "undefined" && claimStorage(s));
  if (kind) tabKind = kind;
  cached = s;
  loaded = true;
  try {
    if (s) window.localStorage.setItem(KEY, JSON.stringify(s));
    else window.localStorage.removeItem(KEY);
  } catch { /* private mode, blocked storage — the session stays in memory */ }
  if (switched && typeof window !== "undefined") { window.location.reload(); return; }
  if (deferNotify) queueMicrotask(notify);
  else notify();
}

/**
 * The session, or null once it has expired.
 *
 * Expiry is checked on every read rather than on a timer: a laptop that slept
 * through the hour wakes with a token the backend will refuse, and a gate that
 * trusted a stale flag would render the app around it.
 *
 * The session is cleared at once, but listeners are told on a microtask.
 * getSession is called during render (useLastApiSync, via SubHeader), and
 * notifying synchronously there made AuthGate set state while SubHeader was
 * rendering — React's "Cannot update a component while rendering a different
 * component". Every later read already sees null, so nothing can act on the
 * expired token in between.
 */
export function getSession(): Session | null {
  /* On the server, only inside the push watcher's scope (serverScope.ts). */
  const scoped = serverScope();
  if (scoped) return { token: scoped.token, expiresAtMs: Infinity, id: "server", username: "server", email: "", roles: [] };
  const s = read();
  if (!s) return null;
  if (Date.now() >= s.expiresAtMs) { write(null, { deferNotify: true }); return null; }
  return s;
}

/* ── Sign in ──────────────────────────────────────────────────────────────── */

/** Expiry off the JWT itself; falls back to one hour if the claim is absent. */
function expiryOf(token: string): number {
  try {
    const p = token.split(".")[1];
    const json = JSON.parse(
      atob(p.replace(/-/g, "+").replace(/_/g, "/").padEnd(p.length + ((4 - (p.length % 4)) % 4), "=")),
    ) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : Date.now() + 3_600_000;
  } catch {
    return Date.now() + 3_600_000;
  }
}

/** The backend's two error shapes, reduced to one message. */
async function messageOf(r: Response, fallback: string): Promise<string> {
  try {
    const b = (await r.json()) as { detail?: unknown };
    const d = b.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      const first = d[0] as { msg?: string } | undefined;
      if (first?.msg) return first.msg;
    }
  } catch { /* not JSON */ }
  return fallback;
}

export async function login(email: string, password: string): Promise<Session> {
  const r = await fetch("/api/central/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!r.ok) {
    throw new LoginError(
      await messageOf(r, r.status === 401 ? "Invalid email or password" : `Sign-in failed (${r.status})`),
    );
  }

  const { access_token: token } = (await r.json()) as { access_token?: string };
  if (!token) throw new LoginError("Sign-in succeeded but returned no token");

  /* Identity comes from /auth/me rather than the JWT: the token carries only a
     subject id, and the shell shows a username and gates on roles. */
  const me = await fetch("/api/central/auth/me", {
    headers: { authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!me.ok) throw new LoginError(await messageOf(me, "Signed in, but the account could not be read"));

  const u = (await me.json()) as { id?: string; username?: string; email?: string; roles?: string[] };
  const s: Session = {
    token,
    expiresAtMs: expiryOf(token),
    id: u.id ?? "",
    username: u.username ?? email,
    email: u.email ?? email,
    roles: u.roles ?? [],
  };
  write(s);
  return s;
}

export function logout(): void { write(null); }

/**
 * Confirm the stored token is still good, and refresh the identity on it.
 *
 * Called at boot. A 401 purges rather than retries — the token is either
 * expired or was issued by a backend that has since been restarted, and both
 * mean signing in again.
 */
export async function revalidateSession(): Promise<void> {
  const s = getSession();
  if (!s) return;
  let r: Response;
  try {
    r = await fetch("/api/central/auth/me", {
      headers: { authorization: `Bearer ${s.token}` },
      cache: "no-store",
    });
  } catch {
    /* Offline or the backend is unreachable. The token has not been refused,
       so it is kept — purging here would sign people out on a flaky network. */
    return;
  }
  if (r.status === 401) { write(null); return; }
  if (!r.ok) return;
  const u = (await r.json()) as { id?: string; username?: string; email?: string; roles?: string[] };
  write({ ...s, id: u.id ?? s.id, username: u.username ?? s.username, email: u.email ?? s.email, roles: u.roles ?? s.roles });
}

/* ── Heartbeat ────────────────────────────────────────────────────────────── */

/**
 * One round trip to the backend, for the header's connection indicator.
 *
 * THROWS on anything other than a good reply, which is the point: the badge
 * reports when a request last *succeeded*, so a heartbeat that resolved on
 * failure would report a link that is not there. That is the exact bug this
 * replaced — the disabled gateway stubs resolve empty, React Query counted
 * that as a success, and the header claimed "Synced" against no backend at
 * all. See hooks/useLastApiSync.ts.
 *
 * /auth/me rather than /health because the dashboard only renders behind
 * AuthGate: there is always a session when the badge is visible, and using the
 * authenticated route means the poll doubles as the session check that
 * otherwise only ran at boot. A 401 purges, which signs the shell out the
 * moment the token stops being accepted rather than at the next reload.
 */
export async function heartbeat(): Promise<true> {
  const s = getSession();
  if (!s) throw new Error("No session");

  const r = await fetch("/api/central/auth/me", {
    headers: { authorization: `Bearer ${s.token}` },
    cache: "no-store",
  });

  if (r.status === 401) { write(null); throw new Error("Session expired"); }
  if (!r.ok) throw new Error(`Central backend answered ${r.status}`);
  return true;
}

/* ── Site ─────────────────────────────────────────────────────────────────── */

/**
 * The central backend has no site registry yet — GET /sites and GET /gateways
 * are on the roadmap and 404 today (docs/central-backend-s1-contract.md §7).
 * AuthGate blocks on ensureSite(), so it resolves immediately rather than
 * holding the shell behind an endpoint that does not exist.
 */
export const SITE_NAME = "UnityESS Central EMS";
export async function ensureSite(): Promise<string> { return SITE_NAME; }
export function siteReady(): boolean { return true; }
export function activeSiteName(): string { return SITE_NAME; }
