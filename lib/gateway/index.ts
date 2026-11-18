/* ═══════════════════════════════════════════════════════════════════════════
 * NORTHBOUND EMS GATEWAY — DISABLED 24 September 2026
 *
 * The whole NorthBound integration is commented out in place, not deleted, at
 * Kedar's instruction. The website is moving to the Ornate Central EMS Backend
 * (bess-ems-api.unityess.cloud); see docs/central-backend-s1-contract.md.
 *
 * NOTHING READS REAL DATA WHILE THIS STANDS. The central backend publishes no
 * telemetry read endpoints yet — S1 fast-BESS is the next one expected — so
 * every data screen renders its empty state. That is the expected outcome of
 * this change, not a regression to chase.
 *
 * The stub below preserves this module's export surface so the 19 importers
 * still compile. Readers return empty, writers throw. To restore: delete the
 * stub, uncomment the original, and do the same in fetch.ts, session.ts,
 * lib/api/adapters/gateway.ts and app/api/gw/*.
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ── ORIGINAL, COMMENTED OUT ──────────────────────────────────────────────── */

// /**
//  * The NorthBound EMS Gateway, as the website reads it.
//  *
//  * One import path for everything under lib/api/services. The read-only surface
//  * is /k's — those wrappers map to documented endpoints, were written against
//  * this gateway's quirks and have been in the field since August — and this file
//  * states which of them the website uses, so the dependency is visible in one
//  * place rather than scattered through sixteen services.
//  *
//  * What is NOT re-exported is as deliberate as what is. The control family
//  * (cmdCharge, cmdDischarge, cmdStandby, cmdGridMode) is internal_admin at the
//  * gateway, classified "never public customer UI" by §11 of the API Reference,
//  * and refused server-side by the proxy unless GW_ALLOW_WRITES is set. The
//  * website has no dispatch screen, so it does not import the verbs either.
//  */
//
// export {
//   getHealth,
//   getSources,
//   getLatest,
//   getAlarms,
//   getAssets,
//   getAuthMe,
//   getSeries,
//   getStorageStatus,
//   getStoredPoints,
//   type StoredPointRow,
//   getFastBessProfile,
//   getRuntimeConfig,
//   getSocProtection,
//   isAlarmState,
//   type GatewayAlarm,
//   type GatewayAsset,
//   type AuthMe,
//   type HistorySeries,
//   type SeriesQuery,
//   type GwResponse,
// } from "@/mobile_app_kunal_backend/gateway/client";
//
// export type { FastBessRow, SourceSummary, GatewayMode } from "@/mobile_app_kunal_backend/gateway/types";
// export type { SeriesPoint, SeriesResponse } from "@/mobile_app_kunal_backend/gateway/series";
//
// export {
//   gw, leafValue, signal, firstSignal, unitOf, fetchSourceTelemetry,
//   type SignalMap, type UnitMap, type SourceTelemetry,
// } from "./fetch";
//
// export {
//   ensureSite, siteReady, activeSiteName, getSession, subscribe, login, logout,
//   revalidateSession, LoginError, type Session,
// } from "./session";

/* ── DISABLED STUB ────────────────────────────────────────────────────────── */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

const OFF = "NorthBound gateway is disabled; see docs/central-backend-s1-contract.md";

/* Shapes are kept REAL, not `any`. Callers index into these structurally —
   `r.data.points.filter(([, kw]) => …)` destructures a tuple by position — and
   an `any` here would turn every such callback parameter into an implicit-any
   error under noImplicitAny rather than compiling quietly. */

export type SignalMap = Record<string, Record<string, number | null>>;
export type UnitMap = Record<string, Record<string, string>>;
export interface SourceTelemetry { assets: string[]; signals: SignalMap; units: UnitMap }

export interface GwResponse<T = unknown> { data: T; ok: boolean; status: number }

export interface GatewayAlarm { [k: string]: any }
export interface GatewayAsset { [k: string]: any }
export interface StoredPointRow { [k: string]: any }
export interface FastBessRow { [k: string]: any }
export interface SourceSummary { [k: string]: any }
export interface AuthMe { [k: string]: any }
export type GatewayMode = string;
export type Session = any;

