import { PRIORITY, type AlarmPriority } from "@/lib/alarms/priority";

/** P1–P4 as a small filled chip; the name is in the tooltip. */
export function PriorityBadge({ p, size = "sm" }: { p: AlarmPriority; size?: "sm" | "xs" }) {
  const P = PRIORITY[p] ?? PRIORITY[4];
  return (
    <span
      title={`${P.label} · ${P.name}`}
      style={{
        display: "inline-block", minWidth: size === "xs" ? 22 : 26, textAlign: "center",
        padding: size === "xs" ? "0 4px" : "1px 6px", borderRadius: 4,
        fontSize: size === "xs" ? 9.5 : 10.5, fontWeight: 700, lineHeight: size === "xs" ? "15px" : "16px",
        color: "#fff", background: P.color, fontVariantNumeric: "tabular-nums", flex: "none",
      }}
    >
      {P.label}
    </span>
  );
}
