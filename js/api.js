// api.js - talks to server.py, which holds the shared day state for every device.

export class ConflictError extends Error {
  constructor(msg, day) {
    super(msg);
    this.name = "ConflictError";
    this.day = day;
  }
}

async function request(path, options) {
  const res = await fetch(path, { cache: "no-store", ...options });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) throw new ConflictError(body.error || "conflict", body.day);
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

/** The stored day, always shaped {claimed, log}. */
export function fetchDay(dayKey) {
  return request(`api/day/${dayKey}`);
}

/** Apply one op ("claim" | "release" | "clear" | "undo") and get the updated day back. */
export function sendOp(dayKey, op, slotId, participantId) {
  return request(`api/day/${dayKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, slotId, participantId }),
  });
}

/** Claims for every day in [from, to] that has any: {dayKey: {claimed}}. */
export async function fetchRange(from, to) {
  const body = await request(`api/days?from=${from}&to=${to}`);
  return body.days || {};
}

/** People and scheduled chores: {people, schedules}, archived ones included. */
export function fetchHousehold() {
  return request("api/household");
}

function post(path, body) {
  return request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** Create (no id) or update a person; resolves to the whole household. */
export function savePerson(id, fields) {
  return post(id ? `api/people/${id}` : "api/people", fields);
}

/** Create (no id) or update a scheduled chore; resolves to the whole household. */
export function saveSchedule(id, fields) {
  return post(id ? `api/schedules/${id}` : "api/schedules", fields);
}

export async function fetchIcons() {
  const res = await fetch("config/icons.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`icons: ${res.status}`);
  return (await res.json()).groups;
}

/** Create (no id) or update an everyday chore; resolves to the whole household. */
export function saveChore(id, fields) {
  return post(id ? `api/chores/${id}` : "api/chores", fields);
}

/** Put the everyday chores in this order (every id, once). */
export function orderChores(ids) {
  return post("api/chore-order", { ids });
}
