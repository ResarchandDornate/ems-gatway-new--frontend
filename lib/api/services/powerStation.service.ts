/**
 * Power Station dashboard service.
 *
 * A thin pass-through to adapters/gateway.ts, kept as its own module because
 * the hooks import from here and the adapter is where the backend's names
 * live. Swapping backends again means writing one new adapter, not touching
 * seventeen hooks.
 */

import {
  fetchStationSummaryReal,
  fetchDailyDataReal,
  fetchDailyDataCustomReal,
  fetchIntradayDataReal,
  fetchIntradayDataCustomReal,
  fetchHistoricalPowerReal,
  fetchCommDevicesReal,
  fetchIntradayPerInverterReal,
  fetchMatrixAcDataReal,
  type InverterSeries,
  type IntradayPoint,
} from "../adapters/gateway";
import type { StationSummary, DailyPoint, MatrixData, CommDevice } from "../types";

export type { InverterSeries, IntradayPoint };

export async function fetchStationSummary(stationId: string): Promise<StationSummary> {
  return fetchStationSummaryReal(stationId);
}

export async function fetchDailyData(
  stationId: string, range: "7d" | "month" | "year" | "all",
): Promise<DailyPoint[]> {
  return fetchDailyDataReal(stationId, range);
}

export async function fetchIntradayData(stationId: string): Promise<IntradayPoint[]> {
  return fetchIntradayDataReal(stationId);
}

export async function fetchDailyDataCustom(
  stationId: string, startTs: number, endTs: number,
): Promise<DailyPoint[]> {
  return fetchDailyDataCustomReal(stationId, startTs, endTs);
}

export async function fetchIntradayDataCustom(
  stationId: string, startTs: number, endTs: number,
): Promise<IntradayPoint[]> {
  return fetchIntradayDataCustomReal(stationId, startTs, endTs);
}

export async function fetchHistoricalPower(
  stationId: string, startDate: string, endDate: string,
): Promise<IntradayPoint[]> {
  return fetchHistoricalPowerReal(stationId, startDate, endDate);
}

export async function fetchMatrixData(stationId: string, matrixId: string): Promise<MatrixData> {
  return fetchMatrixAcDataReal(stationId, matrixId);
}

export async function fetchPerInverterData(stationId: string): Promise<InverterSeries[]> {
  return fetchIntradayPerInverterReal(stationId);
}

export async function fetchCommDevices(stationId: string): Promise<CommDevice[]> {
  return fetchCommDevicesReal(stationId);
}
