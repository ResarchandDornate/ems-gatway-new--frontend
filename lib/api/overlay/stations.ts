/**
 * Per-source overlay for fields the gateway does not store.
 * Keyed by NorthBound gateway `source_id` (GET /api/sources/summary).
 *
 * The gateway is a telemetry device. It publishes what its Modbus maps carry —
 * 2,844 points across nine assets — and nowhere in that dictionary is there a
 * rated capacity, a commissioning date, a tariff or a street address. Those are
 * commercial facts about an installation, and they have to be written down by
 * somebody who knows them.
 *
 * This file is where they are written down.
 *
 * To add a source to the dashboard with full metadata:
 *   1. Read the ids from GET /api/sources/summary (external_ems_1, …).
 *   2. Add an entry to OVERLAY below.
 *   3. Save — the dashboard picks it up on next page load.
 *
 * Sources without an entry still appear, under the gateway's own display name,
 * with DEFAULT_OVERLAY for the rest.
 */

import type { Station, StationStatus, StationType } from "@/lib/api/types";
import type { SiteAsset } from "@/lib/energy/topology";
import { DEMO_GATEWAY_ID } from "@/lib/central/demoGateway";

/**
 * Per-station Time-of-Day tariff rates in ₹/kWh.
 * Set from the site's DISCOM tariff order.
 * If absent, DEFAULT_TOD_RATES from curveReport.service is used.
 */
export interface TodRates {
  peak:     number;   // ₹/kWh — typically 18:00–22:00 IST
  shoulder: number;   // ₹/kWh — typically 06:00–10:00 and 22:00–24:00 IST
  flat:     number;   // ₹/kWh — mid-day baseline
  valley:   number;   // ₹/kWh — off-peak / night
}

export interface StationOverlay {
  /** Organisation that owns the site — the top of the station-bar path. */
  organisation?: string;
  /** Assets on site. Overrides detection from the gateway's streams —
   *  set it only where detection is wrong (lib/energy/detectAssets.ts). */
  assets?: SiteAsset[];
  powerStationName?: string;
  powerStationEnglishName?: string;
  hasBess?: boolean;                     // true = UnityESS cabinet present
  installedCapacity?: number;            // kWh — set per unit count (261, 418, …)
  installedPower?: number;               // kW
  energyStorageCabinetNum?: number;
  matrixNum?: number;
  electricMeterId?: string;
  electricMeterNumber?: string;
  operationTime?: string;                // ISO YYYY-MM-DD
  status?: StationStatus;
  tacticsLevel?: number;
  powerStationType?: StationType;
  stationLocation?: string;              // Gateway carries no address; state it here
  accumulations?: { totalCharge: number; totalDischarge: number; totalRevenue: number };
  todRates?: TodRates;                   // Site-specific DISCOM tariff rates in ₹/kWh
  /**
   * Sanctioned (contract) demand in kVA, from the connection agreement.
   *
   * The figure the DISCOM bills demand against and penalises excess over. Not
   * telemetry and not derivable from it: the meter reports what is drawn, and
   * only the agreement says what was contracted.
   */
  contractDemandKva?: number;
  /** Demand charge in ₹ per kVA per month, from the tariff order. */
  demandChargeRs?: number;
  /**
   * What the DISCOM pays for an exported unit, ₹/kWh.
   *
   * Rarely the same as the import rate and often far below it — many Indian
   * C&I connections settle export at an APPC-linked figure or at nothing at
   * all. The gap between this and the import rate is what makes exporting a
   * unit you later buy back a loss rather than a wash.
   */
  exportRateRs?: number;
  /**
   * What a kWh of the site's load would cost from diesel, ₹/kWh. Revenue is
   * load energy × this — the diesel the battery displaces (lib/energy/load).
   */
  dieselRateRs?: number;
  /**
   * kg CO₂ per kWh of diesel generation the battery displaces, for "CO₂
   * avoided". An estimate, not a measurement: ~2.68 kg CO₂ per litre of
   * diesel (IPCC) ÷ ~3.3 kWh per litre for a small genset ≈ 0.8. Replace with
   * the site DG's own fuel figure when known.
   */
  dieselCo2KgPerKwh?: number;
  /**
   * False when the site has no load to chart. Load is derived from battery
   * discharge (lib/energy/load), so a site with none still draws a "load"
   * from the battery's own draw. Unset = shown.
   */
  hasLoad?: boolean;
  gridName?: string;                     // Display label for the AC grid node (default "1#Grid")
  matrixName?: string;                   // Display label for the matrix/cluster node
  /** What the site's gateway is called on screen; the id stays in its tooltip. */
  gatewayName?: string;
}

