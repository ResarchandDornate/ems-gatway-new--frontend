"use client";

/**
 * One hovered moment shared by a page's charts.
 *
 * Inside a <HoverSyncProvider>, hovering any chart publishes a time window —
 * an instant on a Day curve, a whole hour / day / month on a bar — and every
 * other chart marks the same window (a cursor line on a curve, a shaded band
 * on a bar chart) while its card's readings show the values there. Outside a
 * provider every hook here is a no-op, so the shared charts behave as before
 * on the other screens.
 *
 * A small external store rather than React state on the page, so a mouse
 * move re-renders the cards, not the whole dashboard.
 */

import { createContext, useCallback, useContext, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { bucketsOf, wall, type Period } from "@/lib/charts/period";
import { tooltipStyle } from "@/lib/charts/tokens";
import { ReferenceArea, ReferenceLine } from "recharts";

/** What is hovered: [from, to) — `from === to` for an instant on a curve. */
export interface HoverWindow { from: number; to: number; source: string; label?: string }

interface Store {
  get: () => HoverWindow | null;
  set: (w: HoverWindow | null) => void;
  subscribe: (fn: () => void) => () => void;
}

function createStore(): Store {
  let cur: HoverWindow | null = null;
  const subs = new Set<() => void>();
  return {
    get: () => cur,
    set: (w) => {
      if (w === cur || (w && cur && w.from === cur.from && w.to === cur.to && w.source === cur.source)) return;
      cur = w;
      subs.forEach((fn) => fn());
    },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}

const Ctx = createContext<Store | null>(null);

export function HoverSyncProvider({ children }: { children: ReactNode }) {
  const ref = useRef<Store | null>(null);
  if (!ref.current) ref.current = createStore();
  return <Ctx.Provider value={ref.current}>{children}</Ctx.Provider>;
}

const nothing = () => null;
const noSub = () => () => {};

/**
 * The page's hovered window and a setter tagged with this chart's id.
 * `hover` is null outside a provider or when nothing is hovered; `own` says
 * this chart is the one under the pointer (it shows its own tooltip).
 */
export function useHoverSync() {
  const store = useContext(Ctx);
  const id = useId();
  const hover = useSyncExternalStore(store?.subscribe ?? noSub, store?.get ?? nothing, nothing);
  const publish = useCallback((from: number, to: number = from, label?: string) => {
    store?.set({ from, to, source: id, label });
  }, [store, id]);
  const clear = useCallback(() => {
    if (store?.get()?.source === id) store.set(null);
  }, [store, id]);
  return { hover, own: hover?.source === id, publish, clear, enabled: store != null };
}

/** Recharts mouse handlers for a time-axis chart: publish the hovered instant. */
export function timeHoverHandlers(publish: (ts: number) => void, clear: () => void) {
  return {
    onMouseMove: (e: { activeLabel?: unknown } | null) => {
      const ts = Number(e?.activeLabel);
      if (e?.activeLabel != null && Number.isFinite(ts)) publish(ts);
    },
    onMouseLeave: clear,
  };
}

/** The window a bucket label stands for in a period: an hour of a Day, a day of a Week / Month, a month of a Year. */
export function bucketWindow(period: Period, label: string): { from: number; to: number } | null {
  if (period.range === "day") {
    const h = Number(label);
    if (!Number.isInteger(h)) return null;
    return { from: period.from + h * 3_600_000, to: period.from + (h + 1) * 3_600_000 };
  }
  const b = bucketsOf(period).find((x) => x.label === label);
  return b ? { from: b.from, to: b.to } : null;
}

/** The bucket label holding a hovered window's start, for a bar chart to shade. */
export function bucketLabelAt(period: Period, labels: string[], ts: number): string | null {
  for (const l of labels) {
    const w = bucketWindow(period, l);
    if (w && ts >= w.from && ts < w.to) return l;
  }
  return null;
}

/** The point a curve marks for a window: the instant, or a bucket's middle. */
export const hoverTs = (w: HoverWindow) => (w.from === w.to ? w.from : w.from + (w.to - w.from) / 2);

/**
 * A line's value for a hovered window: the reading nearest an instant (none
 * past `maxGapMs`), or the average of the readings inside a bucket.
 * Data oldest first.
 */
export function valueIn(data: { ts: number; v: number | null }[], w: HoverWindow, maxGapMs: number): number | null {
  if (w.from !== w.to) {
    let s = 0, n = 0;
    for (const d of data) if (d.v != null && Number.isFinite(d.v) && d.ts >= w.from && d.ts < w.to) { s += d.v; n++; }
    return n ? s / n : null;
  }
  let lo = 0, hi = data.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].ts < w.from) lo = mid + 1; else hi = mid - 1;
  }
  let best: { ts: number; v: number | null } | null = null;
  for (const i of [lo - 2, lo - 1, lo, lo + 1]) {
    const d = data[i];
    if (!d || d.v == null) continue;
    if (!best || Math.abs(d.ts - w.from) < Math.abs(best.ts - w.from)) best = d;
  }
  return best && Math.abs(best.ts - w.from) <= maxGapMs ? best.v : null;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const p2 = (n: number) => String(n).padStart(2, "0");

