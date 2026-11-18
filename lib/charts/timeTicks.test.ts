/* npm test — node's runner. SITE_TZ is Asia/Kolkata (UTC+05:30). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { timeTicks, makeFormatter, modeFor, timeTooltipLabel, dayCategoryLabel, wall } from "./timeTicks.ts";

const IST = (s: string) => Date.parse(`${s}+05:30`);
const H = 3_600_000, D = 24 * H;
const label = (first: number, last: number, ticks: number[]) => {
  const f = makeFormatter(modeFor(last - first), first, last);
  return ticks.map((t, i) => f(t, i));
};

test("under a day: round hours, the midnight tick names the day", () => {
  const first = IST("2026-10-12T14:00:00"), last = first + 24 * H;
  const t = timeTicks(first, last);
  assert.ok(t.length >= 4 && t.length <= 13, `got ${t.length} ticks`); // 12 steps, both ends
  for (const ts of t) assert.equal(wall(ts).mi, 0, "ticks sit on whole hours");
  const l = label(first, last, t);
  assert.ok(l.includes("13 Oct"), `midnight labelled with its date: ${l.join(" · ")}`);
  assert.ok(l.every((x) => /^\d\d:\d\d$/.test(x) || x === "13 Oct"));
});

test("short windows step by minutes, not by 15", () => {
  const first = IST("2026-10-12T10:03:00"), last = first + 14 * 60_000;
  const t = timeTicks(first, last);
  assert.ok(t.length >= 3, `a 14-minute window gets ${t.length} ticks`);
});

test("three days: date on the first label and wherever the day changes", () => {
  const first = IST("2026-10-10T18:00:00"), last = first + 3 * D;
  assert.equal(modeFor(last - first), "datetime");
  const t = timeTicks(first, last);
  const l = label(first, last, t);
  assert.match(l[0], /^10 Oct \d\d:\d\d$/);
  /* Thinned by Recharts: keep every 3rd — the label after a dropped midnight still carries its date. */
  const kept = t.filter((_, i) => i % 3 === 0);
  const lk = label(first, last, kept);
  const days = new Set(kept.map((ts) => wall(ts).d));
  const withDate = lk.filter((x) => /Oct/.test(x)).length;
  assert.equal(withDate, days.size, `one dated label per day: ${lk.join(" · ")}`);
});

test("a week: one tick per IST midnight, labelled by date", () => {
  const first = IST("2026-10-05T00:00:00"), last = first + 7 * D;
  assert.equal(modeFor(last - first), "day");
  const t = timeTicks(first, last);
  for (const ts of t) { const w = wall(ts); assert.equal(w.h, 0); assert.equal(w.mi, 0); }
  assert.deepEqual(label(first, last, t).slice(0, 3), ["5 Oct", "6 Oct", "7 Oct"]);
});

test("a month and more: day steps stay under the tick budget", () => {
  const first = IST("2026-10-01T00:00:00"), last = IST("2026-11-01T00:00:00");
  const t = timeTicks(first, last);
  assert.ok(t.length <= 13, `${t.length} ticks over a month`);
  assert.ok(t.every((ts) => wall(ts).h === 0));
});

test("a year: monthly ticks on the 1st, year on the first label and on January", () => {
  const first = IST("2026-06-01T00:00:00"), last = IST("2027-06-01T00:00:00");
  assert.equal(modeFor(last - first), "month");
  const t = timeTicks(first, last);
  assert.ok(t.every((ts) => wall(ts).d === 1 && wall(ts).h === 0));
  const l = label(first, last, t);
  assert.match(l[0], /2026$/);
  assert.ok(l.includes("Jan 2027"), l.join(" · "));
});

test("ticks never fall outside the window and are strictly increasing", () => {
  for (const span of [30 * 60_000, 6 * H, 30 * H, 5 * D, 40 * D, 400 * D]) {
    const first = IST("2026-10-12T07:13:00"), last = first + span;
    const t = timeTicks(first, last);
    assert.ok(t.length > 0, `span ${span}`);
    assert.ok(t.every((ts) => ts >= first && ts <= last));
    assert.ok(t.every((ts, i) => i === 0 || ts > t[i - 1]));
  }
});

test("tooltip carries the full date, seconds and zone", () => {
  assert.equal(timeTooltipLabel(Date.parse("2026-10-12T08:53:20Z")), "12 Oct 2026, 14:23:20 IST");
});

test("daily category keys read as dates", () => {
  assert.equal(dayCategoryLabel("10-12"), "12 Oct");
  assert.equal(dayCategoryLabel("10/03"), "3 Oct");
  assert.equal(dayCategoryLabel("2026-10-12"), "12 Oct");
  assert.equal(dayCategoryLabel("10-12 ·"), "12 Oct ·");
  assert.equal(dayCategoryLabel("Charge"), "Charge");
});
