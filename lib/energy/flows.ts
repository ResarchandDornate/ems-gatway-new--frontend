/**
 * Turning four scalars into the arrows between four assets.
 *
 * Telemetry gives us net power per asset — how much PV is making, whether the
 * bank is charging, whether the meter is importing. It does not give us the
 * routing, because no meter measures "how many of the load's kilowatts came
 * from the roof". That has to be inferred, and the inference is a merit order.
 *
 * Sources are drawn from in the order solar → battery → grid, and sinks are
 * filled in the order load → battery → grid. That ordering is the whole model,
 * and it encodes the operating intent of a behind-the-meter BESS:
 *
 *   · self-consume before storing        (solar fills load first)
 *   · store before exporting             (surplus PV charges the bank)
 *   · discharge before importing         (the bank beats the utility)
 *   · import only what is left over      (grid is the balancer of last resort)
 *
 * So the same 8.2 kW of PV draws a different picture depending on what else is
 * happening, which is exactly what makes the scene worth watching.
 *
 * The one thing this deliberately does NOT do is force a balance. If the
 * numbers do not reconcile — a missing meter, a site with unmetered auxiliary
 * load, a reading mid-transient — the leftover is left over rather than
 * smeared across the arrows to make the picture tidy. A flow diagram that
 * always balances is a flow diagram that cannot tell you a meter is broken.
 */

import type { AssetId, EnergyFlow, EnergySnapshot } from "./types";

/**
 * Below this, a flow is noise rather than a transfer.
 *
 * Meters idle at a few tens of watts and sign-flip around zero; without a
 * deadband the scene flickers arrows on and off while nothing is happening.
 */
export const FLOW_EPSILON_KW = 0.05;

interface Bucket {
  id: AssetId;
  remaining: number;
}

/**
 * Greedy merit-order allocation between available sources and unfilled sinks.
 *
 * Order within each array is the priority; the first source is drained into the
 * first sink until one of them runs out, and so on.
 */
function allocate(sources: Bucket[], sinks: Bucket[]): EnergyFlow[] {
  const flows: EnergyFlow[] = [];

  for (const source of sources) {
    for (const sink of sinks) {
      // An asset never feeds itself: a charging battery is not also discharging.
      if (source.id === sink.id) continue;
      if (source.remaining < FLOW_EPSILON_KW) break;
      if (sink.remaining < FLOW_EPSILON_KW) continue;

      const amount = Math.min(source.remaining, sink.remaining);
      source.remaining -= amount;
      sink.remaining -= amount;

      flows.push({
        id: `${source.id}->${sink.id}`,
        from: source.id,
        to: sink.id,
        power: amount,
        active: amount >= FLOW_EPSILON_KW,
      });
    }
  }

  return flows;
}

/** Treat a missing reading as "contributes nothing", never as a zero reading. */
const known = (v: number | null): number => (v == null ? 0 : v);

/**
 * Derive the directed flows implied by a snapshot.
 *
 * Returns only flows above the deadband, ordered strongest first so that
 * overlapping routes draw the dominant one on top.
 */
export function deriveFlows(snapshot: EnergySnapshot): EnergyFlow[] {
  const solar = Math.max(0, known(snapshot.solar.power));
  const batt = known(snapshot.bess.power);
  const grid = known(snapshot.grid.power);
  const load = Math.max(0, known(snapshot.load.power));

  // Split the signed readings into the source half and the sink half.
  const discharge = Math.max(0, batt);   // bank as a source
  const charge = Math.max(0, -batt);     // bank as a sink
  const importing = Math.max(0, grid);   // utility as a source
  const exporting = Math.max(0, -grid);  // utility as a sink

  const sources: Bucket[] = [
    { id: "solar", remaining: solar },
    { id: "bess", remaining: discharge },
    { id: "grid", remaining: importing },
  ];

  const sinks: Bucket[] = [
    { id: "load", remaining: load },
    { id: "bess", remaining: charge },
    { id: "grid", remaining: exporting },
  ];

  return allocate(sources, sinks)
    .filter((f) => f.active)
    .sort((a, b) => b.power - a.power);
}

/**
 * Largest flow in the set, used to normalise particle density and speed.
 *
 * Returns null when nothing is moving, so callers can distinguish "an idle
 * plant" from "a plant whose biggest flow happens to be small".
 */
export function peakFlow(flows: EnergyFlow[]): number | null {
  if (flows.length === 0) return null;
  return Math.max(...flows.map((f) => f.power));
}
