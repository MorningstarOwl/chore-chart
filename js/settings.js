// settings.js - the People and Schedule pages: edit household members and repeating chores.

import { h, fill, avatar, tint, dayAndDate } from "./views.js";
import { PALETTE, addDays, goalOf } from "./calendar.js";
import { describeRule, nextOccurrence } from "./schedule.js";

const SWATCHES = [...PALETTE, "#e85d75", "#00a6a6", "#f4a261", "#2b2d42", "#8e7dbe", "#4d908e"];
const GOAL_MIN = 1;
const GOAL_MAX = 20;
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let openPicker = null; // id of the person whose icon menu is open, kept across re-renders
let scheduleDraft = null; // the schedule form's working copy while it is open

/** True while a form is mid-edit, so a background refresh must not redraw over it. */
export function settingsBusy() {
  return scheduleDraft !== null;
}

/* ---------- Icon menu ---------- */

function iconMenu(groups, current, onPick, { prefer } = {}) {
  const ordered = prefer ? [...groups].sort((a, b) => (b.name === prefer) - (a.name === prefer)) : groups;
  return h("div", { class: "icons" }, ordered.map((g) => h("div", { class: "icons__group" },
    h("h4", { class: "icons__title", text: g.name }),
    h("div", { class: "icons__grid", attrs: { role: "group", "aria-label": g.name } }, g.icons.map((icon) => h("button", {
      class: `icons__btn${icon === current ? " icons__btn--on" : ""}`,
      text: icon,
      attrs: { type: "button", "aria-pressed": icon === current ? "true" : "false", "aria-label": `Use ${icon}` },
      on: { click: () => onPick(icon) },
    }))))));
}

/* ---------- People ---------- */

/** − 5 pts + : changes show at once and save after a short pause, so quick taps add up. */
function goalStepper(p, save) {
  let value = goalOf(p);
  let timer = null;
  const out = h("output", { class: "goal__value", attrs: { "aria-live": "polite" } });
  const less = h("button", { class: "goal__btn", text: "−", attrs: { type: "button", "aria-label": `Lower ${p.name}'s daily goal` } });
  const more = h("button", { class: "goal__btn", text: "+", attrs: { type: "button", "aria-label": `Raise ${p.name}'s daily goal` } });
  const show = () => {
    out.textContent = `${value} pt${value === 1 ? "" : "s"} a day`;
    less.disabled = value <= GOAL_MIN;
    more.disabled = value >= GOAL_MAX;
  };
  const bump = (n) => {
    value = Math.min(GOAL_MAX, Math.max(GOAL_MIN, value + n));
    show();
    clearTimeout(timer);
    timer = setTimeout(() => { if (value !== goalOf(p)) save(p.id, { goal: value }); }, 500);
  };
  less.addEventListener("click", () => bump(-1));
  more.addEventListener("click", () => bump(1));
  show();
  return h("div", { class: "goal", attrs: { role: "group", "aria-label": `${p.name}'s daily goal` } }, less, out, more);
}

