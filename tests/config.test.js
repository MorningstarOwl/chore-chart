import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateParticipants, validateChores } from "../js/config.js";

describe("validateParticipants", () => {
  it("accepts Alex/Sam/Riley/Jordan", () => {
    const out = validateParticipants([
      { id: "alex", name: "Alex" },
      { id: "sam",   name: "Sam" },
      { id: "riley", name: "Riley" },
      { id: "jordan", name: "Jordan" },
    ]);
    assert.equal(out.length, 4);
    assert.deepEqual(out.map((p) => p.id), ["alex", "sam", "riley", "jordan"]);
  });

  it("throws on duplicate participant id", () => {
    assert.throws(
      () => validateParticipants([
        { id: "sam",   name: "Sam"   },
        { id: "sam",   name: "Second Sam" },
      ]),
      /Duplicate participant id: sam/
    );
  });

  it("throws on missing id", () => {
    assert.throws(
      () => validateParticipants([{ name: "Alex" }]),
      /requires a.*"id"/
    );
  });

  it("throws on empty id", () => {
    assert.throws(
      () => validateParticipants([{ id: "", name: "Ghost" }]),
      /requires a.*"id"/
    );
  });

  it("throws on missing name", () => {
    assert.throws(
      () => validateParticipants([{ id: "x" }]),
      /requires a.*"name"/
    );
  });
});

describe("validateChores", () => {
  const sample = [
    { id: "a", name: "A", points: 1, slotsPerDay: 1 },
    { id: "b", name: "B", points: 2, slotsPerDay: 1 },
  ];

  it("accepts valid entries", () => {
    const out = validateChores({ chores: sample });
    assert.equal(out.length, 2);
    assert.equal(out[0].points, 1);
    assert.equal(out[1].slotsPerDay, 1);
  });

  it("throws on negative points", () => {
    assert.throws(
      () => validateChores({ chores: [{ id: "a", name: "A", points: -1, slotsPerDay: 1 }] }),
      /positive integer.*points/
    );
  });

  it("throws on zero points", () => {
    assert.throws(
      () => validateChores({ chores: [{ id: "a", name: "A", points: 0, slotsPerDay: 1 }] }),
      /positive integer.*points/
    );
  });

  it("throws on float points", () => {
    assert.throws(
      () => validateChores({ chores: [{ id: "a", name: "A", points: 1.5, slotsPerDay: 1 }] }),
      /positive integer.*points/
    );
  });

  it("throws on slotsPerDay = 0", () => {
    assert.throws(
      () => validateChores({ chores: [{ id: "a", name: "A", points: 1, slotsPerDay: 0 }] }),
      /requires.*integer.*slotsPerDay/
    );
  });

  it("throws on float slotsPerDay", () => {
    assert.throws(
      () => validateChores({ chores: [{ id: "a", name: "A", points: 1, slotsPerDay: 1.5 }] }),
      /requires.*integer.*slotsPerDay/
    );
  });

  it("throws on duplicate chore id", () => {
    assert.throws(
      () => validateChores({ chores: [
        { id: "dup", name: "First", points: 1, slotsPerDay: 1 },
        { id: "dup", name: "Second", points: 1, slotsPerDay: 1 },
      ]}),
      /Duplicate chore id: dup/
    );
  });

  it("throws when chores array is missing", () => {
    assert.throws(
      () => validateChores({}),
      /non-empty.*array/
    );
  });

  it("throws when chore entry is not an object", () => {
    assert.throws(
      () => validateChores({ chores: ["not an object"] }),
      /chore entry must be an object/
    );
  });

  it("throws on empty name", () => {
    assert.throws(
      () => validateChores({ chores: [{ id: "a", name: "", points: 1, slotsPerDay: 1 }] }),
      /requires.*"name"/
    );
  });
});
