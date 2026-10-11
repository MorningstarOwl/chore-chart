// Scores page maths: weekly targets, fair ranking, the reset countdown.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { standings, daysLeft, cheer } from "../js/stats.js";
import { weeklyTargetOf, periodTotals, weekDays } from "../js/calendar.js";

const t = (points) => ({ points, goalDays: 0, daysSoFar: 0, perDay: {} });

describe("weeklyTargetOf", () => {
  it("is the person's own target, else their daily goal x 7", () => {
    assert.equal(weeklyTargetOf({ goal: 2 }), 14);
    assert.equal(weeklyTargetOf({}), 35);
    assert.equal(weeklyTargetOf({ goal: 2, weeklyTarget: 20 }), 20);
    assert.equal(weeklyTargetOf({ goal: 4, weeklyTarget: null }), 28);
  });
});

describe("standings", () => {
  const teen = { id: "riley", name: "Riley", goal: 6 };   // target 42
  const kid = { id: "jordan", name: "Jordan", goal: 2 };  // target 14
  const parent = { id: "alex", name: "Alex", goal: 5 };   // target 35

  it("ranks by progress toward each person's own target, not raw points", () => {
    const rows = standings([teen, kid, parent], [t(30), t(14), t(20)]);
    assert.deepEqual(rows.map((r) => [r.person.id, r.rank, r.earned]), [["jordan", 1, true], ["riley", 2, false], ["alex", 3, false]]);
    assert.equal(rows[0].target, 14);
  });

  it("breaks equal progress by points, and shares a rank only when both match", () => {
    const a = { id: "a", name: "A", goal: 1, weeklyTarget: 10 };
    const b = { id: "b", name: "B", goal: 1, weeklyTarget: 20 };
    const c = { id: "c", name: "C", goal: 1, weeklyTarget: 10 };
    const rows = standings([a, b, c], [t(5), t(10), t(5)]);
    assert.deepEqual(rows.map((r) => [r.person.id, r.rank]), [["b", 1], ["a", 2], ["c", 2]]);
  });

  it("counts points over the target as earned", () => {
    assert.equal(standings([kid], [t(20)])[0].earned, true);
    assert.equal(standings([kid], [t(13)])[0].earned, false);
  });

  it("works from a real week of claims", () => {
    const chores = [{ id: "dishes", name: "Dishes", points: 2, slotsPerDay: 1 }];
    const keys = weekDays("2026-10-11");
    const days = { "2026-10-11": { claimed: { "dishes#0": "jordan" } }, "2026-10-12": { claimed: { "dishes#0": "jordan" } } };
    const totals = periodTotals(() => chores, [kid, teen], days, keys, "2026-10-12");
    const rows = standings([kid, teen], totals);
    assert.equal(rows[0].points, 4);
    assert.equal(rows[0].totals.goalDays, 2);
  });
});

describe("daysLeft", () => {
  it("counts the days after today until the Saturday reset", () => {
    assert.equal(daysLeft("2026-10-11", "2026-10-11"), 6); // Sunday
    assert.equal(daysLeft("2026-10-11", "2026-10-17"), 0); // Saturday
    assert.equal(daysLeft("2026-10-04", "2026-10-11"), 0); // a finished week
  });
});

describe("cheer", () => {
  it("names who earned their reward", () => {
    assert.equal(cheer(["Jordan"], false), "🎉 Jordan has earned their reward this week!");
    assert.equal(cheer(["Sam", "Jordan"], false), "🎉 Sam and Jordan have earned their rewards this week!");
    assert.equal(cheer(["A", "B", "C"], true), "🎉 A, B and C earned their rewards.");
  });
});
