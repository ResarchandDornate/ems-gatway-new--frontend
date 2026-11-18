/* NORTHBOUND GATEWAY — DISABLED 24 September 2026.
 * Commented out in place; the export surface now lives in the stub at the
 * foot of lib/gateway/index.ts. Nothing imports this file while it stands.
 * See docs/central-backend-s1-contract.md. */

export {};

// "use client";
//
// /**
//  * The website's signed-in session.
//  *
//  * Deliberately not a second implementation. The store, the per-site scoping,
//  * the expiry re-check on every read and the 401 purge all live in
//  * mobile_app_kunal_backend/gateway/auth.ts, were written against this gateway
//  * and have been in the field since August. A parallel copy here would be a
//  * second answer to "is this person signed in", and the two would drift the
//  * first time one of them learned something.
//  *
//  * What this file adds is the one thing the website needs and /k does not: the
//  * site is resolved once, at boot, rather than chosen. /k ships to customers who
//  * may hold several plants and shows them a picker; the website is operated
//  * against one deployment, so it takes the registry's default and never asks.
//  * If that deployment later holds more than one gateway, the picker to add is
//  * SiteContext — it already exists — and nothing below changes.
//  */
//
// import { apiBase, appToken } from "@/mobile_app_kunal_backend/gateway/config";
// import {
//   activeSiteId, setActiveSite, getSession, subscribe, login, logout,
//   revalidateSession, LoginError, type Session,
// } from "@/mobile_app_kunal_backend/gateway/auth";
//
// export { getSession, subscribe, login, logout, revalidateSession, LoginError };
// export type { Session };
//
// /**
//  * Whether a site is active yet.
//  *
//  * Load-bearing rather than cosmetic: auth.ts scopes every token to a site and
//  * `getSession()` returns null while none is set, so a gate that rendered before
//  * this resolved would read "signed out" and show the login form to somebody who
//  * is signed in. The shell waits on it.
//  */
// export function siteReady(): boolean {
//   return activeSiteId() !== "";
// }
//
// let inFlight: Promise<string> | null = null;
// let siteName = "";
//
// /**
//  * What to call the plant on screen.
//  *
//  * The registry's display name, never its address: `baseUrl` is a tunnel host,
//  * is server-only by construction, and the browser is told an id and a name
//  * precisely so a compromised page has nothing else to leak. Empty until
//  * ensureSite has resolved.
//  */
// export function activeSiteName(): string {
//   return siteName;
// }
//
// /**
//  * Resolve which gateway this deployment talks to, and point the session store
//  * at it.
//  *
//  * Idempotent and de-duplicated: React Strict Mode mounts effects twice in
//  * development, and two concurrent boots would each call setActiveSite and
//  * notify subscribers — harmless, but it makes the login form flicker.
//  */
// export async function ensureSite(): Promise<string> {
//   const already = activeSiteId();
//   if (already) return already;
//   if (inFlight) return inFlight;
//
//   inFlight = (async () => {
//     const tok = appToken();
//     const r = await fetch(`${apiBase()}/api/sites`, {
//       cache: "no-store",
//       headers: tok ? { "x-gw-app-token": tok } : {},
//     });
//     if (!r.ok) {
//       throw new Error(
//         r.status === 403
//           ? "This deployment refused the site list. It is not a problem with your account."
//           : `Could not read the site registry (${r.status}).`,
//       );
//     }
//     const body = (await r.json()) as {
//       defaultSiteId?: string;
//       sites?: { id: string; name?: string }[];
//     };
//     /* The registry always names a default — sites.ts synthesises one from
//        GW_BASE_URL when nothing else is configured — so an empty answer here
//        means the deployment is misconfigured rather than that it has no sites,
//        and saying so beats signing in to nothing. */
//     const id = body.defaultSiteId ?? body.sites?.[0]?.id;
//     if (!id) throw new Error("This deployment has no gateway configured (GW_BASE_URL is unset).");
//     siteName = body.sites?.find((s) => s.id === id)?.name ?? "";
//     setActiveSite(id);
//     return id;
//   })();
//
//   try {
//     return await inFlight;
//   } finally {
//     inFlight = null;
//   }
// }
