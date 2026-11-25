"use client";

import { useEffect, useState } from "react";
import { useLastApiSync } from "@/hooks/useLastApiSync";
import { useLastTelemetryTs } from "@/lib/telemetryClock";
import { describeTelemetry } from "@/lib/freshness";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useFastBess } from "@/hooks/useFastBess";
import { useGatewayHealth } from "@/hooks/useGatewayHealth";
import { useQuery } from "@tanstack/react-query";
import { fetchFastBess, healthStatusOf } from "@/lib/central";
import { useUnit } from "@/lib/context/UnitContext";

/* Site freshness: the age of the newest reading the site sent. */
const LIVE_READING_MS    = 60_000;      // ≤ 60 s → Live
const OFFLINE_READING_MS = 5 * 60_000;  // > 5 min → Offline; between → Delayed
/* The website's own link: no successful server response for this long. */
const NO_LINK_AFTER_MS   = 3 * 60_000;

export type SiteFreshnessLabel = "Live" | "Delayed" | "Offline" | "No data" | "No link";

export interface SiteFreshness {
  label: SiteFreshnessLabel;
  color: string;
  /** One line explaining the three facts behind the label, for a tooltip. */
  title: string;
  /** When the site's newest reading was taken, epoch ms. */
  lastReadingAt: number | null;
  /** Short age of that reading, e.g. "8m". Empty when unknown. */
  age: string;
}

/**
 * Is the SITE live — not "does this website reach our server".
 *
 * The station-bar badge used to be the server link alone ("Synced" whenever
 * the backend answered), so it stayed green while the site's gateway was
 * unreachable and its newest reading minutes old: the backend answers with
 * whatever it last stored, whether or not anything new has arrived. And the
 * dashboard's own pill called data live for 15 minutes. Both read from here
 * now, so the two can never disagree:
 *
 *   · the website cannot reach the server     → No link
 *   · the site has never sent a reading        → No data
 *   · newest reading ≤ 60 s old                → Live
 *   · gateway reports unreachable, or > 5 min  → Offline
 *   · otherwise (1–5 min)                      → Delayed
 *
 * Gateway health records are written on state CHANGES, so the newest one is
 * the current state however old it is.
 */
export function useSiteFreshness(): SiteFreshness {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const { gatewayId } = useAppConfig();

  /* The newest S1 sample dates the site's last reading. Every 30 s, so a site
     going quiet shows up within half a minute; shares its key with
     UnitProvider's probe, and React Query polls at the faster of the two. */
  const s1Probe = useFastBess(gatewayId, undefined, 10, 30_000);
  let s1Ts: number | null = null;
  for (const r of s1Probe.data ?? []) {
    const t = Date.parse(r.sample_time_utc ?? "");
    if (!Number.isNaN(t) && (s1Ts == null || t > s1Ts)) s1Ts = t;
  }
  /* The site is only as live as its stalest cabinet: one newest sample per
     cabinet, and the OLDEST of those dates the site. A cabinet that went
     quiet while the other kept sending used to read Live. */
  const { units } = useUnit();
  const bessIds = units.map((u) => u.bessId).filter((b): b is string => !!b);
  const perCab = useQuery({
    queryKey: ["central", "freshnessPerCabinet", gatewayId, bessIds.join(",")],
    queryFn: async () => {
      const ts = await Promise.all(bessIds.map((b) =>
        fetchFastBess(gatewayId, { bessId: b, limit: 1 })
          .then((rows) => Date.parse(rows[0]?.sample_time_utc ?? ""))
          .catch(() => NaN)));
      return Object.fromEntries(bessIds.map((b, i) => [b, Number.isNaN(ts[i]) ? null : ts[i]]));
    },
    enabled: gatewayId.length > 0 && bessIds.length > 1,
    refetchInterval: 30_000,
    staleTime: 25_000,
    retry: false,
  });
  const cabTs = Object.entries(perCab.data ?? {});
  const stalest = cabTs.length
    ? cabTs.reduce<[string, number | null] | null>((m, [b, t]) => (m == null || (t ?? -Infinity) < (m[1] ?? -Infinity) ? [b, t] : m), null)
    : null;
  const pageTs = useLastTelemetryTs() ?? s1Ts;
  /* With more than one cabinet, the stalest one's sample wins when it is older. */
  const lastReadingAt = stalest && stalest[1] != null && pageTs != null ? Math.min(pageTs, stalest[1]) : pageTs;
  /* A cabinet with no sample at all while another has one is offline. */
  const cabinetSilent = !!stalest && stalest[1] == null && cabTs.some(([, t]) => t != null);
  const lagging = cabinetSilent ? units.find((u) => u.bessId === stalest![0])?.label ?? stalest![0]
    : stalest && pageTs != null && stalest[1] != null && pageTs - stalest[1] > LIVE_READING_MS
    ? units.find((u) => u.bessId === stalest[0])?.label ?? stalest[0] : null;
  const reading = describeTelemetry(lastReadingAt, now);

  const health = useGatewayHealth(gatewayId, 1);
  const gatewayStatus = healthStatusOf(health.data?.[0]);
  const gatewayDown = ["UNREACHABLE", "OFFLINE"].includes((gatewayStatus ?? "").toUpperCase());

  const lastSyncAt = useLastApiSync();
  const linkAge = lastSyncAt != null && now != null ? now - lastSyncAt : null;
  const readingAgeMs = reading.ageMs;

  const [label, color]: [SiteFreshnessLabel, string] =
    linkAge != null && linkAge > NO_LINK_AFTER_MS ? ["No link", "#A8505E"] :
    readingAgeMs == null                          ? ["No data", "var(--muted)"] :
    cabinetSilent                                 ? ["Offline", "#A8505E"] :
    readingAgeMs <= LIVE_READING_MS               ? ["Live",    "#4E8D6E"] :
    gatewayDown || readingAgeMs > OFFLINE_READING_MS
                                                  ? ["Offline", "#A8505E"] :
                                                    ["Delayed", "#9C844A"];

  const clock = (t: number) => new Date(t).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour12: false });
  const title = [
    readingAgeMs == null ? "No reading from the site yet" : `Newest site reading ${reading.age} ago`,
    lagging ? (cabinetSilent ? `${lagging} has sent no reading` : `${lagging} is behind the other cabinet`) : null,
    gatewayStatus ? `Gateway: ${gatewayStatus}` : null,
    lastSyncAt != null ? `Website ↔ server: last reached ${clock(lastSyncAt)} IST` : "Website ↔ server: not reached yet",
  ].filter(Boolean).join(" · ");

  return { label, color, title, lastReadingAt, age: reading.age };
}
