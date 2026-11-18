/* npm test — node's runner. SITE_TZ is Asia/Kolkata (UTC+05:30). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodOf, shift, switchRange, isLatest, bucketsOf, aggregate, kindOf } from "./period.ts";

const T = Date.parse("2026-10-13T06:00:00Z"); // Tue 13 Oct 2026, 11:30 IST

test("day period is the IST calendar day", () => {
  const p = periodOf("day", T);
  assert.equal(new Date(p.from).toISOString(), "2026-10-12T18:30:00.000Z");
  assert.equal(new Date(p.to).toISOString(), "2026-10-13T18:30:00.000Z");
  assert.equal(p.label, "Tue, 13 Oct 2026");
});

test("week is the rolling seven days ending today", () => {
  const p = periodOf("week", T);
  assert.equal(p.label, "7–13 Oct 2026");
  assert.equal(new Date(p.from).toISOString(), "2026-10-06T18:30:00.000Z");
  assert.equal(new Date(p.to).toISOString(), "2026-10-13T18:30:00.000Z");
  assert.equal(bucketsOf(p).length, 7);
  assert.equal(bucketsOf(p)[0].label, "Wed");
  assert.equal(bucketsOf(p)[6].label, "Tue");
});

test("month and year", () => {
  assert.equal(periodOf("month", T).label, "October 2026");
  assert.equal(bucketsOf(periodOf("month", T)).length, 31);
  assert.equal(periodOf("year", T).label, "2026");
  assert.equal(bucketsOf(periodOf("year", T)).length, 12);
});

test("shift steps whole units and crosses months", () => {
  assert.equal(shift(periodOf("month", T), -1).label, "September 2026");
  assert.equal(shift(periodOf("week", T), -1).label, "30 Sep – 6 Oct 2026");
  assert.equal(shift(periodOf("week", Date.parse("2026-10-01T06:00:00Z")), -1).label, "18–24 Sep 2026");
  /* Back then forward returns to the same seven days, no overlap. */
  const back = shift(periodOf("week", T), -1);
  assert.equal(back.to, periodOf("week", T).from);
  assert.equal(shift(back, 1).label, "7–13 Oct 2026");
  assert.equal(shift(periodOf("day", T), 1).label, "Wed, 14 Oct 2026");
});

test("no future: the current period is the latest", () => {
  assert.equal(isLatest(periodOf("day", T), T), true);
  assert.equal(isLatest(shift(periodOf("day", T), -1), T), false);
  assert.equal(isLatest(periodOf("week", T), T), true);
  assert.equal(isLatest(shift(periodOf("week", T), -1), T), false);
});

test("switching range keeps the anchor", () => {
  const sep = periodOf("day", Date.parse("2026-09-30T06:00:00Z"));
  assert.equal(switchRange(sep, "month", T).label, "September 2026");
  assert.equal(switchRange(periodOf("day", T), "week", T).label, "7–13 Oct 2026");
});

test("aggregate: measure, counter, flag, empty bucket", () => {
  const b = bucketsOf(periodOf("week", T)).slice(0, 2);
  const r = [{ ts: b[0].from + 1, value: 10 }, { ts: b[0].from + 2, value: 30 }];
  assert.deepEqual(aggregate(r, b, "measure").map((x) => [x.min, x.avg, x.max]), [[10, 20, 30], [null, null, null]]);
  assert.equal(aggregate(r, b, "counter")[0].avg, 20);
  assert.equal(aggregate([{ ts: b[0].from + 1, value: 5 }, { ts: b[0].from + 2, value: 3 }], b, "counter")[0].avg, null);
  assert.equal(aggregate([{ ts: b[0].from + 1, value: 0 }, { ts: b[0].from + 2, value: 1 }], b, "flag")[0].max, 1);
});

test("kind by unit and values", () => {
  assert.equal(kindOf("kWh", [1, 2]), "counter");
  assert.equal(kindOf("", [0, 1, 0]), "flag");
  assert.equal(kindOf("℃", [24.3, 24.5]), "measure");
});

test("daily rows onto week / month / year buckets", async () => {
  const { dailyToBuckets } = await import("./period.ts");
  const rows = [{ date: "2026-10-12", kwh: 10, peak: 50 }, { date: "2026-10-13", kwh: 5, peak: 70 }, { date: "2026-09-30", kwh: 7, peak: 40 }];
  const wk = dailyToBuckets(rows, periodOf("week", T), { kwh: "sum" });
  /* 7–13 Oct: the 12th and 13th are the last two days. */
  assert.deepEqual(wk.map((b) => b.kwh), [null, null, null, null, null, 10, 5]);
  const yr = dailyToBuckets(rows, periodOf("year", T), { kwh: "sum", peak: "max" });
  assert.equal(yr[9].kwh, 15); assert.equal(yr[9].peak, 70); assert.equal(yr[8].kwh, 7); assert.equal(yr[0].kwh, null);
});

test("hour is the rolling sixty minutes to the next five-minute mark", () => {
  const p = periodOf("hour", Date.parse("2026-10-21T06:02:30Z"));   // 11:32:30 IST
  assert.equal(new Date(p.from).toISOString(), "2026-10-21T05:05:00.000Z");
  assert.equal(new Date(p.to).toISOString(), "2026-10-21T06:05:00.000Z");
  assert.equal(p.label, "10:35–11:35, 21 Oct 2026");
  assert.equal(bucketsOf(p).length, 12);
  assert.equal(bucketsOf(p)[0].label, "10:35");
  assert.equal(new Date(shift(p, -1).to).toISOString(), "2026-10-21T05:05:00.000Z");
  assert.equal(shift(shift(p, -1), 1).from, p.from);
});

test("28 days is the rolling 28 days ending today, one bucket a day", () => {
  const p = periodOf("days28", T);
  assert.equal(p.label, "16 Sep – 13 Oct 2026");
  assert.equal(bucketsOf(p).length, 28);
  assert.equal(shift(shift(p, -1), 1).from, p.from);
  assert.equal(new Date(shift(p, -1).to).toISOString(), new Date(p.from).toISOString());
});

test("switching a past day to an hour shows its last hour", () => {
  const day = periodOf("day", T - 3 * 86_400_000);
  const h = switchRange(day, "hour", T);
  assert.equal(h.to, day.to);
});
