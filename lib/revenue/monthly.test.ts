/* npm test — node's runner. IST is UTC+05:30. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestMonthKwh, foldLifetime, foldMonthly, istMonth, monthFromLifetime, monthTotal, nextMonth, prevIstMonth,
  type LifetimeDoc, type MonthlyDoc,
} from "./monthly.ts";

test("IST month turns at IST midnight, not UTC", () => {
  assert.equal(istMonth(Date.parse("2026-09-30T18:29:00Z")), "2026-09");
  assert.equal(istMonth(Date.parse("2026-09-30T18:31:00Z")), "2026-10");
});

test("previous month wraps the year", () => {
  assert.equal(prevIstMonth(Date.parse("2026-10-13T06:00:00Z")), "2026-09");
  assert.equal(prevIstMonth(Date.parse("2027-01-05T06:00:00Z")), "2026-12");
});

test("keeps each cabinet's highest reading per month", () => {
  const doc: MonthlyDoc = {};
  foldMonthly(doc, [
    { asset_id: "external_ems_1_bms", sample_time_utc: "2026-09-30T18:00:00Z", value: "1500.5" },
    { asset_id: "external_ems_1_bms", sample_time_utc: "2026-09-30T17:00:00Z", value: "1490" },
    /* Counter reset a minute early: must not overwrite September's total. */
    { asset_id: "external_ems_1_bms", sample_time_utc: "2026-09-30T18:20:00Z", value: "0.4" },
    { asset_id: "external_ems_1_bms", sample_time_utc: "2026-10-01T05:00:00Z", value: "60" },
  ]);
  assert.equal(doc["2026-09"]["external_ems_1_bms"].kwh, 1500.5);
  assert.equal(doc["2026-10"]["external_ems_1_bms"].kwh, 60);
});

test("ignores rows it cannot read, and reports no change on a repeat", () => {
  const doc: MonthlyDoc = {};
  const rows = [{ asset_id: "a_bms", sample_time_utc: "2026-09-10T00:00:00Z", value: 10 }];
  assert.equal(foldMonthly(doc, rows), true);
  assert.equal(foldMonthly(doc, rows), false);
  assert.equal(foldMonthly(doc, [{ asset_id: null, sample_time_utc: "2026-09-10T00:00:00Z", value: 1 }, { asset_id: "a", value: "x" }]), false);
});

test("month total needs every cabinet", () => {
  const doc: MonthlyDoc = { "2026-09": { external_ems_1_bms: { kwh: 100, at: 0 }, external_ems_2_bms: { kwh: 50, at: 0 } } };
  assert.equal(monthTotal(doc, "2026-09", ["external_ems_1", "external_ems_2"]), 150);
  assert.equal(monthTotal(doc, "2026-09", ["external_ems_1"]), 100);
  assert.equal(monthTotal(doc, "2026-09", ["external_ems_1", "external_ems_3"]), null);
  assert.equal(monthTotal(doc, "2026-08", ["external_ems_1"]), null);
  /* external_ems_1 must not match external_ems_10. */
  assert.equal(monthTotal({ "2026-09": { external_ems_10_bms: { kwh: 9, at: 0 } } }, "2026-09", ["external_ems_1"]), null);
});

const rows = (asset: string, pts: [string, number][]) => pts.map(([t, v]) => ({ asset_id: asset, sample_time_utc: t, value: String(v) }));

test("next month wraps the year", () => {
  assert.equal(nextMonth("2026-12"), "2027-01");
  assert.equal(nextMonth("2026-09"), "2026-10");
});

test("running month: live lifetime minus the month's first reading", () => {
  const doc: LifetimeDoc = {};
  foldLifetime(doc, rows("external_ems_1_pcs", [["2026-09-30T18:40:00Z", 8000], ["2026-10-05T00:00:00Z", 8100]]));
  foldLifetime(doc, rows("external_ems_2_pcs", [["2026-09-30T18:45:00Z", 10000], ["2026-10-05T00:00:00Z", 10200]]));
  assert.deepEqual(monthFromLifetime(doc, "2026-10", ["external_ems_1", "external_ems_2"], 18500), { kwh: 500, complete: true });
  /* No live figure: up to the last reading seen, flagged incomplete. */
  assert.deepEqual(monthFromLifetime(doc, "2026-10", ["external_ems_1", "external_ems_2"]), { kwh: 300, complete: false });
});

test("past month: next month's start minus this month's", () => {
  const doc: LifetimeDoc = {};
  foldLifetime(doc, rows("a_pcs", [["2026-09-30T19:00:00Z", 100], ["2026-10-31T19:00:00Z", 900]]));
  assert.deepEqual(monthFromLifetime(doc, "2026-10", ["a"], 1000), { kwh: 800, complete: true });
});

test("a start first seen days after the 1st is incomplete", () => {
  const doc: LifetimeDoc = {};
  foldLifetime(doc, rows("a_pcs", [["2026-10-09T16:00:00Z", 500]]));
  assert.deepEqual(monthFromLifetime(doc, "2026-10", ["a"], 700), { kwh: 200, complete: false });
  assert.equal(monthFromLifetime(doc, "2026-10", ["a", "b"], 700), null);
});

test("best month figure prefers a complete lifetime rise, else the larger reading", () => {
  const ids = ["a"];
  const lifetime: LifetimeDoc = {};
  foldLifetime(lifetime, rows("a_pcs", [["2026-09-30T19:00:00Z", 1000]]));
  /* Complete start: lifetime rise wins even over a larger BMS figure. */
  assert.equal(bestMonthKwh({ lifetime, months: { "2026-10": { a_bms: { kwh: 999, at: 0 } } } }, "2026-10", ids, { nowKwh: 1600 }), 600);
  /* Stale BMS counter (the 9 Oct case) loses to the live lifetime rise. */
  assert.equal(bestMonthKwh({ lifetime }, "2026-10", ids, { nowKwh: 3000, bmsNowKwh: 1574 }), 2000);

  const late: LifetimeDoc = {};
  foldLifetime(late, rows("a_pcs", [["2026-10-09T16:00:00Z", 1000]]));
  /* Late anchor: the larger of the two understatements. */
  assert.equal(bestMonthKwh({ lifetime: late }, "2026-10", ids, { nowKwh: 1300, bmsNowKwh: 1574 }), 1574);
  assert.equal(bestMonthKwh({ lifetime: late }, "2026-10", ids, { nowKwh: 3000, bmsNowKwh: 1574 }), 2000);
  /* A past month with only a late anchor and no BMS record: unknown. */
  assert.equal(bestMonthKwh({ lifetime: late }, "2026-10", ids), null);
  assert.equal(bestMonthKwh(null, "2026-09", ids), null);
});
