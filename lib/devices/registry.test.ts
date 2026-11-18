/* npm test — node's runner. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEVICE_TYPES, LINK_POINTS, SUMMARY_TYPES, deviceType, kindOf, presenceOf } from "./registry.ts";

const zeros = (n: number) => Array.from({ length: n }, (_, i) => ({ signal: `reading_${i}`, value: "0.0" }));

test("a slot with its link at 0 and every reading 0 is not a device (Site 1's grid meter)", () => {
  assert.equal(presenceOf([{ signal: "communication_status", value: "0.0" }, ...zeros(42)]), "unproven");
});

test("a link that has read 1 is a device, even if it reads 0 now", () => {
  assert.equal(presenceOf([{ signal: "communication_status", value: "0.0" }, { signal: "communication_status", value: "1.0" }, ...zeros(3)]), "installed");
  assert.equal(presenceOf([{ signal: "online_points", value: 1 }]), "installed");
});

test("a live reading beside a link stuck at 0 is still a device", () => {
  assert.equal(presenceOf([{ signal: "communication_status", value: "0" }, { signal: "phase_a_voltage", value: "231.4" }]), "installed");
});

test("a device with no link register is there while it publishes, zeros and all (remote control)", () => {
  assert.equal(presenceOf(zeros(5)), "installed");
  assert.equal(presenceOf([]), "absent");
});

test("unreadable values prove nothing", () => {
  assert.equal(presenceOf([{ signal: "communication_status", value: null }, { signal: "x", value: "" }, { signal: "y", value: "n/a" }]), "unproven");
});

test("kinds come off the asset id", () => {
  assert.equal(kindOf("external_ems_2_grid_meter"), "grid_meter");
  assert.equal(kindOf("external_ems_12_io_module"), "io_module");
  assert.equal(kindOf("weather_station"), "weather_station");
});

test("an unknown kind still gets a type, named from its id", () => {
  assert.deepEqual(deviceType("pv_inverter"), { kind: "pv_inverter", substream: "pv_inverter", label: "PV Inverter" });
  assert.equal(deviceType("grid_meter").linkPoint, "p1354");
});

test("the registry is consistent", () => {
  const kinds = DEVICE_TYPES.map((t) => t.kind);
  assert.equal(new Set(kinds).size, kinds.length, "kinds are unique");
  assert.equal(new Set(LINK_POINTS).size, LINK_POINTS.length, "link points are unique");
  assert.deepEqual(SUMMARY_TYPES.map((t) => t.kind), ["pcs", "bms", "liquid_cooling", "grid_meter", "dehumidifier"]);
});
