/**
 * The Ornate Central EMS Backend, as the website reads it.
 *
 * One import path, the way lib/gateway was for NorthBound. Today it carries
 * only the session — the backend publishes no telemetry reads yet. Data
 * readers land here as S1 ships; see docs/central-backend-s1-contract.md.
 */
export {
  getSession, subscribe, login, logout, revalidateSession, heartbeat,
  ensureSite, siteReady, activeSiteName, LoginError, SITE_NAME,
  type Session,
} from "./session";

export {
  fetchGatewayHealth, fetchGatewayList, healthStatusOf, isHealthyStatus, CentralReadError, CONFIGURED_GATEWAY_ID,
  type GatewayListing, type GatewayHealthRecord, type GatewayHealthSnapshot, type GatewaySourceHealth,
} from "./gateways";

export {
  fetchFastBess, fetchFastBessSlices, fetchFastBessWindow, fetchPowerSocRange, chronological, windowOf, signalNames, reading,
  FAST_BESS_MAX_LIMIT,
  type FastBessSample, type FastBessPayload, type SignalValues, type PowerSocPoint,
} from "./fastBess";

export {
  fetchGeneral, numeric, label, isKeySignal, assetsIn, latestPerSignal, seriesFor,
  SUBSTREAMS, GENERAL_MAX_LIMIT,
  type GeneralRecord, type Substream,
} from "./general";

export {
  fetchAlarmEvents, occurrences, openOccurrences, episodes, ALARMS_MAX_LIMIT,
  type AlarmEvent, type AlarmOccurrence, type AlarmEpisode, type AlarmSeverity, type AlarmState,
} from "./alarms";

export {
  fetchController, stateOf, controllerLabel, stateChanges, socByBess, CONTROLLER_BESS, CONTROLLER_MAX_LIMIT,
  type ControllerRecord, type ControllerData, type ControllerBess, type ControllerSolis,
  type ControllerThresholds, type ControllerAction,
} from "./controller";

export {
  fetchSolis, snapshotsOf, eventsOf, isGoodRead, solarKw, limitKw, SOLIS_MAX_LIMIT,
  type SolisRecord, type SolisState, type SolisEvent, type SolisSnapshot, type SolisEventRow,
} from "./solis";

export {
  fetchEdgeAi, cyclesOf, anomaliesOf, featureLabel, EDGE_AI_MAX_LIMIT,
  type EdgeAiRecord, type EdgeAiCycle, type EdgeAiAnomaly, type EdgeAiSource, type EdgeAiModelInfo,
} from "./edgeAi";

export {
  fetchConfigAudit, settingLabel, auditValueText, CONFIG_AUDIT_MAX_LIMIT,
  type ConfigAuditRecord, type ConfigChangeSource,
} from "./configAudit";

export { setWindow, inWindow, type ReadWindow } from "./gateways";

export { wordSwapped, WORD_SWAPPED_SIGNALS, signedMilli, SIGNED_MILLI_SIGNALS, decoded } from "./decode";

export { fetchHistory, mergeRows, type HistoryStream } from "./history";
