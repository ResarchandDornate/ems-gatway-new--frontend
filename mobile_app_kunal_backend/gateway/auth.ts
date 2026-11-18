"use client";

/**
 * The signed-in session, held on the client.
 *
 * The proxy no longer holds a gateway account — each person signs in with their
 * own, and this is where that token lives. The gateway decides what the token
 * can see, which is the only place that decision can honestly be made.
 *
 * Exposed as an external store rather than a context so that the fetch layer,
 * which is not a component, can read the token without a provider above it.
 */

import { apiBase, appToken, SITE_HEADER } from "./config";

/* ── One session per site ──────────────────────────────────────────────────
   Each gateway issues its own accounts and validates its own tokens: there is
   no authority above them that could make one token mean anything at another.
   So a session is per site, stored under its own key, and switching site does
   not sign you out of the one you left.

   The alternative — one session, re-used across gateways — would have to
   either hide that a second sign-in is needed or present site B's login as
   though the app had been signed out entirely. Both lie about where the
   boundary is, and the boundary is real. */
const KEY_PREFIX = "unityess.gw.session.";
const keyFor = (siteId: string) => `${KEY_PREFIX}${siteId}`;

/* The single-session key used before sites existed. Not migrated onto a site:
   a token is only meaningful to the gateway that minted it, and guessing which
   site that was would attach a credential to a plant it was never issued for.
   It is removed instead, so one re-login upgrades cleanly. */
const LEGACY_KEY = "unityess.gw.session";

/** Which site the token requests are currently being made for. */
let activeSite = "";

export interface Session {
  token: string;
  /** Absolute expiry, ms since epoch. */
  expiresAt: number;
  username: string;
}

/**
 * Where the session is kept.
 *
 * On a packaged build, localStorage lives inside the app's own private data
 * directory — unreadable by other apps without root — and surviving a relaunch
 * is what stops the app asking for a password every time it is opened.
 *
 * In a browser it goes to sessionStorage instead, so a session cannot outlive
 * the tab on a shared or public machine. The trade is deliberate: persistence
 * where the sandbox is the app, and none where it is not.
 */
const isPackaged = () =>
  typeof window !== "undefined" &&
  (window.location.protocol === "capacitor:" || window.location.hostname === "localhost") &&
  typeof (globalThis as Record<string, unknown>).__GW_API_BASE__ === "string" &&
  ((globalThis as Record<string, unknown>).__GW_API_BASE__ as string).length > 0;

function store(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return isPackaged() ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // private mode
  }
}

/* ── Store ────────────────────────────────────────────────────────────────── */

type Listener = () => void;
const listeners = new Set<Listener>();
let current: Session | null = null;
let loaded = false;

