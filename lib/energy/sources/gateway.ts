"use client";

/**
 * The real plant: NorthBound gateway telemetry, reshaped into an EnergySnapshot.
 *
 * This is the only file that knows both vocabularies. useBessLive speaks in
 * canonical metrics (battKw, soc, today's charge); the scene speaks in assets
 * (solar, bess, grid, load). Keeping the translation here means the renderer
 * never learns what a PCS register is, and a future MQTT or WebSocket feed only
 * has to produce an EnergySnapshot to drop straight in beside this.
 *
 * Sign conventions already agree — the PCS reports discharge positive, and so
 * does EnergySnapshot.bess.power — so nothing is flipped on the way through.
 * That was deliberate when the contract was written, and it survived the move
 * off UGX unchanged, which is the point of having had a contract.
 *
 * Nulls are carried, never filled. useBessLive blanks every reading once a
 * device passes its staleness window precisely so the dashboard cannot show a
 * dead plant's last words as the present, and that decision is respected here:
 * a null arrives as a null, the asset greys out, and no flow is drawn from it.
 */

import { siteLoadKw } from "@/lib/energy/load";
import { SITE_OVERLAY_FOR } from "@/lib/api/overlay/stations";
import { useMemo } from "react";
/* Central backend. Same BessLiveData shape, so everything below is unchanged —
   see hooks/useBessLiveCentral.ts for which figures are real and which are null
   because the utility meter is silent. */
import { useBessLiveCentral as useBessLive } from "@/hooks/useBessLiveCentral";
import { useSolarToday } from "@/hooks/useSolarToday";
import type { EnergySnapshot, EnergySource, BessStatus, GridStatus } from "../types";
import type { SiteAsset } from "../topology";
import { deriveFlows, FLOW_EPSILON_KW } from "../flows";

export interface GatewayEnergyOptions {
  /** Nameplate energy, kWh. Lets SOC % be shown as stored kWh; omit and that field stays null. */
  ratedCapacityKwh?: number | null;
  /** Days since commissioning, for the top strip. */
  runDays?: number | null;
  /** The site's assets. With PV and no grid, an unmetered solar is inferred. */
  assets?: SiteAsset[];
}

function bessStatus(power: number | null, soc: number | null): BessStatus {
  if (power == null && soc == null) return "offline";
  if (power == null) return "idle";
  if (power < -FLOW_EPSILON_KW) return "charging";
  if (power > FLOW_EPSILON_KW) return "discharging";
  return "idle";
}

function gridStatus(power: number | null): GridStatus {
  if (power == null) return "offline";
  if (power > FLOW_EPSILON_KW) return "importing";
  if (power < -FLOW_EPSILON_KW) return "exporting";
  return "balanced";
}

export function useGatewayEnergy(stationId: string, options: GatewayEnergyOptions = {}): EnergySource {
  const live = useBessLive(stationId);
  const pvToday = useSolarToday(stationId).data;
  const { ratedCapacityKwh = null, runDays = null, assets } = options;
  const co2Factor = SITE_OVERLAY_FOR(stationId).dieselCo2KgPerKwh ?? null;
  /* Solar + battery + load and no grid (the site owner's description, 1 Oct
     2026): every kW the battery takes comes from solar, and it discharges
     only when there is no solar. So with no PV reading, solar is inferred from
     the battery — a floor while charging, zero while discharging — and the
     scene can draw where power is going. */
  const offGrid = !!assets?.includes("pv") && !assets.includes("grid");
  const assetsKey = assets?.join(",") ?? "";

  const snapshot = useMemo<EnergySnapshot>(() => {
    const { battKw, gridKw, soc } = live;
    let solarKw = live.solarKw;
    let solarInferred: "min" | "zero" | undefined;
    if (solarKw == null && offGrid && battKw != null) {
      if (battKw < -FLOW_EPSILON_KW) { solarKw = -battKw; solarInferred = "min"; }
      else if (battKw > FLOW_EPSILON_KW) { solarKw = 0; solarInferred = "zero"; }
    }

    // Load is solar + battery, the site owner's definition — see lib/energy/load.
    // A solar floor is not a reading: load stays unknown while charging.
    const loadKw = siteLoadKw(solarInferred === "min" ? null : solarKw, battKw);

    const balance = pvToday?.kwh != null && live.chargedKwh != null && live.dischargedKwh != null
      ? pvToday.kwh - live.chargedKwh + live.dischargedKwh : null;
    const loadToday = balance != null && live.dischargedKwh != null
      ? Math.round(Math.max(balance, live.dischargedKwh) * 10) / 10
      : live.dischargedKwh;
    const loadTodayIsFloor = balance == null || !!pvToday?.isFloor || balance < (live.dischargedKwh ?? 0);

    const storedKwh =
      soc != null && ratedCapacityKwh != null ? (soc / 100) * ratedCapacityKwh : null;

    const renewableShare =
      loadKw != null && loadKw > 0.1 && solarKw != null
        ? Math.min(100, ((solarKw + Math.max(0, battKw ?? 0)) / loadKw) * 100)
        : null;

    return {
      solar: {
        power: solarKw,
        inferred: solarInferred,
        /* No yield register: ∫ PV power over today's S5/S6 rows (lib/energy/solarToday). */
        energy: pvToday?.kwh ?? null,
        energyIsFloor: pvToday?.isFloor,
        energyFrom: pvToday?.fromTs ?? null,
        status: solarKw == null ? "offline" : solarKw > 0.1 ? "generating" : "idle",
      },
      bess: {
        soc,
        power: battKw,
        energy: storedKwh,
        temperature: live.maxCellTempC ?? live.tempC,
        soh: live.soh,
        status: bessStatus(battKw, soc),
      },
      grid: {
        power: gridKw,
        voltage: null, // PCC voltage is not in the BESS profile; bank DC volts is not the same thing
        frequency: live.gridHz,
        status: gridStatus(gridKw),
      },
      load: {
        power: loadKw,
        /* Load today = solar today − charge today + discharge today (energy
           balance on a site with no grid). With solar only partly covered it
           is a floor; with no solar figure, today's discharge is the floor. */
        energy: loadToday,
        energyIsFloor: loadToday != null && loadTodayIsFloor,
        status: loadKw == null ? "offline" : loadKw > 0.1 ? "consuming" : "idle",
      },
      site: {
        runDays,
        /* Diesel displaced: lifetime discharge (the load, by the owner's rule)
           × the site's emission factor — an estimate, tonnes. */
        co2Avoided:
          live.totalDischargedKwh != null && co2Factor != null
            ? Math.round((live.totalDischargedKwh * co2Factor) / 100) / 10
            : null,
        lifetimeYield:
          live.totalDischargedKwh != null ? live.totalDischargedKwh / 1000 : null,
        renewableShare,
      },
      timestamp: live.lastTs,
      ready: !live.isLoading,
      live: live.isLive,
      stale: live.isStale,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, pvToday, ratedCapacityKwh, runDays, offGrid, assetsKey, co2Factor]);

  return useMemo(
    () => ({ snapshot, flows: deriveFlows(snapshot) }),
    [snapshot],
  );
}
