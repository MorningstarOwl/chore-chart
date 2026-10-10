// tests/catalogFeasibility.test.js
// Validates the shipped catalog meets the 24-pt minimum for 4 participants.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogFeasibility } from "../js/config.js";

describe("catalog feasibility (shipped data)", () => {
  // Load real JSON from disk — a broken catalog will fail tests.
  const chores = JSON.parse(readFileSync(
    new URL("../config/chores.json", import.meta.url).pathname,
    "utf8"
  )).chores.map(c => ({ id: c.id, points: c.points, slotsPerDay: c.slotsPerDay }));

  const participants = JSON.parse(readFileSync(
    new URL("../config/participants.json", import.meta.url).pathname,
    "utf8"
  )).participants.map(p => ({ id: p.id, name: p.name }));

  const result = catalogFeasibility(chores, participants);

  it("has four participants", () => {
    assert.equal(participants.length, 4);
  });

  it("totals >= 24 and returns ok: true (24 required, headroom >= 5)", () => {
    assert.equal(result.required, 24, "required = ceil(4 * 5 * 1.2)");
    assert.ok(result.catalogTotal >= 24, `catalogTotal is ${result.catalogTotal}, expected >= 24`);
    assert.ok(result.catalogTotal - result.required >= 5, `headroom ${result.catalogTotal - result.required} expected >= 5`);
    assert.equal(result.ok, true);
  });

  it("sizes the requirement from each person's own goal", () => {
    const kids = [{ id: "a", goal: 2 }, { id: "b", goal: 3 }, { id: "c", goal: 6 }, { id: "d" }];
    assert.equal(catalogFeasibility(chores, kids).required, Math.ceil((2 + 3 + 6 + 5) * 1.2));
  });

  it("returns ok: false when total drops below required", () => {
    const small = [{ id: "x", points: 1, slotsPerDay: 1 }];
    const smallResult = catalogFeasibility(small, participants);
    assert.equal(smallResult.required, 24);
    assert.equal(smallResult.catalogTotal, 1);
    assert.equal(smallResult.ok, false);
  });
});
