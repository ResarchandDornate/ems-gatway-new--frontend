"use client";

/**
 * Which site the app is looking at.
 *
 * The level above GatewayContext. A site is one gateway; a gateway carries one
 * or more BESS. GatewayContext picks the unit, this picks the plant, and the
 * two are separate contexts because they answer to different things: the unit
 * list comes from a gateway's own `sources/summary`, while the site list is a
 * property of this deployment and no gateway can be asked for it.
 *
 * Mounted OUTSIDE the sign-in gate, which is the whole reason it is its own
 * provider. Each gateway issues its own accounts, so the site has to be chosen
 * before there is anything to sign in to — a gate that sat above this would
 * have to ask for credentials before knowing which plant they were for.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  useSyncExternalStore, type ReactNode,
} from "react";

import { apiBase, appToken, SITE_HEADER } from "./config";
import { activeSiteId, setActiveSite } from "./auth";
import type { PublicSite } from "./sites";

/* ── The choice, as an external store ──────────────────────────────────────
   The same shape as the session store, and for the same reason: auth.ts is not
   a component and has to read the active site on every request. Keeping the
   selection here and mirroring it into auth.ts on change means there is one
   answer to "which site", not two that can disagree. */

const REMEMBERED = "unityess.gw.site";

const listeners = new Set<() => void>();
let chosen: string | null = null;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null; // private mode
  }
}

/** Remembered across launches: reopening the app should not re-ask. */
function remembered(): string | null {
  try {
    return storage()?.getItem(REMEMBERED) ?? null;
  } catch {
    return null;
  }
}

function choose(siteId: string): void {
  if (siteId === chosen) return;
  chosen = siteId;
  /* auth.ts first. It swaps the session snapshot synchronously, so by the time
     a subscriber re-renders, getSession() already describes the new site. The
     other order renders one frame of the new site with the old site's session,
     which is one frame of a request going to the wrong gateway. */
  setActiveSite(siteId);
  try {
    storage()?.setItem(REMEMBERED, siteId);
  } catch {
    /* private mode — the choice simply does not survive a relaunch */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
const snapshot = () => chosen;
/* Null on the server. There is no storage to read there and no request to
   scope, and returning anything else would make the first client render
   disagree with the markup it is hydrating. */
const serverSnapshot = () => null;

/* ── Context ───────────────────────────────────────────────────────────── */

interface SiteSelection {
  /** The active site's id. Never empty inside the provider's children. */
  siteId: string;
  /** What to call it on screen. */
  siteName: string;
  /** Every site this deployment is configured for. One is the normal case. */
  sites: PublicSite[];
  /** True when there is more than one, i.e. when a picker is worth showing. */
  multi: boolean;
  select: (siteId: string) => void;
}

const Ctx = createContext<SiteSelection>({
  siteId: "",
  siteName: "",
  sites: [],
  multi: false,
  select: () => {},
});

interface Registry {
  sites: PublicSite[];
  defaultSiteId: string;
}

export function SiteProvider({ children }: { children: ReactNode }) {
  const siteId = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tok = appToken();

    (async () => {
      try {
        const r = await fetch(`${apiBase()}/api/sites`, {
          cache: "no-store",
          headers: tok ? { "x-gw-app-token": tok } : {},
        });
        const body = await r.json();
        if (!r.ok) throw new Error(body?.detail ?? body?.error ?? `sites ${r.status}`);
        if (cancelled) return;

        const reg = body as Registry;
        setRegistry(reg);

        /* A remembered site is honoured only if it still exists. A site can be
           decommissioned between launches, and restoring one that has gone
           would send every request to a proxy that now refuses it — correctly,
           but with an error where a plant should be. */
        const want = remembered();
        const valid = want && reg.sites.some((s) => s.id === want) ? want : reg.defaultSiteId;
        choose(valid);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /* A site remembered from a previous launch is applied before the registry
     answers, so a returning user does not watch the app decide where it is.
     It is still validated above once the list arrives, and corrected if it has
     gone; this only removes the wait, not the check. */
  useEffect(() => {
    const want = remembered();
    if (want && !activeSiteId()) choose(want);
  }, []);

  const select = useCallback((id: string) => choose(id), []);

  const value = useMemo<SiteSelection>(() => {
    const sites = registry?.sites ?? [];
    const hit = sites.find((s) => s.id === siteId);
    return {
      siteId: siteId ?? "",
      /* The id is a deliberate fallback rather than a placeholder like
         "Loading". It is never wrong, which "Loading" would be the moment the
         registry answered and this had not re-rendered. */
      siteName: hit?.name ?? siteId ?? "",
      sites,
      multi: sites.length > 1,
      select,
    };
  }, [registry, siteId, select]);

  /* Nothing renders until a site is chosen. The gate below reads a session,
     and a session is per site — rendering it first would show the sign-in form
     for a site the app has not settled on, and sign a user in to whichever one
     it happened to land on afterwards. */
  if (!siteId) {
    return (
      <div className="m-empty" style={{ minHeight: "60vh", display: "grid", placeItems: "center" }}>
        <span className="m-body m-ink3">
          {error
            ? `Could not read the site list: ${error}`
            : "Connecting…"}
        </span>
      </div>
    );
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useSiteSelection = () => useContext(Ctx);
