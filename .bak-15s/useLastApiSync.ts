"use client";

import { useQuery } from "@tanstack/react-query";
import { getSession, heartbeat } from "@/lib/central";

/**
 * When the app last successfully reached the backend.
 *
 * ── Why this is one poll and not "any query" ──────────────────────────────
 * This used to report the newest `dataUpdatedAt` across the whole query cache:
 * whichever screen last talked to the API kept the header honest, wherever you
 * were. That worked while every query hit the network.
 *
 * It stopped working on 24 Sep 2026, when the NorthBound readers were disabled
 * and replaced with stubs that RESOLVE EMPTY so screens render empty states
 * rather than error boundaries. React Query cannot tell that apart from a real
 * answer — an empty resolve is a `success` — so the header reported "Synced"
 * against a backend the app was no longer speaking to, then decayed to "No
 * Link" three minutes later once the stubs stopped being re-fetched. A green
 * dot over a dead link is worse than a red one, and it is the same mistake the
 * "Live" label was renamed to avoid (see components/SubHeader.tsx).
 *
 * Deriving the badge from ONE deliberate round trip removes the ambiguity: the
 * only thing that can mark the connection live is a request that actually came
 * back good. Screens are then free to stub, fail or render empty without
 * touching what the header claims.
 *
 * Returns null until the first success of the session — never a fabricated
 * "now". On failure the last success is KEPT, not cleared, so the age keeps
 * growing and the badge degrades Synced → Delayed → No Link on its own
 * thresholds rather than snapping to "No Data" on one dropped packet.
 */
export function useLastApiSync(): number | null {
  /* Read without subscribing: this only gates the poll, and AuthGate already
     re-renders the shell when the session appears or goes. */
  const signedIn = getSession() != null;

  const { dataUpdatedAt } = useQuery({
    queryKey:        ["central", "heartbeat"],
    queryFn:         heartbeat,
    enabled:         signedIn,
    /* 30 s against the header's 45 s "Synced" window: one poll may be missed
       before the badge starts degrading, so a single blip does not flicker it. */
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    /* The app turns focus refetch off globally. Here it has to be on: with no
       background polling, a tab brought back after a minute showed Delayed or
       No Link for up to another 30 s — the age of a poll that was paused, not
       of a link that was down. Returning to the tab now pings immediately. */
    refetchOnWindowFocus: true,
    staleTime:       25_000,
    gcTime:          60_000,
    /* No retry. A retry would delay the failure past the point the badge is
       meant to report it, and the next tick is 30 s away regardless. */
    retry:           false,
  });

  return dataUpdatedAt > 0 ? dataUpdatedAt : null;
}
