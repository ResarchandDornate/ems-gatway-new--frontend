/**
 * Points the shared gateway client at the deployed proxy.
 *
 * Set before anything else imports the gateway. apiBase() reads this global
 * lazily so ordering is not load-bearing, but setting it first keeps the
 * dependency obvious to the next reader.
 */

const base = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

(globalThis as Record<string, unknown>).__GW_API_BASE__ = base;

/* Matches GW_APP_TOKEN on the deployment. Baked into the bundle, so it is a
   lock rather than a secret — see the gate in gateway/proxy.ts. */
(globalThis as Record<string, unknown>).__GW_APP_TOKEN__ = import.meta.env.VITE_APP_TOKEN ?? "";

/* An empty base means same-origin. That is right under `npm run dev`, where
   Vite proxies /api/gw to the Next app, and wrong in a packaged build, where
   same-origin is the bundle itself and every request 404s at the WebView. The
   symptom on device is five screens of dashes and no network error to explain
   them, so say so here instead. */
if (import.meta.env.PROD && !base) {
  console.warn(
    "[unityess] VITE_API_BASE is unset in a production build. Gateway calls " +
      "will resolve against the bundle origin and return nothing. Set it to " +
      "the deployed proxy origin and rebuild.",
  );
}

export const API_BASE = base;
