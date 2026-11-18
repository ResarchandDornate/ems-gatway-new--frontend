/* npm test — node's runner. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketRise, valueAtEdge, MAX_BRIDGE_MS } from "./boundaryRise.ts";

const H = 3_600_000;

test("an edge is interpolated between the readings either side", () => {
  const list = [{ t: 0, v: 100 }, { t: 2 * H, v: 120 }];
  assert.equal(valueAtEdge(list, H), 110);
  assert.equal(valueAtEdge(list, 0), 100);
  assert.equal(valueAtEdge(list, 3 * H), null);          // past the last reading
  assert.equal(valueAtEdge([{ t: 0, v: 1 }, { t: MAX_BRIDGE_MS + 2 * H, v: 2 }], H), null); // outage
});

test("hours add up to the day, including hours with no reading inside", () => {
  /* Readings every 90 min, so several hours hold none. */
  const list = Array.from({ length: 17 }, (_, i) => ({ t: i * 1.5 * H, v: 1000 + i * 15 }));
  const series = new Map([["a_pcs", list]]);
  const hours = Array.from({ length: 24 }, (_, h) => bucketRise(series, h * H, (h + 1) * H, 30 * H));
  assert.ok(hours.every((x) => x != null));
  const sum = hours.reduce((s, x) => s + (x ?? 0), 0);
  assert.equal(Math.round(sum * 1000) / 1000, bucketRise(series, 0, 24 * H, 30 * H));
  assert.equal(sum, 240);
});

test("the running bucket ends at the newest reading", () => {
  const series = new Map([["a", [{ t: 0, v: 10 }, { t: H, v: 20 }, { t: 2 * H, v: 25 }]]]);
  assert.equal(bucketRise(series, H, 3 * H, 2.5 * H), 5);
  assert.equal(bucketRise(series, 0, 3 * H, 2.5 * H), 15);
});

test("cabinets are summed; any unknown cabinet or a reset gives null", () => {
  const a = [{ t: 0, v: 0 }, { t: H, v: 10 }];
  const b = [{ t: 0, v: 5 }, { t: H, v: 8 }];
  assert.equal(bucketRise(new Map([["a", a], ["b", b]]), 0, H, 2 * H), 13);
  assert.equal(bucketRise(new Map([["a", a], ["b", []]]), 0, H, 2 * H), null);
  assert.equal(bucketRise(new Map([["a", [{ t: 0, v: 10 }, { t: H, v: 2 }]]]), 0, H, 2 * H), null);
});
