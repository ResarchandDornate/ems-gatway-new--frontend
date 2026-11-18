/* NORTHBOUND GATEWAY — DISABLED 24 September 2026.
 * Commented out in place; the export surface now lives in the stub at the
 * foot of lib/gateway/index.ts. Nothing imports this file while it stands.
 * See docs/central-backend-s1-contract.md. */

export {};

// "use client";
//
// /**
//  * How the website reads the NorthBound EMS Gateway.
//  *
//  * Every call goes to the proxy at /api/gw, never to the gateway host. The
//  * reasons are the proxy's own (mobile_app_kunal_backend/gateway/proxy.ts) and
//  * all three still apply here: the gateway is a field device behind a tunnel
//  * with no reason to allow a browser origin, its address is not something a page
//  * should know, and control endpoints are refused server-side rather than merely
//  * hidden in a client that a determined person can modify.
//  *
//  * `gw` itself is /k's, re-exported rather than reimplemented — it carries the
//  * bearer token, the site header, the 401 purge that surfaces the login screen,
//  * and the `items`/`rows` envelope reconciliation that cost somebody a day when
//  * the alarms screen showed nothing over a plant reporting 150 alarms.
//  */
//
// export { gw, type GwResponse } from "@/mobile_app_kunal_backend/gateway/client";
//
// import { gw } from "@/mobile_app_kunal_backend/gateway/client";
//
// /**
//  * One decoded telemetry point.
//  *
//  * The gateway wraps each signal as { value, quality, unit, address } on most
//  * assets and returns a bare scalar on a few, so both are accepted.
//  *
//  * A point whose quality is anything but "good" resolves to null rather than to
//  * its value. The gateway holds the last decoded number in place when a read
//  * fails, so trusting the value alone presents a stale register as a live
//  * reading — and nothing downstream can tell the difference. Same rule as
//  * client.ts's leafValue, and it has to be the same rule.
//  */
// export function leafValue(v: unknown): number | null {
//   if (typeof v === "number") return Number.isFinite(v) ? v : null;
//   if (v && typeof v === "object") {
//     const o = v as Record<string, unknown>;
//     if (typeof o.quality === "string" && o.quality !== "good") return null;
//     if (typeof o.value === "number") return Number.isFinite(o.value) ? o.value : null;
//   }
//   return null;
// }
//
// /** asset (base id) → signal → decoded value. Null where the gateway sent none. */
// export type SignalMap = Record<string, Record<string, number | null>>;
//
// /**
//  * asset → signal → engineering unit, as the gateway states it.
//  *
//  * Carried rather than inferred. The UGX client guessed a unit from the shape of
//  * the key name — `kW_` prefixes, a `temp` substring — because ThingsBoard
//  * published none; this gateway sends `unit` on every point, sourced from the
//  * same Modbus dictionary that defines the register. A guess that agrees with
//  * the dictionary 95% of the time is a guess that mislabels one axis in twenty.
//  */
// export type UnitMap = Record<string, Record<string, string>>;
//
// export interface SourceTelemetry {
//   /** Assets the snapshot actually contained, so absence can be stated. */
//   assets: string[];
//   signals: SignalMap;
//   units: UnitMap;
// }
//
// /**
//  * One source's full cached telemetry, flattened to base asset and signal name.
//  *
//  * `/api/telemetry` rather than `/api/telemetry/key-signals`: "key" is 603
//  * signals per source and is dominated by fault bits the alarms page already
//  * reads through `/api/alarms`, while several figures the dashboard needs —
//  * grid metering, site load, the cumulative energy counters — are not flagged
//  * key at all.
//  */
// export async function fetchSourceTelemetry(sourceId: string): Promise<SourceTelemetry> {
//   const r = await gw<{
//     assets?: Record<string, { base_asset_id?: string; signals?: Record<string, unknown> }>;
//   }>(`telemetry?source_id=${encodeURIComponent(sourceId)}`);
//
//   /* Keyed by each node's own base_asset_id, which is the only reliable source
//      for it. Stripping the source prefix off the runtime id looks equivalent
//      and is not: the utility meter runs as external_ems_1_grid_meter against a
//      base id of utility_meter, and the battery as external_ems_1_bms against
//      bms_1. Prefix-stripping produced keys that matched no binding and every
//      site figure read as absent. */
//   const raw = r.data.assets ?? {};
//   const signals: SignalMap = {};
//   const units: UnitMap = {};
//
//   for (const [runtimeId, node] of Object.entries(raw)) {
//     const base =
//       node?.base_asset_id ??
//       (runtimeId.startsWith(`${sourceId}_`) ? runtimeId.slice(sourceId.length + 1) : runtimeId);
//     const out: Record<string, number | null> = {};
//     const outUnits: Record<string, string> = {};
//     for (const [name, point] of Object.entries(node?.signals ?? {})) {
//       out[name] = leafValue(point);
//       const u = point && typeof point === "object"
//         ? (point as { unit?: unknown }).unit
//         : undefined;
//       /* The dictionary writes degrees as "degC" and kilohms as "Kohm", which
//          are register-map spellings rather than things to put on an axis. */
//       if (typeof u === "string" && u) outUnits[name] = prettyUnit(u);
//     }
//     signals[base] = { ...(signals[base] ?? {}), ...out };
//     units[base] = { ...(units[base] ?? {}), ...outUnits };
//   }
//
//   return { assets: Object.keys(signals), signals, units };
// }
//
// const UNIT_SPELLING: Record<string, string> = {
//   degc: "°C", degf: "°F", kohm: "kΩ", mohm: "mΩ", ohm: "Ω",
//   kvar: "kVAr", kva: "kVA", kwh: "kWh", kw: "kW", hz: "Hz",
//   bar: "Bar", pct: "%", percent: "%",
// };
//
// function prettyUnit(raw: string): string {
//   return UNIT_SPELLING[raw.trim().toLowerCase()] ?? raw.trim();
// }
//
// /** The unit the gateway states for a signal, or "" when it states none. */
// export function unitOf(t: SourceTelemetry | undefined, asset: string, name: string): string {
//   return t?.units[asset]?.[name] ?? "";
// }
//
// /**
//  * Read one signal from a flattened snapshot.
//  *
//  * Returns null for both "the asset is not on this site" and "the point read
//  * badly", because a screen has nothing different to do about them and the
//  * distinction is already reported by `assets`.
//  */
// export function signal(t: SourceTelemetry | undefined, asset: string, name: string): number | null {
//   return t?.signals[asset]?.[name] ?? null;
// }
//
// /**
//  * The first of several candidate signal names that resolves.
//  *
//  * The gateway's two EMS sources do not spell every point identically — the
//  * dictionary resolves both, and where it lists alternatives this is how a
//  * caller asks for whichever one this site actually publishes, rather than
//  * hard-coding one and reading null on the other.
//  */
// export function firstSignal(
//   t: SourceTelemetry | undefined,
//   asset: string,
//   names: string[],
// ): number | null {
//   for (const n of names) {
//     const v = signal(t, asset, n);
//     if (v != null) return v;
//   }
//   return null;
// }
