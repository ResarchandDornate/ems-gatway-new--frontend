/**
 * Server-side proxy to the NorthBound EMS Gateway.
 *
 * Everything the mobile app reads goes through here, for three reasons the
 * gateway's own API Reference insists on (§2, §11):
 *
 *   1. Credentials are never stored here. Each caller signs in to the gateway
 *      with their own account and this proxy forwards their bearer token
 *      unchanged. It holds no login of its own, so it cannot be induced to
 *      read a plant the caller is not entitled to — the gateway decides that,
 *      which is the only place that can.
 *   2. CORS stops being a problem. The gateway is a field device behind a
 *      tunnel; it has no reason to allow a browser origin.
 *   3. Writes can be refused centrally. Control endpoints are internal_admin
 *      and "never public customer UI" (§11), so this proxy rejects every
 *      non-GET path unless GW_ALLOW_WRITES is explicitly set.
 *
 * The Next route file at app/api/gw/[...path]/route.ts is a three-line
 * re-export of this module. A route has to live under app/ for Next to mount
 * it; the logic does not, and it belongs with the app it serves.
 *
 * A site with no gateway address is refused, not substituted for. The proxy
 * used to fall back to a bundled recording of the plant so the screens could be
 * reviewed without a tunnel; that fixture has been removed, along with every
 * path that served it. Nothing in this app now answers a telemetry request with
 * data that did not come from a gateway on this request.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveSite, SITE_HEADER, type Site } from "./sites";
import { isDemoSite, serveDemo } from "./demo";
import { beginUserWait } from "./pressure";

/* The gateway address is no longer a module constant: it depends on which
   site the request is for, and this deployment may hold several. See
   sites.ts. With a single GW_BASE_URL the registry holds exactly one site
   and every path below behaves exactly as it did before it existed. */
/* Control endpoints are internal_admin and §11 classifies them "never public
   customer UI". Refused here rather than merely hidden in the client, because a
   control disabled in the UI is a control a modified client can still press. */
const ALLOW_WRITES = process.env.GW_ALLOW_WRITES === "true";

/* ── Which writes the flag actually opens ──────────────────────────────────
   GW_ALLOW_WRITES used to open every non-GET method on every path. That is a
   wider door than dispatch needs: the same flag would have permitted
   storage/cleanup, storage/vacuum, logs/test and server-upload/upload-once —
   endpoints that delete history, rewrite the database and inject log rows, and
   that nobody turning on a control panel is asking for.

   The dispatch set is enumerated instead, from the API Inventory of 10 Aug
   2026. A path not on this list stays refused whatever the flag says, so
   turning on control cannot turn on maintenance by accident.

   Anchored with ^...$ deliberately: a prefix match on "control/" would also
   accept anything the gateway adds under that namespace later, which is
   precisely the sort of silent widening this list exists to prevent. */
const CONTROL_WRITES: RegExp[] = [
  /^control\/sources\/[^/]+\/(charge|discharge|standby|grid-mode)$/,
  /^control\/site\/(power|standby|grid-mode)$/,
  /^control\/soc-protection\/(runtime|solar|evaluate-once)$/,
  /^commands\/ems\/(write|batch)$/,
  /^config\/runtime$/,
];

const isControlWrite = (suffix: string) => CONTROL_WRITES.some((re) => re.test(suffix));

/** A write this build will forward, if the deployment has opted in. */
const writeAllowed = (suffix: string) => ALLOW_WRITES && isControlWrite(suffix);

/* No GW_USERNAME or GW_PASSWORD. This proxy deliberately holds no gateway
   account: it forwards whatever bearer token the caller presents. A server-side
   login here would make every user of this route indistinguishable from every
   other, which is exactly the confused deputy the pass-through avoids. */

