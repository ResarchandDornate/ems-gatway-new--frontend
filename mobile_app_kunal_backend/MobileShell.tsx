"use client";

/**
 * Shell for the gateway-backed app.
 *
 * Six layers: the app-token check, token scope, theme, the site, the sign-in
 * gate, and then the app itself.
 *
 * The site sits ABOVE the gate because accounts are issued per gateway. Which
 * plant you are signing in to has to be settled before there is a credential
 * to check, and a gate above the site would ask for one without knowing what
 * it was for.
 *
 * The gate sits OUTSIDE GatewayProvider deliberately. Inside it, every screen's
 * queries would mount while signed out, fire at the gateway with no token, and
 * fill the console with 401s before the login form had even been typed into.
 * Nothing asks the gateway anything until there is a session to ask with.
 */

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { AppBackground, ConnectionBanner, FloatingNavigation } from "./components";
import { ThemeProvider } from "./useTheme";
import { GatewayProvider } from "./gateway/GatewayContext";
import { SiteProvider, useSiteSelection } from "./gateway/SiteContext";
import { getSession, subscribe, revalidateSession } from "./gateway/auth";
import { appToken } from "./gateway/config";
import { LoginScreen } from "./screens/LoginScreen";
import { AppOnlyScreen } from "./screens/AppOnlyScreen";

/** No session during server render — the store is a browser thing. */
const serverSnapshot = () => null;

/**
 * Checks the session and the live reading the moment the app comes back.
 *
 * A phone suspends rather than terminates. Timers stop, no requests are made,
 * and nothing notices — so an app reopened after lunch shows the readings it
 * had when it was put down, with a banner reporting an outage that may have
 * ended hours ago. Two settings made that the default: the query client sets
 * `refetchOnWindowFocus: false`, and `revalidateSession()` — written for
 * exactly this moment, and whose docstring says so — was exported and never
 * called by anything.
 *
 * Order matters. The session is revalidated first, because a token that
 * expired while the app slept should produce the sign-in screen rather than a
 * round of requests that are all going to 401. Only if a session survives is
 * anything refetched.
 *
 * Only the live snapshot is invalidated, not every query. That one is small,
 * polls at five seconds anyway, and is what the staleness banner and every
 * "last known" label are read from — so it is the whole of what "is this
 * current?" depends on. Invalidating everything would fire eight requests at
 * a field board that answers them one at a time, which is the contention this
 * codebase has just spent effort removing; the rest catch up on their own
 * intervals a few seconds later.
 */
function ForegroundRefresh() {
  const qc = useQueryClient();
  const lastRun = useRef(0);

  useEffect(() => {
    function onForeground() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      /* visibilitychange and focus both fire on a single return to the app,
         and on some browsers so does pageshow. Without this guard one wake
         costs three rounds of requests. */
      const now = Date.now();
      if (now - lastRun.current < 3_000) return;
      lastRun.current = now;

      revalidateSession();
      if (!getSession()) return;

      /* Exactly ["gw", siteId, "latest"], and not the ["…","latest","ids"]
         key beside it. Both are backed by the same argument-less getLatest, so
         matching on the segment alone sent the identical request twice on
         every wake — measured, two calls where one was wanted. The ids query
         polls at thirty seconds and catches up on its own. */
      qc.invalidateQueries({
        predicate: (q) => q.queryKey.length === 3 && q.queryKey[2] === "latest",
      });
    }

    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("focus", onForeground);
    window.addEventListener("pageshow", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("pageshow", onForeground);
    };
  }, [qc]);

  return null;
}

function Gate({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribe, getSession, serverSnapshot);
  const { siteId } = useSiteSelection();

  if (!session) {
    return (
      <AppBackground>
        <LoginScreen />
      </AppBackground>
    );
  }

  return (
    /* Keyed by site, so switching plants remounts the unit selection rather
       than carrying it across. Source ids are per gateway and every site
       commissioned from the same template has an `external_ems_1`, so a stale
       selection would not error — it would silently resolve to a different
       plant's unit of the same name, which is the failure mode worth spending
       a remount to make impossible. */
    <GatewayProvider key={siteId}>
      {/* Inside the gate, so it only runs where there is a session to check
          and a reading to refresh. Renders nothing. */}
      <ForegroundRefresh />
      <ConnectionBanner />
      <AppBackground>{children}</AppBackground>
      <FloatingNavigation />
    </GatewayProvider>
  );
}

export interface MobileShellProps {
  children: ReactNode;
  /**
   * Whether the proxy this build talks to requires an app token.
   *
   * Only the server knows — it is `GW_APP_TOKEN` on the deployment — so the
   * Next layout reads it at request time and passes it down. The packaged
   * build never sets it: it carries a token, so the answer cannot change what
   * it does, and a Vite bundle has no server to ask.
   */
  gated?: boolean;
  /**
   * Native side effects that must run whatever is on screen.
   *
   * Rendered inside ThemeProvider — so it can read the theme — but OUTSIDE the
   * gate, which is the whole point. Gate returns early when there is no
   * session, and an early return drops `children`: on a packaged build that
   * took NativeChrome with it, so hideSplashAfterPaint() never ran, and with
   * launchAutoHide false in capacitor.config.ts nothing else hides the splash.
   *
   * The result was that every fresh install sat on the splash screen forever
   * with the login form rendered and laid out underneath it, unreachable. It
   * survived because the web build has no splash and :5180 has no native
   * layer, so the one shell that could reproduce it was the one nobody could
   * open in a browser.
   *
   * A ReactNode rather than a callback, so this shared file stays ignorant of
   * Capacitor — the web build passes nothing and behaves exactly as before.
   */
  chrome?: ReactNode;
}

export function MobileShell({ children, gated = false, chrome }: MobileShellProps) {
  /* Gate on, and no token in hand. Every request this build makes will be
     refused at the proxy before the gateway is touched, so the sign-in form is
     not offered — see AppOnlyScreen for why showing it is worse than useless.

     Read directly rather than through state: appToken() returns a global the
     shell installs at boot, before React mounts, so it is the same value on the
     server render and the client one and cannot cause a hydration mismatch. */
  const appOnly = gated && !appToken();

  return (
    <div className="m-root">
      <ThemeProvider>
        {chrome}
        {appOnly ? (
          <AppBackground>
            <AppOnlyScreen />
          </AppBackground>
        ) : (
          <SiteProvider>
            <Gate>{children}</Gate>
          </SiteProvider>
        )}
      </ThemeProvider>
    </div>
  );
}
