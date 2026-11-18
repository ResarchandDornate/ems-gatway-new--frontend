/**
 * The site registry.
 *
 * A site is a gateway. That is not a simplification for the app's convenience
 * — it is what the gateway itself believes: `control/site/(power|standby|
 * grid-mode)` acts on the whole plant behind one base URL, while
 * `control/sources/{source_id}/*` acts on one BESS within it. So the hierarchy
 * the screens need already exists in the API, and this file only gives its top
 * level a name and an address:
 *
 *     site (one gateway)  ──  source_id  →  bess_id
 *                         └─  source_id  →  bess_id
 *
 * Server-only. `baseUrl` is a tunnel host and never reaches the browser — the
 * client is told an id and a name and nothing else, which is all a picker
 * needs and all a compromised page could then leak.
 */

import { SITE_HEADER } from "./config";
import { DEMO_BASE, demoEnabled } from "./demo";

export interface Site {
  /** Stable, url-safe, and used as a cache-key component. Never displayed. */
  id: string;
  /** What a person sees in the picker. */
  name: string;
  /** Base URL of this site's gateway, no trailing slash. Never empty. */
  baseUrl: string;
}

/** Everything the browser is permitted to know about a site. */
export interface PublicSite {
  id: string;
  name: string;
  /** Always true. Kept so the client contract is unchanged; a site with no
   *  gateway address is no longer registered at all. */
  live: boolean;
}

/**
 * Which site a request is for.
 *
 * A header rather than a path segment or a query parameter, and the choice is
 * load-bearing in both directions:
 *
 *   - A query parameter would be forwarded to the gateway verbatim. The proxy
 *     passes `req.nextUrl.search` straight through, so `?site=` would arrive
 *     at a field device as an unrecognised filter on endpoints that already
 *     take `from_epoch_ms`, `limit`, `order` and `format`.
 *   - A path segment would break the suffix that everything else keys off:
 *     CONTROL_WRITES matches anchored patterns against `path.join("/")`, and
 *     serveFromCapture switches on the same string. Every one of those would
 *     have had to learn to skip a leading segment, which is a lot of places to
 *     be right in.
 *
 * A header is invisible to the gateway — it is read here and not forwarded —
 * and disturbs no existing contract.
 */
export { SITE_HEADER };

/* ── Reading the registry ──────────────────────────────────────────────────
   Three configurations, in precedence order.

   1. GW_SITES — a JSON array, the multi-site case:

        GW_SITES=[{"id":"gujarat","name":"Gujarat","baseUrl":"https://…"}]

   2. GW_BASE_URL — one gateway, which is every deployment that exists today.
      It becomes a single site so that nothing about the single-site case
      changes: same behaviour, same responses, one more level of scope above
      it that happens to have one member.

   3. Neither — an empty registry. Every request is then refused with a
      precise message, because there is nothing to serve.

   A malformed GW_SITES throws rather than falling back. Falling back would
   start the app against whatever GW_BASE_URL happens to hold while the
   operator believes two sites are configured, and the screens would label a
   plant with a name from a registry that never loaded. A boot that fails with
   a precise message is recoverable in a minute; a deployment that quietly
   serves the wrong site is the failure this codebase keeps writing comments
   about. */

function parseRegistry(): Site[] {
  /* Demo mode wins over both, and that ordering is the safety property.

     A deployment with GW_DEMO=true talks to no gateway at all — the registry
     holds one synthetic site and there is no configured address left for a
     request to reach. Letting GW_BASE_URL survive alongside it would make
     "demo" a per-request decision, and a per-request decision is one that can
     be got wrong for one request. See gateway/demo.ts. */
  if (demoEnabled()) {
    return [{ id: "demo", name: "Demo Plant (synthetic)", baseUrl: DEMO_BASE }];
  }

  const raw = (process.env.GW_SITES ?? "").trim();

  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `GW_SITES is not valid JSON: ${(e as Error).message}. Expected ` +
          `[{"id":"…","name":"…","baseUrl":"https://…"}].`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("GW_SITES must be a non-empty JSON array of sites.");
    }

    const seen = new Set<string>();
    const sites = parsed.map((entry, i) => {
      const e = entry as Partial<Site>;
      const id = typeof e.id === "string" ? e.id.trim() : "";
      const name = typeof e.name === "string" ? e.name.trim() : "";
      const baseUrl = typeof e.baseUrl === "string" ? e.baseUrl.trim().replace(/\/+$/, "") : "";

      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        throw new Error(
          `GW_SITES[${i}].id must be non-empty and match [A-Za-z0-9_-]+ — it is ` +
            `sent as a header and used as a cache key. Got ${JSON.stringify(e.id)}.`,
        );
      }
      if (!name) throw new Error(`GW_SITES[${i}].name is required — it is what a person reads.`);
      if (seen.has(id)) throw new Error(`GW_SITES has two sites with id "${id}".`);
      seen.add(id);

      return { id, name, baseUrl };
    });

    return sites;
  }

  const base = (process.env.GW_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (base) {
    return [{ id: "default", name: process.env.GW_SITE_NAME?.trim() || "Site", baseUrl: base }];
  }

  /* Nothing configured, and nothing to substitute. The bundled reference
     capture used to be returned here, so an unconfigured deployment came up
     showing a recording of somebody's plant; that fixture is gone and so is
     this fallback. An empty registry makes /api/sites answer with no sites and
     no default, which the sign-in gate reports as "This deployment has no
     gateway configured" — the true statement, and an actionable one. */
  return [];
}

/* Evaluated once. The registry is process environment, which cannot change
   without a restart, and re-parsing per request would only add a chance of
   throwing somewhere less obvious. */
let registry: Site[] | null = null;

export function allSites(): Site[] {
  if (!registry) registry = parseRegistry();
  return registry;
}

/**
 * The site used when a caller names none. Always the first configured.
 *
 * Undefined when nothing is configured. Every caller already had to handle a
 * site it could not resolve — `resolveSite` has always been able to return
 * null — so this widens an existing case rather than introducing one.
 */
export function defaultSite(): Site | undefined {
  return allSites()[0];
}

export function siteById(id: string | null | undefined): Site | null {
  if (!id) return null;
  return allSites().find((s) => s.id === id) ?? null;
}

/**
 * Which site this request is for, or null when it names one that does not
 * exist.
 *
 * Null rather than a fallback, deliberately. An unrecognised site id is either
 * a stale client holding a site that has been decommissioned or a typo in a
 * hand-made request; silently serving the default would answer both with
 * another site's plant, under the name the caller asked for. The caller 400s
 * instead, and the screen can say which site it could not find.
 */
export function resolveSite(req: { headers: { get(name: string): string | null } }): Site | null {
  const asked = req.headers.get(SITE_HEADER);
  if (!asked) return defaultSite() ?? null;
  return siteById(asked);
}

/** The registry as the browser may see it: no addresses. */
export function publicSites(): PublicSite[] {
  return allSites().map((s) => ({ id: s.id, name: s.name, live: Boolean(s.baseUrl) }));
}
