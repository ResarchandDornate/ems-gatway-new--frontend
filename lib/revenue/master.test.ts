/* npm test — node's runner. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMaster, revenueFor, savingPerUnit } from "./master.ts";

const m = { chargeSource: "solar", chargeCostRs: 2.5, replacedSource: "dg", dischargeCostRs: 25 } as const;

test("saving per unit is discharge cost minus charge cost", () => {
  assert.equal(savingPerUnit(m), 22.5);
});

test("revenue is units discharged times the saving", () => {
  assert.equal(revenueFor(m, 100), 2250);
  assert.equal(revenueFor(m, null), null);
  assert.equal(revenueFor(null, 100), null);
});

test("charging dearer than the source replaced is a loss, not clamped", () => {
  assert.equal(revenueFor({ chargeCostRs: 9, dischargeCostRs: 8 }, 10), -10);
});

test("parseMaster accepts a valid form and rejects bad values", () => {
  assert.deepEqual(parseMaster(m), m);
  assert.equal(parseMaster({ ...m, chargeCostRs: -1 }), null);
  assert.equal(parseMaster({ ...m, dischargeCostRs: "25" }), null);
  assert.equal(parseMaster({ ...m, chargeSource: "wind" }), null);
  assert.equal(parseMaster({ ...m, replacedSource: "solar" }), null);
  assert.equal(parseMaster(null), null);
});

test("parseMaster keeps typed-in monthly discharge and rejects bad months", () => {
  assert.deepEqual(parseMaster({ ...m, manualDischargeKwh: { "2026-09": 4200 } })?.manualDischargeKwh, { "2026-09": 4200 });
  assert.equal(parseMaster({ ...m, manualDischargeKwh: { "2026-13": 1 } }), null);
  assert.equal(parseMaster({ ...m, manualDischargeKwh: { "2026-09": -5 } }), null);
  assert.equal(parseMaster({ ...m, manualDischargeKwh: {} })?.manualDischargeKwh, undefined);
});
