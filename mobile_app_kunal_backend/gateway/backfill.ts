/**
 * The ingestion worker §2 of the Server Pull Historian specification asks for.
 *
 * Without it, an hour of history exists in the store only because somebody
 * once looked at a window containing it. That is enough to make the second
 * look instant, and not enough to make 30 d possible: nobody is going to hold
 * a chart open for the 720 gateway reads a first 30 d window costs.
 *
 * So this walks backwards from the current chunk and fills what is missing, at
 * a pace that yields to anyone actually watching a chart. The far edge is the
 * widest span the History screen offers rather than the ninety days the
 * gateway retains — see DAYS. After one pass the store holds every window the
 * app can ask for, and the walk thereafter finds almost every chunk already
 * stored and costs a directory read.
 *
 * The chunk grid is imported from series.ts and must never be redeclared here:
 * the walker fills chunks by their start instant and buildSeries looks them up
 * by the same instant, so two different CHUNK_MS values would have this write
 * chunks that no request ever reads. They agreed at 60 minutes once and
 * diverged the moment one of them was tuned.
 *
 * ── Why it needs its own account ──────────────────────────────────────────
 * Every other request through this proxy carries the token of the person who
 * made it, deliberately: the gateway decides what each account may read, and
 * that is the only place the decision can honestly be made. A worker has no
 * person attached to it, so §4 step 1 of the specification gives it its own
 * credentials. Unset, this module does nothing at all — the app keeps working
 * exactly as it does now, filling the store from live traffic alone, which is
 * slower but needs no new secret to exist.
 *
 * The account should be a read-only one. Nothing here writes, and the proxy
 * refuses control endpoints regardless of who is asking.
 */

import { gatewayLogin, GatewayReadError, gatewayRead, withoutEdgeDeadline } from "./proxy";
import { allSites } from "./sites";
import { CHUNK_MS, ensureChunk, liveFillsInFlight } from "./series";
import { isPersistent, storeRoot } from "./chunkStore";

/**
 * How far back to walk. Thirty days, matching the widest span the History
 * screen offers — not the ninety the gateway retains.
 *
 * The distinction is worth three times the work. Retention is what the gateway
 * *has*; this is what the app can ever *show*. Backfilling to ninety days
 * fetches 15.6M rows to fill sixty days that no screen can request, and at the
 * measured cost of the history endpoint — 8.0 s per request plus 5.27 ms per
 * row — that is 30 hours of gateway time against 10 for thirty days.
 *
 * Raise it if a wider span is ever added to MINUTES in HistoryScreen; the two
 * numbers should move together, and this is the one that costs.
 */
const DAYS = Number(process.env.HISTORY_BACKFILL_DAYS ?? 30);

/* Between gateway reads, and adaptive rather than fixed.
   
   A flat pace has to be set for the worst case — someone watching a chart —
   and then it is paid all night when nobody is. At 1,080 requests that is six
   hours of deliberate idling on top of ten hours of work.

   So: yield only when there is something to yield to. IDLE_PACE_MS is a breath
   between reads; BUSY_PACE_MS is what it waits instead while somebody is
   waiting on the gateway, which pressure.ts reports through
   liveFillsInFlight().

   ── What that signal used to miss ──────────────────────────────────────────
   It counted chart fills and nothing else, so the walker yielded to History
   and to nothing a person actually looks at most of the time. Measured on the
   commissioned board while the walker ran, /api/fast-bess/latest — the
   five-second live poll every screen depends on — took 32 to 80 seconds
   against a sub-second baseline, and health and telemetry took 25 and 21. The
   app was issuing polls sixteen times faster than they could be answered, so
   the queue never drained and every screen read "Data delayed" over a healthy
   plant. The counter now covers every request the proxy serves.

   ── And why the idle pace went up ─────────────────────────────────────────
   One second assumed a read is quick. On this board a historian read measures
   40 to 100 seconds, so a one-second pause afterwards is roughly a 2% rest
   duty cycle — the comment above promised "a short breath so the walker never
   monopolises the board", and at that ratio it monopolises it almost
   entirely. Five seconds is still small against the read it follows, and the
   yield above is what does the real work; this is the floor under it for the
   window between a person's requests, where the counter reads zero but
   somebody is about to ask again. Tune with HISTORY_BACKFILL_PACE_MS. */