export const OVERLAY: Record<string, StationOverlay> = {
  /* ── The commissioned site ────────────────────────────────────────────────
     Two BESS behind one gateway. The gateway calls them "Chinese EMS 1" and
     "Chinese EMS 2" — the vendor's own labels, carried through from the EMS
     controllers — which is accurate and is not what an operator should be
     reading on a dashboard, so they are renamed here.

     installedCapacity is 261 kWh per cabinet, as the site owner stated on
     1 Oct 2026. installedPower per cabinet is still unknown — the site total
     (261 kW) is on SITE_OVERLAY below. Before that, both were left at 0. Nothing in the
     gateway states them: the 63-signal profile carries SOC, SOH and available
     charge/discharge power, and the full 2,844-point dictionary carries no
     rated capacity at any asset. A plausible number written here would be
     indistinguishable on screen from a measured one, and every ratio computed
     from it — utilisation, cycles, depth of discharge — would inherit the
     guess silently. Fill them in from the commissioning documents, and until
     then the dashboard shows 0 because 0 is what is known. */

  external_ems_1: {
    powerStationName: "UnityESS · Unit 1",
    powerStationEnglishName: "UnityESS · Unit 1",
    hasBess: true,
    energyStorageCabinetNum: 1,
    matrixNum: 1,
    tacticsLevel: 2,
    powerStationType: "industrial",
    installedCapacity: 261,   // site owner, 1 Oct 2026
    // TODO: from commissioning docs — installedPower (kW per cabinet),
    // operationTime, stationLocation, electricMeterNumber, todRates.
  },

  external_ems_2: {
    powerStationName: "UnityESS · Unit 2",
    powerStationEnglishName: "UnityESS · Unit 2",
    hasBess: true,
    energyStorageCabinetNum: 1,
    matrixNum: 1,
    tacticsLevel: 2,
    powerStationType: "industrial",
    installedCapacity: 261,   // site owner, 1 Oct 2026
    // TODO: as above.
  },
};

/* ── The demo plant's commercial facts — REMOVED 25 September 2026 ────────
   A DEMO_FACTS table used to be merged over the entries above whenever
   NEXT_PUBLIC_GW_DEMO was set, and the flag was set in .env.local. It supplied
   an installed capacity of 261 kWh, a rating of 125 kW, a Sanand address, meter
   numbers, a contract demand of 500 kVA and a four-slot ToD card at
   9.85/7.40/6.55/4.90 rupees.

   None of it was real, and seven live services read it through overlayFor:
   curveReport priced energy with those tariffs, maxDemand billed against that
   contract demand, energyFlows valued export at that rate, roundTrip divided by
   that capacity, and scada and fleet showed the address and rating. Nothing on
   screen distinguished any of it from a measurement.

   The file's own warning said the rates were a plausible card and "must never
   be copied onto a real site". With the flag on, they effectively were.

   Removed rather than switched off: a flag can be set again by accident, and
   the failure is silent. Real figures belong in OVERLAY above, from the
   commissioning documents — docs/tariff/README.md insists a second person
   verify every rate before it is published. Until they are written down, the
   screens show a dash, which is what is known. */

/** The overlay entry for a source. Nothing is merged over it. */
export function overlayFor(sourceId: string): StationOverlay {
  return OVERLAY[sourceId] ?? {};
}


