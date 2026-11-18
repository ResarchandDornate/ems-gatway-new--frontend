/* Run with: npm test  (node's built-in runner; no dependencies) */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CELL_DRIFT_THRESHOLD_MV, isDriftIssue, isDriftIssueV, driftAxisDomain, driftAxisTicks, worstDrift,
} from "./cellDrift.ts";

test("threshold is 100 mV", () => {
  assert.equal(CELL_DRIFT_THRESHOLD_MV, 100);
});

test("below 100 mV is not an issue", () => {
  assert.equal(isDriftIssue(80), false);
  assert.equal(isDriftIssue(-80), false);
  assert.equal(isDriftIssue(99.9), false);
  assert.equal(isDriftIssue(0), false);
});

test("exactly 100 mV is an issue, either way", () => {
  assert.equal(isDriftIssue(100), true);
  assert.equal(isDriftIssue(-100), true);
});

test("above 100 mV is an issue", () => {
  assert.equal(isDriftIssue(120), true);
  assert.equal(isDriftIssue(-120), true);
});

test("no reading is not an issue", () => {
  assert.equal(isDriftIssue(null), false);
  assert.equal(isDriftIssue(undefined), false);
  assert.equal(isDriftIssue(Number.NaN), false);
});

test("volts convert: 0.1 V is the threshold", () => {
  assert.equal(isDriftIssueV(0.08), false);
  assert.equal(isDriftIssueV(0.1), true);
  assert.equal(isDriftIssueV(-0.12), true);
});

test("chart opens on ±150 mV and widens only for an outlier", () => {
  assert.deepEqual(driftAxisDomain([-30, 12, 80]), [-150, 150]);
  assert.deepEqual(driftAxisDomain([]), [-150, 150]);
  assert.deepEqual(driftAxisDomain([-170, 20]), [-200, 150]);
  assert.deepEqual(driftAxisTicks([-150, 150]), [-150, -100, -50, 0, 50, 100, 150]);
});

test("worst drift is the extreme farther from the average", () => {
  assert.equal(worstDrift({ min: 3240, avg: 3330, max: 3340 }), -90);
  assert.equal(worstDrift({ min: 3320, avg: 3330, max: 3450 }), 120);
  assert.equal(worstDrift({ min: null, avg: 3330, max: 3335 }), 5);
  assert.equal(worstDrift({ min: 3300, avg: null, max: 3400 }), null);
});
