/* npm test — node's runner. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { commLostOf } from "./commLost.ts";

const M = 60_000;
const NOW = Date.parse("2026-10-13T12:40:00Z");
const at = (minAgo: number) => new Date(NOW - minAgo * M).toISOString();
const rows = (asset: string, sub: string, minsAgo: number[], extra: object = {}) =>
  minsAgo.map((m) => ({ asset_id: asset, substream: sub, signal: "x", sample_time_utc: at(m), ...extra }));

test("a device silent past 15 minutes is lost; a current one is not", () => {
  const r = [...rows("a_bms", "bms_extended", [270, 270.25, 270.5]), ...rows("a_cool", "liquid_cooling", [1, 2, 3])];
  const lost = commLostOf(r, NOW);
  assert.deepEqual(lost.map((x) => [x.assetId, x.reason]), [["a_bms", "silent"]]);
});

test("a slow device is not lost for its own cadence", () => {
  /* Reports every 10 min; last 25 min ago: under 3 × 10 = 30 min. */
  assert.equal(commLostOf(rows("a_io", "io_module", [25, 35, 45, 55]), NOW).length, 0);
  assert.equal(commLostOf(rows("a_io", "io_module", [35, 45, 55, 65]), NOW).length, 1);
});

test("a reachability register at 0 is offline even while rows arrive", () => {
  const r = rows("a_meter", "utility_meter", [1, 2], { signal: "communication_status", value: "0.0" });
  assert.deepEqual(commLostOf(r, NOW).map((x) => x.reason), ["offline"]);
  const ok = rows("a_meter", "utility_meter", [1, 2], { signal: "communication_status", value: "1.0" });
  assert.equal(commLostOf(ok, NOW).length, 0);
});

test("remote_control is never lost", () => {
  assert.equal(commLostOf(rows("a_rc", "remote_control", [300, 301]), NOW).length, 0);
});
