/**
 * Devices whose data has stopped arriving — "Communication Lost" alarms.
 *
 * A device on the Communication Status screen goes Abnormal when its readings
 * stop and Offline when its own reachability register says so; neither raised
 * an alarm, because alarms were only the faults a device reports, and a silent
 * device reports none (13 Oct 2026: BMS detail silent from 13:44 and fire
 * protection from 16:42 on both BESS, with nothing on the Alarms page).
 *
 * Silent: the newest reading is older than COMM_LOST_MS, or three of the
 * device's own reporting intervals if that is longer — a slow device is not
 * lost for being slow. Offline: the newest communication_status /
 * online_points reading is 0.
 */

export const COMM_LOST_MS = 15 * 60_000;
/** Without two readings to measure a cadence from. */
const UNKNOWN_CADENCE_MS = 30 * 60_000;

export interface CommRow {
  asset_id?: string | null;
  substream?: string | null;
  signal?: string | null;
  sample_time_utc?: string | null;
  value?: unknown;
}

export interface CommLost {
  assetId: string;
  substream: string;
  reason: "silent" | "offline";
  /** The newest reading, epoch ms. */
  lastSeen: number;
}

export function commLostOf(rows: CommRow[], now: number): CommLost[] {
  const by = new Map<string, { sub: string; times: number[]; flag?: { t: number; v: number } }>();
  for (const r of rows) {
    if (!r.asset_id) continue;
    const t = Date.parse(r.sample_time_utc ?? "");
    if (Number.isNaN(t)) continue;
    const e = by.get(r.asset_id) ?? { sub: r.substream ?? "", times: [] };
    e.times.push(t);
    if (r.signal === "communication_status" || r.signal === "online_points") {
      const v = Number(r.value);
      if (Number.isFinite(v) && (!e.flag || t > e.flag.t)) e.flag = { t, v };
    }
    by.set(r.asset_id, e);
  }
  const out: CommLost[] = [];
  for (const [assetId, e] of by) {
    /* remote_control is a schedule written to, not a device that reports. */
    if (e.sub === "remote_control") continue;
    const t = [...new Set(e.times)].sort((a, b) => a - b);
    const lastSeen = t[t.length - 1];
    const gaps = t.slice(1).map((x, i) => x - t[i]).sort((a, b) => a - b);
    const cadence = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
    const limit = cadence == null ? Math.max(COMM_LOST_MS, UNKNOWN_CADENCE_MS) : Math.max(COMM_LOST_MS, 3 * cadence);
    if (e.flag && e.flag.v === 0) out.push({ assetId, substream: e.sub, reason: "offline", lastSeen });
    else if (now - lastSeen > limit) out.push({ assetId, substream: e.sub, reason: "silent", lastSeen });
  }
  return out;
}
