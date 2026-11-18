/**
 * The station list, from the Ornate Central EMS Backend.
 *
 * ── A station is now the SITE ──────────────────────────────────────────────
 *
 * It used to be a `source_id`: one EMS controller and the BESS behind it. That
 * was the NorthBound gateway's own hierarchy, and it made the commissioned
 * plant render as two stations when it is physically one site with two
 * cabinets — with the unit picker beside it offering the same two things.
 *
 * The site is the gateway. Verified against the live backend:
 *
 *   gateway bd57016e-…
 *   ├── external_ems_1 → bess_1 + 9 assets
 *   └── external_ems_2 → bess_2 + 9 assets
 *
 * ── Where the list comes from ──────────────────────────────────────────────
 *
 * `GET /gateways/{id}/health` carries `data.health.sources[]`, which is the
 * same shape the old `/api/sources/summary` returned — an id, liveness, a
 * last-seen stamp, and per-source asset and signal counts. The backend has no
 * endpoint that lists gateways or sites, so the site itself is the configured
 * gateway and there is exactly one of it until `GET /gateways` exists.
 *
 * ── What is measured and what is written down ──────────────────────────────
 *
 * `installedPower` is real: `p0094 rated_power` on each PCS, summed. Every
 * other commercial fact — rated capacity, commissioning date, address, tariff
 * — is absent from all 1,174 points the gateway publishes and comes from the
 * overlay. See docs/dashboard-api-mapping.md.
 */

import { fetchGatewayHealth, fetchGatewayList, fetchGeneral, fetchFastBess } from "@/lib/central";
import { siteToStation } from "../overlay/stations";
import type { Station } from "../types";

/** PCS nameplate power. The one figure on this page that is telemetry. */
const RATED_POWER_POINT = "p0094";

export interface SiteSource {
  sourceId: string;
  online: boolean | null;
  assetCount: number | null;
  signalCount: number | null;
  lastUpdateUtc: string | null;
}

/** `data.health.sources[]`, read defensively — the payload is the gateway's. */
function readSources(data: unknown): SiteSource[] {
  const health = (data as { health?: { sources?: unknown[] } } | undefined)?.health;
  const rows = Array.isArray(health?.sources) ? health.sources : [];
  return rows
    .map((r) => r as Record<string, unknown>)
    .filter((r) => typeof r.source_id === "string")
    .map((r) => ({
      sourceId: r.source_id as string,
      online: typeof r.online === "boolean" ? r.online : null,
      assetCount: typeof r.asset_count === "number" ? r.asset_count : null,
      signalCount: typeof r.signal_count === "number" ? r.signal_count : null,
      lastUpdateUtc: typeof r.last_update_utc === "string" ? r.last_update_utc : null,
    }));
}

/**
 * Summed PCS nameplate, in kW.
 *
 * One reading per PCS asset, so the newest row per asset_id is taken rather
 * than the newest row — the response interleaves both cabinets. Returns null
 * rather than 0 when nothing answers: a site whose rating is unknown must not
 * render as a site rated at zero.
 */
async function ratedPowerKw(gatewayId: string): Promise<number | null> {
  try {
    const rows = await fetchGeneral(gatewayId, { pointId: RATED_POWER_POINT, limit: 50 });
    const newest = new Map<string, number>();
    for (const r of rows) {
      if (!r.asset_id || newest.has(r.asset_id)) continue;
      const n = Number(r.value);
      if (Number.isFinite(n)) newest.set(r.asset_id, n);
    }
    if (newest.size === 0) return null;
    return [...newest.values()].reduce((a, b) => a + b, 0);
  } catch {
    /* The site still lists without its rating; the overlay's value is used. */
    return null;
  }
}

/**
 * The sites this deployment can see — exactly one, the configured gateway.
 *
 * An array rather than a single value because the shape outlives the
 * limitation: when `GET /gateways` lands, this maps over it and nothing
 * downstream changes.
 */
export async function fetchStations(gatewayId: string): Promise<Station[]> {
  if (!gatewayId) return [];
  /* Every gateway the backend lists, the configured one first. When it cannot
     list them, the configured gateway alone — as before. */
  const listed = await fetchGatewayList();
  if (!listed?.length) return [await stationFor(gatewayId, null)];
  const ordered = [...listed].sort((a, b) => (a.id === gatewayId ? -1 : b.id === gatewayId ? 1 : 0));
  return Promise.all(ordered.map((g) => stationFor(g.id, g.gateway_key ?? null)));
}

/** One gateway as a station. `gatewayKey` names it when it sends no S1 profile. */
async function stationFor(gatewayId: string, gatewayKey: string | null): Promise<Station> {

  /* THE SITE IS CONFIGURED, NOT DISCOVERED.
     
     This used to return [] whenever the newest health record carried no
     sources — which made the site's existence depend on the gateway having
     reported recently. When the gateway went quiet for four hours on 25 Sep,
     the station list emptied, the picker read "0 stations", and the map lost
     its pin: the whole app behaved as though the plant did not exist rather
     than as though it was not answering.
     
     A site is a fact about the deployment. Liveness is an attribute of it.
     So the configured gateway always yields a station, and a health read that
     is empty or fails only means its sources are unknown — which siteToStation
     renders as offline rather than as absent. */
  const [records, ratedKw, profileName] = await Promise.all([
    fetchGatewayHealth(gatewayId, 1).catch(() => []),
    ratedPowerKw(gatewayId),
    profileNameOf(gatewayId),
  ]);

  let sources = readSources(records[0]?.data);
  /* No roster from health — on 12 Oct 2026 /health answered 500 on every
     call, and every per-site total ("—" unless every cabinet answers) went
     blank with it. The cabinets are still knowable: each S1 sample names its
     source. Their liveness is not, so `online` stays null (unknown). */
  if (sources.length === 0) sources = await sourcesFromFastStream(gatewayId);

  return siteToStation(gatewayId, sources, ratedKw, profileName ?? gatewayKey);
}

/** The S1 profile the gateway runs (e.g. kalpa_lineage_elecod_fast_v1), shown instead of its UUID. */
async function profileNameOf(gatewayId: string): Promise<string | null> {
  const rows = await fetchFastBess(gatewayId, { limit: 1 }).catch(() => []);
  const p = rows[0]?.data?.profile_name;
  return typeof p === "string" && p.trim() ? p.trim() : null;
}

/** The cabinets the fast stream names, for when health cannot say. */
async function sourcesFromFastStream(gatewayId: string): Promise<SiteSource[]> {
  const rows = await fetchFastBess(gatewayId, { limit: 20 }).catch(() => []);
  const ids = [...new Set(rows.map((r) => r.source_id).filter((id): id is string => !!id))].sort();
  return ids.map((sourceId) => ({ sourceId, online: null, assetCount: null, signalCount: null, lastUpdateUtc: null }));
}

export async function fetchStation(id: string, gatewayId: string): Promise<Station> {
  const all = await fetchStations(gatewayId);
  const s = all.find((x) => x.id === id);
  if (!s) throw new Error(`Site ${id} not found`);
  return s;
}