/** Where the readings are from: "14 Oct, 11:12", "11:00–12:00", "Wed, 14 Oct" or "Oct 2026". */
export function hoverStamp(w: HoverWindow): string {
  const a = wall(w.from);
  if (w.from === w.to) return `${a.d} ${MON[a.mo - 1]}, ${p2(a.h)}:${p2(a.mi)}`;
  const span = w.to - w.from;
  if (span <= 3_600_000) return `${a.d} ${MON[a.mo - 1]}, ${p2(a.h)}:00–${p2((a.h + 1) % 24)}:00`;
  if (span <= 26 * 3_600_000) return `${WD[a.wd]}, ${a.d} ${MON[a.mo - 1]}`;
  return `${MON[a.mo - 1]} ${a.y}`;
}

/** The muted "at …" stamp at the head of a card's readings while a chart is hovered. */
export function HoverStamp({ hover }: { hover: HoverWindow | null }) {
  if (!hover) return null;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ink)", fontVariantNumeric: "tabular-nums" }}>
      {hoverStamp(hover)}
    </span>
  );
}

/* ── The mirrored tooltip ─────────────────────────────────────────────── */

export interface GhostRow { name: string; color?: string; value: string }

/** Tooltip rows in the hovered chart's own tooltip look. */
export function GhostBox({ title, rows }: { title?: string; rows: GhostRow[] }) {
  return (
    <div style={{ ...tooltipStyle, whiteSpace: "nowrap" }}>
      {title && <div style={{ marginBottom: 4 }}>{title}</div>}
      {rows.length === 0 ? <div>No Readings</div> : rows.map((r) => (
        <div key={r.name} style={r.color ? { color: r.color } : undefined}>{r.name} : {r.value}</div>
      ))}
    </div>
  );
}

/**
 * A recharts `label` for the ReferenceLine / ReferenceArea that marks another
 * chart's hovered moment: the same tooltip box beside the mark, so every chart
 * shows its figures at once. `flip` puts it on the left (the mark is near the
 * right edge).
 */
export function ghostLabel(content: ReactNode, flip: boolean) {
  const W = 240;
  // eslint-disable-next-line react/display-name
  return (p: { viewBox?: { x?: number; y?: number; width?: number } }) => {
    const x = p.viewBox?.x ?? 0, w = p.viewBox?.width ?? 0, y = p.viewBox?.y ?? 0;
    return (
      <foreignObject x={flip ? x - W - 8 : x + w + 8} y={y + 6} width={W} height={160} style={{ overflow: "visible", pointerEvents: "none" }}>
        <div style={{ display: "flex", justifyContent: flip ? "flex-end" : "flex-start" }}>{content}</div>
      </foreignObject>
    );
  };
}

/** Whether a mark sits far enough right that its box goes on the left. */
export const flipAt = (ts: number, span: [number, number]) => (ts - span[0]) / Math.max(1, span[1] - span[0]) > 0.55;

/**
 * The invisible mark carrying the mirrored box on a time-axis chart: a line at
 * an instant, an area over a bar's span. Called (not rendered as a component)
 * as the chart's last child, so recharts sees its own element type and the box
 * sits over the lines. Null when the chart has no reading there.
 */
export function ghostMark(mark: HoverWindow, span: [number, number], title: string, rows: GhostRow[]) {
  /* Nothing at that moment (or still loading): no box, rather than "No Readings". */
  if (!rows.length) return null;
  const label = ghostLabel(<GhostBox title={title} rows={rows} />, flipAt(hoverTs(mark), span));
  return mark.from === mark.to
    ? <ReferenceLine x={mark.from} stroke="none" ifOverflow="visible" label={label} />
    : <ReferenceArea x1={Math.max(mark.from, span[0])} x2={Math.min(mark.to, span[1])} fillOpacity={0} stroke="none" ifOverflow="visible" label={label} />;
}
