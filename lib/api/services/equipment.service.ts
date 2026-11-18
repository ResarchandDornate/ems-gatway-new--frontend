/**
 * Equipment Monitoring service.
 *
 * Every value comes from the NorthBound EMS Gateway's live telemetry snapshot.
 * There is no mock mode and no second backend to fall back to: the
 * `USE_REAL_PCS` switch and the `/energy-storage-manage` REST calls it guarded
 * are gone along with the UGX client, and each reader below now maps to one
 * documented gateway asset.
 *
 * Two readers gained a real source in the move and two lost their subject:
 *
 *   gained   water chiller  → liquid_cooling   (226 points)
 *            fire protection → fire_protection (46 points)
 *   lost     battery cluster → no rack asset exists on the deployed build
 *            cell           → same
 *
 * The lost pair return empty arrays rather than throwing. See the header of
 * adapters/gateway.ts for what was measured against the gateway and when.
 */

import {
  fetchHierarchyReal,
  fetchPcsDataReal,
  fetchPcsSubDeviceListReal,
  fetchCabinetDetailReal,
  fetchBmsDataReal,
  fetchClusterDataReal,
  fetchCellDataReal,
  fetchBmsSubDeviceListReal,
  fetchWaterChillerDataReal,
  fetchFireProtectionDataReal,
} from "../adapters/gateway";
import type {
  CabinetDetail, BmsData, EquipmentHierarchy, PcsData, ClusterData, CellData,
  WaterChillerData, FireProtectionData, MeterTodData, BmsSubDevice, PcsSubDevice,
} from "../types";

export async function fetchHierarchy(stationId: string): Promise<EquipmentHierarchy> {
  return fetchHierarchyReal(stationId);
}

export async function fetchCabinetDetail(_cabinetId: string, stationId: string): Promise<CabinetDetail> {
  /* One cabinet per source on this backend, so the station identifies it and
     the cabinet id is not read. Kept in the signature because the callers pass
     it and a source with two cabinets would need it again. */
  return fetchCabinetDetailReal(stationId);
}

export async function fetchPcsData(_cabinetId: string, stationId: string): Promise<PcsData> {
  return fetchPcsDataReal(stationId);
}

export async function fetchBmsData(_pileId: string, stationId: string): Promise<BmsData> {
  return fetchBmsDataReal(stationId);
}

/** Empty: the deployed gateway exposes the battery as one aggregate asset. */
export async function fetchClusterData(_pileId: string, stationId: string): Promise<ClusterData[]> {
  return fetchClusterDataReal(stationId);
}

/** Empty: no per-cell registers on this build. */
export async function fetchCellData(rackId: string, _stationId: string): Promise<CellData[]> {
  return fetchCellDataReal(rackId);
}

export async function fetchPcsSubDeviceList(stationId: string): Promise<PcsSubDevice[]> {
  return fetchPcsSubDeviceListReal(stationId);
}

export async function fetchBmsSubDeviceList(stationId: string): Promise<BmsSubDevice[]> {
  return fetchBmsSubDeviceListReal(stationId);
}

export async function fetchWaterChillerData(stationId: string): Promise<WaterChillerData[]> {
  return fetchWaterChillerDataReal(stationId);
}

export async function fetchFireProtectionData(stationId: string): Promise<FireProtectionData[]> {
  return fetchFireProtectionDataReal(stationId);
}

/**
 * Time-of-day meter reads.
 *
 * Empty. The utility meter publishes live power, power factor and cumulative
 * forward and reverse energy, but no time-of-day buckets — those were a
 * settlement product of the legacy billing API, and a gateway does not do
 * settlement. Splitting the cumulative counters into ToD bands here would be
 * inventing a tariff calendar the backend has never heard of.
 */
export async function fetchMeterData(_stationId: string): Promise<MeterTodData[]> {
  return [];
}
