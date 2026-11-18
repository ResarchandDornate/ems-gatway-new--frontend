"use client";

/**
 * Gateway Health — what the field device says about itself.
 *
 * The first screen in this app reading the central backend for real rather
 * than for a heartbeat. It is deliberately NOT a plant view: nothing here is a
 * measurement of the battery. It answers a narrower question that no other
 * screen can — is the gateway up, is it seeing its sources, and is what it
 * sees arriving here.
 *
 * ── Why the upload lag is given its own tile ───────────────────────────────
 *
 * `sample_time_utc` is when the gateway measured; `received_at_utc` is when
 * this backend stored it. A gateway whose link has failed keeps measuring and
 * keeps reporting status "ok" in its own snapshot — the snapshot describes the
 * gateway, not the delivery. The gap between the two stamps is the only thing
 * that exposes that, so it is shown as a figure rather than left for someone
 * to subtract two timestamps by eye.
 *
 * ── Every figure is allowed to be absent ───────────────────────────────────
 *
 * The API reference says the `data` payload varies by gateway firmware, so a
 * missing key renders as an em dash rather than a zero. Zero bad signals and
 * "this build does not report bad signals" are very different claims and the
 * screen must not conflate them.
 *
 * ── The whole snapshot, not just the headline ──────────────────────────────
 *
 * Mapped field by field against a live payload on 28 Sep 2026. Besides the
 * counts in the tiles, each source reports its own asset/signal counts and when
 * the gateway last heard from it, and the snapshot carries the gateway's local
 * store (`storage`), the 1 Hz S1 sampler (`fast_bess_logger`), whether control
 * and commands are enabled, the poll-error state and the gateway's own clock.
 * All of it is shown below; none of it is a plant measurement either.
 */

import { useMemo } from "react";
import { healthStatusOf, isHealthyStatus, type GatewayHealthRecord, type GatewaySourceHealth } from "@/lib/central";
import { PageHeader } from "@/components/PageHeader";
import { cabinetLabel } from "@/lib/deviceNames";

/* ── Formatting ───────────────────────────────────────────────────────────── */

const DASH = "—";

const num = (v: number | undefined) =>
  typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-IN") : DASH;

/** Stored UTC, rendered in the viewer's zone. The stored value is never mutated. */
const localStamp = (iso: string | undefined) => {
  if (!iso) return DASH;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return DASH;
  return new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata",
    day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
};