/** Positional, as series.ts emits it: [t, …six nullable stats…, count, count]. */
export type SeriesPoint = [
  number,
  number | null, number | null, number | null,
  number | null, number | null, number | null,
  number, number,
];
export interface SeriesResponse {
  source_id: string; bess_id: string;
  from_epoch_ms: number; to_epoch_ms: number; bucket_ms: number;
  points: SeriesPoint[];
  totals: {
    charged_kwh: number; discharged_kwh: number; throughput_kwh: number;
    ratio_pct: number | null; peak_abs_kw: number | null;
    soc_min: number | null; soc_max: number | null; temp_max: number | null;
    rows: number; skipped_ms: number;
  };
  coverage: {
    total: number; ready: number; covered_ms: number; window_ms: number;
    complete: boolean; gaps: [number, number][];
  };
}
export type HistorySeries = SeriesResponse;
export interface SeriesQuery {
  sourceId: string; bessId: string;
  fromEpochMs: number; toEpochMs: number;
  points?: number; nowMs?: number;
}

/* Readers resolve rather than throw, carrying status 503 and ok:false, so a
   screen renders its empty state instead of tripping an error boundary. */
const res = <T,>(data: T): Promise<GwResponse<T>> =>
  Promise.resolve({ data, ok: false, status: 503 });

const emptySeries = (q: SeriesQuery): SeriesResponse => ({
  source_id: q.sourceId, bess_id: q.bessId,
  from_epoch_ms: q.fromEpochMs, to_epoch_ms: q.toEpochMs, bucket_ms: 0,
  points: [],
  totals: {
    charged_kwh: 0, discharged_kwh: 0, throughput_kwh: 0,
    ratio_pct: null, peak_abs_kw: null,
    soc_min: null, soc_max: null, temp_max: null,
    rows: 0, skipped_ms: 0,
  },
  /* complete:false — the window is not covered, it is unavailable. A caller
     that trusts `complete` must not read this as a fully-read empty window. */
  coverage: {
    total: 0, ready: 0, covered_ms: 0,
    window_ms: Math.max(0, q.toEpochMs - q.fromEpochMs),
    complete: false, gaps: [[q.fromEpochMs, q.toEpochMs]],
  },
});

export const gw = <T = unknown,>(_path: string, _key?: string) => res({} as T);
export const getHealth = () => res({} as Record<string, unknown>);
export const getSources = () => res({ sources: [] as SourceSummary[] });
export const getLatest = () => res({ rows: [] as FastBessRow[] });
export const getAlarms = () => res({ alarms: [] as GatewayAlarm[] });
export const getAssets = (_sourceId?: string) => res({ assets: [] as GatewayAsset[] });
export const getAuthMe = () => res<AuthMe | null>(null);
export const getStorageStatus = () => res({} as Record<string, unknown>);
export const getStoredPoints = (_assetId: string, _signal: string, _limit?: number) =>
  res({ rows: [] as StoredPointRow[], count: 0 });
export const getFastBessProfile = () => res({} as Record<string, unknown>);
export const getRuntimeConfig = () => res({} as Record<string, unknown>);
export const getSocProtection = () => res({} as Record<string, unknown>);
export const getSeries = (q: SeriesQuery) => res(emptySeries(q));
export const isAlarmState = (_v: unknown): boolean => false;

export function leafValue(_v: unknown): number | null { return null; }
export function unitOf(_t: SourceTelemetry | undefined, _a: string, _n: string): string { return ""; }
export function signal(_t: SourceTelemetry | undefined, _a: string, _n: string): number | null { return null; }
export function firstSignal(_t: SourceTelemetry | undefined, _a: string, ..._names: string[]): number | null { return null; }
export const fetchSourceTelemetry = (_sourceId: string): Promise<SourceTelemetry> =>
  Promise.resolve({ assets: [], signals: {}, units: {} });

/* Session fails closed. Sign-in cannot succeed against a disabled gateway;
   repoint these at the central backend's /api/v1/auth/login when it lands. */
export class LoginError extends Error {
  constructor(msg = OFF) { super(msg); this.name = "LoginError"; }
}
export const getSession = (): Session => null;
export const subscribe = (_fn: () => void): (() => void) => () => {};
export const login = async (_email: string, _password: string): Promise<never> => {
  throw new LoginError(OFF);
};
export const logout = (): void => {};
export const revalidateSession = async (): Promise<void> => {};
export const siteReady = (): boolean => false;
export const activeSiteName = (): string => "";
export const ensureSite = async (): Promise<string> => "";
