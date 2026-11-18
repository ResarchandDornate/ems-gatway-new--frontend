/* npm test — node's runner. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { planAxes, blockReason, scaleKey, type PlanItem } from "./axisPlan.ts";

const it_ = (id: string, unit: string): PlanItem => ({ id, scale: scaleKey(unit, id) });

test("same unit shares one axis; a second unit takes the right", () => {
  const p = planAxes([it_("a", "V"), it_("b", "V"), it_("c", "A")], {}, 5);
  assert.deepEqual(p.sides, { left: "V", right: "A" });
  assert.deepEqual([...p.sideOf], [["a", "left"], ["b", "left"], ["c", "right"]]);
  assert.equal(p.notGraphed.size, 0);
});

test("five parameters in two units all draw", () => {
  const items = [it_("v1", "V"), it_("t1", "°C"), it_("v2", "V"), it_("t2", "°C"), it_("v3", "V")];
  const p = planAxes(items, {}, 5);
  assert.equal(p.graphed.length, 5);
});

test("a third unit is refused, not drawn on a hidden axis", () => {
  const p = planAxes([it_("v", "V"), it_("t", "°C")], {}, 5);
  assert.equal(blockReason(p, "A", 5), "axes");
  assert.equal(blockReason(p, "V", 5), null);
  assert.equal(blockReason(p, "°C", 5), null);
});

test("mV and V are different scales", () => {
  const p = planAxes([it_("pack", "V"), it_("drift", "mV")], {}, 5);
  assert.deepEqual(p.sides, { left: "V", right: "mV" });
  assert.equal(blockReason(p, "A", 5), "axes");
});

test("a unitless parameter needs an axis of its own", () => {
  const p = planAxes([it_("flag1", ""), it_("v", "V")], {}, 5);
  assert.deepEqual(p.sides, { left: "#flag1", right: "V" });
  assert.equal(blockReason(p, scaleKey("", "flag2"), 5), "axes");
});

test("the graph limit blocks before the axes do", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => it_(id, "V"));
  assert.equal(blockReason(planAxes(items, {}, 5), "V", 5), "limit");
});

test("removing the left unit leaves the right axis where it is", () => {
  const first = planAxes([it_("v", "V"), it_("t", "°C")], {}, 5);
  const after = planAxes([it_("t", "°C")], first.sides, 5);
  assert.deepEqual(after.sides, { right: "°C" });
  /* The next new unit fills the freed left side. */
  const next = planAxes([it_("t", "°C"), it_("a", "A")], after.sides, 5);
  assert.deepEqual(next.sides, { left: "A", right: "°C" });
  assert.equal(next.sideOf.get("t"), "right");
});

test("a plan fed back as prev is unchanged", () => {
  const items = [it_("t", "°C"), it_("a", "A"), it_("t2", "°C")];
  const p = planAxes(items, { right: "°C" }, 5);
  assert.deepEqual(planAxes(items, p.sides, 5), p);
});

test("download-only: past the limit or with no axis, in pick order", () => {
  const items = [
    it_("v1", "V"), it_("t1", "°C"), it_("a1", "A"), it_("v2", "V"),
    it_("v3", "V"), it_("t2", "°C"), it_("v4", "V"),
  ];
  const p = planAxes(items, {}, 5);
  assert.deepEqual(p.graphed, ["v1", "t1", "v2", "v3", "t2"]);
  assert.equal(p.notGraphed.get("a1"), "axes");
  assert.equal(p.notGraphed.get("v4"), "limit");
});

test("a kept side with nothing drawn is freed for one that is", () => {
  /* °C was on the right, but its only parameter is now past the limit. */
  const items = [...["a", "b", "c", "d"].map((id) => it_(id, "V")), it_("k", "kW"), it_("e", "V"), it_("t", "°C")];
  const p = planAxes(items, { left: "V", right: "°C" }, 5);
  assert.deepEqual(p.sides, { left: "V", right: "kW" });
  assert.equal(p.graphed.length, 5);
  assert.equal(p.notGraphed.get("t"), "limit");
});

test("empty selection has no axes", () => {
  const p = planAxes([], { left: "V" }, 5);
  assert.deepEqual(p.sides, {});
  assert.equal(blockReason(p, "A", 5), null);
});