/** MB as the gateway reports storage, shown in GB once it is that large. */
const mb = (v: number | undefined) =>
  typeof v !== "number" || !Number.isFinite(v) ? DASH
  : v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`;

/** Display-only Title Case for raw ids like "periodic_snapshot"; acronyms upper. */
const ACRONYMS = new Set(["api", "ems", "pcs", "bms", "io", "ac", "dc", "soc", "utc", "ok"]);
const titleCase = (id: string) =>
  id.split(/[_\s]+/).filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

const yesNo = (v: boolean | undefined) => (v === undefined ? DASH : v ? "Yes" : "No");

const duration = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
};

/* ── Pieces ───────────────────────────────────────────────────────────────── */

function Tile({ label, value, sub, tone }: {
  label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad";
}) {
  const colour =
    tone === "ok" ? "var(--accent)" :
    tone === "warn" ? "#C9A227" :
    tone === "bad" ? "#C2566B" : "var(--ink)";
  return (
    <div className="surface-card min-w-0" style={{ padding: "var(--pad)" }}>
      <p className="card-eyebrow">{label}</p>
      {/* Scales with the screen and wraps rather than running out of the tile. */}
      <div className="text-[clamp(18px,5vw,26px)] font-semibold leading-tight break-words" style={{ color: colour }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function Dot({ on }: { on: boolean | undefined }) {
  const c = on === undefined ? "var(--muted)" : on ? "var(--accent)" : "#C2566B";
  return (
    <span
      className="inline-block rounded-full flex-none"
      style={{ width: 7, height: 7, background: c, boxShadow: `0 0 6px ${c}` }}
    />
  );
}

/** One label/value line in a card's footer list. `bad` tints the value. */
function Row({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span>{label}</span>
      <span className="text-ink3 text-right truncate" style={bad ? { color: "#C2566B" } : undefined} title={value}>
        {value}
      </span>
    </div>
  );
}

/* ── View ─────────────────────────────────────────────────────────────────── */

/** The gateway's mode, as a sentence: ems_read_write → "Monitoring & Control". */
function modeWords(mode: string): string {
  const m = mode.toLowerCase();
  if (m.includes("read_write")) return "Monitoring & Control";
  if (m.includes("read_only") || m === "monitor") return "Monitoring Only";
  return titleCase(mode);
}

export function GatewayHealth({
  gatewayId, records, loading, error, configPending,
}: {
  gatewayId: string;
  records: GatewayHealthRecord[] | undefined;
  loading: boolean;
  error: Error | null;
  /** Config still in flight — gatewayId "" means unknown, not unset. */
  configPending?: boolean;
}) {
  const latest = records?.[0];
  const health = latest?.data?.health;
  const status = healthStatusOf(latest);

  /* Upload lag off the newest record. Both stamps are optional, so this is
     null rather than 0 when either is missing. */
  const lagMs = useMemo(() => {
    const s = Date.parse(latest?.sample_time_utc ?? "");
    const r = Date.parse(latest?.received_at_utc ?? "");
    return Number.isNaN(s) || Number.isNaN(r) ? null : Math.max(0, r - s);
  }, [latest]);

  const sources: GatewaySourceHealth[] = health?.sources ?? [];
  const bad = health?.bad_signal_count;
  const storage = health?.storage;
  const logger = health?.fast_bess_logger;

  if (!gatewayId) {
    if (configPending) {
      return (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">Loading…</p>
        </div>
      );
    }
    return (
      <div className="surface-card ps-hero">
        <div>
          <h1 className="ps-hero-title">No Gateway Configured</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHeader title="Gateway Health" />

      {error && (
        <div className="surface-card" style={{ padding: "var(--pad)", borderColor: "#C2566B" }}>
          <p className="card-eyebrow" style={{ color: "#C2566B" }}>Could Not Read</p>
          <p className="text-[12px] text-ink3 mt-1">{error.message}</p>
        </div>
      )}

      {!error && !loading && records?.length === 0 && (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">No Records</p>
        </div>
      )}

      {loading && !records && (
        <div className="surface-card" style={{ padding: "var(--pad)" }}>
          <p className="card-eyebrow">Loading…</p>
        </div>
      )}

      {latest && (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))" }}>
            <Tile
              label="Status"
              value={status ? titleCase(status.toLowerCase()) : DASH}
              sub={health?.gateway_mode ? modeWords(health.gateway_mode) : undefined}
              tone={isHealthyStatus(status) ? "ok" : status ? "bad" : undefined}
            />
            <Tile
              label="Cabinets Online"
              value={
                health?.online_source_count !== undefined && health?.source_count !== undefined
                  ? `${health.online_source_count}/${health.source_count}` : DASH
              }
              tone={
                health?.online_source_count === undefined ? undefined
                : health.online_source_count === health.source_count ? "ok" : "bad"
              }
            />
            <Tile
              label="Devices Online"
              value={
                health?.online_asset_count !== undefined && health?.asset_count !== undefined
                  ? `${health.online_asset_count}/${health.asset_count}` : DASH
              }
              tone={
                health?.online_asset_count === undefined ? undefined
                : health.online_asset_count === health.asset_count ? "ok" : "warn"
              }
            />
            <Tile label="Data Points" value={num(health?.total_signal_count)} />
            <Tile
              label="Faulty Data Points"
              value={num(bad)}
              tone={bad === undefined ? undefined : bad === 0 ? "ok" : "warn"}
              sub={bad === undefined ? "Not Reported" : undefined}
            />
            <Tile
              label="Upload Delay"
              value={lagMs === null ? DASH : duration(lagMs)}
              sub="From Reading To Cloud"
              tone={lagMs === null ? undefined : lagMs < 60_000 ? "ok" : "warn"}
            />
          </div>

          <div className="grid gap-3 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div className="surface-card" style={{ padding: "var(--pad)" }}>
              <p className="card-eyebrow">Cabinets</p>
              {sources.length === 0 ? (
                <p className="text-[12px] text-muted mt-2">None</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {sources.map((s, i) => (
                    <li key={s.source_id ?? i} className="flex flex-col gap-0.5 text-[12px] text-ink3">
                      <div className="flex items-center gap-2">
                        <Dot on={s.online} />
                        <span title={s.source_id ?? undefined}>{s.source_id ? cabinetLabel(s.source_id) : DASH}</span>
                        <span className="ml-auto text-[11px] text-muted">
                          {s.online === undefined ? DASH : s.online ? "Online" : "Offline"}
                        </span>
                      </div>
                      {/* Per-source counts and when the gateway last heard from
                          this controller — `sources[]` carries all of it. */}
                      <div className="pl-[15px] flex flex-wrap gap-x-3 text-[10px] font-mono text-muted">
                        <span>
                          {s.online_asset_count !== undefined && s.asset_count !== undefined
                            ? `${s.online_asset_count}/${s.asset_count} Assets` : `${DASH} Assets`}
                        </span>
                        <span>{num(s.signal_count)} Signals</span>
                        <span style={s.bad_signal_count ? { color: "#C9A227" } : undefined}>
                          {num(s.bad_signal_count)} Bad
                        </span>
                        <span title="When the gateway last heard from this cabinet">
                          Seen {localStamp(s.last_update_utc)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 pt-3 border-t border-line flex flex-col gap-1 text-[11px] text-muted">
                <Row label="Cabinet Controller Reachable" value={yesNo(latest.data?.api_reachable)} bad={latest.data?.api_reachable === false} />
                <Row label="Controller Error" value={health?.api_error ?? (health ? "None" : DASH)} bad={!!health?.api_error} />
                <Row
                  label="Failed Reads"
                  value={
                    health?.poll_error_count === undefined ? DASH
                    : `${health.poll_error_count}${health.poll_error_active ? " · Active" : ""}`
                  }
                  bad={health?.poll_error_active === true}
                />
                <Row label="Control Allowed" value={yesNo(health?.control_enabled)} />
                <Row label="Remote Commands Allowed" value={yesNo(health?.commands_enabled)} />
                <Row label="Local Storage Writable" value={yesNo(health?.storage_can_write)} bad={health?.storage_can_write === false} />
                <Row label="Gateway Clock" value={localStamp(health?.gateway_timestamp_utc)} />
                <Row
                  label="Report Type"
                  value={[latest.data?.record_type, latest.data?.reason].filter(Boolean).map((v) => titleCase(String(v))).join(" · ") || DASH}
                />
              </div>
            </div>

            <div className="surface-card" style={{ padding: "var(--pad)" }}>
              <p className="card-eyebrow mb-2">Recent Reports</p>
              <div className="flex flex-col gap-1 overflow-auto" style={{ maxHeight: 260 }}>
                {records!.slice(0, 40).map((r, i) => {
                  const h = r.data?.health;
                  return (
                    <div
                      key={`${r.sample_time_utc ?? i}-${i}`}
                      className="flex items-center gap-2 text-[11px] py-1 border-b border-line last:border-0"
                    >
                      <Dot on={h?.status === undefined ? undefined : h.status === "ok"} />
                      <span className="font-mono text-ink3">{localStamp(r.sample_time_utc)}</span>
                      <span className="ml-auto text-muted">
                        {h?.online_source_count !== undefined && h?.source_count !== undefined
                          ? `${h.online_source_count}/${h.source_count} Cabinets Online` : DASH}
                      </span>
                      <span className="text-muted" title={r.data?.reason ?? undefined}>{r.data?.reason ? titleCase(r.data.reason) : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* The gateway's own store and its 1 Hz sampler. Both are in every
              snapshot and both explain gaps elsewhere: a full or unmounted
              disk, or a stopped fast-BESS logger, is why Live BESS goes quiet
              while this page still reads "ok". */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            <div className="surface-card" style={{ padding: "var(--pad)" }}>
              <p className="card-eyebrow">Gateway Local Storage</p>
              {!storage ? (
                <p className="text-[12px] text-muted mt-2">Not Reported</p>
              ) : (
                <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted">
                  <Row label="Enabled" value={yesNo(storage.enabled)} />
                  <Row label="Disk Connected" value={yesNo(storage.mount_ok)} bad={storage.mount_ok === false} />
                  <Row label="Can Write" value={yesNo(storage.can_write)} bad={storage.can_write === false} />
                  <Row
                    label="Disk Used"
                    value={typeof storage.used_percent === "number" ? `${storage.used_percent.toFixed(1)} %` : DASH}
                    bad={typeof storage.used_percent === "number" && storage.used_percent >= 90}
                  />
                  <Row label="Database Size" value={mb(storage.db_size_mb)} />
                  <Row label="Free Space" value={mb(storage.free_space_mb)} />
                  <Row label="Readings Not Saved" value={num(storage.skipped_write_count)} bad={!!storage.skipped_write_count} />
                  <Row label="Why Last Reading Wasn't Saved" value={storage.last_skip_reason ?? "None"} />
                </div>
              )}
            </div>

            <div className="surface-card" style={{ padding: "var(--pad)" }}>
              <p className="card-eyebrow">Battery Data Recorder</p>
              {!logger ? (
                <p className="text-[12px] text-muted mt-2">Not Reported</p>
              ) : (
                <div className="mt-2 flex flex-col gap-1 text-[11px] text-muted">
                  <Row label="Enabled" value={yesNo(logger.enabled)} />
                  <Row label="Running" value={yesNo(logger.running)} bad={logger.enabled === true && logger.running === false} />
                  <Row label="Process Alive" value={yesNo(logger.thread_alive)} bad={logger.thread_alive === false} />
                  <Row label="Last Reading" value={localStamp(logger.last_sample_utc)} />
                  <Row label="Last Error" value={logger.last_error ?? "None"} bad={!!logger.last_error} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