/* ── The ceiling above all of them ─────────────────────────────────────────
   Every budget below is spent inside somebody else's, and for a long time none
   of them knew it.

   ems.unityess.cloud is served through Cloudflare, whose origin timeout is
   100 s on every plan below Enterprise. When it expires, Cloudflare abandons
   the connection to this app and synthesises its own 520/524 — *at the edge*,
   which means nothing in this file runs on it and none of the CORS headers
   handle() attaches are on it. To a packaged build calling from
   capacitor://localhost that is a cross-origin response with no
   Access-Control-Allow-Origin, so the WebView refuses to hand it to the page
   and fetch() throws. The app never learns the status, so every distinction
   drawn in the login screen's error mapping — 502 the board is busy, 503
   storage is down, 530 the tunnel is gone — is unreachable, and the user gets
   the one message that says nothing: "Could not reach the gateway."

   Measured against the live deployment on 7 September 2026, with the board not
   answering: GET /k returned 200 in 1.0 s and /api/sites in 5.7 s, so this app
   was healthy, while /api/gw/health took 125 s to return a Cloudflare 524
   carrying `server: cloudflare` and no access-control header of any kind.
   That is the whole bug, and it was in the arithmetic: 45 s x 3 attempts, 55 s
   x 2 and 180 s x 2 are all budgets larger than the 100 s we are given to
   spend them in. The innermost limit was the largest, so it never applied.

   Hence a wall-clock deadline that all three sit under, enforced across
   attempts rather than per attempt. The per-request budgets below stay as they
   are — they encode real measurements of this board and are the right shape —
   but no combination of them can now overrun the edge, which is the property
   that actually has to hold.

   80 s, not 100. The remaining 20 s pays for everything either side of the
   gateway call: reading the request, a cold start (5.7 s, observed above),
   parsing and aggregating the response, and the trip back out. A deadline that
   equalled the ceiling would lose the race it exists to win. */
const EDGE_BUDGET_MS = 80_000;

/* Below this, do not start another attempt against the board.

   The floor is not tuning, it is what guarantees an answer gets out. An
   attempt begun with 3 s left cannot finish and cannot be reported: it eats
   the remainder of the budget and hands the request back to Cloudflare, which
   is the failure this whole section exists to stop. 10 s because the board's
   cheapest measured reply is 2.5-6.7 s and its worst fixed cost 13.7-20.0 s,
   so under ten seconds an attempt is unlikely to land and the time is better
   spent returning a true error while the edge is still listening. */
const MIN_ATTEMPT_MS = 10_000;

/* The deadline for the request currently being served, shared by every gateway
   call made under it.

   Request-scoped rather than call-scoped, because one inbound request is not
   always one gateway call: /api/gw/history-series walks up to PAGES_PER_CHUNK
   pages through gatewayRead, and a per-call cap would let a single request
   spend 80 s per page and sail past the edge anyway. AsyncLocalStorage is what
   lets fetchGateway — several layers down, with no argument threaded to it —
   read the budget the request opened.

   `null` in the store means a caller that is deliberately not behind the edge;
   see withoutEdgeDeadline. Absent from the store entirely means a caller that
   was never wrapped, which gets a fresh budget of its own: the safe default,
   and the one that keeps a route nobody remembered to wrap no worse than it is
   today. */
const deadlineStore = new AsyncLocalStorage<number | null>();

/**
 * Serve `fn` under one shared budget for every gateway call it makes.
 *
 * Wrap anything with an HTTP client waiting on the far side of Cloudflare.
 */
export function withEdgeDeadline<T>(fn: () => Promise<T>): Promise<T> {
  return deadlineStore.run(Date.now() + EDGE_BUDGET_MS, fn);
}

/**
 * Run `fn` with no deadline at all.
 *
 * For the backfill walker, and only for it. It talks to the gateway from
 * server code on its own schedule, with no browser waiting and no Cloudflare
 * between — the ceiling above simply is not over it, and capping it would
 * shorten its logins to fit a limit it never meets. Nothing a user waits on
 * may use this.
 */
export function withoutEdgeDeadline<T>(fn: () => Promise<T>): Promise<T> {
  return deadlineStore.run(null, fn);
}

/** Thrown when the shared budget ran out before an attempt could be made.
    Named TimeoutError because from the caller's side that is precisely what
    happened, and it lets unreachableReason describe it without a second
    branch. */
class BudgetExhausted extends Error {
  constructor() {
    super("the request budget was spent before the gateway answered");
    this.name = "TimeoutError";
  }
}

/* ── Retry ────────────────────────────────────────────────────────────────
   The gateway is a field board behind a Cloudflare tunnel serving 2844
   signals; its own integration guide is explicit that 502 and timeout are
   transient ("retry with backoff, don't treat a single failure as offline")
   and that only a 530 means the tunnel is actually down. Measured here, a
   bare single-shot fetch failed roughly two requests in three. Only GETs are
   retried — a write must never be replayed, and writes are refused above. */
/* 45 s, and it is sized against the tunnel rather than against the work.
   
   The board's *fixed* cost per request — measured by timing a bare 401, which
   touches no database and returns four words — has been 2.5-6.7 s and was
   observed at 13.7-20.0 s. That is the floor under every call here, including
   auth/login, and at a 25 s budget a login was timing out during a bad spell:
   three attempts, all abandoned, and an app that cannot sign in against a
   gateway that is merely slow rather than down.
   
   The cost of the larger budget is that a genuinely dead gateway takes longer
   to report as dead. That is the better failure: a slow sign-in is recoverable
   by waiting, and a spurious one sends somebody to site. 530 (tunnel down)
   still returns immediately and is unaffected by this. */
