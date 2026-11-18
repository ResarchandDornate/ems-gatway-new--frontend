import { useEffect, useState, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

import { wireSessionRevalidation } from "./native";

/**
 * The query layer the shared screens assume exists.
 *
 * On the web this comes from app/providers.tsx, which the root layout wraps
 * around every route including /k. The Android bundle has no root layout, so
 * without this the whole tree throws "No QueryClient set" before the first
 * screen paints.
 *
 * Deliberately NOT a copy of app/providers.tsx. That file also mounts AuthGate
 * and the devtools; the first belongs to Phase 3 and the second has no place
 * in a store build. What is copied exactly is the cache policy, because the
 * screens were tuned against it — a different staleTime here would make the
 * phone refetch on a cadence the web app does not, against a field gateway
 * that the API Reference says is not built for the load.
 */

// Same 24 h as the web app.
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24;

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            staleTime: 30_000,
            gcTime: CACHE_MAX_AGE,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: window.localStorage,
      key: "UNITYESS_GW_QUERY_CACHE",
    }),
  );

  /* Refetch everything when the app returns to the foreground.
     A WebView suspended for hours comes back with a connection pool that no
     longer works, and React Query has no way to know: its retries fail against
     a device whose network is fine, so the UI settles on "Can't reach the
     site" and stays there. invalidateQueries on resume forces fresh requests
     over fresh connections, which is what a relaunch was otherwise needed for.

     refetchOnWindowFocus stays off — it fires on every tab focus in a browser
     and would put this gateway under load it is documented as not wanting.
     This is the native resume event only. */
  useEffect(
    () =>
      wireSessionRevalidation(() => {
        /* `refetchType: "active"` so only what is on screen is re-requested,
           and queries already in flight are left to finish. A blanket
           invalidateQueries() restarted the 33-second history request every
           time it ran, which is why History showed no rows while the 5-second
           live polls were fine. */
        void queryClient.invalidateQueries({ refetchType: "active" });
      }),
    [queryClient],
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      /* Persistence earns more here than it does on the web. A phone opened in
         a plant room may have no signal at all, and a screen that shows the
         last known reading with a stale badge — which these screens already
         render — beats one that shows nothing.

         BUMP `buster` WHENEVER A CACHED RESPONSE SHAPE CHANGES, for the reason
         app/providers.tsx documents at length: the cache outlives the code,
         and a returning app rehydrates yesterday's shape into today's screens. */
      persistOptions={{
        persister,
        maxAge: CACHE_MAX_AGE,
        buster: "gw-v1",
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