export const DEFAULT_OVERLAY: Required<Pick<StationOverlay,
  "installedCapacity" | "installedPower" | "energyStorageCabinetNum" | "matrixNum" |
  "electricMeterId" | "electricMeterNumber" | "status" | "tacticsLevel" |
  "powerStationType" | "accumulations"
>> = {
  installedCapacity: 0,
  installedPower: 0,
  energyStorageCabinetNum: 0,
  matrixNum: 0,
  electricMeterId: "",
  electricMeterNumber: "",
  /* Offline, not online. The previous default was "online" and it was read by
     any station the overlay did not name — so an unknown source rendered a
     green badge before a single byte of telemetry had arrived. A station whose
     connectivity is unknown is not a station that is up. */
  status: "offline",
  tacticsLevel: 1,
  powerStationType: "industrial",
  accumulations: { totalCharge: 0, totalDischarge: 0, totalRevenue: 0 },
};

/**
 * Merge a gateway source summary with its overlay into the frontend Station
 * shape.
 *
 * @param liveStatus Connectivity as the gateway reports it (`online` on
 *   /api/sources/summary). It wins over the overlay, which carries no status at
 *   all for the commissioned units: a literal cannot know whether a plant is
 *   answering, and the previous UGX overlay had exactly that bug — a site that
 *   had gone dark still rendered a green badge because a constant said so.
 */
/**
 * ONE CABINET as a Station — not what the picker lists.
 *
 * Superseded by siteToStation on 25 Sep 2026, when a station became the site.
 * Kept because per-cabinet metadata is a real need the moment anything shows a
 * cabinet's own name, rating or commissioning date, and the OVERLAY entries it
 * reads are keyed on source_id for exactly that.
 *
 * Nothing calls it today. If you are reaching for it to build a station list,
 * you want siteToStation instead — this one would give you two stations for a
 * site that has one.
 */
export function sourceToStation(
  s: {
    source_id: string;
    display_name?: string | null;
    online?: boolean | null;
    last_seen_utc?: string | null;
  },
  liveStatus?: StationStatus,
): Station {
  const ov = overlayFor(s.source_id);
  const def = DEFAULT_OVERLAY;

  /* `online` is tri-state on the wire: true, false, or null for "the gateway
     did not say". Null must not collapse to offline — it is the difference
     between a plant that is down and a field the summary omitted. */
  const derived: StationStatus | undefined =
    liveStatus ?? (s.online == null ? undefined : s.online ? "online" : "offline");

  return {
    id: s.source_id,
    /* A cabinet is served by exactly the controller it belongs to. */
    sourceIds: [s.source_id],
    powerStationName: ov.powerStationName ?? s.display_name ?? s.source_id,
    powerStationEnglishName: ov.powerStationEnglishName ?? s.display_name ?? s.source_id,
    hasBess: ov.hasBess ?? true,
    installedCapacity: ov.installedCapacity ?? def.installedCapacity,
    installedPower: ov.installedPower ?? def.installedPower,
    energyStorageCabinetNum: ov.energyStorageCabinetNum ?? def.energyStorageCabinetNum,
    matrixNum: ov.matrixNum ?? def.matrixNum,
    electricMeterId: ov.electricMeterId ?? def.electricMeterId,
    electricMeterNumber: ov.electricMeterNumber ?? def.electricMeterNumber,
    operationTime: ov.operationTime ?? "",
    status: derived ?? ov.status ?? def.status,
    tacticsLevel: ov.tacticsLevel ?? def.tacticsLevel,
    powerStationType: ov.powerStationType ?? def.powerStationType,
    /* The gateway publishes no address. Empty renders as a dash, which is
       honest; the overlay is where a real one goes. */
    stationLocation: ov.stationLocation ?? "",
    accumulations: ov.accumulations ?? def.accumulations,
  };
}