export function renderPeople(el, { household, icons, onSave, onError }) {
  const active = household.people.filter((p) => !p.archived);
  const removed = household.people.filter((p) => p.archived);

  const save = async (id, fields) => {
    try {
      await onSave(id, fields);
    } catch (err) {
      onError(err.message);
    }
  };

  const cards = active.map((p) => {
    const name = h("input", {
      class: "field__input",
      attrs: { type: "text", value: p.name, maxlength: "30", "aria-label": `Name for ${p.name}`, autocomplete: "off" },
      on: {
        change: (e) => {
          const v = e.target.value.trim();
          if (v && v !== p.name) save(p.id, { name: v });
          else e.target.value = p.name;
        },
        keydown: (e) => { if (e.key === "Enter") e.target.blur(); },
      },
    });
    const swatches = h("div", { class: "swatches", attrs: { role: "group", "aria-label": `Colour for ${p.name}` } },
      SWATCHES.map((c) => h("button", {
        class: `swatch${c === p.color ? " swatch--on" : ""}`,
        attrs: { type: "button", style: tint(c), "aria-label": `Colour ${c}`, "aria-pressed": c === p.color ? "true" : "false" },
        on: { click: () => save(p.id, { color: c }) },
      })),
      h("label", { class: "swatch swatch--custom", attrs: { title: "Pick any colour" } },
        h("span", { class: "visually-hidden", text: "Custom colour" }),
        h("input", { attrs: { type: "color", value: p.color }, on: { change: (e) => save(p.id, { color: e.target.value }) } })));
    const goal = goalStepper(p, save);
    const pickerOpen = openPicker === p.id;
    return h("li", { class: "person", attrs: { style: tint(p.color) } },
      h("div", { class: "person__top" },
        h("button", {
          class: "person__avatar",
          attrs: { type: "button", "aria-expanded": pickerOpen ? "true" : "false", "aria-label": `Change icon for ${p.name}` },
          on: { click: () => { openPicker = pickerOpen ? null : p.id; renderPeople(el, { household, icons, onSave, onError }); } },
        }, avatar(p, "avatar--xl"), h("span", { class: "person__edit", text: "✎", attrs: { "aria-hidden": "true" } })),
        h("div", { class: "person__fields" },
          h("label", { class: "field" }, h("span", { class: "field__label", text: "Name" }), name),
          h("div", { class: "field" }, h("span", { class: "field__label", text: "Colour" }), swatches),
          h("div", { class: "field" }, h("span", { class: "field__label", text: "Daily goal" }), goal))),
      pickerOpen ? iconMenu(icons, p.icon, (icon) => { openPicker = null; save(p.id, { icon }); }) : null,
      h("div", { class: "person__actions" },
        h("button", { class: "link-btn", text: pickerOpen ? "Close icons" : "Choose icon", attrs: { type: "button" },
          on: { click: () => { openPicker = pickerOpen ? null : p.id; renderPeople(el, { household, icons, onSave, onError }); } } }),
        active.length > 1 ? h("button", {
          class: "link-btn link-btn--danger",
          text: "Remove",
          attrs: { type: "button" },
          on: { click: () => { if (confirm(`Remove ${p.name} from the chart? Their past chores stay counted, and you can bring them back later.`)) save(p.id, { archived: true }); } },
        }) : null));
  });

  // New people get the first colour and critter nobody is using yet.
  const usedColors = new Set(active.map((p) => p.color));
  const usedIcons = new Set(active.map((p) => p.icon));
  const nextColor = SWATCHES.find((c) => !usedColors.has(c)) || SWATCHES[0];
  const critters = icons.find((g) => g.name === "Critters")?.icons || icons[0].icons;
  const nextIcon = critters.find((i) => !usedIcons.has(i)) || critters[0];
  const newName = h("input", { class: "field__input", attrs: { type: "text", maxlength: "30", placeholder: "Name", "aria-label": "New person's name", autocomplete: "off" } });
  const add = h("form", {
    class: "person person--new",
    on: {
      submit: (e) => {
        e.preventDefault();
        const v = newName.value.trim();
        if (v) save(null, { name: v, color: nextColor, icon: nextIcon });
      },
    },
  }, h("div", { class: "person__top" },
    avatar({ name: "?", icon: nextIcon, color: nextColor }, "avatar--xl"),
    h("div", { class: "person__fields" },
      h("label", { class: "field" }, h("span", { class: "field__label", text: "Add someone" }), newName),
      h("button", { class: "primary", text: "Add to the chart", attrs: { type: "submit" } }))));

  fill(el,
    h("p", { class: "page-intro", text: "Tap a picture to choose a critter or symbol. Set each person's daily goal to suit them: a younger child might aim for 2 or 3 points while a teenager aims for 6. Changes save as you go." }),
    h("ul", { class: "people" }, cards, h("li", {}, add)),
    removed.length ? h("section", { class: "removed" },
      h("h2", { class: "section-title", text: "Removed" }),
      h("ul", { class: "removed__list" }, removed.map((p) => h("li", { class: "removed__item" },
        avatar(p), h("span", { text: p.name }),
        h("button", { class: "link-btn", text: "Bring back", attrs: { type: "button" }, on: { click: () => save(p.id, { archived: false }) } })))))
      : null);
}

