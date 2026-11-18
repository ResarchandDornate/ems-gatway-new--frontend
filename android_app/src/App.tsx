import { useEffect, useSyncExternalStore } from "react";

import { MobileShell } from "../../mobile_app_kunal_backend/MobileShell";
import { ScreenRouter } from "../../mobile_app_kunal_backend/ScreenRouter";
import { ensureHash, getSnapshot, slugFrom, subscribe } from "./router";
import { NativeChrome } from "./NativeChrome";
import { Providers } from "./Providers";

/**
 * Mirrors what the web build assembles across three files: Providers from
 * app/providers.tsx, MobileShell from app/k/layout.tsx for the token scope,
 * background and dock, and ScreenRouter from app/k/[[...slug]]/page.tsx.
 *
 * The slug comes from the hash instead of a Next catch-all route, and that is
 * the only structural difference between the two shells.
 */
export function App() {
  const pathname = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Cold start can land with no hash at all — normalise it so the dock has a
  // path to match and does not render with every tab dark.
  useEffect(ensureHash, []);

  return (
    <Providers>
      {/* NativeChrome goes through `chrome`, not `children`. As a child it sat
          inside the sign-in gate, which returns early when there is no session
          — so on a fresh install it never mounted, the splash was never hidden
          and the app could not be used at all. */}
      <MobileShell chrome={<NativeChrome />}>
        <ScreenRouter slug={slugFrom(pathname)} />
      </MobileShell>
    </Providers>
  );
}