const IDLE_PACE_MS = Number(process.env.HISTORY_BACKFILL_PACE_MS ?? 5_000);
const BUSY_PACE_MS = 20_000;
/* Longest the walker will stand aside for live traffic before going anyway. */
const YIELD_MAX_MS = 120_000;

/* Two different failures, two different waits.

   One chunk timing out is ordinary on this gateway — the history endpoint is
   slow and variable, and a 55 s timeout is a coin-flip on a bad minute, not a
   sign that anything is wrong. Treating it as an outage and sleeping five
   minutes was costing far more than the failed read: the walker measured 0.50
   chunks/min against a model that says 1.75, and nearly all of the difference
   was this sleep.

   Consecutive failures are a different claim. If several chunks in a row fail
   the board really is loaded or the tunnel really is down, and then a long
   wait is right — asking harder makes a busy board busier. */
const CHUNK_RETRY_MS = 20_000;
const FAILS_BEFORE_BACKOFF = 5;
const BACKOFF_MS = 5 * 60_000;

let running = false;

interface Cred { user: string; pass: string }

function creds(): Cred | null {
  const user = process.env.GW_INGEST_USER?.trim();
  const pass = process.env.GW_INGEST_PASSWORD;
  return user && pass ? { user, pass } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The gateway names sources external_ems_N and their BESS bess_N. */
const bessFor = (sourceId: string) => sourceId.replace(/^external_ems_/, "bess_");

/**
 * Start the walker. Safe to call more than once; only the first call starts it.
 *
 * Never awaited and never throws into its caller: this runs beside the app,
 * and a store that cannot be filled is a slower app rather than a broken one.
 */
export function startBackfill(): void {
  if (running) return;
  const c = creds();
  if (!c) {
    console.log(
      "[backfill] GW_INGEST_USER/GW_INGEST_PASSWORD unset — history fills from live traffic only. " +
        "Set them to pre-fill the last " + DAYS + " days.",
    );
    return;
  }
  running = true;
  console.log(
    `[backfill] starting: ${DAYS}d, ${Math.round(IDLE_PACE_MS / 1000)}s between reads when idle ` +
      `(${Math.round(BUSY_PACE_MS / 1000)}s while a chart is loading), store ${storeRoot()}` +
      (isPersistent() ? "" : " (HISTORY_DIR unset — this store does not survive container replacement)"),
  );
  /* Outside the edge deadline, deliberately.

     That budget exists because a browser is waiting on the far side of
     Cloudflare's 100 s origin timeout. Neither is true here: this walker runs
     on its own schedule, in server code, straight at the gateway. Left inside
     it, the walker's own sign-in would be shortened to fit a limit it never
     meets — and this is the one caller that can afford to wait out a 109 s
     login, because nobody is watching a spinner while it does. */
  void withoutEdgeDeadline(() => loop(c));
}

async function loop(c: Cred): Promise<void> {
  for (;;) {
    try {
      for (const site of allSites()) {
        if (!site.baseUrl) continue; // capture site: nothing to pull
        await walkSite(site, c);
      }
    } catch (e) {
      console.warn("[backfill] pass failed:", e instanceof Error ? e.message : e);
    }
    /* A full pass done, or abandoned. Either way the newest hour has moved on
       by now, so go round again — the second pass is cheap because almost
       every hour is already stored. */
    await sleep(BACKOFF_MS);
  }
}

async function walkSite(site: ReturnType<typeof allSites>[number], c: Cred): Promise<void> {
  /* Retried here rather than left to abort the pass. These two calls open every
     walk, so a single timeout on either — routine on this gateway — threw all
     the way out to loop(), which logged "pass failed" and slept five minutes
     without having read a thing. */
  let auth = "", expiry = 0, body: Record<string, unknown>;
  for (let attempt = 1; ; attempt++) {
    try {
      const s = await gatewayLogin(site, c.user, c.pass);
      auth = `Bearer ${s.token}`;
      expiry = s.expiresAt;
      ({ body } = await gatewayRead("sources/summary", new URLSearchParams(), auth, site));
      break;
    } catch (e) {
      if (attempt >= 3) throw e;   // three failures is an outage; let loop() wait it out
      await sleep(CHUNK_RETRY_MS);
    }
  }
  const sources = (Array.isArray(body.rows) ? body.rows : [])
    .map((s) => String((s as { source_id?: string }).source_id ?? ""))
    .filter(Boolean);

  if (!sources.length) {
    console.warn(`[backfill] ${site.id}: gateway listed no sources`);
    return;
  }

  /* The chunk that has just ended. The one in progress is deliberately
     skipped: it cannot be sealed yet, so it cannot be stored, and live
     requests extend it from its own high-water mark anyway. */
  const newest = Math.floor(Date.now() / CHUNK_MS) * CHUNK_MS - CHUNK_MS;
  /* Days in milliseconds, not in chunks. This read `DAYS * 24 * CHUNK_MS`,
     which is only DAYS days while a chunk is an hour — at 80 minutes it walked
     forty days for a setting that says thirty, a third more work than asked
     for. Nothing about a day is a whole number of chunks, so the span has to
     be expressed in the unit it is stated in. */
  const oldest = newest - DAYS * 86_400_000;

  let filled = 0, stored = 0, empty = 0;
  /* Reset by any success, so it counts a *run* of failures rather than their
     total over the walk. */
  let consecutiveFails = 0;

  /* Newest first. If the walk is cut short — a restart, a gateway that stops
     answering — what survives is the recent history someone is most likely to
     open, rather than ninety-day-old hours nobody has asked for. */
  for (let start = newest; start >= oldest; start -= CHUNK_MS) {
    for (const sourceId of sources) {
      if (Date.now() > expiry) {
        const next = await gatewayLogin(site, c.user, c.pass);
        auth = `Bearer ${next.token}`;
        expiry = next.expiresAt;
      }

      /* Yield *before* starting a read, not only after finishing one.
      
         Sleeping afterwards was half the rule: it stopped the walker queueing
         a second read behind someone's chart, but not the first. A 24 h window
         is 17 chunks off disk and one live read of the open chunk — about
         eight seconds — and landing behind a backfill read already in flight
         was turning that into twenty-seven.
      
         Bounded, because liveFillsInFlight() is a counter and a leaked
         increment would otherwise park the walk forever. At the cap it simply
         proceeds and competes, which is the old behaviour. */
      for (let waited = 0; liveFillsInFlight() > 0 && waited < YIELD_MAX_MS; waited += 500) {
        await sleep(500);
      }

      try {
        const r = await ensureChunk(site, sourceId, bessFor(sourceId), start, auth);
        consecutiveFails = 0;
        if (r === "stored") { stored++; continue; }   // already held; no read happened
        if (r === "filled") filled++;
        if (r === "empty") empty++;
      } catch (e) {
        /* 401 means the token this loop is holding is finished, which the
           expiry check above should have caught; anything else is the board.
           Both are worth waiting out rather than marching through 2,160 hours
           failing on each one. */
        const status = e instanceof GatewayReadError ? e.status : 0;
        if (status === 401) expiry = 0;
        consecutiveFails += 1;
        /* Only the first of a run is logged. A gateway having a bad ten
           minutes would otherwise write a line per chunk and bury everything
           else in the server log. */
        if (consecutiveFails === 1 || consecutiveFails === FAILS_BEFORE_BACKOFF) {
          console.warn(`[backfill] ${site.id}/${sourceId} ${new Date(start).toISOString()}: ${
            e instanceof Error ? e.message : e}${
            consecutiveFails >= FAILS_BEFORE_BACKOFF ? ` (${consecutiveFails} in a row, backing off)` : ""}`);
        }
        await sleep(consecutiveFails >= FAILS_BEFORE_BACKOFF ? BACKOFF_MS : CHUNK_RETRY_MS);
        continue;
      }

      /* Only after an actual gateway read. An hour already in the store cost a
         file check, and pausing for those would make a pass over an already
         full store take hours for no reason. */
      await sleep(liveFillsInFlight() > 0 ? BUSY_PACE_MS : IDLE_PACE_MS);
    }
  }

  console.log(
    `[backfill] ${site.id}: ${filled} hours fetched, ${empty} empty, ${stored} already stored`,
  );
}
