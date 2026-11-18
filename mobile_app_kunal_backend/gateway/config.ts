/**
 * Where the gateway proxy lives, as seen from whichever shell is running.
 *
 * The web build at /k is served by the same Next app that hosts the proxy, so
 * a relative path is already correct and this returns "" — that build's
 * behaviour is unchanged by this file existing.
 *
 * The Android build is a static bundle with no server of its own. Its requests
 * would resolve against capacitor://localhost, which hosts the app and nothing
 * else, so the shell sets __GW_API_BASE__ to the deployed origin at startup.
 *
 * Read on every call rather than captured in a module constant: module
 * evaluation order is a build-tool detail, and a constant read before the
 * shell had set the global would silently pin the app to same-origin for the
 * rest of the session.
 */
export function apiBase(): string {
  const v = (globalThis as Record<string, unknown>).__GW_API_BASE__;
  return typeof v === "string" ? v.replace(/\/+$/, "") : "";
}

/**
 * Shared token for the proxy's access gate, when the deployment sets one.
 *
 * Read from a global the shell installs at boot, the same way the API base is,
 * because this file is compiled into both a Next build and a Vite build and
 * neither one's environment mechanism exists in the other.
 *
 * Empty is the normal case for the web build and for local development, where
 * the proxy leaves the gate open.
 */
export function appToken(): string {
  const v = (globalThis as Record<string, unknown>).__GW_APP_TOKEN__;
  return typeof v === "string" ? v : "";
}

/**
 * Header naming which site a request is for.
 *
 * Lives here rather than in sites.ts because both sides of the wire need it and
 * only one side may have the registry: sites.ts reads process.env at module
 * scope and is server-only, so importing the constant from there would pull the
 * whole registry — and its configuration — into the browser bundle. sites.ts
 * re-exports this, so server callers still import it from where it belongs.
 *
 * A header rather than a query parameter or a path segment; sites.ts explains
 * why, and the reasoning is about the gateway rather than about this constant.
 */
export const SITE_HEADER = "x-gw-site";
