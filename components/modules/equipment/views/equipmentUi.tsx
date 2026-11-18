"use client";

/**
 * The shapes every equipment tab is built from.
 *
 * PCS, BMS, Chiller, Environment and Sub Meter all say the same kinds of thing —
 * a labelled figure, a status pill, a grid of alarm bits — and were each growing
 * their own copy. One set here keeps a reading on the Chiller tab the same size,
 * weight and alignment as the identical reading on PCS, which is the whole point
 * of a tabbed module: the tabs should feel like one instrument, not five.
 */

export const num = (v: number | null, dp = 2) => (v == null ? "—" : v.toFixed(dp));

export function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <div className="surface-card" style={{ padding: "var(--pad-sm) var(--pad) var(--pad)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 11 }}>
        <h3 className="card-title">{title}</h3>
        {note && <span style={{ fontSize: 11, color: "var(--muted)" }}>{note}</span>}
      </div>
      {children}
    </div>
  );
}

/** Label left, figure right. Every reading on every equipment tab. */
export function Row({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "baseline", justifyContent: "space-between",
      gap: 10, padding: "6px 0", borderTop: "1px solid var(--line)",
    }}>
      <span style={{ fontSize: 11.5, color: "var(--ink3)", minWidth: 0, overflowWrap: "anywhere" }}>
        {label}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: "var(--ink)", whiteSpace: "nowrap" }}>
        {/* No unit after a dash: "— °C" reads as a reading of nothing degrees. */}
        {value}{unit && value !== "—" && <small style={{ fontSize: 10, fontWeight: 500, color: "var(--muted)" }}> {unit}</small>}
      </span>
    </div>
  );
}

const PILL_FOR: Record<string, string> = {
  online: "pill green", on: "pill green", good: "pill green", derated: "pill amber", stale: "pill amber", normal: "pill green", running: "pill green", open: "pill green",
  offline: "pill red", fault: "pill red", alarm: "pill red", error: "pill red", "communication lost": "pill red",
  standby: "pill gray", shutdown: "pill gray", idle: "pill gray", stop: "pill gray", stopped: "pill gray", closed: "pill gray", unknown: "pill gray",
  reserved: "pill gray", "no fault": "pill gray",
};

/** A status with its caption above it, as every reference screen draws them. */
/** `16:42:22` IST, for a tile's capture time. */
const captured = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false });

export function StatusTile({ label, state, at }: {
  label: string; state: string;
  /** When the device's data was captured — shown under the pill. */
  at?: number | null;
}) {
  const cls = PILL_FOR[state.toLowerCase()] ?? "pill cyan";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 0 }}>
      <span style={{
        fontSize: 9.5,
        color: "var(--muted)", fontWeight: 600, textAlign: "center"
      }}>
        {label}
      </span>
      <span className={cls} style={{ fontSize: 11.5, whiteSpace: "nowrap" }}><span className="dot" /> {state}</span>
      {at != null && <span style={{ fontSize: 10, color: "var(--muted)" }}>Captured {captured(at)}</span>}
    </div>
  );
}

/**
 * A block of state bits.
 *
 * Dense grid rather than a list: every one of them reading Normal is the
 * ordinary case, so the block should be scannable in a single pass and only
 * break that rhythm when something is actually wrong.
 */
export function StateGrid({ items, okLabel = "Normal", badLabel = "Alarm", unknown = false }: {
  items: { label: string; ok: boolean }[];
  /** The readings are stale: show "—", never a reassuring "Normal". */
  unknown?: boolean;
  /** PCS calls its bad state "Fault"; the chiller calls it "Alarm". Set per
   *  block rather than per item — every bit in one block shares the wording. */
  okLabel?: string;
  badLabel?: string;
}) {
  return (
    <div style={{ display: "grid", gap: "6px 14px", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
      {items.map((it) => (
        <div key={it.label} style={{
          display: "flex", alignItems: "baseline", justifyContent: "space-between",
          gap: 10, padding: "5px 0", borderTop: "1px solid var(--line)",
        }}>
          <span title={it.label} style={{ fontSize: 11.5, color: "var(--ink3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {it.label}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", color: unknown || it.ok ? "var(--muted)" : "var(--red)" }}>
            {unknown ? "—" : it.ok ? okLabel : badLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Phases down, quantities across — an imbalance is spotted by reading a column. */
/* A dash takes no unit ("— V"). */
const withUnit = (v: number | null, unit: string) => (v == null ? "—" : `${num(v)} ${unit}`);

export function PhaseTable({ phases }: {
  phases: { label: string; voltageV: number | null; currentA: number | null; activeKw: number | null;
            reactiveKvar: number | null; apparentKva: number | null; powerFactor: number | null }[];
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ps-table">
        <thead>
          <tr>
            <th>Phase</th>
            <th className="num">Voltage</th>
            <th className="num">Current</th>
            <th className="num">Active Power</th>
            <th className="num">Reactive Power</th>
            <th className="num">Apparent Power</th>
            <th className="num">Power Factor</th>
          </tr>
        </thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p.label}>
              <td style={{ fontWeight: 600, color: "var(--ink)" }}>{p.label}</td>
              <td className="num">{withUnit(p.voltageV, "V")}</td>
              <td className="num">{withUnit(p.currentA, "A")}</td>
              <td className="num">{withUnit(p.activeKw, "kW")}</td>
              <td className="num">{withUnit(p.reactiveKvar, "kVAR")}</td>
              <td className="num">{withUnit(p.apparentKva, "kVA")}</td>
              <td className="num">{num(p.powerFactor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
