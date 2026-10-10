// config.js - validates chore/participant lists and checks the chore list covers everyone's goals.
// No runtime deps. ES module.

function validateParticipants(data) {
  if (!data || typeof data !== "object") {
    throw new TypeError("participants.json: top-level object expected");
  }
  const list = Array.isArray(data.participants) ? data.participants : Array.isArray(data) ? data : null;
  if (!list || !list.length) {
    throw new TypeError("participants.json: 'participants' must be a non-empty array");
  }
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object") throw new TypeError("participant entry must be an object");
    if (typeof p.id !== "string" || !p.id) throw new TypeError(`participant requires a non-empty string "id" (got: ${JSON.stringify(p)})`);
    if (typeof p.name !== "string" || !p.name) throw new TypeError(`participant "${p.id}" requires a non-empty string "name"`);
    if (seen.has(p.id)) throw new Error(`Duplicate participant id: ${p.id}`);
    seen.add(p.id);
    if (p.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(p.color)) {
      throw new TypeError(`participant "${p.id}" has an invalid "color" (use #rrggbb, got: ${p.color})`);
    }
    out.push(p.color ? { id: p.id, name: p.name, color: p.color } : { id: p.id, name: p.name });
  }
  return out;
}

function validateChores(data) {
  if (!data || typeof data !== "object") {
    throw new TypeError("chores.json: top-level object expected");
  }
  const list = Array.isArray(data.chores) ? data.chores : Array.isArray(data) ? data : null;
  if (!list || !list.length) {
    throw new TypeError("chores.json: 'chores' must be a non-empty array");
  }
  const seen = new Set();
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "object") throw new TypeError("chore entry must be an object");
    if (typeof c.id !== "string" || !c.id) {
      throw new TypeError(`chore requires a non-empty string "id" (got: ${JSON.stringify(c)})`);
    }
    if (typeof c.name !== "string" || !c.name) {
      throw new TypeError(`chore "${c.id}" requires a non-empty string "name"`);
    }
    if (!Number.isInteger(c.points) || c.points < 1) {
      throw new TypeError(`chore "${c.id}" requires a positive integer "points" (got: ${c.points})`);
    }
    if (!Number.isInteger(c.slotsPerDay) || c.slotsPerDay < 1) {
      throw new TypeError(`chore "${c.id}" requires integer "slotsPerDay" >= 1 (got: ${c.slotsPerDay})`);
    }
    if (seen.has(c.id)) throw new Error(`Duplicate chore id: ${c.id}`);
    seen.add(c.id);
    out.push({ id: c.id, name: c.name, points: c.points, slotsPerDay: c.slotsPerDay });
  }
  return out;
}

function catalogTotal(choreList) {
  let total = 0;
  for (const c of choreList) {
    total += c.points * c.slotsPerDay;
  }
  return total;
}

/** Points the chore list must offer: everyone's daily goals combined, plus 20% slack. */
function computeRequired(participants) {
  const goals = participants.reduce((sum, p) => sum + (Number.isInteger(p.goal) ? p.goal : 5), 0);
  return Math.max(0, Math.ceil(goals * 1.2));
}

function catalogFeasibility(choreList, participants) {
  const catalogTotalPts = catalogTotal(choreList);
  const required = computeRequired(participants);
  return {
    catalogTotal: catalogTotalPts,
    required,
    ok: catalogTotalPts >= required,
  };
}

export { validateParticipants, validateChores, catalogFeasibility, catalogTotal };