/* ---------- Schedule ---------- */

function blankDraft(todayKey) {
  return {
    id: null, name: "", icon: "🗑️", points: 1, assignee: null,
    rule: { type: "weekly", every: 1, weekdays: [new Date().getDay()], start: todayKey, day: 1, nth: 1, weekday: new Date().getDay() },
  };
}

function draftFrom(s) {
  return {
    id: s.id, name: s.name, icon: s.icon, points: s.points, assignee: s.assignee,
    rule: { every: 1, weekdays: [0], day: 1, nth: 1, weekday: 0, ...s.rule },
  };
}

/** The rule exactly as the server wants it for the draft's repeat type. */
function cleanRule(r) {
  if (r.type === "weekly") return { type: "weekly", every: r.every, weekdays: [...r.weekdays].sort(), start: r.start };
  if (r.type === "monthly-day") return { type: "monthly-day", every: r.every, day: r.day, start: r.start };
  return { type: "monthly-nth", every: r.every, nth: r.nth, weekday: r.weekday, start: r.start };
}

function select(options, value, onChange, label) {
  return h("select", { class: "field__input", attrs: { "aria-label": label }, on: { change: (e) => onChange(e.target.value) } },
    options.map(([v, text]) => h("option", { text, attrs: { value: String(v), selected: String(v) === String(value) } })));
}

