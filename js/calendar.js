// calendar.js - pure date math and period totals for the week/month views. No DOM.
// Day keys are local-calendar "YYYY-MM-DD" strings; weeks start on Sunday.

import { pointsByParticipant } from "./scoring.js";

export const DAILY_GOAL = 5;

/** A person's daily points goal: their own if set, else the household default. */
export function goalOf(person) {
  return Number.isInteger(person && person.goal) ? person.goal : DAILY_GOAL;
}

export function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function fromKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isKey(key) {
  return typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) && toKey(fromKey(key)) === key;
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Sunday on or before the given day. */
export function weekStart(key) {
  return addDays(key, -fromKey(key).getDay());
}

export function weekDays(key) {
  const start = weekStart(key);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** "YYYY-MM" for a day key. */
export function monthOf(key) {
  return key.slice(0, 7);
}

export function addMonths(month, n) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return toKey(d).slice(0, 7);
}

/** Every day of the month, in order. */
export function monthDays(month) {
  const out = [];
  for (let key = `${month}-01`; monthOf(key) === month; key = addDays(key, 1)) out.push(key);
  return out;
}

/** The whole weeks (Sunday..Saturday) covering a month: 35 or 42 keys, padded with neighbours. */
export function monthGrid(month) {
  const days = monthDays(month);
  const first = weekStart(days[0]);
  const last = addDays(weekStart(days[days.length - 1]), 6);
  const out = [];
  for (let key = first; key <= last; key = addDays(key, 1)) out.push(key);
  return out;
}

/**
 * Per-person totals across a set of days.
 * choresFor(key) gives the chores that can score that day (everyday + scheduled).
 * daysMap: {dayKey: {claimed: {...}}}. Only days on or before todayKey count toward
 * "days so far", so a week in progress is judged on the days that have happened.
 * Each person is judged against their own daily goal (goalOf).
 * Returns [{id, goal, points, goalDays, daysSoFar, perDay: {key: points}}] in participant order.
 */
export function periodTotals(choresFor, participants, daysMap, keys, todayKey) {
  const totals = participants.map((p) => ({ id: p.id, goal: goalOf(p), points: 0, goalDays: 0, daysSoFar: 0, perDay: {} }));
  for (const key of keys) {
    const pts = pointsByParticipant({ chores: choresFor(key) }, participants, daysMap[key]);
    const counted = key <= todayKey;
    for (const t of totals) {
      const p = pts[t.id] || 0;
      t.perDay[key] = p;
      t.points += p;
      if (counted) t.daysSoFar++;
      if (p >= t.goal) t.goalDays++;
    }
  }
  return totals;
}

/** Who did what on a day, in the order given: [{slotId, chore, participantId}]. */
export function doneList(chores, day) {
  const claimed = (day && day.claimed) || {};
  const out = [];
  for (const chore of chores) {
    for (let i = 0; i < chore.slotsPerDay; i++) {
      const slotId = `${chore.id}#${i}`;
      if (claimed[slotId]) out.push({ slotId, chore, participantId: claimed[slotId] });
    }
  }
  return out;
}

const PALETTE = ["#1b7f79", "#d1495b", "#5e4bb3", "#e09f3e", "#3a86ff", "#6a994e", "#9c6644", "#c2185b"];

export { PALETTE };

/** A colour per participant: their saved "color", else a stable palette slot. */
export function personColors(participants) {
  return Object.fromEntries(participants.map((p, i) => [p.id, p.color || PALETTE[i % PALETTE.length]]));
}

/** Black or white, whichever reads better on the given #rrggbb background. */
export function inkFor(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? "#1a1a1a" : "#ffffff";
}
