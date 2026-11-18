"use client";

/**
 * The Device List detail panel's reads, on the central backend.
 *
 * A new file rather than a change to useDeviceTelemetry: that one's services
 * read the NorthBound gateway with NorthBound asset ids, and the History page
 * still calls it that way. See deviceTelemetry.service.ts, "Central backend".
 *
 * One snapshot query per asset, not two: useDeviceLatest keyed its cache on
 * the device alone, so the KPI read and the all-parameters read — different
 * key lists — overwrote each other under one cache entry.
 */

import { useQuery } from "@tanstack/react-query";
import { useAppConfig } from "@/hooks/useAppConfig";
import { fetchAssetSnapshot, fetchAssetSeries } from "@/lib/api/services/deviceTelemetry.service";
import { fetchFastBess, fetchFastBessWindow, type FastBessSample } from "@/lib/central";
import { istMidnight } from "@/lib/api/time";

export function useAssetSnapshot(assetId: string) {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["assetTelemetry", "snapshot", gatewayId, assetId],
    queryFn:  () => fetchAssetSnapshot(gatewayId, assetId),
    enabled:  !!gatewayId && !!assetId,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}

export function useAssetSeries(assetId: string, key: string) {
  const { gatewayId } = useAppConfig();
  return useQuery({
    queryKey: ["assetTelemetry", "series", gatewayId, assetId, key],
    queryFn:  () => fetchAssetSeries(gatewayId, assetId, key),
    enabled:  !!gatewayId && !!assetId && !!key,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export type TrendRange = "stored" | "1h" | "today";

/** PCS and BMS assets whose signals S1 also carries, with their bess id. */
export function s1Home(assetId: string): { bessId: string; group: "pcs_values" | "bms_values" } | null {
  const m = /^external_ems_(\d+)_(pcs|bms)$/.exec(assetId);
  return m ? { bessId: `bess_${m[1]}`, group: m[2] === "pcs" ? "pcs_values" : "bms_values" } : null;
}

const hm = (ts: number, sec = false) => new Date(ts).toLocaleTimeString("en-IN", {
  timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", ...(sec ? { second: "2-digit" } : {}), hour12: false,
});

/**
 * One S1 key over the last hour (every sample, paged) or today (one sample
 * every ten minutes, since S1 is 1 Hz and a day is 86,400 rows). S2 point
 * reads reach only the newest rows; S1 takes a date range.
 */
export function useS1KeySeries(assetId: string, key: string, range: TrendRange) {
  const { gatewayId } = useAppConfig();
  const home = s1Home(assetId);
  return useQuery({
    queryKey: ["assetTelemetry", "s1Series", gatewayId, assetId, key, range],
    queryFn: async () => {
      const now = Date.now();
      let rows: FastBessSample[] = [];
      if (range === "1h") {
        rows = (await fetchFastBessWindow(gatewayId, { bessId: home!.bessId, fromMs: now - 3_600_000, toMs: now, maxPages: 5 })).samples;
      } else {
        const wins: number[] = [];
        for (let t = istMidnight(now); t < now; t += 10 * 60_000) wins.push(t);
        let i = 0;
        const out: (FastBessSample | null)[] = new Array(wins.length);
        await Promise.all(Array.from({ length: 8 }, async () => {
          while (i < wins.length) {
            const k = i++;
            out[k] = await fetchFastBess(gatewayId, { bessId: home!.bessId, fromMs: wins[k], toMs: wins[k] + 60_000, limit: 1 })
              .then((r) => r[0] ?? null).catch(() => null);
          }
        }));
        rows = out.filter((r): r is FastBessSample => !!r);
      }
      const points = rows.map((r) => {
        const ts = Date.parse(r.sample_time_utc ?? "");
        const v = (r.data?.[home!.group] as Record<string, unknown> | undefined)?.[key];
        return { ts, value: typeof v === "number" && Number.isFinite(v) ? v : NaN };
      }).filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.value))
        .sort((a, b) => a.ts - b.ts)
        .map((p) => ({ ...p, t: hm(p.ts, range === "1h") }));
      return { points, onS1: points.length > 0 || rows.length === 0 ? points.length > 0 : false };
    },
    enabled: !!gatewayId && !!home && !!key && range !== "stored",
    staleTime: range === "1h" ? 30_000 : 5 * 60_000,
    refetchInterval: range === "1h" ? 60_000 : 10 * 60_000,
  });
}