function scheduleForm(ctx) {
  const { icons, people, todayKey, onSave, onCancel } = ctx;
  const d = scheduleDraft;
  const preview = h("p", { class: "form__preview", attrs: { "aria-live": "polite" } });
  const error = h("p", { class: "form__error", attrs: { role: "alert" } });
  const weekly = h("div", { class: "form__row" });
  const monthly = h("div", { class: "form__row" });
  const byDate = h("div", { class: "form__inline" });
  const byWeekday = h("div", { class: "form__inline" });
  const iconBtn = h("button", { class: "icon-choice", text: d.icon, attrs: { type: "button", "aria-label": "Choose icon" } });
  const iconSlot = h("div");
  let root = null; // the form, once built; refresh() reads its buttons

  function refresh() {
    const r = d.rule;
    const isWeekly = r.type === "weekly";
    weekly.hidden = !isWeekly;
    monthly.hidden = isWeekly;
    byDate.hidden = r.type !== "monthly-day";
    byWeekday.hidden = r.type !== "monthly-nth";
    for (const b of root.querySelectorAll("[data-repeat]")) b.setAttribute("aria-pressed", String((b.dataset.repeat === "weekly") === isWeekly));
    for (const b of root.querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === r.type));
    for (const b of root.querySelectorAll("[data-wd]")) b.setAttribute("aria-pressed", String(r.weekdays.includes(Number(b.dataset.wd))));
    iconBtn.textContent = d.icon;
    const rule = cleanRule(r);
    if (isWeekly && !rule.weekdays.length) {
      preview.textContent = "Pick at least one day.";
      return;
    }
    const upcoming = [];
    for (let key = nextOccurrence(rule, todayKey); key && upcoming.length < 3; key = nextOccurrence(rule, addDays(key, 1))) upcoming.push(key);
    preview.textContent = `${describeRule(rule)}. Next: ${upcoming.map(dayAndDate).join(", ") || "never"}.`;
  }

  const name = h("input", {
    class: "field__input",
    attrs: { type: "text", value: d.name, maxlength: "40", placeholder: "e.g. Take the bins out", required: true, autocomplete: "off" },
    on: { input: (e) => { d.name = e.target.value; } },
  });
  iconBtn.addEventListener("click", () => {
    if (iconSlot.firstChild) iconSlot.replaceChildren();
    else iconSlot.replaceChildren(iconMenu(icons, d.icon, (icon) => { d.icon = icon; iconSlot.replaceChildren(); refresh(); }, { prefer: "Household" }));
  });

  weekly.append(
    h("span", { class: "field__label", text: "Repeat" }),
    h("div", { class: "form__inline" },
      select([[1, "every week"], [2, "every other week"], [3, "every 3 weeks"], [4, "every 4 weeks"]], d.rule.every,
        (v) => { d.rule.every = Number(v); refresh(); }, "How often"),
      h("span", { text: "on" }),
      h("div", { class: "weekdays", attrs: { role: "group", "aria-label": "Days of the week" } }, WEEKDAY_LETTERS.map((letter, i) => h("button", {
        class: "weekday", text: letter,
        attrs: { type: "button", "data-wd": String(i), "aria-label": WEEKDAY_NAMES[i] },
        on: {
          click: () => {
            const set = new Set(d.rule.weekdays);
            if (set.has(i)) set.delete(i); else set.add(i);
            d.rule.weekdays = [...set];
            refresh();
          },
        },
      })))));

  byDate.append(h("span", { text: "on day" }),
    select(Array.from({ length: 31 }, (_, i) => [i + 1, String(i + 1)]), d.rule.day, (v) => { d.rule.day = Number(v); refresh(); }, "Day of the month"));
  byWeekday.append(h("span", { text: "on the" }),
    select([[1, "1st"], [2, "2nd"], [3, "3rd"], [4, "4th"], [-1, "last"]], d.rule.nth, (v) => { d.rule.nth = Number(v); refresh(); }, "Which week"),
    select(WEEKDAY_NAMES.map((n, i) => [i, n]), d.rule.weekday, (v) => { d.rule.weekday = Number(v); refresh(); }, "Weekday"));
  monthly.append(
    h("span", { class: "field__label", text: "Repeat" }),
    h("div", { class: "form__inline" },
      select([[1, "every month"], [2, "every 2 months"], [3, "every 3 months"], [6, "every 6 months"], [12, "every year"]], d.rule.every,
        (v) => { d.rule.every = Number(v); refresh(); }, "How often"),
      h("div", { class: "seg seg--small", attrs: { role: "group", "aria-label": "Monthly by" } },
        h("button", { text: "By date", attrs: { type: "button", "data-mode": "monthly-day" }, on: { click: () => { d.rule.type = "monthly-day"; refresh(); } } }),
        h("button", { text: "By weekday", attrs: { type: "button", "data-mode": "monthly-nth" }, on: { click: () => { d.rule.type = "monthly-nth"; refresh(); } } }))),
    h("div", { class: "form__inline" }, byDate, byWeekday));

  const form = root = h("form", {
    class: "sched-form",
    on: {
      submit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        try {
          await onSave(d.id, { name: d.name, icon: d.icon, points: d.points, assignee: d.assignee, rule: cleanRule(d.rule) });
        } catch (err) {
          error.textContent = err.message;
        }
      },
    },
  },
    h("h2", { class: "sched-form__title", text: d.id ? "Edit scheduled chore" : "New scheduled chore" }),
    h("div", { class: "form__row form__row--name" },
      h("div", { class: "field" }, h("span", { class: "field__label", text: "Icon" }), iconBtn),
      h("label", { class: "field field--grow" }, h("span", { class: "field__label", text: "Chore" }), name)),
    iconSlot,
    h("div", { class: "form__row" },
      h("span", { class: "field__label", text: "How often" }),
      h("div", { class: "seg seg--small", attrs: { role: "group", "aria-label": "Repeats" } },
        h("button", { text: "Weekly", attrs: { type: "button", "data-repeat": "weekly" }, on: { click: () => { d.rule.type = "weekly"; refresh(); } } }),
        h("button", { text: "Monthly", attrs: { type: "button", "data-repeat": "monthly" },
          on: { click: () => { if (d.rule.type === "weekly") d.rule.type = "monthly-nth"; refresh(); } } }))),
    weekly,
    monthly,
    h("div", { class: "form__row form__row--split" },
      h("label", { class: "field" }, h("span", { class: "field__label", text: "Starting" }),
        h("input", { class: "field__input", attrs: { type: "date", value: d.rule.start, required: true },
          on: { change: (e) => { if (e.target.value) { d.rule.start = e.target.value; refresh(); } } } })),
      h("label", { class: "field" }, h("span", { class: "field__label", text: "Points" }),
        select([1, 2, 3, 4, 5, 6, 8, 10].map((n) => [n, String(n)]), d.points, (v) => { d.points = Number(v); }, "Points")),
      h("label", { class: "field" }, h("span", { class: "field__label", text: "Whose turn" }),
        select([["", "Anyone"], ...people.map((p) => [p.id, `${p.icon} ${p.name}`])], d.assignee || "", (v) => { d.assignee = v || null; }, "Whose turn"))),
    preview,
    error,
    h("div", { class: "form__actions" },
      h("button", { class: "primary", text: d.id ? "Save changes" : "Add to the calendar", attrs: { type: "submit" } }),
      h("button", { text: "Cancel", attrs: { type: "button" }, on: { click: onCancel } })));

  refresh();
  return form;
}

