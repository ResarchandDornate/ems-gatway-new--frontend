/**
 * Stands in for `next/navigation`, aliased in vite.config.ts.
 *
 * Only the two hooks the shared UI actually calls are real —
 * FloatingNavigation uses usePathname and useRouter, and nothing else in
 * ../../../mobile_app_kunal_backend imports from this module. The rest exist
 * so that a screen added later fails visibly at the call site instead of
 * failing to resolve at build time.
 */

import { useSyncExternalStore } from "react";
import { getSnapshot, push, replace, subscribe } from "../router";

export function usePathname(): string {
  // Third argument is the server snapshot. There is no server here, but React
  // requires it when the hook is reachable during hydration.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* A stable identity, because callers put the router in dependency arrays and
   a fresh object each render would re-fire their effects every time. */
const router = {
  push,
  replace,
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  /* No-ops rather than throws: Next's router resolves these to prefetching and
     RSC refetching, both of which are meaningless in a static bundle, and
     neither is worth crashing a screen over. */
  refresh: () => {},
  prefetch: () => {},
} as const;

export function useRouter(): typeof router {
  return router;
}

export function useSearchParams(): URLSearchParams {
  const pathname = usePathname();
  const q = pathname.indexOf("?");
  return new URLSearchParams(q === -1 ? "" : pathname.slice(q + 1));
}

export function useParams(): Record<string, string | string[]> {
  return {};
}
