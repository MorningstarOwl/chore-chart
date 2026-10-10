// Calendar math and period totals behind the week/month views.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  toKey, fromKey, isKey, addDays, weekStart, weekDays, addMonths, monthDays, monthGrid,
  periodTotals, doneList, personColors, inkFor,
} from "../js/calendar.js";

const CHORES = [
  { id: "trash", name: "Trash", points: 2, slotsPerDay: 1 },
  { id: "dishes", name: "Dishes", points: 3, slotsPerDay: 1 },
  { id: "pets", name: "Feed pets", points: 1, slotsPerDay: 2 },
];
const PEOPLE = [{ id: "alex", name: "Alex" }, { id: "sam", name: "Sam" }];

describe("day keys", () => {
  it("round-trips local dates", () => {
    assert.equal(toKey(fromKey("2026-10-09")), "2026-10-09");
    assert.equal(toKey(new Date(2026, 0, 5)), "2026-01-05");
  });
  it("rejects impossible dates", () => {
    assert.equal(isKey("2026-02-30"), false);
    assert.equal(isKey("2026-2-3"), false);
    assert.equal(isKey("2026-02-28"), true);
  });
  it("adds days across month, year and DST boundaries", () => {
    assert.equal(addDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-11-01", 1), "2026-11-02"); // US DST ends Nov 1 2026
    assert.equal(addDays("2026-03-08", -1), "2026-03-07"); // DST starts Mar 8 2026
  });
});

describe("weeks", () => {
  it("start on Sunday", () => {
    assert.equal(weekStart("2026-10-09"), "2026-10-04"); // Friday -> Sunday
    assert.equal(weekStart("2026-10-04"), "2026-10-04");
    assert.equal(weekStart("2026-10-10"), "2026-10-04"); // Saturday
  });
  it("span seven consecutive days, crossing months", () => {
    assert.deepEqual(weekDays("2026-11-01"), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    assert.equal(weekDays("2026-10-30")[6], "2026-10-31");
  });
});

describe("months", () => {
  it("step across year ends", () => {
    assert.equal(addMonths("2026-12", 1), "2027-01");
    assert.equal(addMonths("2026-01", -1), "2025-12");
  });
  it("list every day", () => {
    assert.equal(monthDays("2026-02").length, 28);
    assert.equal(monthDays("2028-02").length, 29);
    assert.equal(monthDays("2026-10").at(-1), "2026-10-31");
  });
  it("grid as whole Sunday-Saturday weeks", () => {
    const g = monthGrid("2026-10"); // Oct 1 2026 is a Thursday
    assert.equal(g[0], "2026-09-27");
    assert.equal(g.length % 7, 0);
    assert.equal(g.at(-1), "2026-10-31"); // Oct 31 2026 is a Saturday
    assert.equal(monthGrid("2026-08").length, 42); // Aug 2026 needs six rows
  });
});

describe("periodTotals", () => {
  const days = {
    "2026-10-04": { claimed: { "trash#0": "alex", "dishes#0": "alex" } }, // alex 5
    "2026-10-05": { claimed: { "pets#0": "sam", "pets#1": "sam", "trash#0": "sam" } }, // sam 4
    "2026-10-09": { claimed: { "dishes#0": "sam", "trash#0": "sam" } }, // sam 5, but in the future
  };
  const keys = weekDays("2026-10-04");

  it("sums points and counts goal days per person", () => {
    const [alex, sam] = periodTotals(() => CHORES, PEOPLE, days, keys, "2026-10-09");
    assert.equal(alex.points, 5);
    assert.equal(alex.goalDays, 1);
    assert.equal(sam.points, 9);
    assert.equal(sam.goalDays, 1);
    assert.equal(sam.perDay["2026-10-05"], 4);
    assert.equal(sam.perDay["2026-10-06"], 0);
  });

  it("only counts days that have happened toward days-so-far", () => {
    const [alex] = periodTotals(() => CHORES, PEOPLE, days, keys, "2026-10-06");
    assert.equal(alex.daysSoFar, 3);
  });

  it("judges each person against their own daily goal", () => {
    const people = [{ id: "alex", name: "Alex", goal: 6 }, { id: "sam", name: "Sam", goal: 3 }];
    const [alex, sam] = periodTotals(() => CHORES, people, days, keys, "2026-10-09");
    assert.equal(alex.goal, 6);
    assert.equal(alex.goalDays, 0); // 5 points falls short of 6
    assert.equal(sam.goal, 3);
    assert.equal(sam.goalDays, 2); // 4 and 5 both clear 3
  });

  it("is all zeros for an empty period", () => {
    const totals = periodTotals(() => CHORES, PEOPLE, {}, keys, "2026-10-09");
    assert.deepEqual(totals.map((t) => [t.points, t.goalDays]), [[0, 0], [0, 0]]);
  });
});

describe("doneList", () => {
  it("lists claimed slots in catalog order", () => {
    const out = doneList(CHORES, { claimed: { "pets#1": "sam", "trash#0": "alex" } });
    assert.deepEqual(out.map((d) => [d.slotId, d.participantId]), [["trash#0", "alex"], ["pets#1", "sam"]]);
    assert.deepEqual(doneList(CHORES, undefined), []);
  });
});

describe("colours", () => {
  it("honours a configured colour, else uses the palette", () => {
    const c = personColors([{ id: "a", name: "A", color: "#123456" }, { id: "b", name: "B" }]);
    assert.equal(c.a, "#123456");
    assert.match(c.b, /^#[0-9a-f]{6}$/);
  });
  it("picks readable ink", () => {
    assert.equal(inkFor("#ffffff"), "#1a1a1a");
    assert.equal(inkFor("#000000"), "#ffffff");
    assert.equal(inkFor("#1d3557"), "#ffffff");
    assert.equal(inkFor("#d99a00"), "#1a1a1a");
  });
});
