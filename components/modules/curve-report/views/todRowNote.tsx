import type { TodRow } from "@/lib/api/types";

/** What a ToD row is, in a word: no data, a partial day, or metered. "" for a sampled full day. */
export function todRowNote(r: TodRow): string {
  if (r.missing) return "no data";
  if (r.coverage != null && r.coverage < 1) return `partial ${Math.round(r.coverage * 100)}%`;
  return r.metered ? "metered" : "";
}

const TITLE: Record<string, string> = {
  "no data": "The gateway uploaded nothing for this day.",
  metered: "The total comes from the battery's energy meter; the split by tariff period is estimated from power readings.",
};

/** The date cell, with the row's note beneath it. */
export function TodDateCell({ row }: { row: TodRow }) {
  const note = todRowNote(row);
  return (
    <td className="py-2 px-3 text-ink2 whitespace-nowrap" title={TITLE[note] ?? (note ? "Only part of this day was uploaded; the figures cover that part." : undefined)}>
      {row.date}
      {note && note !== "metered" && <div className="text-[10.5px] font-mono text-muted">{note.replace(/\b[a-z]/g, (c) => c.toUpperCase())}</div>}
    </td>
  );
}

/** A band value, or "—" on a day with no data. */
export const todValue = (r: TodRow, v: number) => (r.missing ? "—" : v.toFixed(2));
