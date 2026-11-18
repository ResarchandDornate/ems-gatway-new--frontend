/* ═══════════════════════════════════════════════════════════════════════════
 * NORTHBOUND EMS GATEWAY ADAPTER — DISABLED 24 September 2026
 *
 * Commented out in place at Kedar's instruction, alongside lib/gateway/ and
 * app/api/gw/. The website is moving to the Ornate Central EMS Backend, which
 * publishes no telemetry read endpoints yet — see
 * docs/central-backend-s1-contract.md for what S1 has to provide before this
 * layer can be rewritten against it.
 *
 * Every reader below now REJECTS rather than returning a hollow object. That
 * is deliberate: these return types are richly shaped (StationSummary, BmsData,
 * CabinetDetail …) and handing back {} would fail later, deep in a component,
 * as an undefined property access. A rejection lands in the failure path the
 * services already have — the gateway has been answering 503 since 18 Sep, so
 * that path is the one that has actually been running.
 *
 * To restore: delete the stub, uncomment the original.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── ORIGINAL, COMMENTED OUT ──────────────────────────────────────────────── */

// /**
//  * NorthBound EMS Gateway → the dashboard shapes the UI already speaks.
//  *
//  * Replaces adapters/station.ts, adapters/pcs.ts and adapters/bms.ts, which read
//  * UGX/ThingsBoard timeseries keys and are gone. Everything here comes from two
//  * calls: `/api/telemetry?source_id=` for the live snapshot across all nine
//  * assets, and `/api/gw/history-series` for anything with a time axis.
//  *
//  * SIGNAL NAMING is taken from the Telemetry Data Dictionary of 10 Aug 2026,
//  * which resolves both EMS sources. Names are per base asset:
//  *
//  *   bms_1          display_soc, soh, cluster_total_voltage_collected, …
//  *   pcs_1          total_active_power, phase_a_voltage, rated_power, …
//  *   ems_system     load_power, grid_current_total_power, energy_storage_power
//  *   utility_meter  total_active_power, forward_total_active_energy, …
//  *   liquid_cooling inlet_water_temperature, outlet_water_pressure, …
//  *   fire_protection / dehumidifier / io_module / remote_control
//  *
//  * WHAT THIS BACKEND DOES NOT HAVE, stated once here rather than discovered
//  * six times downstream: per-rack and per-cell battery detail. The gateway
//  * exposes the battery as one aggregate `bms_1` asset, and the `/api/bms/*`
//  * family the Phase 1.6 inventory advertises is absent from the deployed build
//  * — all four routes 404, and the gateway's own OpenAPI declares 58 paths with
//  * no `rack`, `cell`, `module` or `cluster` among them
//  * (docs/gateway-findings-2026-09-03.md §1). Cluster and cell readers therefore
//  * return empty rather than fabricating a rack, and the pages that showed them
//  * are parked.
//  *
//  * EVERY READING IS NULLABLE and stays that way. A register the gateway could
//  * not read comes back null, and `leafValue` additionally nulls any point whose
//  * quality is not "good" — the gateway holds the last decoded number in place
//  * when a read fails, so trusting the value alone would present a stale
//  * register as a live one.
//  */
//
// import {
//   fetchSourceTelemetry, signal, firstSignal, getSources, getSeries,
//   type SourceTelemetry,
// } from "@/lib/gateway";
// import { overlayFor, DEFAULT_OVERLAY } from "../overlay/stations";
// /* The per-cell families are read through the metric layer, not by walking the
//    snapshot here — it owns the expansion and the zero-padded-tail rule. See
//    fetchCellDataReal. */
// import { activeProfile, readMetricArray } from "../metrics";
// import { fetchTodayAlarmCount } from "../services/alarms.service";
// import type {
//   StationSummary, DailyPoint, MatrixData, CommDevice,
//   BmsData, PcsData, ClusterData, CellData, CabinetDetail,
//   EquipmentHierarchy, WaterChillerData, FireProtectionData,
//   BmsSubDevice, PcsSubDevice, PcsCurvePoint,
// } from "../types";
//
// /* ── Asset ids, as base_asset_id ──────────────────────────────────────────── */
// const BMS = "bms_1";
// const PCS = "pcs_1";
// const EMS = "ems_system";
// const METER = "utility_meter";
// const COOL = "liquid_cooling";
// const FIRE = "fire_protection";
//
// /**
//  * A source's snapshot, read once and shared.
//  *
//  * Several panels on a page each want a handful of figures out of the same
//  * 1,422-signal payload, and this board answers a telemetry read in 2.5–6.7 s
//  * at best. Fetching per panel would multiply that by the panel count against a
//  * field device behind a tunnel, so the snapshot is fetched once per source and
//  * handed around. React Query caches it above this layer; the window here is
//  * deliberately short and only collapses the burst within one render pass.
//  */
// const SNAPSHOT_TTL_MS = 4_000;
//
// /**
//  * How long a *failure* is shared before the next caller is allowed to retry.
//  *
//  * Shorter than the success TTL, and not zero, which is what it used to be.
//  * Dropping the entry in the catch handler meant every panel that had queued
//  * behind a failing read issued its own — and with React Query retrying on top,
//  * one unhealthy gateway drew 43 requests for the same payload in a single page
//  * load. Against a board whose cheapest measured reply is 2.5 s and whose worst
//  * fixed cost is 20 s, that is a page that cannot recover: the retries are still
//  * arriving when the edge budget runs out.
//  *
//  * 750 ms is long enough to collapse the burst from one render pass and short
//  * enough that a gateway which comes back is picked up on the next poll rather
//  * than on the next TTL.
//  */
// const SNAPSHOT_FAIL_TTL_MS = 750;
//
// const snapshots = new Map<
//   string,
//   { at: number; p: Promise<SourceTelemetry>; failed: boolean }
// >();
//
// export function snapshot(sourceId: string): Promise<SourceTelemetry> {
//   const hit = snapshots.get(sourceId);
//   if (hit) {
//     const age = Date.now() - hit.at;
//     if (age < (hit.failed ? SNAPSHOT_FAIL_TTL_MS : SNAPSHOT_TTL_MS)) return hit.p;
//   }
//
//   const entry = { at: Date.now(), failed: false, p: null as unknown as Promise<SourceTelemetry> };
//   entry.p = fetchSourceTelemetry(sourceId).catch((e) => {
//     /* Marked rather than deleted. Concurrent callers still share this one
//        rejection — which is the whole point — but the window it is shared for
//        is the short one above, so a recovered gateway is not locked out. */
//     entry.failed = true;
//     entry.at = Date.now();
//     throw e;
//   });
//
//   snapshots.set(sourceId, entry as { at: number; p: Promise<SourceTelemetry>; failed: boolean });
//   return entry.p;
// }
//
// /* ── Small shared decoders ────────────────────────────────────────────────── */
//
// /**
//  * The battery's charge/discharge state.
//  *
//  * `charge_discharge_status` is the direct register and the only one that moved
//  * across the reference capture; `system_status` is a mode word (Normal /
//  * Charge Disabled / Discharge Disabled / Standby / Shutdown) and is read only
//  * for the two states it alone can express. Deriving the state from the sign of
//  * the current would also work and is deliberately not done: at low power the
//  * sign flips on noise, and the register does not.
//  */
// function chargeState(t: SourceTelemetry): BmsData["systemStatus"] {
//   const cd = signal(t, BMS, "charge_discharge_status");
//   if (cd === 1) return "discharging";
//   if (cd === 2) return "charging";
//
//   const sys = signal(t, BMS, "system_status");
//   if (sys === 4) return "shutdown";
//   if (sys === 3 || cd === 0) return "standby";
//   return "unknown";
// }
//
// /** Sum of the readings that are present, or null when none of them is. */
// function sumPresent(...vs: (number | null)[]): number | null {
//   const present = vs.filter((v): v is number => v != null);
//   return present.length ? present.reduce((a, b) => a + b, 0) : null;
// }
//
// /* ── Station summary ──────────────────────────────────────────────────────── */
//
// /**
//  * The Power Station header.
//  *
//  * `installedKw` is read live from `pcs_1.rated_power` rather than from the
//  * overlay — the PCS states its own rating and a measured figure beats a
//  * transcribed one. Capacity has no equivalent: nothing in the 2,844-point
//  * dictionary carries a rated kWh, so it stays an overlay field and reads 0
//  * until somebody fills it in from the commissioning documents.
//  *
//  * Revenue is null throughout, not zero. The gateway meters energy and has no
//  * tariff, no settlement and no billing source; a 0 here would render as "₹0
//  * earned" over a plant that has been cycling for months. The UI renders "—"
//  * for null, which is the true statement.
//  */
// export async function fetchStationSummaryReal(sourceId: string): Promise<StationSummary> {
//   const [t, alarms] = await Promise.all([
//     snapshot(sourceId),
//     fetchTodayAlarmCount(sourceId).catch(() => 0),
//   ]);
//
//   const ov = overlayFor(sourceId);
//
//   /* Lifetime counters. The PCS's AC-side cumulative energy is preferred over
//      the BMS's DC-side total: the AC figure is what the meter and any tariff
//      would agree with, and the difference between them is round-trip loss,
//      which belongs in the efficiency figure below rather than silently in the
//      headline. The BMS totals are the fallback for a source whose PCS does not
//      publish them. */
//   const totalCharge =
//     firstSignal(t, PCS, ["ac_cumulative_charge_energy"]) ??
//     signal(t, BMS, "total_cumulative_charge_capacity") ?? 0;
//   const totalDischarge =
//     firstSignal(t, PCS, ["ac_cumulative_discharge_energy"]) ??
//     signal(t, BMS, "total_cumulative_discharge_capacity") ?? 0;
//
//   /* "Today" is not published. The BMS carries monthly cumulative energy and
//      the PCS carries lifetime; neither resets at midnight, and subtracting a
//      stored yesterday-value is a historian's job, not a snapshot's. Today's
//      figures are integrated from the fast historian instead — the same
//      trapezoid the History page totals, over midnight-to-now. */
//   const today = await todayEnergy(sourceId).catch(() => ({ charge: 0, discharge: 0 }));
//
//   /* Round-trip efficiency over the life of the counters. Guarded on charge
//      being meaningfully non-zero: a brand-new plant divides by ~0 and reports
//      an efficiency in the thousands. */
//   const efficiency = totalCharge > 1 ? (totalDischarge / totalCharge) * 100 : 0;
//
//   return {
//     stationId: sourceId,
//     stationName: ov.powerStationName ?? sourceId,
//     stationLocation: ov.stationLocation ?? "",
//     hasBess: ov.hasBess ?? true,
//     installedKw: signal(t, PCS, "rated_power") ?? ov.installedPower ?? DEFAULT_OVERLAY.installedPower,
//     capacityKwh: ov.installedCapacity ?? DEFAULT_OVERLAY.installedCapacity,
//     totalChargeKwh: totalCharge,
//     totalDischargeKwh: totalDischarge,
//     todayChargeKwh: today.charge,
//     todayDischargeKwh: today.discharge,
//     totalRevenueInr: null,
//     yesterdayRevenueInr: null,
//     todayRevenueInr: null,
//     todayAlarms: alarms,
//     stationEfficiencyPct: Math.round(efficiency * 10) / 10,
//     /* No photo store on a gateway. The UI falls back to its placeholder. */
//     fileId: "",
//   };
// }
//
// /** Midnight-to-now energy, integrated server-side over the raw historian rows. */
// async function todayEnergy(sourceId: string): Promise<{ charge: number; discharge: number }> {
//   const now = Date.now();
//   const midnight = new Date(now);
//   midnight.setHours(0, 0, 0, 0);
//   const r = await getSeries({
//     sourceId,
//     /* Unfiltered by bess id on purpose: within one source there is one BESS,
//        and filtering on an id the gateway may not have stated turns "the guess
//        was wrong" into "this unit moved no energy today". */
//     bessId: "",
//     fromEpochMs: midnight.getTime(),
//     toEpochMs: now,
//     points: 96,
//     nowMs: now,
//   });
//   return { charge: r.data.totals.charged_kwh, discharge: r.data.totals.discharged_kwh };
// }
//
// /* ── Daily and intraday series ────────────────────────────────────────────── */
//
// const DAY_MS = 86_400_000;
//
// /**
//  * Per-day charge and discharge.
//  *
//  * Built from the historian's own per-bucket energy, which is the trapezoid over
//  * every raw one-second row — not the plotted mean multiplied by the bucket
//  * width. A bar chart built from the line would under-report any day that spiked
//  * between plotted samples.
//  *
//  * Revenue is null per day for the same reason it is null on the summary: there
//  * is no tariff on this backend.
//  */
// export async function fetchDailyDataReal(
//   sourceId: string,
//   range: "7d" | "month" | "year" | "all",
// ): Promise<DailyPoint[]> {
//   const days = range === "7d" ? 7 : range === "month" ? 30 : range === "year" ? 365 : 90;
//   const to = Date.now();
//   /* Ninety days, not more, whatever the range asks for. §8 of the handover
//      states the historian retains ninety days at one second; a year-long
//      request would walk eleven months of empty chunks against a field device to
//      prove they are empty. */
//   const from = to - Math.min(days, 90) * DAY_MS;
//   return dailyBetween(sourceId, from, to);
// }
//
// export async function fetchDailyDataCustomReal(
//   sourceId: string, startTs: number, endTs: number,
// ): Promise<DailyPoint[]> {
//   return dailyBetween(sourceId, startTs, endTs);
// }
//
// async function dailyBetween(sourceId: string, from: number, to: number): Promise<DailyPoint[]> {
//   const days = Math.max(1, Math.ceil((to - from) / DAY_MS));
//   const r = await getSeries({
//     sourceId, bessId: "", fromEpochMs: from, toEpochMs: to,
//     /* One point per day. The server derives the bucket from the point count,
//        so this is how a daily bar chart is asked for. */
//     points: days,
//     nowMs: Date.now(),
//   });
//
//   const byDay = new Map<string, { charge: number; discharge: number }>();
//   for (const [t, , , , , , , chg, dsg] of r.data.points) {
//     const date = new Date(t).toISOString().slice(0, 10);
//     const acc = byDay.get(date) ?? { charge: 0, discharge: 0 };
//     acc.charge += chg;
//     acc.discharge += dsg;
//     byDay.set(date, acc);
//   }
//
//   return [...byDay.entries()]
//     .sort(([a], [b]) => a.localeCompare(b))
//     .map(([date, v]) => ({ date, charge: v.charge, discharge: v.discharge, revenue: null }));
// }
//
// export interface IntradayPoint { t: string; power: number; soc: number | null; load: number }
//
// const hm = (ms: number) =>
//   new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
//
// /**
//  * Today's power and SOC curve.
//  *
//  * `load` is 0 throughout and is not a measurement. The historian's 63-signal
//  * profile is PCS and BMS only — site load lives on `ems_system.load_power`,
//  * which the fast logger does not carry — so there is no historical load series
//  * to plot. It stays in the shape because the chart's contract has the field;
//  * it is never presented as a reading, and the live figure is available on the
//  * Power Station page through `fetchMatrixAcDataReal` below.
//  */
// export async function fetchIntradayDataReal(sourceId: string): Promise<IntradayPoint[]> {
//   const now = Date.now();
//   const midnight = new Date(now);
//   midnight.setHours(0, 0, 0, 0);
//   return intradayBetween(sourceId, midnight.getTime(), now);
// }
//
// export async function fetchIntradayDataCustomReal(
//   sourceId: string, startTs: number, endTs: number,
// ): Promise<IntradayPoint[]> {
//   return intradayBetween(sourceId, startTs, endTs);
// }
//
// export async function fetchHistoricalPowerReal(
//   sourceId: string, startDate: string, endDate: string,
// ): Promise<IntradayPoint[]> {
//   const from = new Date(`${startDate}T00:00:00`).getTime();
//   const to = new Date(`${endDate}T23:59:59`).getTime();
//   return intradayBetween(sourceId, from, to);
// }
//
// async function intradayBetween(sourceId: string, from: number, to: number): Promise<IntradayPoint[]> {
//   const r = await getSeries({
//     sourceId, bessId: "", fromEpochMs: from, toEpochMs: to, points: 288, nowMs: Date.now(),
//   });
//   /* A null mean is a bucket the gateway had no rows for. It is dropped rather
//      than plotted as 0 — a flat line across a gap is the one rendering error
//      this series was rebuilt to stop making. */
//   return r.data.points
//     .filter(([, kw]) => kw != null)
//     .map(([t, kw, , , soc]) => ({ t: hm(t), power: kw as number, soc, load: 0 }));
// }
//
// /**
//  * Per-inverter breakdown.
//  *
//  * Empty. This is a BESS gateway: `/api/assets` reports nine asset kinds and a
//  * PV inverter is not among them. The site does have solar — a Solis on a
//  * Modbus RTU port, readable at `/api/solis/status`
//  * (docs/gateway-findings-2026-09-03.md §2) — but that endpoint publishes a
//  * single live power figure and no per-inverter history, so there is nothing to
//  * break down. Returning [] lets the chart render its own empty state.
//  */
// export interface InverterSeries { name: string; points: { t: string; power: number }[] }
// export async function fetchIntradayPerInverterReal(_sourceId: string): Promise<InverterSeries[]> {
//   return [];
// }
//
// /* ── Live plant figures ───────────────────────────────────────────────────── */
//
// /**
//  * The Matrix panel — the live AC and battery picture for one unit.
//  *
//  * This is where the gateway is plainly better than the backend it replaces.
//  * `ems_system` publishes site load, grid power and the available charge and
//  * discharge power limits directly; on UGX the first was absent, the second was
//  * inferred and the limits were documented as "no bank-level charge/discharge
//  * power limit exposed". All three are now read.
//  */
// export async function fetchMatrixAcDataReal(
//   sourceId: string, matrixId: string,
// ): Promise<MatrixData> {
//   const t = await snapshot(sourceId);
//   const ov = overlayFor(sourceId);
//
//   const soc = firstSignal(t, BMS, ["display_soc"]) ?? signal(t, EMS, "soc");
//   const capacity = ov.installedCapacity ?? 0;
//
//   /* Remaining energy needs a rated capacity, and there isn't one on this
//      backend. Computed only where the overlay supplies it; 0 otherwise, which
//      is what the field already shows for an unconfigured site. */
//   const remainingDischarge = capacity && soc != null ? (capacity * soc) / 100 : 0;
//   const remainingCharge = capacity && soc != null ? capacity - (capacity * soc) / 100 : 0;
//
//   const today = await todayEnergy(sourceId).catch(() => ({ charge: 0, discharge: 0 }));
//
//   return {
//     matrixId,
//     matrixName: ov.matrixName ?? "1#Matrix",
//     energy: {
//       remainingDischargeKwh: remainingDischarge,
//       todayChargeKwh: today.charge,
//       remainingChargeKwh: remainingCharge,
//       todayDischargeKwh: today.discharge,
//     },
//     power: {
//       totalActivePowerKw:
//         firstSignal(t, PCS, ["total_active_power", "charge_discharge_power"]) ??
//         signal(t, EMS, "energy_storage_power"),
//       totalReactivePowerKvar: signal(t, PCS, "total_reactive_power"),
//       /* Measured, not derived. The PCS states what the BMS will currently
//          accept and deliver, and the EMS aggregates the same across the site. */
//       maxChargeablePowerKw:
//         firstSignal(t, PCS, ["bms_available_charge_power", "available_charge_power"]) ??
//         signal(t, EMS, "total_available_charge_power"),
//       maxDischargePowerKw:
//         firstSignal(t, PCS, ["bms_available_discharge_power", "available_discharge_power"]) ??
//         signal(t, EMS, "total_available_discharge_power"),
//     },
//     current: {
//       phaseA: signal(t, PCS, "phase_a_current"),
//       phaseB: signal(t, PCS, "phase_b_current"),
//       phaseC: signal(t, PCS, "phase_c_current"),
//     },
//     totalSocPct: soc,
//     /* The EMS controller is a real asset here, unlike on UGX where there was
//        no edge-controller device and this was hardcoded to a green "normal".
//        `system_fault` and `e_stop` are the two words that decide it. */
//     edgeController: {
//       name: "EMS Controller",
//       runStatus:
//         signal(t, EMS, "system_fault") === 1 || signal(t, EMS, "e_stop") === 1
//           ? "abnormal"
//           : "normal",
//     },
//     cabinets: [
//       {
//         id: `${sourceId}_${BMS}`,
//         name: ov.powerStationName ?? sourceId,
//         powerKw: signal(t, PCS, "total_active_power"),
//         socPct: soc,
//       },
//     ],
//   };
// }
//
// /**
//  * Communication status, per asset.
//  *
//  * The gateway reports reachability for each asset it polls rather than for a
//  * site as a whole, which is what the Comm Status panel wanted all along. `ip`
//  * and `port` stay null: assets sit on Modbus RTU serial ports and CAN, and
//  * neither has an IP address to report — `/dev/ems_solis_rtu` is a port name,
//  * not an endpoint.
//  */
// export async function fetchCommDevicesReal(sourceId: string): Promise<CommDevice[]> {
//   const [t, sources] = await Promise.all([snapshot(sourceId), getSources()]);
//
//   const row = (sources.data.sources as { source_id?: string; last_seen_utc?: string | null }[])
//     .find((s) => s.source_id === sourceId);
//   const lastSeen = row?.last_seen_utc ?? "";
//
//   /* Per-asset status words, where the asset publishes one. A `communication_
//      status` of 1 is reachable; `*_online_status` is the PCS's own view of its
//      peers. An asset the snapshot did not carry at all is reported offline,
//      which is the honest reading of "the gateway polled it and got nothing". */
//   const devices: { id: string; name: string; state: number | null }[] = [
//     { id: PCS,   name: "PCS",             state: signal(t, PCS, "pcs_online_status") },
//     { id: BMS,   name: "BMS",             state: signal(t, PCS, "bms_online_status") },
//     { id: EMS,   name: "EMS Controller",  state: signal(t, EMS, "master_communication_status") },
//     { id: METER, name: "Utility Meter",   state: signal(t, METER, "communication_status") },
//     { id: COOL,  name: "Liquid Cooling",  state: signal(t, PCS, "liquid_cooling_online_status") },
//     { id: FIRE,  name: "Fire Protection", state: signal(t, FIRE, "communication_status") },
//   ];
//
//   return devices.map((d) => ({
//     id: `${sourceId}_${d.id}`,
//     name: d.name,
//     ip: null,
//     port: null,
//     /* Modbus for everything the gateway polls. Stated rather than inferred:
//        the dictionary gives every one of these a Modbus register address. */
//     protocol: "Modbus",
//     lastSeen,
//     status: !t.assets.includes(d.id)
//       ? ("offline" as const)
//       : d.state == null
//         ? ("abnormal" as const)
//         : d.state === 1
//           ? ("online" as const)
//           : ("offline" as const),
//   }));
// }
//
// /* ── Equipment ────────────────────────────────────────────────────────────── */
//
// /**
//  * The equipment tree.
//  *
//  * All six levels now: Grid → Matrix → Cabinet → Pile → Rack → Cell. It used to
//  * stop at Pile with `racks: []`, on the reasoning that racks and cells "do not
//  * exist as addressable things in the deployed build". The cells do — 260 of
//  * them, in the telemetry snapshot — and the rack is the one cluster the BMS
//  * reports. What does not exist is a *choice* of rack, which is why there is
//  * exactly one and why every `rack.*` metric stays unmapped.
//  *
//  * The cell nodes are named, not fetched: this builds the tree, and the
//  * readings hang off it through fetchCellDataReal. The length comes from the
//  * same snapshot either way, so the two cannot disagree about how long the pack
//  * is — and a source whose BMS is absent still gets `racks: []`, unchanged.
//  */
// export async function fetchHierarchyReal(sourceId: string): Promise<EquipmentHierarchy> {
//   const ov = overlayFor(sourceId);
//   const cabinetId = `${sourceId}_${BMS}`;
//   const rackId = rackIdFor(sourceId);
//   const cells = await fetchCellDataReal(rackId).catch(() => []);
//   const racks = cells.length
//     ? [{
//         id: rackId,
//         name: "1# Cluster",
//         pileId: cabinetId,
//         cells: cells.map((c) => ({ id: c.cellId, name: c.name, rackId })),
//       }]
//     : [];
//   return {
//     stationId: sourceId,
//     grids: [
//       {
//         id: `${sourceId}_grid`,
//         name: ov.gridName ?? "1#Grid",
//         matrices: [
//           {
//             id: `${sourceId}_matrix`,
//             name: ov.matrixName ?? "1#Matrix",
//             gridId: `${sourceId}_grid`,
//             cabinets: [
//               {
//                 id: cabinetId,
//                 name: ov.powerStationName ?? sourceId,
//                 matrixId: `${sourceId}_matrix`,
//                 piles: [{ id: cabinetId, name: "1# Pile", cabinetId, racks }],
//               },
//             ],
//           },
//         ],
//       },
//     ],
//   };
// }
//
// export async function fetchPcsDataReal(sourceId: string): Promise<PcsData> {
//   const t = await snapshot(sourceId);
//
//   const active = signal(t, PCS, "total_active_power");
//   const apparent = signal(t, PCS, "total_apparent_power");
//
//   return {
//     cabinetId: `${sourceId}_${PCS}`,
//     activePowerKw: active,
//     reactivePowerKvar: signal(t, PCS, "total_reactive_power"),
//     /* Line voltage and current as single figures, averaged across the phases
//        that reported. A three-phase PCS with one dead probe should read the
//        other two rather than nothing. */
//     acVoltageV: avg(
//       signal(t, PCS, "phase_a_voltage"),
//       signal(t, PCS, "phase_b_voltage"),
//       signal(t, PCS, "phase_c_voltage"),
//     ),
//     acCurrentA: avg(
//       signal(t, PCS, "phase_a_current"),
//       signal(t, PCS, "phase_b_current"),
//       signal(t, PCS, "phase_c_current"),
//     ),
//     dcVoltageV: firstSignal(t, PCS, ["dc_voltage", "pcs_total_dc_voltage"]),
//     dcCurrentA: signal(t, PCS, "dc_current"),
//     dcPowerKw: firstSignal(t, PCS, ["dc_power", "dc_power_2"]),
//     frequency: signal(t, PCS, "grid_frequency"),
//     /* Conversion efficiency, AC out over DC in, only where both are real and
//        the unit is actually moving power. Below a kilowatt the ratio is noise
//        over noise and reports figures like 400%. */
//     efficiency: conversionEfficiency(active, firstSignal(t, PCS, ["dc_power", "dc_power_2"])),
//     socPct: firstSignal(t, PCS, ["soc"]) ?? signal(t, BMS, "display_soc"),
//     /* The IGBT heat sink, which is the temperature an operator watches. The
//        per-phase and cavity probes are also published and belong on the
//        equipment detail page rather than in this one-figure summary. */
//     temperature: firstSignal(t, PCS, ["heat_sink_temperature", "cavity_temperature"]),
//     runState: pcsRunState(t),
//   };
// }
//
// function avg(...vs: (number | null)[]): number | null {
//   const present = vs.filter((v): v is number => v != null);
//   return present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;
// }
//
// function conversionEfficiency(acKw: number | null, dcKw: number | null): number | null {
//   if (acKw == null || dcKw == null) return null;
//   if (Math.abs(acKw) < 1 || Math.abs(dcKw) < 1) return null;
//   /* Direction-aware: charging, the DC side is the output and the ratio
//      inverts. Taking |AC|/|DC| unconditionally reported >100% on every charge. */
//   const eff = acKw < 0 ? Math.abs(dcKw) / Math.abs(acKw) : Math.abs(acKw) / Math.abs(dcKw);
//   return eff > 0 && eff <= 1.2 ? Math.round(eff * 1000) / 10 : null;
// }
//
// function pcsRunState(t: SourceTelemetry): string {
//   if (signal(t, PCS, "e_stop_input_status") === 1) return "E-Stop";
//   if (signal(t, PCS, "shutdown_status") === 1) return "Shutdown";
//   if (signal(t, PCS, "standby_status") === 1) return "Standby";
//   if (signal(t, PCS, "on_grid_status") === 1) return "On-Grid";
//   if (signal(t, PCS, "off_grid_status") === 1) return "Off-Grid";
//   if (signal(t, PCS, "running_status_2") === 1) return "Running";
//   /* Not "Unknown" dressed up as a state. The PCS publishes six status words
//      and none of them is asserted, which is itself worth showing as-is. */
//   return "—";
// }
//
// export async function fetchBmsDataReal(sourceId: string): Promise<BmsData> {
//   const t = await snapshot(sourceId);
//   const ov = overlayFor(sourceId);
//
//   const v = signal(t, BMS, "cluster_total_voltage_collected");
//   const i = firstSignal(t, BMS, ["cluster_total_current", "can_hall_sampling_current"]);
//
//   return {
//     pileId: `${sourceId}_${BMS}`,
//     label: ov.powerStationName ?? sourceId,
//     /* The gateway stamps the snapshot, not each point, and the proxy does not
//        forward that stamp through the flattened shape this adapter reads. The
//        source's own `last_seen_utc` is the freshness signal on this backend and
//        it is reported by the Comm Status panel. Null here rather than
//        Date.now(), which would assert a freshness nothing measured. */
//     telemetryTs: null,
//     systemStatus: chargeState(t),
//     totalVoltageV: v,
//     totalCurrentA: i,
//     /* No measured DC power register on the BMS side, so V×I — the same
//        convention the Kinetics profile documents for bank.power. The PCS's
//        `dc_power` is the measured alternative and is what PcsData reports. */
//     totalPowerKw: v != null && i != null ? (v * i) / 1000 : null,
//     maxTempC: signal(t, BMS, "battery_max_temperature"),
//     socPct: signal(t, BMS, "display_soc"),
//     maxCellTempC: signal(t, BMS, "battery_max_temperature"),
//     minCellTempC: signal(t, BMS, "battery_min_temperature"),
//     maxCellVoltageM: signal(t, BMS, "cell_max_voltage"),
//     minCellVoltageMv: signal(t, BMS, "cell_min_voltage"),
//     sohPct: signal(t, BMS, "soh"),
//     /* `cell_average_voltage` is a register in its own right. This was null on
//        the reasoning that pack volts over a cell count needs a cell count
//        nobody publishes — true of that derivation, and beside the point: the
//        BMS computes the average itself. */
//     avgCellVoltageMv: signal(t, BMS, "cell_average_voltage"),
//     avgCellTempC: signal(t, BMS, "average_temperature"),
//     /* Which cell and which probe hold the extremes. Published throughout and
//        never read: these are positions in the 260- and 160-register blocks, so
//        they index the arrays fetchCellDataReal returns and let the cell map
//        point at the cell the pack figure came from. */
//     maxVoltCellNo: signal(t, BMS, "cell_max_voltage_id"),
//     minVoltCellNo: signal(t, BMS, "cell_min_voltage_id"),
//     maxTempProbeNo: signal(t, BMS, "battery_max_temperature_id"),
//     minTempProbeNo: signal(t, BMS, "battery_min_temperature_id"),
//   };
// }
//
// /* ── Cluster and cells ─────────────────────────────────────────────────────
//    This block used to return empty, on the reasoning that `/api/bms/racks`
//    404s and the gateway's OpenAPI declares no rack route. Both facts are still
//    true and neither was ever about the cells.
//
//    The dictionary of 10 Aug 2026 lists 761 points on bms_1, and 420 of them are
//    per-sensor: `cell_voltage_1..260` in mV and `battery_temperature_1..160` in
//    °C, contiguous, factor 1.0, published in the same `/api/telemetry` snapshot
//    as everything else this adapter reads. They were behind no missing route.
//
//    What the gateway genuinely does NOT have is a *second* rack: one set of
//    cluster registers per BMS, no numbered rack family. So the tree below gains
//    exactly one rack — the cluster the BMS itself reports, under the id the
//    curve pages already expect — and not a rack per module invented to fill a
//    level. See NO_RACKS in profiles/northbound.profile.ts. */
//
// /** The one cluster this BMS publishes, as the rack id the UI addresses it by. */
// const rackIdFor = (sourceId: string) => `${sourceId}_${BMS}-r1`;
//
// /** `external_ems_1_bms_1-r1` → `external_ems_1`. */
// function sourceOfRack(rackId: string): string {
//   const m = /^(external_ems_\d+)_/.exec(rackId);
//   return m ? m[1] : rackId.replace(/_bms_1-r\d+$/, "");
// }
//
// /**
//  * The battery cluster.
//  *
//  * One entry, because the BMS reports one. Every field is the cluster's own
//  * register — `cluster_total_voltage_collected`, `cluster_total_current`,
//  * `cluster_internal_soc` — rather than a pack aggregate relabelled as a rack.
//  * The distinction matters: these ARE the cluster's readings, which is why this
//  * is reporting rather than the fiction the empty version was avoiding.
//  */
// export async function fetchClusterDataReal(sourceId: string): Promise<ClusterData[]> {
//   const t = await snapshot(sourceId);
//   if (!t.assets.includes(BMS)) return [];
//
//   const status = signal(t, BMS, "contactor_fault") || signal(t, BMS, "fuse_fault")
//     ? ("abnormal" as const)
//     : t.signals[BMS] ? ("normal" as const) : ("unknown" as const);
//
//   return [{
//     rackId: rackIdFor(sourceId),
//     name: "1# Cluster",
//     voltage: signal(t, BMS, "cluster_total_voltage_collected"),
//     current: firstSignal(t, BMS, ["cluster_total_current", "can_hall_sampling_current"]),
//     /* The BMS publishes two SOCs: `display_soc` is what it shows an operator
//        and `cluster_internal_soc` is the estimator underneath it. Preferring
//        the internal one here, with display as the fallback, is what makes the
//        two comparable at all — they are the same quantity from two places, and
//        a divergence between them is a finding about the estimator. */
//     soc: firstSignal(t, BMS, ["cluster_internal_soc", "display_soc"]),
//     maxCellTemp: signal(t, BMS, "battery_max_temperature"),
//     minCellTemp: signal(t, BMS, "battery_min_temperature"),
//     maxCellVolt: signal(t, BMS, "cell_max_voltage"),
//     minCellVolt: signal(t, BMS, "cell_min_voltage"),
//     /* `soh` reads a constant 100.0 across the whole reference capture — the
//        estimator is not running on this firmware. Carried through as published
//        rather than suppressed: a flat 100 is the gateway's answer, and hiding
//        it would lose the evidence that the register is not being computed. */
//     soh: signal(t, BMS, "soh"),
//     maxVoltCellNo: signal(t, BMS, "cell_max_voltage_id"),
//     minVoltCellNo: signal(t, BMS, "cell_min_voltage_id"),
//     maxTempProbeNo: signal(t, BMS, "battery_max_temperature_id"),
//     minTempProbeNo: signal(t, BMS, "battery_min_temperature_id"),
//     status,
//   }];
// }
//
// /**
//  * Per-cell voltages and temperatures.
//  *
//  * Read through the metric layer rather than by walking the snapshot here,
//  * because the two families have different lengths (260 and 160) and different
//  * padding, and `readMetricArray` already owns both rules — the expansion and
//  * the zero-padded-tail trim. Doing it by hand in the adapter would be a second
//  * place for the pack's length to be decided.
//  *
//  * VOLTAGES AND PROBES DO NOT PAIR ONE TO ONE. 260 cells share 160 probes, so a
//  * cell's temperature is the probe covering it, and several cells report the
//  * same one. Stated here because the CellData shape puts them side by side and
//  * that invites the assumption that they are two readings of one sensor.
//  */
// export async function fetchCellDataReal(rackId: string): Promise<CellData[]> {
//   const sourceId = sourceOfRack(rackId);
//   const t = await snapshot(sourceId);
//   const profile = activeProfile();
//
//   const volts = readMetricArray(profile, t, "cell.voltages");
//   const temps = readMetricArray(profile, t, "cell.temperatures");
//   if (volts.status !== "ok" && temps.status !== "ok") return [];
//
//   /* The pack is as long as its cells. Probes are indexed into, never used to
//      size it — a BMS that reported temperatures and no voltages would otherwise
//      produce a 160-cell pack that does not exist. */
//   const count = volts.values.length || temps.values.length;
//   const perProbe = temps.values.length ? count / temps.values.length : 0;
//
//   return Array.from({ length: count }, (_, k) => {
//     const n = k + 1;
//     return {
//       /* `{rackId}-cell{N}` — the format the cell curve page parses back out.
//          See SingleCellBattery.tsx, which builds the same string to ask for
//          cell 1's history. */
//       cellId: `${rackId}-cell${n}`,
//       name: `Cell ${n}`,
//       voltMv: volts.values[k] ?? null,
//       tempC: perProbe ? temps.values[Math.floor(k / perProbe)] ?? null : null,
//       /* No per-cell SOC register on this BMS — see the profile. Null, not the
//          pack figure copied 260 times. */
//       socPct: null,
//     };
//   });
// }
//
// export async function fetchCabinetDetailReal(sourceId: string): Promise<CabinetDetail> {
//   const t = await snapshot(sourceId);
//   const ov = overlayFor(sourceId);
//   const soc = signal(t, BMS, "display_soc");
//   const capacity = ov.installedCapacity ?? 0;
//
//   const comm = (v: number | null, present: boolean) =>
//     !present ? ("offline" as const) : v == null ? ("abnormal" as const) : v === 1 ? ("normal" as const) : ("abnormal" as const);
//
//   return {
//     cabinetId: `${sourceId}_${BMS}`,
//     label: ov.powerStationName ?? sourceId,
//     commStatus: {
//       edgeController: comm(signal(t, EMS, "master_communication_status"), t.assets.includes(EMS)),
//       pcs: comm(signal(t, PCS, "pcs_online_status"), t.assets.includes(PCS)),
//       bms: comm(signal(t, PCS, "bms_online_status"), t.assets.includes(BMS)),
//     },
//     operationInfo: {
//       chargeDischargeStatus: cabinetState(chargeState(t)),
//       realtimePowerKw: signal(t, PCS, "total_active_power"),
//       socPct: soc,
//       realtimeCapacityKwh: capacity && soc != null ? (capacity * soc) / 100 : null,
//     },
//     waterChillers: (await fetchWaterChillerDataReal(sourceId)).map((c) => ({
//       tmsStatus: c.tmsWorkingStatus === "Auto" ? ("auto" as const)
//         : c.tmsWorkingStatus === "Manual" ? ("manual" as const) : ("off" as const),
//       outletTempC: c.outletWaterTempC,
//       inletTempC: c.returnWaterTempC,
//       ambientTempC: c.ambientTempC,
//       inletPressureBar: c.returnWaterPressureBar,
//       outletPressureBar: c.supplyWaterPressureBar,
//       compressorSpeedRpm: c.compressorSpeedRpm,
//       pumpSpeedRpm: c.waterPumpSpeedRpm,
//     })),
//   };
// }
//
// function cabinetState(s: BmsData["systemStatus"]): CabinetDetail["operationInfo"]["chargeDischargeStatus"] {
//   return s === "charging" ? "charging"
//     : s === "discharging" ? "discharging"
//     : s === "shutdown" ? "shutdown"
//     : "standby";
// }
//
// /**
//  * The liquid cooling unit.
//  *
//  * New on this backend. UGX published no chiller registers at all and this
//  * returned an empty array; the gateway polls a 226-point liquid cooling asset,
//  * so the Equipment page has real numbers for the first time.
//  *
//  * `compressorSpeedRpm` is the one field that does not survive the move
//  * honestly: this unit reports compressor *frequency* in Hz, not shaft speed,
//  * and there is no rpm register. The Hz figure is carried through under the rpm
//  * field name rather than left at 0 — a 0 rpm compressor reads as a stopped one
//  * — and the Equipment view labels it Hz. Renaming the field is a UI-wide
//  * change and is worth doing; this comment is here so it is not done by
//  * accident, or forgotten.
//  */
// export async function fetchWaterChillerDataReal(sourceId: string): Promise<WaterChillerData[]> {
//   const t = await snapshot(sourceId);
//   if (!t.assets.includes(COOL)) return [];
//
//   const ov = overlayFor(sourceId);
//   const n = (v: number | null) => v ?? 0;
//
//   /* Any asserted alarm or fault on the unit, rather than one chosen bit. The
//      asset carries ~90 of them; a status that only watched the compressor would
//      call a unit with a dry water tank "normal". */
//   const abnormal = Object.entries(t.signals[COOL] ?? {}).some(
//     ([name, v]) => /_alarm$|_fault$|_alarm_lock$/.test(name) && v === 1,
//   );
//
//   return [
//     {
//       cabinetId: `${sourceId}_${COOL}`,
//       cabinetName: ov.powerStationName ?? sourceId,
//       status: abnormal ? "abnormal" : "normal",
//       tmsWorkingStatus: signal(t, COOL, "power_on_off") === 1 ? "Auto" : "Off",
//       outletWaterTempC: n(signal(t, COOL, "outlet_water_temperature")),
//       returnWaterTempC: n(signal(t, COOL, "inlet_water_temperature")),
//       ambientTempC: n(signal(t, COOL, "outdoor_temperature")),
//       returnWaterPressureBar: n(signal(t, COOL, "inlet_water_pressure")),
//       supplyWaterPressureBar: n(signal(t, COOL, "outlet_water_pressure")),
//       // Hz, not rpm — see the note above.
//       compressorSpeedRpm: n(signal(t, COOL, "system_a_compressor_frequency")),
//       /* No pump speed register on this unit; the two pumps publish only fault
//          and overload bits, which the status above already folds in. */
//       waterPumpSpeedRpm: 0,
//     },
//   ];
// }
//
// /**
//  * Fire protection.
//  *
//  * Also new — UGX published nothing for it. `fire_alarm` and `fault` are the
//  * two roll-up words; the individual CO, temperature, IR and feedback channels
//  * are polled too and feed the Alarms page through `/api/alarms`.
//  */
// export async function fetchFireProtectionDataReal(sourceId: string): Promise<FireProtectionData[]> {
//   const t = await snapshot(sourceId);
//   if (!t.assets.includes(FIRE)) return [];
//
//   const ov = overlayFor(sourceId);
//   const alarm = signal(t, FIRE, "fire_alarm") === 1;
//   const fault = signal(t, FIRE, "fault") === 1;
//   const offline = signal(t, FIRE, "communication_status") !== 1;
//
//   return [
//     {
//       cabinetId: `${sourceId}_${FIRE}`,
//       cabinetName: ov.powerStationName ?? sourceId,
//       status: alarm || fault || offline ? "abnormal" : "normal",
//     },
//   ];
// }
//
// /* ── Sub-device lists ─────────────────────────────────────────────────────── */
//
// export async function fetchPcsSubDeviceListReal(sourceId: string): Promise<PcsSubDevice[]> {
//   const t = await snapshot(sourceId);
//   if (!t.assets.includes(PCS)) return [];
//
//   const ov = overlayFor(sourceId);
//   const path = `${ov.gridName ?? "1#Grid"}-${ov.matrixName ?? "1#Matrix"}-${ov.powerStationName ?? sourceId}-PCS`;
//
//   return [
//     {
//       cabinetPath: path,
//       cabinetId: `${sourceId}_${BMS}`,
//       pileId: `${sourceId}_${PCS}`,
//       status: signal(t, PCS, "system_abnormal") === 1 ? "abnormal" : "normal",
//       pcsOperationStatus: pcsRunState(t),
//       pcsOperationMode: signal(t, PCS, "remote_local_status") === 1 ? "Remote" : "Local",
//       /* No AC or DC contactor register on this PCS. The dictionary carries
//          start/stop, lock and E-stop words and no contactor feedback, so these
//          read as unknown rather than as closed. */
//       dcContactorStatus: "—",
//       acContactorStatus: "—",
//       ambientTempC: signal(t, PCS, "air_inlet_temperature"),
//       cabinetTempC: signal(t, PCS, "cavity_temperature"),
//       /* Per-phase power-stage temperatures. Named IGBT A/B/C by the UI; the
//          gateway calls them phase temperatures, which is the same probe. */
//       igbtATempC: signal(t, PCS, "phase_a_temperature"),
//       igbtBTempC: signal(t, PCS, "phase_b_temperature"),
//       igbtCTempC: signal(t, PCS, "phase_c_temperature"),
//       dcVoltageV: signal(t, PCS, "dc_voltage"),
//       dcCurrentA: signal(t, PCS, "dc_current"),
//       dcPowerKw: firstSignal(t, PCS, ["dc_power", "dc_power_2"]),
//       /* This PCS publishes phase voltages, not line voltages. Line = phase ×
//          √3 for a balanced three-phase system, and it is computed rather than
//          left null because the panel's whole subject is the AC side. The
//          approximation is exact only when the phases are balanced; the
//          per-phase figures beside it are what to read when they are not. */
//       abLineVoltageV: lineVolts(signal(t, PCS, "phase_a_voltage")),
//       bcLineVoltageV: lineVolts(signal(t, PCS, "phase_b_voltage")),
//       acLineVoltageV: lineVolts(signal(t, PCS, "phase_c_voltage")),
//       phaseACurrentA: signal(t, PCS, "phase_a_current"),
//       phaseBCurrentA: signal(t, PCS, "phase_b_current"),
//       phaseCCurrentA: signal(t, PCS, "phase_c_current"),
//       activePowerKw: signal(t, PCS, "total_active_power"),
//       reactivePowerKvar: signal(t, PCS, "total_reactive_power"),
//       apparentPowerKva: signal(t, PCS, "total_apparent_power"),
//       powerFactor: signal(t, PCS, "total_power_factor"),
//     },
//   ];
// }
//
// const SQRT3 = Math.sqrt(3);
// const lineVolts = (phase: number | null) =>
//   phase == null ? null : Math.round(phase * SQRT3 * 10) / 10;
//
// export async function fetchBmsSubDeviceListReal(sourceId: string): Promise<BmsSubDevice[]> {
//   const t = await snapshot(sourceId);
//   if (!t.assets.includes(BMS)) return [];
//
//   const ov = overlayFor(sourceId);
//   const path = `${ov.gridName ?? "1#Grid"}-${ov.matrixName ?? "1#Matrix"}-${ov.powerStationName ?? sourceId}-BMS`;
//   const n = (v: number | null) => v ?? 0;
//
//   const v = signal(t, BMS, "cluster_total_voltage_collected");
//   const i = firstSignal(t, BMS, ["cluster_total_current", "can_hall_sampling_current"]);
//   const maxT = signal(t, BMS, "battery_max_temperature");
//   const minT = signal(t, BMS, "battery_min_temperature");
//
//   return [
//     {
//       cabinetPath: path,
//       cabinetId: `${sourceId}_${BMS}`,
//       pileId: `${sourceId}_${BMS}`,
//       status:
//         signal(t, BMS, "contactor_fault") === 1 || signal(t, BMS, "fuse_fault") === 1
//           ? "abnormal"
//           : "normal",
//       systemStatus: chargeState(t),
//       totalVoltageV: v,
//       totalCurrentA: n(i),
//       totalPowerKw: v != null && i != null ? (v * i) / 1000 : 0,
//       maxTempDiffC: maxT != null && minT != null ? Math.round((maxT - minT) * 10) / 10 : 0,
//       maxCellVoltageDiffMv: n(signal(t, BMS, "max_min_cell_voltage_diff")),
//       socPct: n(signal(t, BMS, "display_soc")),
//       maxCellTempC: n(maxT),
//       minCellTempC: n(minT),
//       maxCellVoltageMv: n(signal(t, BMS, "cell_max_voltage")),
//       minCellVoltageMv: n(signal(t, BMS, "cell_min_voltage")),
//       /* Cell and probe identifiers, and per-cell SOC. None of them exists on
//          this build — the battery is one aggregate asset. Empty strings and
//          nulls, so the columns render a dash rather than a fabricated cell 1. */
//       maxTempCellId: "",
//       minTempCellId: "",
//       maxCellVoltageId: "",
//       minCellVoltageId: "",
//       maxCellSocPct: null,
//       maxSocCellId: "",
//       minCellSocPct: null,
//       minSocCellId: "",
//     },
//   ];
// }
//
// /* ── Curve report ─────────────────────────────────────────────────────────── */
//
// /**
//  * The PCS curve for a day.
//  *
//  * The historian's 63-signal profile carries the three phase voltages and
//  * currents and the active power, all at one second, so this is a real curve
//  * rather than a resample of a handful of stored points.
//  *
//  * IGBT temperatures are null: the profile does not include them. They exist on
//  * the live snapshot (`phase_a_temperature` and its siblings) but are not
//  * logged, so there is no history to draw — the same absence UGX had, for a
//  * different reason, and the chart already renders null as a gap.
//  */
// export async function fetchPcsCurveReal(
//   sourceId: string, date: string,
// ): Promise<PcsCurvePoint[]> {
//   const from = new Date(`${date}T00:00:00`).getTime();
//   const to = Math.min(from + DAY_MS, Date.now());
//   if (!(to > from)) return [];
//
//   const r = await getSeries({
//     sourceId, bessId: "", fromEpochMs: from, toEpochMs: to, points: 288, nowMs: Date.now(),
//   });
//
//   /* The aggregated series carries mean power, SOC, temperature and spread —
//      not per-phase electrical detail, which the bucketing would average into
//      meaninglessness anyway. Power is what this curve plots; the per-phase
//      fields stay null and the chart draws the traces it has. */
//   return r.data.points
//     .filter(([, kw]) => kw != null)
//     .map(([t, kw]) => ({
//       t: hm(t),
//       power: kw as number,
//       tempA: null, tempB: null, tempC: null,
//       phaseACurrent: null, phaseBCurrent: null, phaseCCurrent: null,
//       phaseAVoltage: null, phaseBVoltage: null, phaseCVoltage: null,
//     }));
// }
//
// export { sumPresent };

