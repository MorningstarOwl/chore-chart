// Scoring engine tests.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pointsByParticipant, goalStatus, unclaimedSlots } from "../js/scoring.js";

const CATALOG = {
  chores: [
    { id: "trash", name: "Trash", points: 2, slotsPerDay: 1 },
    { id: "dishes", name: "Dishes", points: 3, slotsPerDay: 1 },
    { id: "pets", name: "Feed pets", points: 4, slotsPerDay: 2 },
  ],
};
const PEOPLE = [
  { id: "alex", name: "Alex" },
  { id: "sam", name: "Sam" },
  { id: "riley", name: "Riley" },
  { id: "jordan", name: "Jordan" },
];
const EMPTY_DAY = { claimed: {} };
const ALEX_TRASH = { claimed: { "trash#0": "alex" } };
const FULL = { claimed: { "trash#0": "alex", "dishes#0": "sam", "pets#0": "riley", "pets#1": "riley" } };

describe("pointsByParticipant", () => {
  it("gives everyone 0 on an empty day", () => {
    const out = pointsByParticipant(CATALOG, PEOPLE, EMPTY_DAY);
    for (const p of PEOPLE) assert.equal(out[p.id], 0);
  });

  it("credits the claimer with the chore's points", () => {
    assert.deepEqual(pointsByParticipant(CATALOG, PEOPLE, ALEX_TRASH), { alex: 2, sam: 0, riley: 0, jordan: 0 });
  });

  it("counts each slot of a multi-slot chore", () => {
    const out = pointsByParticipant(CATALOG, PEOPLE, FULL);
    assert.deepEqual(out, { alex: 2, sam: 3, riley: 8, jordan: 0 });
  });

  it("treats null/undefined day state as empty", () => {
    assert.equal(pointsByParticipant(CATALOG, PEOPLE, null).alex, 0);
    assert.equal(pointsByParticipant(CATALOG, PEOPLE, undefined).alex, 0);
  });

  it("ignores claims on slots no longer in the catalog", () => {
    const out = pointsByParticipant(CATALOG, PEOPLE, { claimed: { "gone#0": "alex", "pets#5": "sam" } });
    assert.deepEqual(out, { alex: 0, sam: 0, riley: 0, jordan: 0 });
  });
});

describe("goalStatus", () => {
  it("defaults the goal to 5 and reports met at the boundary", () => {
    const status = goalStatus(CATALOG, PEOPLE, { claimed: { "trash#0": "sam", "dishes#0": "sam" } });
    assert.deepEqual(status.find((s) => s.id === "sam"), { id: "sam", points: 5, goal: 5, met: true });
    assert.deepEqual(status.find((s) => s.id === "jordan"), { id: "jordan", points: 0, goal: 5, met: false });
  });

  it("accepts array-style goals", () => {
    const status = goalStatus(CATALOG, PEOPLE, FULL, [{ id: "sam", goal: 3 }]);
    assert.equal(status.find((s) => s.id === "sam").met, true);
    assert.equal(status.find((s) => s.id === "alex").goal, 5);
  });

  it("accepts object-style goals", () => {
    const status = goalStatus(CATALOG, PEOPLE, FULL, { alex: 2 });
    assert.equal(status.find((s) => s.id === "alex").met, true);
  });
});

describe("unclaimedSlots", () => {
  it("lists every slot when nothing is claimed", () => {
    assert.deepEqual(unclaimedSlots(CATALOG, PEOPLE, EMPTY_DAY).sort(), ["dishes#0", "pets#0", "pets#1", "trash#0"]);
  });

  it("excludes claimed slots", () => {
    assert.deepEqual(unclaimedSlots(CATALOG, PEOPLE, ALEX_TRASH).sort(), ["dishes#0", "pets#0", "pets#1"]);
  });

  it("works when the day has no claimed key", () => {
    assert.equal(unclaimedSlots(CATALOG, PEOPLE, {}).length, 4);
  });
});
