// schedule.js - repeating chores: when a rule falls, how to say it, and each day's chore list. Pure.
//
// Rules (all have "start": the first day they can fall on):
//   {type: "weekly",      every: 1-8 weeks,   weekdays: [0-6]}   0 = Sunday
//   {type: "monthly-day", every: 1-12 months, day: 1-31}         31 means "or the last day"
//   {type: "monthly-nth", every: 1-12 months, nth: 1-4 | -1, weekday: 0-6}   -1 = last
//   {type: "yearly",      month: 1-12, day: 1-31}                Feb 29 falls on Feb 28 in other years
//   {type: "interval",    days: 2-730, fromLastDone: bool}       every N days; with fromLastDone the
//                                                                count restarts whenever it is done
//
// `history` = {lastDone: {scheduleId: "YYYY-MM-DD"}} from the server. Only "interval" rules
// with fromLastDone need it to place dates; the carry-over below needs it for every rule.

import { fromKey, addDays, weekStart } from "./calendar.js";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NTH = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", "-1": "last" };
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000; // whole days, immune to DST
}

function daysInMonth(y, m0) {
  return new Date(y, m0 + 1, 0).getDate();
}

function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/** The first due date of an interval rule: the start, or N days after it was last done. */
function intervalFirst(rule, lastDone) {
  return rule.fromLastDone && lastDone && lastDone >= rule.start ? addDays(lastDone, rule.days) : rule.start;
}

