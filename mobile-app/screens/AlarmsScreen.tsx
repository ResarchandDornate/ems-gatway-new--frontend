"use client";

/**
 * Alarms — the real alarm list from UGX, grouped by severity.
 *
 * Filters are the existing AlarmFilters shape, so this screen is the web app's
 * alarm module at phone width rather than a reduced version of it.
 */

import { useMemo, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useMobileStation, useAlarmList, useAlarmStats } from "../data";
import { Header } from "../components/Header";
import {
  FloatingCard, SectionHeader, ListItem, Segmented, Shimmer, StatusIndicator, Value,
  FeatureCard, Chip, ChipRow, Readout, Monogram,
} from "../components";
import type { AlarmType } from "@/lib/api/types";

type Filter = "all" | AlarmType;

/** "1 fault", "2 faults" — a count chip that reads as English. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const TONE: Record<AlarmType, "bad" | "warn" | "idle"> = {
  failure: "bad",
  alarm:   "warn",
  inform:  "idle",
};

export function AlarmsScreen() {
  const { stationId } = useMobileStation();
  const [filter, setFilter] = useState<Filter>("all");

  const stats = useAlarmStats();
  /* AlarmFilters carries no severity field, so severity is narrowed here rather
     than sent as a parameter the API would silently ignore. One fetch serves
     all four tabs, which is also why switching them is instant. */
  const { data, isLoading } = useAlarmList(stationId);

  const rows = useMemo(
    () => (filter === "all" ? data : data.filter((a) => a.alarmType === filter)),
    [data, filter],
  );

  return (
    <>
      <Header />

      <FeatureCard style={{ marginBottom: 22 }}>
        <div className="m-spread">
          <span className="m-eyebrow">Active alarms</span>
          <StatusIndicator
            tone={(stats.data?.failure ?? 0) > 0 ? "bad" : (stats.data?.alarm ?? 0) > 0 ? "warn" : "good"}
            label={(stats.data?.failure ?? 0) > 0 ? "Action needed" : "Nominal"}
            live
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <Readout value={stats.data?.total ?? null} precision={0} />
        </div>
        {/* Counts are labelled in words here rather than tinted, because the
            feature surface deliberately whites-out chip tones for contrast. */}
        <ChipRow>
          <Chip>{plural(stats.data?.failure ?? 0, "fault")}</Chip>
          <Chip>{plural(stats.data?.alarm ?? 0, "alarm")}</Chip>
          <Chip>{plural(stats.data?.inform ?? 0, "notice")}</Chip>
        </ChipRow>
      </FeatureCard>

      <Segmented<Filter>
        ariaLabel="Filter alarms by severity"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all",     label: "All" },
          { value: "failure", label: "Faults" },
          { value: "alarm",   label: "Alarms" },
          { value: "inform",  label: "Info" },
        ]}
      />

      <div style={{ marginTop: 22 }}>
        <SectionHeader
          title={filter === "all" ? "All severities" : filter}
          action={<span className="m-label m-ink3">{plural(rows.length, "result")}</span>}
        />

        <FloatingCard style={{ paddingTop: 4, paddingBottom: 4 }}>
          {isLoading ? (
            <div style={{ padding: "16px 0", display: "grid", gap: 14 }}>
              <Shimmer w="82%" h={15} />
              <Shimmer w="64%" h={15} />
              <Shimmer w="73%" h={15} />
            </div>
          ) : rows.length === 0 ? (
            <div className="m-empty">
              <span className="m-empty-mark"><CircleCheck size={19} /></span>
              <span className="m-body m-ink3">Nothing active in this category.</span>
            </div>
          ) : (
            rows.map((a) => {
              return (
                <ListItem
                  key={a.id}
                  wrap
                  /* Device initials, as in the reference's holdings rows —
                     faster to scan down a column than a repeated glyph. */
                  leading={<Monogram text={a.deviceName} />}
                  title={a.alertContent}
                  /* 24-hour: shorter, so it stays on one line, and the
                     conventional register for plant monitoring. */
                  subtitle={`${a.deviceName} · ${new Date(a.alertTime).toLocaleString("en-IN", {
                    day: "2-digit", month: "short",
                    hour: "2-digit", minute: "2-digit", hour12: false,
                  })}`}
                  trailing={
                    <StatusIndicator
                      tone={TONE[a.alarmType] ?? "idle"}
                      label={a.alarmCode}
                    />
                  }
                />
              );
            })
          )}
        </FloatingCard>
      </div>
    </>
  );
}