const GW_TIMEOUT_MS = 45_000;
const GW_ATTEMPTS = 3;
/* 500 joins the transient set. The gateway's own guide names 502, 503 and 530
   as retryable, but a field board under load also returns a bare 500 on login,
   and a single one of those is what put "could not reach the site (500)" in
   front of a user while every server-side check passed. Retrying a read costs
   one request; not retrying costs a sign-in. */
const RETRYABLE = new Set([500, 502, 503, 530]);

/* ── History is a different animal ─────────────────────────────────────────
   One budget cannot serve both shapes of request. /fast-bess/latest answers in
   well under a second; /fast-bess/history reads thousands of rows out of
   SQLite on a field board and was measured here at 16.3 s, 24.7 s and one
   timeout, all within a minute of each other, for windows of the same size.
   Latency is 20-25 s and variable, which put every history page on a coin flip
   against the shared 25 s timeout — the screen shimmered forever and the
   gateway looked broken when it was merely slow.

   Fewer attempts, not more. Three tries at 55 s is nearly three minutes of a
   user staring at a skeleton, and a request this slow fails because the board
   is loaded, which a third attempt makes worse rather than better. Two tries
   at 55 s covers the measured spread with better than 2x headroom. */
const HISTORY_TIMEOUT_MS = 55_000;
const HISTORY_ATTEMPTS = 2;

/* ── Sign-in is a third shape again ────────────────────────────────────────
   Three kinds of request, three cost profiles. A cached snapshot is the tunnel
   plus a dictionary lookup; history is the tunnel plus thousands of SQLite
   rows; and auth/login is the tunnel plus whatever the board does to hash a
   password, which on this hardware is the most expensive thing it is ever
   asked to do.

   Measured, back to back: a bare 401 on /api/health returned in 10.9 s and
   POST /api/auth/login returned 200 in 109.2 s. It *succeeded* — it was simply
   slower than any budget here, so all three attempts were abandoned and the
   app reported a gateway that had answered correctly as unreachable. Nobody
   could sign in, and the backfill could not start.

   That measurement stands. The 180 s budget written against it did not, and
   this is the correction: a 109 s sign-in cannot be bought through a 100 s
   edge timeout at any price, so the old value did not lengthen a single
   successful login. All it bought was the *shape* of the failure — instead of
   this proxy answering "the site is not responding, this is the gateway, not
   your password", Cloudflare answered with a header-less 524 the app could not
   even read a status off. Raising this number again will not help; it is
   already above a ceiling it does not control. Fixing the 109 s login means
   raising the ceiling (Enterprise, or take /api/gw off the orange cloud) or
   not making sign-in one long request. See EDGE_BUDGET_MS.

   80 s is therefore "as long as there is", and two attempts still earn their
   place: the deadline clamps the second one to whatever is left, so a retry
   happens exactly when the first attempt failed *fast* — a transient 500 from
   the board, a refused connection — which is the case where retrying was ever
   going to work. A wrong password still comes back as a quick 401, because the
   board rejects it before doing the hashing. */
const AUTH_TIMEOUT_MS = 80_000;
const AUTH_ATTEMPTS = 2;

const isHistory = (url: string) => url.includes("/fast-bess/history");
const isAuth = (url: string) => url.includes("/api/auth/login");

/* ── Asking the board once ─────────────────────────────────────────────────
   Two mechanisms, and they are not the same trade.

   COALESCING is free. When two callers want the same thing from the same
   gateway at the same moment, one request is made and both are given its
   answer. Nobody receives anything older than a request they could have issued
   themselves, so there is no staleness to reason about — it is the same reply,
   handed to two people. Every GET gets this.

   REUSE is not free, and it is therefore narrow. Holding a reply and serving
   it again means someone is shown a fact the board has had time to change, and
   almost everything this proxy carries is exactly the kind of fact that must
   not be held: /telemetry and /fast-bess/latest ARE the readings, and
   /sources/summary carries `online` and `last_seen_utc`, which is the evidence
   behind "the gateway reports this unit offline". Caching that would produce a
   confident stale claim about a plant — the failure this app has spent its
   whole history refusing.

   So reuse is an allowlist of one. See reuseMs.

   Both are keyed on the caller's token as well as the site. The proxy holds no
   account and must never let one customer's answer reach another; the token is
   what the gateway makes its entitlement decision with, so it is what the key
   has to include. Hashed, so a bearer token is not sitting in a map key.

   Bounded in scope, deliberately: this is per-process memory, not a shared
   cache. Two instances answer independently, which is correct — a cache that
   outlived the process would need invalidation nobody has designed. */

