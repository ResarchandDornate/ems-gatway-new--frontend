"use client";

import { QueryClient, defaultShouldDehydrateQuery } from "@tanstack/react-query";
import { PersistQueryClientProvider, removeOldestQuery } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { OWNER_KEY } from "@/lib/central/session";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { AuthGate } from "@/components/auth/AuthGate";

// Cache UGX API responses in localStorage for up to 24 hours.
// On page load the app shows cached data instantly while a background
// revalidation runs — so the UI is never blank even offline.
const CACHE_MAX_AGE = 1000 * 60 * 60 * 24; // 24 h

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 2,
            staleTime: 30_000,         // treat cached data as fresh for 30 s
            gcTime:    CACHE_MAX_AGE,  // keep in memory (and on disk) for 24 h
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // createSyncStoragePersister is safe to call during SSR —
  // it noops when localStorage is unavailable.
  const [persister] = useState(() =>
    createSyncStoragePersister({
      storage: typeof window !== "undefined" ? window.localStorage : undefined,
      /* One slot per account (lib/central/session.ts claims and clears them),
         so one account's cached answers are never rehydrated into another's. */
      key: `EMS_QUERY_CACHE:${(() => { try { return window.localStorage.getItem(OWNER_KEY) ?? "none"; } catch { return "none"; } })()}`,
      // localStorage holds ~5 MB. Over it, setItem throws and, with no retry,
      // the cache silently stops saving — every refresh then rehydrates
      // whatever last fit. Drop the oldest queries until it fits instead.
      retry: removeOldestQuery,
    })
  );

  return (
    <PersistQueryClientProvider
      client={queryClient}
      // BUMP `buster` WHENEVER A CACHED RESPONSE SHAPE CHANGES. The cache is
      // persisted in localStorage for 24 h, so without a bump a returning
      // browser rehydrates the old shape into new code. That is exactly what
      // happened when fetchLiveValues went from returning a bare value map to
      // { values, lastTs }: the dashboard crashed on Object.values(undefined).
      persistOptions={{
        persister, maxAge: CACHE_MAX_AGE, buster: "v12-comm-captured-times-LOCALGW1",
        // `meta: { persist: false }` keeps a query out of localStorage — for
        // series too large for it, which keep their own store (lib/central/fastStore).
        dehydrateOptions: { shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && q.meta?.persist !== false },
      }}
    >
      <AuthGate>{children}</AuthGate>
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
      )}
    </PersistQueryClientProvider>
  );
}