export function renderSchedule(el, { household, icons, todayKey, onSave, onError, redraw }) {
  const people = household.people.filter((p) => !p.archived);
  const who = Object.fromEntries(household.people.map((p) => [p.id, p]));
  const active = household.schedules.filter((s) => !s.archived);

  const ctx = {
    icons, people, todayKey,
    onSave: async (id, fields) => {
      await onSave(id, fields); // throws to the form on a validation error
      scheduleDraft = null;
      redraw();
    },
    onCancel: () => { scheduleDraft = null; redraw(); },
  };

  const items = active
    .map((s) => ({ s, next: nextOccurrence(s.rule, todayKey) }))
    .sort((a, b) => (a.next || "9999").localeCompare(b.next || "9999"))
    .map(({ s, next }) => h("li", { class: "sched-item" },
      h("span", { class: "sched-item__icon", text: s.icon, attrs: { "aria-hidden": "true" } }),
      h("div", { class: "sched-item__body" },
        h("div", { class: "sched-item__name", text: s.name }),
        h("div", { class: "sched-item__rule", text: describeRule(s.rule) }),
        h("div", { class: "sched-item__meta" },
          h("span", { text: next ? (next === todayKey ? "Today" : `Next: ${dayAndDate(next)}`) : "No more dates" }),
          h("span", { text: ` · ${s.points} pt${s.points > 1 ? "s" : ""} · ` }),
          s.assignee && who[s.assignee] ? h("span", { class: "sched-item__who", attrs: { style: tint(who[s.assignee].color) } },
            h("span", { text: `${who[s.assignee].icon} ${who[s.assignee].name}` })) : h("span", { text: "Anyone" }))),
      h("div", { class: "sched-item__actions" },
        h("button", { text: "Edit", attrs: { type: "button" }, on: { click: () => { scheduleDraft = draftFrom(s); redraw(); } } }),
        h("button", {
          class: "danger",
          text: "Delete",
          attrs: { type: "button", "aria-label": `Delete ${s.name}` },
          on: {
            click: async () => {
              if (!confirm(`Stop scheduling "${s.name}"? Points already earned for it stay counted.`)) return;
              try { await onSave(s.id, { archived: true }); } catch (err) { onError(err.message); }
            },
          },
        }))));

  fill(el,
    h("p", { class: "page-intro", text: "Chores that happen on particular days, like bin night or mowing the lawn. They repeat by themselves and show up on the calendar ahead of time." }),
    scheduleDraft ? scheduleForm(ctx) : h("button", {
      class: "primary add-sched",
      text: "+ Schedule a chore",
      attrs: { type: "button" },
      on: { click: () => { scheduleDraft = blankDraft(todayKey); redraw(); } },
    }),
    items.length ? h("ul", { class: "sched-list" }, items)
      : scheduleDraft ? null : h("p", { class: "empty", text: "Nothing scheduled yet." }));

  el.querySelector(".sched-form input")?.focus();
}