/* ── Site-level overlay ───────────────────────────────────────────────────
   Keyed by GATEWAY id, because that is the only site-level identifier the
   backend has. The per-source entries above stay: they describe a cabinet,
   which is the level the unit picker selects, and they are where per-cabinet
   labels belong once anything shows them.

   Everything here is a commercial fact. None of it is derivable from the
   1,174 points the gateway publishes — installedCapacity in particular has no
   register on any asset, which is why it stays 0 until someone reads it off
   the commissioning documents. A plausible number written here would be
   indistinguishable on screen from a measured one. */
export const SITE_OVERLAY: Record<string, StationOverlay> = {
  "bd57016e-9a31-4ed9-b107-018c36d33bc7": {
    organisation: "Ornate Solar",
    /* Site owner, 1 Oct 2026: solar, battery and load. Stated rather than
       detected — the Solis inverter is not on the central backend, so
       detection cannot see the solar, and the grid is not part of this site's
       picture. */
    assets: ["pv", "bess", "load"],
    powerStationName: "PV Powertech",
    powerStationEnglishName: "PV Powertech",
    hasBess: true,
    powerStationType: "industrial",
    tacticsLevel: 2,
    /* Two cabinets, which is what the gateway reports when it is answering.
       Written here so a quiet gateway does not make the site read as having
       none — the live roster still wins whenever there is one. */
    energyStorageCabinetNum: 2,
    /* Two 261 kWh cabinets (site owner, 1 Oct 2026). Power is the single-line
       drawing's 2 × 125 kW PCS: the 261 kW given on 1 Oct matched the
       cabinet's kWh rather than any rating, and the PCS rated-power registers
       read 130 kW each, the converter's maximum. Site totals. */
    installedCapacity: 261 * 2,
    installedPower: 125 * 2,
    gatewayName: "Gateway 1",
    /* Site owner, 1 Oct 2026: revenue = load kWh × ₹30, the diesel cost. */
    dieselRateRs: 30,
    /* Estimate (see dieselCo2KgPerKwh) — confirm against DG-01's fuel data. */
    dieselCo2KgPerKwh: 0.8,
    /* Site owner, 6 Oct 2026: no load on this site, so no Load chart. */
    hasLoad: false,
    // TODO from commissioning documents: operationTime, stationLocation, electricMeterNumber, todRates,
    // contractDemandKva. See docs/dashboard-api-mapping.md section 7.
  },

  /* EMS-gateway-backend2 gateways. Names only — no nameplate, commissioning
     date or tariff is known yet, so those stay unset and render as "—". */
  "1545be97-67a4-4491-9bc8-48070fe9e607": {   // test-gw-01 · cleanedge_kinetics
    powerStationName: "Cleanedge",
    powerStationEnglishName: "Cleanedge",
  },
  "ed61e2a6-4866-4cde-8a8e-7a70e2a64efd": {   // ems-gw-1 · kalpa_lineage_elecod
    powerStationName: "Kalpa",
    powerStationEnglishName: "Kalpa",
  },

  /* The demo plant behind the `customer` sign-in (lib/server/central/demo.ts).
     Every figure here is as made up as its telemetry. */
  [DEMO_GATEWAY_ID]: {
    organisation: "UnityESS Demo",
    assets: ["pv", "bess", "load", "grid"],
    powerStationName: "Demo Solar + Storage",
    powerStationEnglishName: "Demo Solar + Storage",
    hasBess: true,
    powerStationType: "industrial",
    tacticsLevel: 2,
    energyStorageCabinetNum: 2,
    installedCapacity: 261 * 2,
    installedPower: 125 * 2,
    operationTime: "2026-09-15",   // DAY0 in lib/server/central/demo.ts
    gatewayName: "Gateway 1",
    stationLocation: "Pune, Maharashtra",
    dieselRateRs: 30,
    dieselCo2KgPerKwh: 0.8,
  },
};

/** Coordinates per SITE. One pin, because one gateway is one place.
 *
 *  The table this replaced was keyed on UGX station UUIDs, which no central
 *  backend id can ever match — so every marker fell back to the centre of the
 *  country and stacked on a single point. Latent only while the station list
 *  was empty. Retire this when GET /sites carries latitude and longitude. */
