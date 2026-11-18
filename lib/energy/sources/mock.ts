"use client";

/**
 * A synthetic plant, for demos and for developing the scene without a site.
 *
 * The numbers are not random walk noise — they are a compressed day. A full
 * 24 h cycle plays out every `DAY_SECONDS`, so within a minute of watching you
 * see PV come up, surplus charge the bank, the bank carry the evening peak and
 * the grid take over at night. That matters because the whole point of the
 * visualisation is the *transitions*: a mock that jitters around one operating
 * point would let us ship a scene that looks right and animates wrong.
 *
 * Replacing this with a real feed is a swap of one hook — see EnergyProvider.
 */

import { useEffect, useState } from "react";
import type { EnergySnapshot, EnergySource } from "../types";
import { deriveFlows } from "../flows";

/** Wall-clock seconds per simulated 24 h. */
const DAY_SECONDS = 120;

/** Plant sizing the mock is scaled against. */
const PV_PEAK_KW = 12.0;
const BANK_CAPACITY_KWH = 26.0;
const BASE_LOAD_KW = 2.4;

/** Bell curve peaking at solar noon, zero before dawn and after dusk. */
function pvCurve(hour: number): number {
  const dawn = 6.2;
  const dusk = 18.4;
  if (hour < dawn || hour > dusk) return 0;
  const phase = (hour - dawn) / (dusk - dawn); // 0 → 1 across daylight
  return Math.sin(phase * Math.PI) ** 1.6;
}

/** Two-humped commercial profile: morning start-up and an evening peak. */
function loadCurve(hour: number): number {
  const morning = Math.exp(-(((hour - 10.0) / 2.6) ** 2));
  const evening = Math.exp(-(((hour - 19.5) / 2.0) ** 2));
  return BASE_LOAD_KW + 4.6 * morning + 6.2 * evening;
}

function simulate(elapsedSeconds: number): EnergySnapshot {
  const hour = ((elapsedSeconds / DAY_SECONDS) * 24) % 24;

  const solarKw = PV_PEAK_KW * pvCurve(hour);
  const loadKw = loadCurve(hour);

  // Surplus charges, deficit discharges — the same self-consumption intent the
  // flow allocator assumes, so mock and renderer tell a consistent story.
  const surplus = solarKw - loadKw;

  // SOC follows a smooth diurnal shape rather than being integrated, so the
  // mock stays stateless and any observer joining mid-cycle sees a coherent
  // plant instead of whatever the accumulator happened to drift to.
  const socShape = 0.5 - 0.5 * Math.cos(((hour - 7) / 24) * 2 * Math.PI);
  const soc = 22 + 62 * socShape;

  let battKw: number; // + discharge, − charge
  if (surplus > 0.3 && soc < 96) {
    battKw = -Math.min(surplus, 6.5);        // absorb surplus PV
  } else if (surplus < -0.3 && soc > 18) {
    battKw = Math.min(-surplus, 7.5);        // carry the deficit
  } else {
    battKw = 0;                              // full, empty, or balanced
  }

  // Grid closes the balance: import what solar and the bank cannot cover,
  // export what they cannot absorb.
  const gridKw = loadKw - solarKw - battKw;

  const daylightSoFar = Math.max(0, Math.min(hour, 18.4) - 6.2);

  return {
    solar: {
      power: solarKw,
      energy: PV_PEAK_KW * 0.52 * daylightSoFar,
      status: solarKw > 0.1 ? "generating" : "idle",
    },
    bess: {
      soc,
      power: battKw,
      energy: (soc / 100) * BANK_CAPACITY_KWH,
      temperature: 28.5 + 4.2 * Math.abs(battKw) / 7.5,
      soh: 98.6,
      status: battKw < -0.05 ? "charging" : battKw > 0.05 ? "discharging" : "idle",
    },
    grid: {
      power: gridKw,
      voltage: 33,
      frequency: 49.98 + Math.sin(elapsedSeconds * 0.6) * 0.03,
      status: gridKw > 0.05 ? "importing" : gridKw < -0.05 ? "exporting" : "balanced",
    },
    load: {
      power: loadKw,
      energy: loadKw * hour * 0.86,
      status: loadKw > 0.1 ? "consuming" : "idle",
    },
    site: {
      runDays: 4792,
      co2Avoided: 4792,
      lifetimeYield: 792,
      renewableShare: Math.min(100, ((solarKw + Math.max(0, battKw)) / Math.max(loadKw, 0.1)) * 100),
    },
    timestamp: Date.now(),
    ready: true,
    live: true,
    stale: false,
  };
}

/** Refresh cadence, ms. 4 Hz reads as continuous without re-rendering wastefully. */
const TICK_MS = 250;

export function useMockEnergy(): EnergySource {
  const [snapshot, setSnapshot] = useState<EnergySnapshot>(() => simulate(0));

  useEffect(() => {
    const started = performance.now();
    const id = window.setInterval(() => {
      setSnapshot(simulate((performance.now() - started) / 1000));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return { snapshot, flows: deriveFlows(snapshot) };
}
