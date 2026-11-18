/**
 * Alarm priority, P1 (act now) to P4 (note it).
 *
 * The backend sends no priority. S4 carries a severity (High / Medium / Low /
 * Warning) and the flag lists give a derived type (failure / alarm / inform);
 * neither says what is dangerous. So the rule is explicit and lives here:
 *
 *   P1  Critical  a failure on the safety chain — fire protection, or a
 *                 fire / smoke / gas / thermal-runaway / insulation /
 *                 emergency-stop signal on any device
 *   P2  High      any other failure, or S4 severity High
 *   P3  Medium    an alarm, or S4 severity Medium
 *   P4  Low       information, S4 Low or Warning
 *
 * A safety signal is P1 whatever its severity says: a mislabelled "alarm" on
 * a smoke detector is still a smoke detector.
 */

export type AlarmPriority = 1 | 2 | 3 | 4;

const SAFETY = /fire|smoke|gas|thermal[_ ]?runaway|explosion|insulation|emergency|e[_ ]?stop|aerosol|flood|water[_ ]?leak/i;

export interface PriorityInput {
  alarmType?: "failure" | "alarm" | "inform" | string | null;
  /** S4 severity, where one matched. */
  logSeverity?: string | null;
  deviceType?: string | null;
  signal?: string | null;
  alertContent?: string | null;
}

export function priorityOf(a: PriorityInput): AlarmPriority {
  const text = `${a.signal ?? ""} ${a.alertContent ?? ""}`;
  const sev = (a.logSeverity ?? "").toLowerCase();
  const failure = a.alarmType === "failure" || sev === "high" || sev === "critical";
  if (SAFETY.test(text) && (failure || a.alarmType === "alarm" || sev === "medium")) return 1;
  if (a.deviceType === "Fire Protection" && failure) return 1;
  if (failure) return 2;
  if (a.alarmType === "alarm" || sev === "medium") return 3;
  return 4;
}

export const PRIORITY: Record<AlarmPriority, { label: string; name: string; color: string }> = {
  1: { label: "P1", name: "Critical", color: "#C2413A" },
  2: { label: "P2", name: "High",     color: "#D9822B" },
  3: { label: "P3", name: "Medium",   color: "#C9A227" },
  4: { label: "P4", name: "Low",      color: "#5B8AB4" },
};
