/* Run with: npm test  (node's built-in runner; no dependencies)
   T7: S2 point_id-primary read integration — resolver, flag gating, additive query. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveS2PointId, s2PointIdReadsEnabled, addS2PointId } from "./s2PointId.ts";
import { S2_POINT_IDS } from "./s2PointIds.ts";

const FLAG = "EMS_S2_POINT_ID_READS";
function withFlag(on: boolean, fn: () => void) {
  const prev = process.env[FLAG];
  if (on) process.env[FLAG] = "1"; else delete process.env[FLAG];
  try { fn(); } finally {
    if (prev === undefined) delete process.env[FLAG]; else process.env[FLAG] = prev;
  }
}
function q(extra: Record<string, string> = {}) {
  return new URLSearchParams({ site_id: "s", stream: "S2", ...extra });
}

/* ---- map provenance (no fabrication) ---- */
test("map carries exactly the 3264 populated registry point_ids", () => {
  const total = Object.values(S2_POINT_IDS).reduce((a, m) => a + Object.keys(m).length, 0);
  assert.equal(total, 3264);
});

/* ---- Kalpa resolution ---- */
test("Kalpa point_id resolves to the canonical dotted id", () => {
  assert.equal(resolveS2PointId("ems_system", "battery_system_state"),
               "bank.system_data.battery_system_state");
  assert.equal(resolveS2PointId("ems_system", "system_accumulated_charge_energy"),
               "bank.system_data.system_accumulated_charge_energy");
});

/* ---- CleanEdge (793) resolution ---- */
test("CleanEdge point_id resolves to its emitted field id", () => {
  assert.equal(resolveS2PointId("solar_inverter", "meter_power_factor"),
               "mfm.average_power_factor");
});

test("every CleanEdge map value is non-empty and distinct from its signal_key", () => {
  // spot the solar_inverter CleanEdge entries exist and look like point ids
  const si = S2_POINT_IDS["solar_inverter"];
  assert.ok(si && Object.keys(si).length >= 1);
  for (const [k, v] of Object.entries(si)) assert.ok(v && v.length > 0 && v !== k);
});

/* ---- unresolved CleanEdge / unknown -> null (never fabricated) ---- */
test("unresolved signal returns null", () => {
  assert.equal(resolveS2PointId("pcs_extended", "cleanedge_total__not_a_registry_key"), null);
  assert.equal(resolveS2PointId("ems_system", "no_such_signal"), null);
});

test("non-S2 / unknown substream returns null (non-S2 unaffected)", () => {
  assert.equal(resolveS2PointId("bess_fast", "soc"), null);      // S1 substream
  assert.equal(resolveS2PointId("alarms", "severity"), null);
});

/* ---- flag gating ---- */
test("flag is OFF by default", () => {
  withFlag(false, () => assert.equal(s2PointIdReadsEnabled(), false));
});
test("flag ON when EMS_S2_POINT_ID_READS=1", () => {
  withFlag(true, () => assert.equal(s2PointIdReadsEnabled(), true));
});

/* ---- addS2PointId: additive, gated, keeps signal_key ---- */
test("enabled + resolved: point_id added alongside signal_key", () => {
  withFlag(true, () => {
    const qs = q({ substream: "ems_system", signal_key: "battery_system_state" });
    const pid = addS2PointId(qs, "ems_system", "battery_system_state");
    assert.equal(pid, "bank.system_data.battery_system_state");
    assert.equal(qs.get("point_id"), "bank.system_data.battery_system_state");
    assert.equal(qs.get("signal_key"), "battery_system_state");   // backend cross-checks agreement
  });
});

test("disabled (default): no point_id on the query (signal_key fallback preserved)", () => {
  withFlag(false, () => {
    const qs = q({ substream: "ems_system", signal_key: "battery_system_state" });
    const pid = addS2PointId(qs, "ems_system", "battery_system_state");
    assert.equal(pid, "bank.system_data.battery_system_state");   // resolvable...
    assert.equal(qs.get("point_id"), null);                       // ...but not attached while disabled
    assert.equal(qs.get("signal_key"), "battery_system_state");
  });
});

test("enabled + unresolved: no point_id (falls back to signal_key only)", () => {
  withFlag(true, () => {
    const qs = q({ substream: "pcs_extended", signal_key: "cleanedge_total__unmapped" });
    const pid = addS2PointId(qs, "pcs_extended", "cleanedge_total__unmapped");
    assert.equal(pid, null);
    assert.equal(qs.get("point_id"), null);
    assert.equal(qs.get("signal_key"), "cleanedge_total__unmapped");
  });
});

test("addS2PointId never throws on unknown input (graceful)", () => {
  withFlag(true, () => {
    const qs = q({ substream: "nope", signal_key: "nope" });
    assert.doesNotThrow(() => addS2PointId(qs, "nope", "nope"));
    assert.equal(qs.get("point_id"), null);
  });
});
