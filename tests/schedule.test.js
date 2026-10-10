// Repeating chores: when rules fall, how they read, and which chores a day carries.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { occursOn, nextOccurrence, describeRule, scheduledFor, choresForDay } from "../js/schedule.js";
import { addDays } from "../js/calendar.js";

const days = (rule, from, n) => {
  const out = [];
  for (let k = from, i = 0; i < n; i++, k = addDays(k, 1)) if (occursOn(rule, k)) out.push(k);
  return out;
};

describe("weekly rules", () => {
  it("trash day: every Tuesday", () => {
    const rule = { type: "weekly", every: 1, weekdays: [2], start: "2026-10-01" };
    assert.deepEqual(days(rule, "2026-10-01", 21), ["2026-10-06", "2026-10-13", "2026-10-20"]);
  });

  it("mowing: every other Friday, counted from the start week", () => {
    const rule = { type: "weekly", every: 2, weekdays: [5], start: "2026-10-09" };
    assert.deepEqual(days(rule, "2026-10-01", 40), ["2026-10-09", "2026-10-23", "2026-11-06"]);
  });

  it("every other Friday starting on a Saturday begins with the next Friday", () => {
    const rule = { type: "weekly", every: 2, weekdays: [5], start: "2026-10-10" };
    assert.deepEqual(days(rule, "2026-10-10", 30), ["2026-10-16", "2026-10-30"]);
  });

  it("several weekdays", () => {
    const rule = { type: "weekly", every: 1, weekdays: [1, 4], start: "2026-10-05" };
    assert.deepEqual(days(rule, "2026-10-05", 7), ["2026-10-05", "2026-10-08"]);
  });

  it("never before the start date", () => {
    const rule = { type: "weekly", every: 1, weekdays: [2], start: "2026-10-14" };
    assert.equal(occursOn(rule, "2026-10-13"), false);
    assert.equal(occursOn(rule, "2026-10-20"), true);
  });

  it("every-other-week stays aligned across the DST change", () => {
    const rule = { type: "weekly", every: 2, weekdays: [0], start: "2026-10-25" };
    assert.deepEqual(days(rule, "2026-10-25", 30), ["2026-10-25", "2026-11-08", "2026-11-22"]);
  });
});

describe("monthly rules", () => {
  it("2nd Friday of every month", () => {
    const rule = { type: "monthly-nth", every: 1, nth: 2, weekday: 5, start: "2026-10-01" };
    assert.deepEqual(days(rule, "2026-10-01", 92), ["2026-10-09", "2026-11-13", "2026-12-11"]);
  });

  it("last Monday of the month", () => {
    const rule = { type: "monthly-nth", every: 1, nth: -1, weekday: 1, start: "2026-10-01" };
    assert.deepEqual(days(rule, "2026-10-01", 62), ["2026-10-26", "2026-11-30"]);
  });

  it("day 31 falls on the last day of shorter months", () => {
    const rule = { type: "monthly-day", every: 1, day: 31, start: "2026-01-01" };
    assert.deepEqual(days(rule, "2026-01-01", 90), ["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("every 3 months, counted from the start month", () => {
    const rule = { type: "monthly-day", every: 3, day: 1, start: "2026-10-01" };
    assert.deepEqual(days(rule, "2026-10-01", 200), ["2026-10-01", "2027-01-01", "2027-04-01"]);
  });
});

describe("nextOccurrence", () => {
  it("finds the next date on or after a day", () => {
    const rule = { type: "weekly", every: 1, weekdays: [2], start: "2026-01-01" };
    assert.equal(nextOccurrence(rule, "2026-10-10"), "2026-10-13");
    assert.equal(nextOccurrence(rule, "2026-10-13"), "2026-10-13");
  });
  it("starts looking at the start date", () => {
    const rule = { type: "monthly-day", every: 1, day: 15, start: "2027-03-01" };
    assert.equal(nextOccurrence(rule, "2026-10-10"), "2027-03-15");
  });
});

describe("describeRule", () => {
  const cases = [
    [{ type: "weekly", every: 1, weekdays: [2] }, "Every Tuesday"],
    [{ type: "weekly", every: 2, weekdays: [5] }, "Every other Friday"],
    [{ type: "weekly", every: 1, weekdays: [1, 3, 5] }, "Every Monday, Wednesday and Friday"],
    [{ type: "weekly", every: 3, weekdays: [6] }, "Every 3 weeks on Saturday"],
    [{ type: "weekly", every: 1, weekdays: [0, 1, 2, 3, 4, 5, 6] }, "Every day"],
    [{ type: "monthly-nth", every: 1, nth: 2, weekday: 5 }, "2nd Friday of every month"],
    [{ type: "monthly-nth", every: 1, nth: -1, weekday: 1 }, "Last Monday of every month"],
    [{ type: "monthly-day", every: 1, day: 15 }, "On the 15th of every month"],
    [{ type: "monthly-day", every: 3, day: 31 }, "On the 31st of every 3 months (or the last day)"],
    [{ type: "monthly-day", every: 12, day: 1 }, "On the 1st of every year"],
  ];
  for (const [rule, text] of cases) it(text, () => assert.equal(describeRule(rule), text));
});

describe("scheduledFor / choresForDay", () => {
  const trash = { id: "s-1", name: "Trash day", icon: "🗑️", points: 2, assignee: null, rule: { type: "weekly", every: 1, weekdays: [2], start: "2026-10-01" } };
  const gone = { ...trash, id: "s-2", name: "Old chore", archived: true };
  const daily = [{ id: "dishes", name: "Dishes", points: 1, slotsPerDay: 1 }];

  it("puts a schedule on its days only", () => {
    assert.deepEqual(scheduledFor([trash], "2026-10-13", undefined).map((c) => c.id), ["sched:s-1"]);
    assert.deepEqual(scheduledFor([trash], "2026-10-14", undefined), []);
  });

  it("drops archived schedules, except on days someone already did them", () => {
    assert.deepEqual(scheduledFor([gone], "2026-10-13", undefined), []);
    assert.deepEqual(scheduledFor([gone], "2026-10-13", { claimed: { "sched:s-2#0": "sam" } }).map((c) => c.id), ["sched:s-2"]);
  });

  it("keeps points earned on a day the rule no longer covers", () => {
    const moved = { ...trash, rule: { ...trash.rule, weekdays: [3] } };
    const chores = choresForDay(daily, [moved], "2026-10-13", { claimed: { "sched:s-1#0": "alex" } });
    assert.deepEqual(chores.map((c) => c.id), ["sched:s-1", "dishes"]);
  });
});
