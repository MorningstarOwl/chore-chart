// scoring.js — pure, DOM-less point maths for the chore chart.
// No imports from state.js or any DOM global. Pure functions for testability.

/**
 * Compute total points claimed by each participant on a given day.
 * @param {!{participants:Array<{id:string,name:string}>,chores:Array<{id:string,name:string,points:number}>}} catalog
 * @param {!Array<{id:string,name:string}>} participants
 * @param {!{claimed:{[slotId:string]:string}}} dayState  day->slotId->participantId
 * @returns {Object.<string, number>}
 */
export function pointsByParticipant(catalog, participants, dayState) {
  const out = {};
  for (const p of participants) {
    out[p.id] = 0;
  }
  if (!dayState || typeof dayState !== "object") return out;
  if (!dayState.claimed) return out;
  for (const chore of catalog.chores || []) {
    for (let i = 0; i < chore.slotsPerDay; i++) {
      const slot = `${chore.id}#${i}`;
      const claimerId = dayState.claimed[slot];
      if (!claimerId) continue;
      out[claimerId] = (out[claimerId] || 0) + chore.points;
    }
  }
  return out;
}

/**
 * Per-participant goal status. goal is either an object {Alex: 5} or an {Array<{id, goal}>}.
 */
export function goalStatus(catalog, participants, dayState, goal) {
  const points = pointsByParticipant(catalog, participants, dayState);
  const goalMap = Array.isArray(goal)
    ? Object.fromEntries(goal.map((g) => [g.id, g.goal]))
    : goal || {};
  return participants.map((p) => {
    const pts = points[p.id] || 0;
    const target = typeof goalMap[p.id] === "number" ? goalMap[p.id] : 5;
    const met = pts >= target;
    return { id: p.id, points: pts, goal: target, met };
  });
}

/**
 * Return the ids of unclaimed chore slots for today.
 */
export function unclaimedSlots(catalog, participants, dayState) {
  const ids = [];
  if (!catalog || !Array.isArray(catalog.chores)) return ids;
  if (!dayState || !dayState.claimed) {
    for (const chore of catalog.chores) {
      for (let i = 0; i < chore.slotsPerDay; i++) ids.push(`${chore.id}#${i}`);
    }
    return ids;
  }
  for (const chore of catalog.chores) {
    for (let i = 0; i < chore.slotsPerDay; i++) {
      const slot = `${chore.id}#${i}`;
      if (!(slot in dayState.claimed)) ids.push(slot);
    }
  }
  return ids;
}