interface Held {
  at: number;
  status: number;
  body: string;
}

const inFlight = new Map<string, Promise<{ status: number; body: string }>>();
const held = new Map<string, Held>();

/** Cap on stored replies, after which expired entries are swept. Tokens rotate
    every eight hours and each mints new keys, so without this the map grows
    for the life of the process. */
const HELD_MAX = 200;

/**
 * How long a reply to this path may be served again. 0 means coalesce only.
 *
 * `logger/status` is the one entry, and what it publishes is the historian's
 * declared cadence — a deployment property, not a reading. useConnectivity
 * takes `intervalSec` from it and nothing else, and already holds it with a
 * five-minute staleTime on the client, so a minute here is well inside what
 * the app has always been prepared to believe.
 *
 * Nothing else belongs on this list. Before adding one, ask what a reader
 * would conclude from the answer being a minute old, and whether they would be
 * wrong to conclude it.
 */
function reuseMs(suffix: string): number {
  return suffix === "logger/status" ? 60_000 : 0;
}

/** Site, path and caller, as one key. The token is hashed, never stored. */
function answerKey(siteId: string, suffix: string, search: string, auth: string | null): string {
  const who = createHash("sha256").update(auth ?? "").digest("hex").slice(0, 16);
  return `${siteId}|${suffix}${search}|${who}`;
}

function sweep() {
  if (held.size < HELD_MAX) return;
  const now = Date.now();
  for (const [k, v] of held) {
    /* Swept against the longest reuse any path is granted rather than each
       entry's own: the key does not carry its path back, and over-keeping by a
       minute costs a map entry while under-keeping costs a request. */
    if (now - v.at > 60_000) held.delete(k);
  }
  /* Still full means live entries, not leaked ones. Drop the oldest rather
     than grow without limit. */
  if (held.size >= HELD_MAX) {
    const oldest = [...held.entries()].sort((a, b) => a[1].at - b[1].at);
    for (const [k] of oldest.slice(0, Math.ceil(HELD_MAX / 4))) held.delete(k);
  }
}

/**
 * Run `read`, unless the same answer is already held or already on its way.
 *
 * Only 200s are stored. A 401, a 502 or a timeout is a fact about this moment
 * and re-serving it would extend an outage past its end — and a stored 401
 * would keep answering a token that has since been renewed.
 */
async function askOnce(
  key: string,
  suffix: string,
  read: () => Promise<{ status: number; body: string }>,
): Promise<{ status: number; body: string; reused: boolean }> {
  const ttl = reuseMs(suffix);

  if (ttl > 0) {
    const hit = held.get(key);
    if (hit && Date.now() - hit.at < ttl) {
      return { status: hit.status, body: hit.body, reused: true };
    }
  }

  const running = inFlight.get(key);
  if (running) return { ...(await running), reused: true };

  const p = read();
  inFlight.set(key, p);
  try {
    const out = await p;
    if (ttl > 0 && out.status === 200) {
      held.set(key, { at: Date.now(), ...out });
      sweep();
    }
    return { ...out, reused: false };
  } finally {
    inFlight.delete(key);
  }
}

/* ── Identify ourselves ────────────────────────────────────────────────────
   The gateway sits behind Cloudflare with bot protection on, and a request
   carrying no User-Agent is refused at the edge with error 1010 — a browser
   signature block, returned in under 100 ms and never reaching the board.
   Verified: no UA gives an instant 403/1010, while any real UA passes the edge.

   Node's fetch does not reliably set one, so this proxy says who it is. That is
   correct manners for a server-to-server client regardless, and it makes the
   gateway's own logs able to distinguish this app from a browser. */
const USER_AGENT = "UnityESS-Mobile-Proxy/1.0 (+https://ems.unityess.cloud)";