/* ── DISABLED STUB ────────────────────────────────────────────────────────── */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

const OFF = "NorthBound gateway adapter is disabled; see docs/central-backend-s1-contract.md";

/** Rejects as Promise<never>, which is assignable to every reader's return. */
const off = (..._a: any[]): Promise<never> => Promise.reject(new Error(OFF));

export interface IntradayPoint { t: string; power: number; soc: number | null; load: number }
export interface InverterSeries { name: string; points: { t: string; power: number }[] }

export const snapshot = off;
export const fetchStationSummaryReal = off;
export const fetchDailyDataReal = off;
export const fetchDailyDataCustomReal = off;
export const fetchIntradayDataReal = off;
export const fetchIntradayDataCustomReal = off;
export const fetchHistoricalPowerReal = off;
export const fetchIntradayPerInverterReal = off;
export const fetchMatrixAcDataReal = off;
export const fetchCommDevicesReal = off;
export const fetchHierarchyReal = off;
export const fetchPcsDataReal = off;
export const fetchBmsDataReal = off;
export const fetchClusterDataReal = off;
export const fetchCellDataReal = off;
export const fetchCabinetDetailReal = off;
export const fetchWaterChillerDataReal = off;
export const fetchFireProtectionDataReal = off;
export const fetchPcsSubDeviceListReal = off;
export const fetchBmsSubDeviceListReal = off;
export const fetchPcsCurveReal = off;

/** Pure helper, kept live — it does no I/O and callers use it on their own data. */
export function sumPresent(xs: (number | null | undefined)[]): number | null {
  const present = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return present.length ? present.reduce((a, b) => a + b, 0) : null;
}
