"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { LoginModal } from "./LoginModal";
import { ensureSite, getSession, subscribe, login, revalidateSession } from "@/lib/central";

/** Routes that manage their own auth and bypass the global gate. */
// /m/demo renders fixtures only and touches no API, so it needs no session.
// /k holds its own session per site and shows its own picker; it is signed in
// to the same gateway as the rest of the app but through a store this gate
// must not pre-empt, because the site it is looking at may not be this one.
// /privacy is the app's privacy policy and MUST stay publicly reachable —
// Google opens it signed out during review, and a login modal there fails the
// listing. It is a static legal page and asks no API anything.
const AUTH_BYPASS_ROUTES = ["/m/demo", "/k", "/privacy"];

/**
 * Gates the app behind a NorthBound EMS Gateway sign-in.
 *
 * Pass-through auth: each person signs in with their own gateway account and
 * the proxy forwards that token unchanged. This app holds no gateway login of
 * its own, so it cannot be induced to read a plant the caller is not entitled
 * to — the gateway decides that, which is the only place that honestly can.
 *
 * The session lives in an external store rather than in state here, because the
 * fetch layer is not a component and has to read the token on every call. This
 * subscribes to the same store, so a 401 anywhere in the app clears the session
 * and this gate shows the login form without any panel having to raise it.
 *
 * Autologin: append ?autologin=1&username=...&password=... to any URL.
 * The gate reads the params, signs in, then rewrites the URL to strip the
 * credentials from browser history before rendering children.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  /* Which gateway this deployment talks to. Resolved before anything reads the
     session, because auth.ts scopes tokens to a site and reports "signed out"
     until one is active — a gate that rendered first would show the login form
     to somebody who is already signed in. */
  const [siteReady, setSiteReady] = useState(false);
  const [siteError, setSiteError] = useState<string | null>(null);

  const session = useSyncExternalStore(
    subscribe,
    () => getSession(),
    /* Server snapshot. Always null: the session lives in browser storage, and
       claiming a session during SSR would render the app shell and then tear
       it down on hydration. */
    () => null,
  );

  useEffect(() => {
    let cancelled = false;

    ensureSite()
      .then(async () => {
        if (cancelled) return;

        const params = new URLSearchParams(window.location.search);
        if (params.get("autologin") === "1") {
          const username = params.get("username") ?? params.get("email");
          const password = params.get("password");

          /* Stripped from the address bar before the async call resolves, so
             they never reach browser history or a server access log. */
          const clean = new URL(window.location.href);
          for (const k of ["autologin", "username", "email", "password"]) {
            clean.searchParams.delete(k);
          }
          window.history.replaceState(null, "", clean.toString());

          if (username && password) {
            await login(username, password).catch(() => {
              /* Falls through to the login form, which is the right place to
                 ask again — and the only place that can explain why. */
            });
          }
        }

        if (!cancelled) setSiteReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setSiteError(e instanceof Error ? e.message : String(e));
      });

    return () => { cancelled = true; };
  }, []);

  /* A laptop that slept overnight runs no timers and makes no requests, so it
     can wake hours after its token died with nothing having noticed. Checking
     on focus makes the first thing it does on waking be finding that out,
     rather than issuing a round of doomed requests and reporting them as a
     connectivity problem. */
  useEffect(() => {
    const onFocus = () => revalidateSession();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  // Routes that handle their own auth bypass the gate entirely.
  if (AUTH_BYPASS_ROUTES.some((r) => pathname?.startsWith(r))) {
    return <>{children}</>;
  }

  if (siteError) {
    return (
      <div className="fixed inset-0 z-50 bg-bg/95 backdrop-blur-md grid place-items-center px-5">
        <div className="w-full max-w-[400px] surface-card p-6">
          <h1 className="text-[15px] font-semibold text-ink mb-2">Gateway Not Configured</h1>
          <p className="text-[12px] text-muted leading-relaxed">{siteError}</p>
        </div>
      </div>
    );
  }

  /* Nothing is rendered until the registry has resolved — not the app, and not
     the login form. Both would be a guess at this point. */
  if (!siteReady) return null;

  /* The carousel sign-in is the website's; the mobile app keeps its card. */
  if (!session) return <LoginModal hero={!pathname?.startsWith("/m")} />;

  return <>{children}</>;
}