async function fetchGateway(url: string, init: RequestInit, retry: boolean): Promise<Response> {
  const timeoutMs = isAuth(url) ? AUTH_TIMEOUT_MS
    : isHistory(url) ? HISTORY_TIMEOUT_MS : GW_TIMEOUT_MS;
  const attempts = isAuth(url) ? AUTH_ATTEMPTS
    : isHistory(url) ? HISTORY_ATTEMPTS : GW_ATTEMPTS;
  const headers = { "User-Agent": USER_AGENT, ...(init.headers as Record<string, string>) };

  /* Undefined — a caller nobody wrapped — opens a budget here rather than
     running without one. See deadlineStore. */
  const stored = deadlineStore.getStore();
  const deadline = stored === null ? null : stored ?? Date.now() + EDGE_BUDGET_MS;
  const budgetLeft = () => (deadline == null ? Infinity : deadline - Date.now());

  let lastError: unknown = null;
  for (let attempt = 0; attempt < (retry ? attempts : 1); attempt++) {
    if (attempt > 0) {
      // Jittered, per §10 — a fixed backoff marches every client that failed
      // together onto the same retry instant, which is how a busy board stays busy.
      const base = 400 * 2 ** (attempt - 1);
      const backoff = base + Math.random() * base;
      /* The backoff is counted against the budget too. Sleeping first and
         checking after is how a retry gets started with less time than it
         needs — the failure the floor exists to prevent. */
      if (budgetLeft() - backoff < MIN_ATTEMPT_MS) break;
      await new Promise((r) => setTimeout(r, backoff));
    }

    /* Whichever is smaller: what this shape of request needs, or what is left
       of the request's share of the edge's 100 s. The clamp is what makes the
       budgets above safe to state independently of one another. */
    const left = budgetLeft();
    if (left < MIN_ATTEMPT_MS) {
      lastError ??= new BudgetExhausted();
      break;
    }

    try {
      const r = await fetch(url, {
        ...init, headers, cache: "no-store",
        signal: AbortSignal.timeout(Math.min(timeoutMs, left)),
      });
      /* §10 of the API Reference, plus the two tunnel codes it does not cover:
         503 storage/service unavailable — "back off and retry later"; 502 tunnel
         up but board busy; 530 tunnel down. Everything else is either success or
         a client error the same request will never fix — 400/422 "do not retry
         unchanged", 403 role, 404 identity — so it is returned as-is. 401 is
         deliberately absent: re-auth is handled one level up, once, with the
         bounded retry the spec asks for. */
      if (RETRYABLE.has(r.status) && attempt < attempts - 1) {
        lastError = new Error(`gateway ${r.status}`);
        continue;
      }
      return r;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error("gateway unreachable");
}

/* ── Reading the gateway from our own server code ──────────────────────────
   handleInner exists to hand a gateway response to a browser untouched. The
   series route needs something different: to read the gateway itself, on the
   caller's behalf, and return an aggregate rather than the rows. Both share
   fetchGateway — the retry policy, the history timeout and the User-Agent are
   properties of talking to this board, not of who is asking — and both honour
   the capture fallback, so a developer with no tunnel still gets a working
   History screen.

   The caller's own bearer token is passed in and forwarded unchanged. This
   function mints nothing and stores nothing: it cannot read a plant the caller
   is not entitled to, for exactly the reason the proxy holds no account. */

export class GatewayReadError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * What to say when the gateway could not be reached at all.
 *
 * Node reports a dead host, a closed tunnel, a refused connection and a DNS
 * failure identically, as the string "fetch failed" — and that string reached
 * a user's screen, in place of a chart, on the one screen that exists to say
 * what happened. It carries no information a reader can act on and reads as a
 * defect in the app rather than a condition of the site.
 *
 * Both paths out of this module route through here: the passthrough that hands
 * a response to the browser, and gatewayRead which our own routes use. They
 * described the same failure two different ways until this existed.
 */
export function unreachableReason(e: unknown): string {
  if (e instanceof Error && e.name === "TimeoutError") {
    return "The gateway did not answer in time.";
  }
  return "Could not reach the gateway.";
}

export async function gatewayRead(
  suffix: string,
  params: URLSearchParams,
  auth: string | null,
  site: Site,
): Promise<{ body: Record<string, unknown>; mode: "live" | "capture" | "demo" }> {
  /* series.ts walks the historian through this function rather than through
     the route above, so the demo has to be answered in both places or History
     is the one screen the demo cannot show. */
  if (isDemoSite(site)) {
    const served = serveDemo("GET", suffix, params);
    if (!served) {
      throw new GatewayReadError(
        501,
        `This deployment is running the synthetic demo plant, which has no ` +
          `equivalent for /api/${suffix}.`,
      );
    }
    return { body: served.body as Record<string, unknown>, mode: "demo" };
  }

  if (!site.baseUrl) {
    throw new GatewayReadError(
      503,
      `Site "${site.id}" has no gateway address. Set GW_BASE_URL (or GW_SITES) ` +
        `to a reachable gateway — there is no offline data to fall back to.`,
    );
  }

  const qs = params.toString();
  let r: Response;
  try {
    r = await fetchGateway(
      `${site.baseUrl}/api/${suffix}${qs ? `?${qs}` : ""}`,
      { method: "GET", headers: { ...(auth ? { Authorization: auth } : {}) } },
      /* retry */ true,
    );
  } catch (e) {
    throw new GatewayReadError(502, unreachableReason(e));
  }

  const text = await r.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new GatewayReadError(502, "the gateway returned a response that was not JSON");
  }

  if (!r.ok) {
    throw new GatewayReadError(
      r.status,
      String(body.detail ?? body.error ?? `gateway ${r.status}`),
    );
  }

  /* The live gateway wraps every collection in `items`; the capture names each
     one for its domain. gw() reconciles this for the browser and the same
     reconciliation has to happen here, or a live history page reads as empty. */
  if (Array.isArray(body.items) && !Array.isArray(body.rows)) body.rows = body.items;

  return { body, mode: "live" };
}

/**
 * Sign in from server code, for the backfill worker.
 *
 * The proxy deliberately holds no gateway account for serving requests — each
 * person signs in with their own, and the gateway decides what their token
 * reaches. This is the one exception the Server Pull specification asks for:
 * §4 step 1 has the ingestion worker authenticate and cache a JWT, because an
 * ingestion worker has no person attached to it.
 *
 * Nothing routes a request through this. It exists only to fill the durable
 * store, and the credentials come from the environment rather than from a
 * caller, so a browser can never reach it.
 */
export async function gatewayLogin(
  site: Site, username: string, password: string,
): Promise<{ token: string; expiresAt: number }> {
  if (!site.baseUrl) throw new GatewayReadError(503, `Site "${site.id}" has no gateway address.`);

  let r: Response;
  try {
    r = await fetchGateway(
      `${site.baseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      },
      /* retry */ true,
    );
  } catch (e) {
    throw new GatewayReadError(502, unreachableReason(e));
  }

  const body = (await r.json().catch(() => ({}))) as {
    access_token?: string; expires_in_sec?: number; detail?: string;
  };
  if (!r.ok || !body.access_token) {
    throw new GatewayReadError(r.status, String(body.detail ?? `gateway ${r.status}`));
  }
  /* Retired a minute early, the same margin the client uses: a token that dies
     mid-request costs a retry, one retired early costs nothing. */
  return {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in_sec ?? 28800) * 1000 - 60_000,
  };
}

async function handleInner(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const suffix = path.join("/");
  const search = req.nextUrl.search;

  /* Which site's gateway this request is for.

     Null means the caller named a site this deployment does not have — a
     client holding a decommissioned id, or a hand-made request. It is refused
     rather than quietly served from the default site, because answering with
     another plant's readings under the name the caller asked for is the one
     outcome worse than an error. The id is echoed back, truncated, so the
     screen can say which site it could not find. */
  const site = resolveSite(req);
  if (!site) {
    return NextResponse.json(
      {
        error: "unknown_site",
        detail:
          `This deployment has no site "${(req.headers.get(SITE_HEADER) ?? "").slice(0, 64)}". ` +
          `It may have been removed since you last signed in.`,
      },
      { status: 400 },
    );
  }

  /* Demo mode, answered here and never forwarded.

     Before the write gate rather than after: the demo has no plant to protect,
     and its only POST is a sign-in the gate would have allowed anyway. Before
     the baseUrl check too, because a demo site's address is a `demo://` scheme
     that nothing is meant to dial. */
  if (isDemoSite(site)) {
    const served = serveDemo(req.method, suffix, req.nextUrl.searchParams);
    if (!served) {
      return NextResponse.json(
        {
          error: "not_in_demo",
          detail:
            `This deployment is running the synthetic demo plant, which has no ` +
            `equivalent for /api/${suffix}. Unset GW_DEMO to reach a real gateway.`,
        },
        { status: 501, headers: { "x-gw-mode": "demo" } },
      );
    }
    return NextResponse.json(served.body, {
      status: served.status,
      headers: { "x-gw-mode": "demo", "x-gw-asked": "model", "Cache-Control": "no-store" },
    });
  }

  /* Signing in is a POST, and it is the one write this proxy must always
     allow — refusing it would leave every caller permanently unauthenticated.
     It is not a control write: it mints a token and touches no plant. */
  const isLogin = suffix === "auth/login";

  // Every other write is refused here regardless of what the client asked for.
  if (req.method !== "GET" && !isLogin && !writeAllowed(suffix)) {
    return NextResponse.json(
      {
        error: "write_disabled",
        detail: isControlWrite(suffix)
          ? "Dispatch is disabled on this deployment. GW_ALLOW_WRITES is not set."
          : "This endpoint is not a dispatch control and is never forwarded by this proxy.",
      },
      { status: 403 },
    );
  }

  /* Note what is NOT checked here: the caller's role. The gateway owns that
     decision and enforces it on every one of these paths — a customer token
     gets 403 from the gateway itself, which is the only place the answer can
     be trusted. This proxy narrows what may be attempted; it does not decide
     who may attempt it. */

  if (!site.baseUrl) {
    return NextResponse.json(
      {
        error: "no_gateway",
        detail:
          `Site "${site.id}" has no gateway address. Set GW_BASE_URL (or ` +
          `GW_SITES) to a reachable gateway — there is no offline data to ` +
          `fall back to.`,
      },
      { status: 503 },
    );
  }

  try {
    /* The caller's own token, forwarded unchanged. Absent on the login request
       itself, and absent on an unauthenticated call — in which case the gateway
       answers 401 and the client knows to sign in. That is the correct place
       for the decision; this proxy is not entitled to make it. */
    const auth = req.headers.get("authorization");

    /* Every request through this handler has a person waiting on it, so it is
       counted as pressure and the backfill walker stands aside for it.
       
       Counted HERE and not inside fetchGateway or gatewayRead, deliberately:
       those are shared with the walker itself, and a walker that counted its
       own reads as somebody waiting would yield to itself and never advance.
       This function is only ever reached by an inbound HTTP request. */
    const doneWaiting = beginUserWait();
    try {
    const body = req.method === "GET" ? undefined : await req.text();

    const read = async () => {
      const r = await fetchGateway(`${site.baseUrl}/api/${suffix}${search}`, {
        method: req.method,
        headers: {
          ...(auth ? { Authorization: auth } : {}),
          ...(req.method === "GET" ? {} : { "Content-Type": "application/json" }),
        },
        body,
        /* Login is retried even though it is a POST. The rule that writes must
           never be replayed is about commands that change the plant — this one
           mints a token and touches nothing, so a second attempt is free, and
           without it a single transient 500 from the board is a failed sign-in
           the user has to notice and repeat by hand. */
      }, /* retry */ req.method === "GET" || isLogin);

      /* 401 is returned as-is rather than retried. There is nothing to retry
         with: the token belongs to the caller, so only the caller can replace it. */
      return { status: r.status, body: await r.text() };
    };

    /* GET only. A write must reach the board exactly as many times as it was
       sent, and sign-in must never be answered from another caller's reply —
       coalescing two logins would hand one person's token to another. */
    const { status, body: text, reused } =
      req.method === "GET"
        ? await askOnce(answerKey(site.id, suffix, search, auth), suffix, read)
        : { ...(await read()), reused: false };

    return new NextResponse(text, {
      status,
      headers: {
        "Content-Type": "application/json",
        "x-gw-mode": "live",
        /* Whether the board was actually asked. Without this the only way to
           tell a coalesced reply from a fresh one is to time it, and a cache
           you cannot observe is a cache you cannot debug. */
        "x-gw-asked": reused ? "reused" : "board",
      },
    });
    } finally {
      doneWaiting();
    }
  } catch (e) {
    /* Not e.message. That is Node's "fetch failed", and it was reaching the
       screen — see unreachableReason. */
    return NextResponse.json(
      { error: "gateway_unreachable", detail: unreachableReason(e) },
      { status: 502, headers: { "x-gw-mode": "live" } },
    );
  }
}

/* ── Access gate ───────────────────────────────────────────────────────────
   A shared token, required on every request when GW_APP_TOKEN is set.
   Unset — which is the default, and the case on a developer machine — the gate
   is open and nothing changes.

   Be clear about what this is and is not. The token ships inside the client
   that sends it, so anyone who decompiles the APK or opens devtools can read
   it: this is a lock, not a wall, and it is emphatically not the customer
   authentication that Phase 3 has to build.

   What it does buy is worth having on day one. Without it, deploying this
   route publishes an unauthenticated proxy that logs into a live plant with
   stored credentials — reachable by anyone who guesses the path, and by every
   crawler that finds it. With it, that door is shut against everyone who has
   not been given the app, which is the whole population that matters until
   real accounts exist.

   Deliberately a header rather than a query parameter, so the token stays out
   of access logs, referrers and browser history. */
const APP_TOKEN = process.env.GW_APP_TOKEN ?? "";
const TOKEN_HEADER = "x-gw-app-token";

/** Length-independent comparison, so the reply cannot be timed to leak length. */
export function tokenOk(req: NextRequest): boolean {
  if (!APP_TOKEN) return true;
  const got = req.headers.get(TOKEN_HEADER) ?? "";
  if (got.length !== APP_TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < APP_TOKEN.length; i++) diff |= got.charCodeAt(i) ^ APP_TOKEN.charCodeAt(i);
  return diff === 0;
}

/* ── Cross-origin access ───────────────────────────────────────────────────
   The web build is served by this same app, so its calls are same-origin and
   never involve CORS. The packaged Android and iOS builds are not: a Capacitor
   WebView serves the bundle from https://localhost (androidScheme "https") or
   capacitor://localhost on iOS, so every gateway call is cross-origin and the
   browser blocks it before the request is even made.

   An allowlist rather than "*", for two reasons. The obvious one is that "*"
   invites any page on the internet to drive this proxy. The load-bearing one
   is Phase 3: once these calls carry credentials, a wildcard origin is
   rejected outright by the browser, so a proxy built on "*" would have to be
   rebuilt at exactly the moment auth lands. GW_EXTRA_ORIGINS covers preview
   builds without another deploy. */
const APP_ORIGINS = new Set(
  [
    "https://localhost",     // Capacitor Android, androidScheme "https"
    "capacitor://localhost", // Capacitor iOS
    "http://localhost:5180", // the standalone Vite dev server
    ...(process.env.GW_EXTRA_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  ],
);

/** Echo the origin only when it is one we allow; otherwise send nothing. */
export function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !APP_ORIGINS.has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    /* Vary matters here: without it a shared cache can serve one origin's
       allow header to another and the failure only shows up in production. */
    Vary: "Origin",
    /* SITE_HEADER included: the packaged builds are cross-origin, and a
       header the preflight does not name is one the browser strips before
       the request is sent — which would silently route every call on a
       phone to the default site. */
    "Access-Control-Allow-Headers": `Content-Type, Authorization, ${TOKEN_HEADER}, ${SITE_HEADER}`,
    "Access-Control-Allow-Credentials": "true",
  };
}

/**
 * Preflight.
 *
 * Must advertise exactly what handleInner will actually accept, and the two
 * drifted apart once: login was exempted from the write refusal in the handler
 * but not here, so the preflight answered "GET, OPTIONS", the browser refused
 * to send the POST, and the app reported a site it could not reach — for a
 * gateway that was up the whole time. A preflight that under-reports is
 * indistinguishable from an outage at the call site.
 *
 * Writes other than login stay refused unless GW_ALLOW_WRITES is set, and
 * saying so here means a modified client is stopped by its own browser before
 * the request is issued.
 */
export async function OPTIONS(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const cors = corsHeaders(req);
  if (!Object.keys(cors).length) return new NextResponse(null, { status: 403 });

  const { path } = await ctx.params;
  const isLogin = path.join("/") === "auth/login";

  return new NextResponse(null, {
    status: 204,
    headers: {
      ...cors,
      /* Must match handleInner exactly. A preflight that under-reports is
         indistinguishable from an outage at the call site — that is the bug
         that once blocked sign-in entirely and then cached the refusal for a
         day. */
      "Access-Control-Allow-Methods":
        isLogin || writeAllowed(path.join("/")) ? "GET, POST, OPTIONS" : "GET, OPTIONS",
      /* Ten minutes, not a day.
         A browser caches a preflight for this long and will not re-ask, so an
         over-long value freezes whatever the answer was at the time — including
         a wrong one. That is exactly what happened here: the preflight briefly
         advertised GET only, phones cached it, and the fix was invisible to
         them for 24 hours while every server-side test passed. A preflight is
         cheap; being unable to correct one is not. */
      "Access-Control-Max-Age": "600",
    },
  });
}

/** Wraps the handler so every path — success, capture fallback and error —
    carries the CORS headers. Adding them at each return site guarantees one
    gets missed. */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  /* Refused before the gateway is touched, so a rejected caller cannot use
     this route to probe whether the plant is reachable. */
  const res = tokenOk(req)
    /* Under a deadline, so that whatever this returns gets out while
       Cloudflare is still listening. Everything below depends on it: the 502
       and its detail line are only worth composing if they can reach the
       phone, and past 100 s they cannot. See EDGE_BUDGET_MS. */
    /* Named, and explained. A bare { error: "forbidden" } is indistinguishable
       at the call site from the gateway's own 403 — the one that means a role
       is not entitled — and the login screen rendered it as "that account is
       not permitted to sign in here". The account was never consulted: this
       refusal happens before the gateway is touched, and the thing at fault is
       the caller's build, not the person holding it. */
    ? await withEdgeDeadline(() => handleInner(req, ctx))
    : NextResponse.json(
        {
          error: "app_token_required",
          detail:
            "This deployment only answers the packaged UnityESS app. The request " +
            "carried no valid app token, so it was refused before the gateway was " +
            "contacted. This is not a problem with your account.",
        },
        { status: 403 },
      );
  for (const [k, v] of Object.entries(corsHeaders(req))) res.headers.set(k, v);
  return res;
}

export { handle as GET, handle as POST };

