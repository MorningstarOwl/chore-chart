import { catalogFeasibility } from "./config.js";
import { fetchDay, fetchRange, sendOp, fetchHousehold, savePerson, saveSchedule, saveChore, orderChores, fetchIcons, ConflictError } from "./api.js";
import { toKey, isKey, addDays, weekStart, weekDays, monthOf, addMonths, monthGrid, monthDays, periodTotals } from "./calendar.js";
import { scheduledFor, choresForDay, dailyFor } from "./schedule.js";
import { renderScoreboard, renderWeek, renderMonth, renderDay, longDate, shortDate, monthName } from "./views.js";
import { renderPeople, renderChores, settingsBusy } from "./settings.js";

const POLL_MS = 10000;
const $ = (id) => document.getElementById(id);
const today = () => toKey(new Date());

function showFailure(message) {
  const banner = $("banner-fail");
  banner.textContent = message || "";
  banner.classList.toggle("banner--hidden", !message);
}

/** "#month/2026-10" (default), "#week/2026-10-04", "#day/2026-10-09", "#people", "#chores" ("#schedule" still works). */
function parseRoute() {
  const [view, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const t = today();
  if (view === "week") return { view, key: weekStart(isKey(arg) ? arg : t) };
  if (view === "day") return { view, key: isKey(arg) ? arg : t };
  if (view === "people") return { view };
  if (view === "chores" || view === "schedule") return { view: "chores" };
  return { view: "month", month: /^\d{4}-\d{2}$/.test(arg || "") ? arg : monthOf(t) };
}

async function init() {
  let icons, household;
  try {
    [icons, household] = await Promise.all([fetchIcons(), fetchHousehold()]);
  } catch (err) {
    showFailure(`Failed to load the chore chart: ${err && err.message}`);
    throw err;
  }

  let daysMap = {}; // claims by day, for the calendar views
  let dayDetail = { key: null, data: { claimed: {}, log: [] } }; // the open day, with its undo log
  let writes = 0;
  let busy = false;

  const active = () => household.people.filter((p) => !p.archived);
  const who = () => Object.fromEntries(household.people.map((p) => [p.id, p]));
  // lastDone places "every N days from the last time" dates and keeps overdue chores on today's list.
  const history = () => ({ today: today(), lastDone: household.lastDone || {} });
  const schedFor = (key, day) => scheduledFor(household.schedules, key, day, history());
  const choresFor = (key) => choresForDay(household.chores, household.schedules, key, daysMap[key], history());
  const dailyOf = (day) => dailyFor(household.chores, day);

  function setHousehold(next) {
    household = next;
    const people = active();
    const feas = catalogFeasibility(household.chores.filter((c) => !c.archived), people);
    $("banner-warn").textContent = feas.ok ? "" : `Heads up: the everyday chores add up to ${feas.catalogTotal} points, short of the ${feas.required} needed for everyone to reach their daily goals with some room to spare.`;
    $("banner-warn").classList.toggle("banner--hidden", feas.ok);
  }
  setHousehold(household);

  function setNav(route, { prev, next, todayHref, label }) {
    const calendar = route.view === "month" || route.view === "week" || route.view === "day";
    for (const v of ["month", "week", "people", "chores"]) {
      $(`tab-${v}`).setAttribute("aria-current", route.view === v ? "page" : "false");
    }
    $("tab-month").href = route.view === "day" ? `#month/${monthOf(route.key)}` : "#month";
    $("tab-week").href = route.view === "day" ? `#week/${route.key}` : "#week";
    $("stepper").hidden = !calendar;
    $("scoreboard").hidden = !calendar;
    if (calendar) {
      $("prev").href = prev;
      $("next").href = next;
      $("today-link").href = todayHref;
    }
    $("period-label").textContent = label;
  }

  function draw() {
    const route = parseRoute();
    const t = today();
    const people = active();
    const view = $("view");
    view.dataset.view = route.view;

    if (route.view === "month") {
      const keys = monthGrid(route.month);
      setNav(route, { prev: `#month/${addMonths(route.month, -1)}`, next: `#month/${addMonths(route.month, 1)}`, todayHref: "#month", label: monthName(route.month) });
      const totals = periodTotals(choresFor, people, daysMap, keys, t);
      const monthTotals = periodTotals(choresFor, people, daysMap, monthDays(route.month), t);
      renderScoreboard($("scoreboard"), { people, totals: monthTotals, mode: "period", caption: "This month's totals" });
      renderMonth(view, { month: route.month, keys, todayKey: t, people, who: who(), daysMap, totals, scheduledFor: schedFor, lastDone: household.lastDone });
    } else if (route.view === "week") {
      const keys = weekDays(route.key);
      setNav(route, { prev: `#week/${addDays(route.key, -7)}`, next: `#week/${addDays(route.key, 7)}`, todayHref: "#week", label: `${shortDate(keys[0])} – ${shortDate(keys[6])}` });
      const totals = periodTotals(choresFor, people, daysMap, keys, t);
      renderScoreboard($("scoreboard"), { people, totals, mode: "period", caption: "This week's totals" });
      renderWeek(view, { keys, todayKey: t, people, who: who(), daysMap, totals, dailyFor: dailyOf, scheduledFor: schedFor, lastDone: household.lastDone });
    } else if (route.view === "day") {
      const key = route.key;
      // Until the day's own fetch lands, show what the calendar already knows (undo stays off).
      const day = dayDetail.key === key ? dayDetail.data : { claimed: daysMap[key]?.claimed || {}, log: [] };
      setNav(route, { prev: `#day/${addDays(key, -1)}`, next: `#day/${addDays(key, 1)}`, todayHref: "#day", label: key === t ? `Today · ${longDate(key)}` : longDate(key) });
      const totals = periodTotals(() => choresForDay(household.chores, household.schedules, key, day, history()), people, { [key]: day }, [key], t);
      renderScoreboard($("scoreboard"), { people, totals, mode: "day", caption: "Points for this day" });
      renderDay(view, {
        key, todayKey: t, daily: dailyOf(day), scheduled: schedFor(key, day), people, who: who(), day,
        onToggle: (slotId, pid, on) => act(key, on ? "claim" : "release", slotId, pid),
        onUndo: () => act(key, "undo"),
        onReset: () => {
          if (confirm(`Clear every chore logged for ${longDate(key)}?`)) act(key, "clear");
        },
      });
    } else if (route.view === "people") {
      setNav(route, { label: "People" });
      renderPeople(view, {
        household, icons,
        onSave: async (id, fields) => { setHousehold(await savePerson(id, fields)); draw(); },
        onError: (msg) => showFailure(`Couldn't save: ${msg}`),
      });
    } else {
      setNav(route, { label: "Chores" });
      renderChores(view, {
        household, icons, todayKey: t,
        onSave: async (id, fields) => { setHousehold(await saveSchedule(id, fields)); draw(); },
        onSaveChore: async (id, fields) => { setHousehold(await saveChore(id, fields)); draw(); },
        onOrder: async (ids) => { setHousehold(await orderChores(ids)); draw(); },
        onError: (msg) => showFailure(`Couldn't save: ${msg}`),
        redraw: draw,
      });
    }
  }

  /** Don't redraw over someone typing in a name box or filling in the schedule form. */
  function editing() {
    const el = document.activeElement;
    return settingsBusy() || (el && $("view").contains(el) && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName));
  }

  // Pull whatever the current view needs; other devices' changes arrive this way.
  async function refresh() {
    if (busy) return;
    const route = parseRoute();
    const seen = writes;
    try {
      const houseP = fetchHousehold();
      let changed = false;
      if (route.view === "day") {
        const data = await fetchDay(route.key);
        if (seen !== writes || busy) return;
        if (dayDetail.key !== route.key || JSON.stringify(data) !== JSON.stringify(dayDetail.data)) {
          dayDetail = { key: route.key, data };
          changed = true;
        }
      } else if (route.view === "month" || route.view === "week") {
        const keys = route.view === "week" ? weekDays(route.key) : monthGrid(route.month);
        const fresh = await fetchRange(keys[0], keys[keys.length - 1]);
        if (seen !== writes || busy) return;
        const merged = { ...daysMap };
        for (const k of keys) delete merged[k];
        Object.assign(merged, fresh);
        if (JSON.stringify(merged) !== JSON.stringify(daysMap)) {
          daysMap = merged;
          changed = true;
        }
      }
      const house = await houseP;
      if (JSON.stringify(house) !== JSON.stringify(household)) {
        setHousehold(house);
        changed = true;
      }
      showFailure("");
      if (changed && !editing()) draw();
    } catch (err) {
      showFailure(`Can't reach the chore chart server, so changes won't save. Retrying… (${err.message})`);
    }
  }

  async function act(key, op, slotId, participantId) {
    busy = true;
    writes++;
    try {
      dayDetail = { key, data: await sendOp(key, op, slotId, participantId) };
      showFailure("");
    } catch (err) {
      if (err instanceof ConflictError && err.day) {
        dayDetail = { key, data: err.day }; // someone else got there first; show the real state
      } else {
        showFailure(`Couldn't save that change: ${err.message}`);
      }
    } finally {
      if (dayDetail.key === key) daysMap = { ...daysMap, [key]: { claimed: dayDetail.data.claimed } };
      busy = false;
      draw();
    }
  }

  window.addEventListener("hashchange", () => {
    draw();
    refresh();
    window.scrollTo({ top: 0 });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  // The poll also carries the page across midnight: "today" is recomputed on every draw.
  let lastDay = today();
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (today() !== lastDay) {
      lastDay = today();
      if (!editing()) draw();
    }
    refresh();
  }, POLL_MS);

  draw();
  refresh();
}

init();