export const SITE_GEO: Record<string, { lat: number; lng: number }> = {
  // Sanand II Industrial Estate, Ahmedabad, Gujarat — the commissioned site.
  "bd57016e-9a31-4ed9-b107-018c36d33bc7": { lat: 22.98, lng: 72.38 },
  [DEMO_GATEWAY_ID]: { lat: 18.52, lng: 73.86 },
};

/** Fallback when a site has no coordinate yet. */
export const INDIA_CENTRE = { lat: 22.0, lng: 80.0 };

/**
 * Build the single site Station from the gateway's source roster.
 *
 * @param ratedKw Summed PCS nameplate in kW, or null when it could not be
 *   read. Used only when the overlay states no installedPower; null then
 *   falls to the default rather than 0, because a site whose rating is
 *   unknown is not a site rated at zero.
 */
export function siteToStation(
  gatewayId: string,
  sources: {
    sourceId: string;
    online: boolean | null;
    assetCount: number | null;
    signalCount: number | null;
    lastUpdateUtc: string | null;
  }[],
  ratedKw: number | null,
  profileName: string | null = null,
): Station {
  const ov = SITE_OVERLAY[gatewayId] ?? {};
  const def = DEFAULT_OVERLAY;

  /* Online if ANY controller is answering. A site with one cabinet down is
     degraded, not offline, and the unit picker is where that is visible.
     All-null — the gateway said nothing either way — stays unknown rather
     than collapsing to offline. */
  const anyKnown = sources.some((s) => s.online !== null);
  const status: StationStatus | undefined = anyKnown
    ? (sources.some((s) => s.online) ? "online" : "offline")
    : undefined;

  return {
    id: gatewayId,
    organisation: ov.organisation,
    gatewayId,
    gatewayName: ov.gatewayName ?? profileName ?? undefined,
    assets: ov.assets,
    sourceIds: sources.map((s) => s.sourceId),
    powerStationName: ov.powerStationName ?? profileName ?? gatewayId,
    powerStationEnglishName: ov.powerStationEnglishName ?? profileName ?? gatewayId,
    hasBess: ov.hasBess ?? true,
    installedCapacity: ov.installedCapacity ?? def.installedCapacity,
    /* A stated nameplate wins over the register read: the PCS rating register
       is what the inverter reports, not what the site was commissioned at. */
    installedPower: ov.installedPower ?? ratedKw ?? def.installedPower,
    /* Counted when the gateway is answering — one BESS behind each EMS
       controller, which is what it reports: external_ems_1 → bess_1, _2 →
       bess_2. An empty roster means it is not answering, not that the site has
       no cabinets, so the overlay's figure is used rather than 0. */
    energyStorageCabinetNum: sources.length || ov.energyStorageCabinetNum || def.energyStorageCabinetNum,
    matrixNum: ov.matrixNum ?? (sources.length || def.matrixNum),
    electricMeterId: ov.electricMeterId ?? def.electricMeterId,
    electricMeterNumber: ov.electricMeterNumber ?? def.electricMeterNumber,
    operationTime: ov.operationTime ?? "",
    status: status ?? ov.status ?? def.status,
    tacticsLevel: ov.tacticsLevel ?? def.tacticsLevel,
    powerStationType: ov.powerStationType ?? def.powerStationType,
    stationLocation: ov.stationLocation ?? "",
    accumulations: ov.accumulations ?? def.accumulations,
  };
}

/** The site overlay for a gateway, or an empty one. */
export const SITE_OVERLAY_FOR = (gatewayId: string): StationOverlay =>
  SITE_OVERLAY[gatewayId] ?? {};

/** The gateway's display name: the site overlay's, else "Gateway" and the id's first eight characters. */
export const gatewayLabel = (gatewayId: string): string =>
  SITE_OVERLAY[gatewayId]?.gatewayName ?? `Gateway ${gatewayId.slice(0, 8)}`;
