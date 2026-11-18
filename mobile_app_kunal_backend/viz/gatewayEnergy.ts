"use client";

/**
 * This site, as the 3D energy scene wants to hear about it.
 *
 * The mirror of lib/energy/sources/ugx.ts, for the other data layer. That file
 * translates the UGX poller; this one translates the gateway proxy the mobile
 * app already reads, and both produce the same EnergySnapshot — which is the
 * whole reason the scene can be mounted here without a line of it changing.
 *
 * Sign conventions already agree, and that is not luck: EnergySnapshot was
 * written against the UnityESS `stack_power` convention, so PCS active power is
 * positive on discharge on both sides of this function, and the utility meter
 * is positive on import on both. Nothing is flipped on the way through, and
 * anything that ever needs to be should be flipped here rather than in the
 * renderer.
 *
 * Nulls are carried, never filled. The data layer under this already refuses to
 * report a figure nobody measured — useSite nulls every meter reading when
 * `communication_status` says the meter is not talking, and useSolis nulls
 * `powerKw` when the inverter is unreachable rather than calling it 0.0 kW —
 * and that decision is respected here. A null arrives as a null, the asset
 * greys out, and no flow is drawn from it. Which is exactly what the scene
 * should show for a plant it cannot see.
 */

import { useMemo } from "react";

import type {
  BessStatus, EnergySnapshot, EnergySource, GridStatus,
} from "@/lib/energy/types";
import { deriveFlows, FLOW_EPSILON_KW } from "@/lib/energy/flows";

import { useReadings, useSite, useSolis } from "../data";

/* Restated rather than imported from sources/ugx.ts. Importing that file would
   pull useBessLive and the whole UGX API client into a bundle that has no use
   for either — it is ten lines of thresholds, and the alternative is a data
   layer. */

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

/**
 * The plant, for the scene.
 *
 * Three feeds, deliberately, and they are the three this app already polls: the
 * 63-signal fast profile at 5 s for the battery, the 1,422-signal snapshot at
 * 15 s for the meter and the site load, and the PV inverter at 30 s. All three
 * go through react-query under keys their own screens already use, so mounting
 * the scene adds no request — it reads the caches the dashboard has filled.
 */
export interface GatewayEnergyOptions {
  /**
   * Nameplate energy, kWh. Lets SOC be reported as stored kWh.
   *
   * An argument because the gateway does not publish one. It publishes
   * `pcs_1.rated_power`, which is the inverter's kW and a different quantity
   * entirely — using it here would put a power rating behind an energy figure
   * and be wrong by whatever the C-rate happens to be. Omit it and the stored
   * field stays null, which is the honest answer for a site whose capacity
   * nobody has told this app.
   */
  ratedCapacityKwh?: number | null;
}

export function useGatewayEnergy({
  ratedCapacityKwh = null,
}: GatewayEnergyOptions = {}): EnergySource {
  const r = useReadings();
  const site = useSite();
  const solis = useSolis();

  const snapshot = useMemo<EnergySnapshot>(() => {
    const battKw = r.powerKw;
    const gridKw = site.gridKw;
    const solarKw = solis.available ? solis.powerKw : null;

    /* The EMS's own load register, not grid + battery + solar.
     *
     * The UGX adapter derives load because it has no load signal. This gateway
     * publishes one — ems_system.load_power, which useSite reads — and a
     * measured figure beats a sum of three others every time: the derived form
     * needs all three inputs present to produce anything at all, so on this
     * site it would go null the moment the utility meter stopped talking, which
     * is the condition under which it is currently sitting. */
    const loadKw = site.loadKw;

    /* Stored energy, only when a capacity was supplied. See the option's note:
       the gateway has no kWh nameplate to read, and inventing one would put a
       confident number under a label nobody measured. */
    const storedKwh =
      r.soc != null && ratedCapacityKwh != null ? (r.soc / 100) * ratedCapacityKwh : null;

    /* What share of the site's demand is not coming from the utility.
     *
     * Solar plus whatever the battery is discharging, over load. Charging does
     * not count — Math.max(0, …) — because energy going into the bank is not
     * energy serving the site, and counting it would have the figure climb
     * while the plant imports to charge.
     *
     * Null unless every term is measured. A share computed from a load figure
     * with no meter behind it is a number about nothing, and this card is the
     * one a customer reads first. */
    const renewableShare =
      loadKw != null && loadKw > 0.1 && solarKw != null && battKw != null
        ? Math.min(100, ((solarKw + Math.max(0, battKw)) / loadKw) * 100)
        : null;

    return {
      solar: {
        power: solarKw,
        /* The inverter endpoint reports instantaneous power only; daily yield
           is not in the reply. Null, not zero — see the file header. */
        energy: null,
        status: solarKw == null ? "offline" : solarKw > 0.1 ? "generating" : "idle",
      },
      bess: {
        soc: r.soc,
        power: battKw,
        energy: storedKwh,
        /* The hottest cell, not the average. A thermal problem is a cell
           problem, and an average is exactly the statistic that hides one. */
        temperature: r.tempMax ?? r.tempAvg,
        soh: r.soh,
        status: bessStatus(battKw, r.soc),
      },
      grid: {
        power: gridKw,
        /* PCC voltage is not published. The bank's DC volts are, and they are
           not the same quantity — naming one as the other would put a plausible
           wrong number under a label an operator trusts. */
        voltage: null,
        frequency: site.gridHz,
        status: gridStatus(gridKw),
      },
      load: {
        power: loadKw,
        energy: null,
        status: loadKw == null ? "offline" : loadKw > 0.1 ? "consuming" : "idle",
      },
      site: {
        /* Commissioning date is not in the gateway's reply, and CO₂ avoided
           needs a grid emissions factor this app has never been given. Both
           null rather than estimated; the overlay that would show them is off
           on this screen anyway. */
        runDays: null,
        co2Avoided: null,
        /* The inverter's own lifetime AC discharge counter, kWh → MWh. A plant
           counter, not something integrated on the phone. */
        lifetimeYield:
          site.acDischargedKwhTotal != null ? site.acDischargedKwhTotal / 1000 : null,
        renewableShare,
      },
      timestamp: r.row?.timestamp_epoch_ms ?? null,
      ready: !r.isLoading,
      /* "Something real arrived", which is not the same as "a request
         succeeded": a snapshot of nothing but nulls is a reachable gateway with
         nothing to say, and the scene should grey out for it exactly as it does
         for an unreachable one. */
      live: battKw != null || r.soc != null || gridKw != null || loadKw != null,
      stale: r.isStale,
    };
  }, [r, site, solis, ratedCapacityKwh]);

  return useMemo(() => ({ snapshot, flows: deriveFlows(snapshot) }), [snapshot]);
}