function read(siteId: string): Session | null {
  const s = store();
  if (!s || !siteId) return null;
  try {
    s.removeItem(LEGACY_KEY);
    const raw = s.getItem(keyFor(siteId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    /* An expired token is not a session. Dropping it here rather than waiting
       for a 401 means the login screen appears at launch instead of after the
       first failed request. */
    if (!parsed?.token || parsed.expiresAt <= Date.now()) {
      s.removeItem(keyFor(siteId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function write(next: Session | null) {
  const s = store();
  try {
    if (!activeSite) return;
    if (next) s?.setItem(keyFor(activeSite), JSON.stringify(next));
    else s?.removeItem(keyFor(activeSite));
  } catch {
    /* private mode — the session simply does not survive a reload */
  }
  current = next;
  listeners.forEach((l) => l());
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The site every token read and write below is scoped to. */
export function activeSiteId(): string {
  return activeSite;
}

/**
 * Point the session store at a different site.
 *
 * The snapshot is swapped synchronously so getSession() is correct the instant
 * this returns, and subscribers are notified off the render path — this can be
 * called from a lazy state initialiser, where notifying synchronously is not
 * allowed. Same reason, and same shape, as the expiry purge below.
 */
export function setActiveSite(siteId: string): void {
  if (siteId === activeSite) return;
  activeSite = siteId;
  current = read(siteId);
  loaded = true;
  queueMicrotask(() => listeners.forEach((l) => l()));
}

export function getSession(): Session | null {
  /* No site chosen yet means no session to speak of. The shell does not render
     the gate until the registry has resolved, so this is the brief window
     before that and not a signed-out state. */
  if (!activeSite) return null;

  if (!loaded) {
    current = read(activeSite);
    loaded = true;
  }

  /* Expiry is re-checked on every read, not only on the first one.
   *
   * `loaded` made this a once-per-process test, and a mobile app is not a page
   * load: iOS and Android suspend rather than terminate, so a process can live
   * for days. A session that expired overnight therefore stayed in memory and
   * was handed out as valid for as long as the app stayed open — observed at
   * 21 hours after sign-in, with every request going out carrying a dead token
   * and the screen stuck on "Can't reach the site, showing the last reading
   * from 13h ago". There was no route back to sign-in short of force-quitting,
   * because the only thing that clears a stale session is a 401 and these
   * requests were not getting far enough to receive one.
   *
   * The check is a timestamp comparison against a value already in memory, so
   * running it per read costs nothing worth measuring. */
  if (current && current.expiresAt <= Date.now()) {
    current = null;
    /* Purged off the render path. This function is the getSnapshot for
       useSyncExternalStore and is called *during* render, where notifying
       subscribers synchronously is not allowed. `current` is already null by
       then, so the snapshot React reads stays stable either way. */
    queueMicrotask(() => write(null));
  }

  return current;
}

/**
 * Re-read the session from storage, dropping it if it has expired.
 *
 * Called when the app returns to the foreground. A suspended app runs no
 * timers and makes no requests, so it can be resumed hours after its token
 * died with nothing having noticed; this makes the first thing it does on
 * waking be finding that out, rather than issuing a round of doomed requests
 * and reporting them as a connectivity problem.
 */
export function revalidateSession(): void {
  const next = read(activeSite);
  if ((next?.token ?? null) !== (current?.token ?? null)) write(next);
}

/** The bearer token, or "" when signed out. Read by client.ts on every call. */
export function bearerToken(): string {
  return getSession()?.token ?? "";
}

/* ── Actions ──────────────────────────────────────────────────────────────── */

export class LoginError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Sign in against the gateway, through the proxy.
 *
 * Goes through /api/gw rather than straight to the gateway for the same reason
 * every other call does: the gateway is behind a tunnel with no reason to allow
 * a browser origin, and its host is not something the client should know.
 */
export async function login(username: string, password: string): Promise<Session> {
  const tok = appToken();
  const r = await fetch(`${apiBase()}/api/gw/auth/login`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(tok ? { "x-gw-app-token": tok } : {}),
      /* Which gateway is being signed in to. Without it the proxy would forward
         every sign-in to the default site, and the token minted there would be
         stored against whichever site the picker happened to be showing. */
      ...(activeSite ? { [SITE_HEADER]: activeSite } : {}),
    },
    body: JSON.stringify({ username, password }),
  });

  const body = (await r.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in_sec?: number;
    detail?: string;
    error?: string;
  };

  if (!r.ok || !body.access_token) throw new LoginError(r.status, loginMessage(r.status, body));

  /* Expire the session slightly early. A token that dies mid-request produces
     a failed screen; one that is treated as dead a minute early produces a
     login prompt, which is the better of the two. */
  const lifetimeMs = (body.expires_in_sec ?? 28800) * 1000;
  const session: Session = {
    token: body.access_token,
    expiresAt: Date.now() + lifetimeMs - 60_000,
    username,
  };
  write(session);
  return session;
}

/**
 * What to tell someone whose sign-in did not work.
 *
 * The distinction that matters is whether it is their fault. A wrong password
 * and an unreachable plant are the same red box otherwise, and an operator who
 * reads "gateway 530" retypes their password half a dozen times before anyone
 * thinks to check whether the site is actually online.
 *
 * The gateway's own `detail` is only surfaced for the statuses where it says
 * something about the account. On an infrastructure failure it carries text
 * like "gateway 530", written for whoever wrote this proxy, and it is replaced.
 */
function loginMessage(status: number, body: { detail?: string; error?: string }): string {
  /* A build with no GW_BASE_URL and a plant that has stopped answering both
     arrive here as 503, and they are not the same event: one is a missing line
     in .env.local, the other is someone driving to site. The proxy already
     distinguishes them in its error code; only this function was throwing that
     away. */
  if (body.error === "no_gateway") {
    return "This build has no gateway address configured (GW_BASE_URL). It is not a fault at the site.";
  }
  if (status === 401) return "That username or password was not accepted.";
  if (status === 403) return body.detail ?? "That account is not permitted to sign in here.";
  if (status === 429) return "Too many attempts. Wait a moment and try again.";
  /* 502 tunnel up but the board is not answering, 503 storage or service
     unavailable, 530 tunnel down entirely — all of them mean the site, not the
     person standing in front of the phone. */
  if (status === 502 || status === 503 || status === 530 || status === 504) {
    return "The site is not responding. This is the gateway, not your password — try again shortly.";
  }
  /* Status included deliberately. These are the codes nobody can act on
     without it — 521 and 522 mean Cloudflare cannot reach the origin, 500 means
     the proxy itself broke — and they are indistinguishable on screen
     otherwise. */
  if (status === 0) return "Could not reach the site. Check the connection and try again.";
  if (status >= 500) return `Could not reach the site (${status}). Check the connection and try again.`;
  return body.detail ?? body.error ?? `Sign-in failed (${status}).`;
}

export function logout(): void {
  write(null);
}

/**
 * Called by the fetch layer when the gateway rejects a token it previously
 * accepted — revoked, or expired earlier than advertised. Clearing it here is
 * what makes the login screen appear rather than every panel showing an error.
 */
export function onUnauthorized(): void {
  if (getSession()) write(null);
}