export function occursOn(rule, key, lastDone) {
  if (!rule || key < rule.start) return false;
  if (rule.type === "interval") {
    const first = intervalFirst(rule, lastDone);
    return key >= first && daysBetween(first, key) % rule.days === 0;
  }
  const date = fromKey(key);
  if (rule.type === "yearly") {
    const last = daysInMonth(date.getFullYear(), rule.month - 1);
    return date.getMonth() === rule.month - 1 && date.getDate() === Math.min(rule.day, last);
  }
  const every = rule.every || 1;
  if (rule.type === "weekly") {
    if (!rule.weekdays.includes(date.getDay())) return false;
    // Count weeks from the first matching day on or after the start, so "every other Friday
    // starting Saturday" begins with the very next Friday.
    const startDow = fromKey(rule.start).getDay();
    const lead = [0, 1, 2, 3, 4, 5, 6].find((d) => rule.weekdays.includes((startDow + d) % 7));
    const anchor = weekStart(addDays(rule.start, lead));
    const weeks = Math.round((dayNumber(weekStart(key)) - dayNumber(anchor)) / 7);
    return weeks % every === 0;
  }
  const start = fromKey(rule.start);
  const months = (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth();
  if (months % every !== 0) return false;
  const last = daysInMonth(date.getFullYear(), date.getMonth());
  const d = date.getDate();
  if (rule.type === "monthly-day") return d === Math.min(rule.day, last);
  if (rule.type === "monthly-nth") {
    if (date.getDay() !== rule.weekday) return false;
    return rule.nth === -1 ? d + 7 > last : Math.ceil(d / 7) === rule.nth;
  }
  return false;
}

/** First day on or after fromKey that the rule falls on, or null within ~2 years. */
export function nextOccurrence(rule, fromKey, lastDone) {
  let key = fromKey < rule.start ? rule.start : fromKey;
  for (let i = 0; i < 800; i++, key = addDays(key, 1)) {
    if (occursOn(rule, key, lastDone)) return key;
  }
  return null;
}

/** Last day on or before key that the rule falls on, or null. */
export function previousOccurrence(rule, key, lastDone) {
  for (let i = 0; i < 800 && key >= rule.start; i++, key = addDays(key, -1)) {
    if (occursOn(rule, key, lastDone)) return key;
  }
  return null;
}

/**
 * For a chore kept on the list until it's done: the due date it is still owed for, as of
 * `today`, or null when nothing is outstanding. Only the latest due date counts; a chore
 * missed twice is owed once.
 */
export function overdueSince(schedule, today, lastDone) {
  if (!schedule.carryOver || schedule.archived) return null;
  const due = previousOccurrence(schedule.rule, addDays(today, -1), lastDone);
  if (!due || (lastDone && lastDone >= due)) return null;
  return due;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function list(words) {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Plain-English rule: "Every Tuesday", "Every other Friday", "2nd Friday of every month". */
export function describeRule(rule) {
  const every = rule.every || 1;
  if (rule.type === "weekly") {
    const days = list(rule.weekdays.map((d) => WEEKDAYS[d]));
    if (rule.weekdays.length === 7 && every === 1) return "Every day";
    if (every === 1) return `Every ${days}`;
    if (every === 2) return `Every other ${days}`;
    return `Every ${every} weeks on ${days}`;
  }
  if (rule.type === "interval") {
    return rule.fromLastDone ? `Every ${rule.days} days, counted from when it was last done` : `Every ${rule.days} days`;
  }
  if (rule.type === "yearly") {
    return `Every year on ${MONTHS[rule.month - 1]} ${rule.day}`;
  }
  const months = every === 1 ? "every month" : every === 3 ? "every 3 months" : every === 12 ? "every year" : `every ${every} months`;
  if (rule.type === "monthly-day") {
    return `On the ${ordinal(rule.day)} of ${months}${rule.day > 28 ? " (or the last day)" : ""}`;
  }
  if (rule.type === "monthly-nth") {
    const nth = NTH[rule.nth];
    return `${nth[0].toUpperCase()}${nth.slice(1)} ${WEEKDAYS[rule.weekday]} of ${months}`;
  }
  return "";
}

/** A schedule as a chore the scoring code understands: one slot, id "sched:<id>". */
export function scheduleChore(s, extra) {
  return { id: `sched:${s.id}`, name: s.name, points: s.points, slotsPerDay: 1, icon: s.icon, scheduled: true, assignee: s.assignee, schedule: s, ...extra };
}

/**
 * Scheduled chores for a day: those whose rule falls on it, plus any already done that day
 * (so moving or deleting a schedule never erases points people earned). On `today`, a chore
 * kept until done that is still owed from an earlier date is added with `overdueSince`.
 */
export function scheduledFor(schedules, key, day, { today, lastDone = {} } = {}) {
  const claimed = (day && day.claimed) || {};
  const out = [];
  for (const s of schedules) {
    const done = claimed[`sched:${s.id}#0`];
    if (done || (!s.archived && occursOn(s.rule, key, lastDone[s.id]))) {
      out.push(scheduleChore(s));
    } else if (key === today) {
      const since = overdueSince(s, today, lastDone[s.id]);
      if (since) out.push(scheduleChore(s, { overdueSince: since }));
    }
  }
  return out;
}

/**
 * The everyday list as it applies to one day. Current chores as they are now, but a removed
 * chore, or a slot cut from "2 a day" to "1 a day", still appears wherever someone already did
 * it, so editing the list never erases points earned. `activeSlots` is how many slots can still
 * be claimed; rows past it exist only to show (and release) an old claim.
 */
export function dailyFor(chores, day) {
  const claimed = (day && day.claimed) || {};
  const out = [];
  for (const c of chores) {
    let last = -1;
    for (const slot of Object.keys(claimed)) {
      if (!slot.startsWith(`${c.id}#`)) continue;
      const i = Number(slot.slice(c.id.length + 1));
      if (Number.isInteger(i) && i > last) last = i;
    }
    const activeSlots = c.archived ? 0 : c.slotsPerDay;
    if (activeSlots === 0 && last < 0) continue;
    out.push({ ...c, slotsPerDay: Math.max(activeSlots, last + 1), activeSlots });
  }
  return out;
}

/** Every chore that can score on a day: scheduled ones first, then the everyday list. */
export function choresForDay(chores, schedules, key, day, history) {
  return [...scheduledFor(schedules, key, day, history), ...dailyFor(chores, day)];
}
