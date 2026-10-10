// views.js - DOM for the scoreboard and the month, week and day views.
// Every piece of text goes through textContent; nothing user-supplied reaches innerHTML.
//
// Shared arguments: `people` are the current (non-archived) household members, in order;
// `who` maps every id ever seen (archived included) to {name, icon, color} for history.

import { goalOf, fromKey, doneList, inkFor } from "./calendar.js";

/** h("div", {class, text, attrs, on}, ...children) */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = String(props.text);
  for (const [k, v] of Object.entries(props.attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "style") {
      // The CSP forbids inline style attributes; CSSOM property writes are allowed.
      for (const decl of String(v).split(";")) {
        const i = decl.indexOf(":");
        if (i > 0) node.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
      }
    } else {
      node.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const [ev, fn] of Object.entries(props.on || {})) node.addEventListener(ev, fn);
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/** Replace el's children, skipping the null/false placeholders conditional sections leave. */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

const fmt = (key, opts) => fromKey(key).toLocaleDateString(undefined, opts);
export const weekdayShort = (key) => fmt(key, { weekday: "short" });
export const longDate = (key) => fmt(key, { weekday: "long", month: "long", day: "numeric" });
export const shortDate = (key) => fmt(key, { month: "short", day: "numeric" });
export const dayAndDate = (key) => fmt(key, { weekday: "short", month: "short", day: "numeric" });
export const monthName = (month) => fmt(`${month}-01`, { month: "long", year: "numeric" });

export const tint = (color) => `--person:${color};--ink:${inkFor(color)}`;

/** A person's round badge: their icon on their colour. */
export function avatar(person, extraClass = "") {
  return h("span", {
    class: `avatar ${extraClass}`,
    text: person.icon || person.name.slice(0, 1).toUpperCase(),
    attrs: { style: tint(person.color), "aria-hidden": "true" },
  });
}

const nameOf = (who, id) => (who[id] ? who[id].name : "someone");

/* ---------- Scoreboard ---------- */

export function renderScoreboard(el, { people, totals, mode, caption }) {
  const best = Math.max(0, ...totals.map((t) => t.points));
  const cards = people.map((p, i) => {
    const t = totals[i];
    let sub, fill;
    if (mode === "day") {
      sub = t.points >= t.goal ? "Goal met!" : `${t.goal - t.points} to go`;
      fill = Math.min(1, t.points / t.goal);
    } else {
      sub = `${t.goalDays} of ${t.daysSoFar} day${t.daysSoFar === 1 ? "" : "s"} at goal · ${t.goal}/day`;
      fill = t.daysSoFar ? t.goalDays / t.daysSoFar : 0;
    }
    const met = mode === "day" && t.points >= t.goal;
    return h("li", { class: `score${met ? " score--met" : ""}`, attrs: { style: tint(p.color) } },
      avatar(p),
      h("div", { class: "score__body" },
        h("div", { class: "score__name" },
          h("span", { text: p.name }),
          mode !== "day" && best > 0 && t.points === best ? h("span", { class: "score__top", text: "Top" }) : null),
        h("div", { class: "score__points" },
          h("strong", { text: t.points }),
          h("span", { text: mode === "day" ? ` / ${t.goal} pts` : " pts" })),
        h("div", { class: "meter", attrs: { role: "presentation" } },
          h("span", { attrs: { style: `width:${Math.round(fill * 100)}%` } })),
        h("div", { class: "score__sub", text: sub })));
  });
  el.replaceChildren(
    h("h2", { class: "visually-hidden", text: caption }),
    h("ol", { class: "scoreboard__list", attrs: { "aria-label": caption } }, cards));
}

/* ---------- Scheduled chore status (week + month) ---------- */

/** status: "done" | "missed" | "due" | "upcoming" */
function scheduleStatus(chore, day, key, todayKey) {
  const by = day && day.claimed && day.claimed[`${chore.id}#0`];
  if (by) return { status: "done", by };
  if (key < todayKey) return { status: "missed" };
  return { status: key === todayKey ? "due" : "upcoming" };
}

function schedLabel(chore, st, who) {
  if (st.status === "done") return `${chore.name}: done by ${nameOf(who, st.by)}`;
  if (st.status === "missed") return `${chore.name}: not done`;
  const a = chore.assignee && who[chore.assignee] ? ` (${who[chore.assignee].name})` : "";
  return `${chore.name}${a}: ${st.status === "due" ? "due today" : "scheduled"}`;
}

/* ---------- Week ---------- */

export function renderWeek(el, { keys, todayKey, people, who, daysMap, totals, dailyFor, scheduledFor }) {
  const cols = keys.map((key) => {
    const future = key > todayKey;
    const day = daysMap[key];
    const sched = scheduledFor(key, day);

    const schedItems = sched.map((c) => {
      const st = scheduleStatus(c, day, key, todayKey);
      const color = st.by ? who[st.by]?.color : c.assignee ? who[c.assignee]?.color : null;
      return h("li", {
        class: `sched sched--${st.status}`,
        attrs: { style: color ? tint(color) : undefined, title: schedLabel(c, st, who) },
      }, h("span", { class: "sched__icon", text: c.icon, attrs: { "aria-hidden": "true" } }),
        h("span", { class: "sched__name", text: c.name }),
        st.status === "done" ? h("span", { class: "sched__by", text: who[st.by]?.icon || "✓", attrs: { "aria-hidden": "true" } }) : null,
        h("span", { class: "visually-hidden", text: ` — ${schedLabel(c, st, who)}` }));
    });

    const pills = people.map((p, i) => {
      const pts = totals[i].perDay[key];
      if (!pts) return null;
      const met = pts >= goalOf(p);
      return h("span", {
        class: `pip${met ? " pip--met" : ""}`,
        attrs: { style: tint(p.color), title: `${p.name}: ${pts} pts` },
      }, h("span", { text: p.icon }), h("b", { text: met ? `${pts}✓` : pts }));
    }).filter(Boolean);

    const done = doneList(dailyFor(day), day);
    const shown = done.slice(0, 5);
    const chips = shown.map((d) => h("li", {
      class: "chip",
      attrs: { style: tint(who[d.participantId]?.color || "#888888"), title: `${d.chore.name} — ${nameOf(who, d.participantId)}` },
    }, h("span", { class: "chip__dot", attrs: { "aria-hidden": "true" } }),
      h("span", { class: "chip__text", text: d.chore.name }),
      h("span", { class: "visually-hidden", text: ` by ${nameOf(who, d.participantId)}` })));
    if (done.length > shown.length) chips.push(h("li", { class: "chip chip--more", text: `+${done.length - shown.length} more` }));

    const cls = `day${key === todayKey ? " day--today" : ""}${future ? " day--future" : ""}`;
    return h("a", { class: cls, attrs: { href: `#day/${key}`, "aria-label": `${longDate(key)}: ${sched.length} scheduled, ${done.length} everyday chores done.` } },
      h("div", { class: "day__head" },
        h("span", { class: "day__dow", text: weekdayShort(key) }),
        h("span", { class: "day__num", text: fromKey(key).getDate() }),
        key === todayKey ? h("span", { class: "day__today", text: "Today" }) : null),
      schedItems.length ? h("ul", { class: "day__sched" }, schedItems) : null,
      pills.length ? h("div", { class: "day__pips" }, pills) : null,
      chips.length ? h("ul", { class: "day__chips" }, chips)
        : future ? null : h("p", { class: "day__empty", text: "Nothing logged yet" }),
      future ? null : h("span", { class: "day__cta", text: key === todayKey ? "Log today's chores" : "Open day", attrs: { "aria-hidden": "true" } }));
  });
  el.replaceChildren(h("div", { class: "week" }, cols));
}

/* ---------- Month ---------- */

export function renderMonth(el, { month, keys, todayKey, people, who, daysMap, totals, scheduledFor }) {
  const head = keys.slice(0, 7).map((k) => h("div", { class: "month__dow", text: weekdayShort(k), attrs: { "aria-hidden": "true" } }));
  const cells = keys.map((key) => {
    const inMonth = key.startsWith(month);
    const future = key > todayKey;
    const day = daysMap[key];
    const sched = scheduledFor(key, day);
    const dots = people.map((p, i) => {
      const pts = totals[i].perDay[key] || 0;
      const state = pts >= goalOf(p) ? "met" : pts > 0 ? "some" : "none";
      return h("span", { class: `dot dot--${state}`, attrs: { style: tint(p.color), title: `${p.name}: ${pts} pts` } });
    });
    const icons = sched.map((c) => {
      const st = scheduleStatus(c, day, key, todayKey);
      const color = st.by ? who[st.by]?.color : null;
      return h("span", {
        class: `micon micon--${st.status}`,
        text: c.icon,
        attrs: { style: color ? tint(color) : undefined, title: schedLabel(c, st, who) },
      });
    });
    const dayTotal = totals.reduce((sum, t) => sum + (t.perDay[key] || 0), 0);
    const summary = [
      ...sched.map((c) => schedLabel(c, scheduleStatus(c, day, key, todayKey), who)),
      ...(future ? [] : people.map((p, i) => `${p.name} ${totals[i].perDay[key] || 0} points`)),
    ].join("; ");
    const cls = `cell${inMonth ? "" : " cell--out"}${key === todayKey ? " cell--today" : ""}${future ? " cell--future" : ""}`;
    return h("a", { class: cls, attrs: { href: `#day/${key}`, "aria-label": `${longDate(key)}${summary ? `: ${summary}` : ""}` } },
      h("span", { class: "cell__num", text: fromKey(key).getDate() }),
      icons.length ? h("span", { class: "cell__sched" }, icons) : null,
      future ? null : h("span", { class: "cell__dots" }, dots),
      dayTotal ? h("span", { class: "cell__total", text: `${dayTotal} pts` }) : null);
  });
  const sample = "var(--muted)";
  const legend = h("p", { class: "legend" },
    h("span", { class: "dot dot--met", attrs: { style: `--person:${sample}` } }), " goal met ",
    h("span", { class: "dot dot--some", attrs: { style: `--person:${sample}` } }), " some points ",
    h("span", { class: "dot dot--none" }), " none · ",
    h("span", { class: "micon micon--upcoming", text: "🗑️" }), " scheduled chore");
  el.replaceChildren(h("div", { class: "month" }, head, cells), legend);
}

/* ---------- Day (the logger) ---------- */

function choreRows({ chores, claimed, people, who, future, onToggle }) {
  const rows = [];
  for (const chore of chores) {
    for (let i = 0; i < chore.slotsPerDay; i++) {
      const slotId = `${chore.id}#${i}`;
      const label = chore.slotsPerDay > 1 ? `${chore.name} (${i + 1} of ${chore.slotsPerDay})` : chore.name;
      const by = claimed[slotId];
      if (!by && i >= (chore.activeSlots ?? chore.slotsPerDay)) continue; // a retired slot nobody used
      // Assignee first, so the expected person's button is the first one under their thumb.
      const order = chore.assignee ? [...people].sort((a, b) => (b.id === chore.assignee) - (a.id === chore.assignee)) : people;
      const choices = by ? [who[by] ? { id: by, ...who[by] } : { id: by, name: by, icon: "?", color: "#888888" }] : order;
      const buttons = choices.map((p) => h("button", {
        class: `who${by === p.id ? " who--on" : ""}`,
        attrs: {
          type: "button",
          style: tint(p.color),
          "aria-pressed": by === p.id ? "true" : "false",
          "aria-label": by === p.id ? `${label}: done by ${p.name}. Tap to undo.` : `${label}: mark done by ${p.name}`,
          disabled: future,
        },
        on: { click: () => onToggle(slotId, p.id, by !== p.id) },
      }, h("span", { class: "who__icon", text: p.icon, attrs: { "aria-hidden": "true" } }),
        h("span", { class: "who__name", text: p.name })));
      const pts = `${chore.points} pt${chore.points > 1 ? "s" : ""}`;
      const meta = by ? `${pts} · done by ${nameOf(who, by)}`
        : chore.assignee && who[chore.assignee] ? `${pts} · ${who[chore.assignee].name}'s turn` : pts;
      rows.push(h("li", {
        class: `chore${by ? " chore--done" : ""}${chore.scheduled ? " chore--sched" : ""}`,
        attrs: by && who[by] ? { style: tint(who[by].color) } : {},
      },
        chore.icon ? h("span", { class: "chore__icon", text: chore.icon, attrs: { "aria-hidden": "true" } }) : null,
        h("div", { class: "chore__info" },
          h("span", { class: "chore__name", text: label }),
          h("span", { class: "chore__meta", text: meta })),
        h("div", { class: "chore__who" }, buttons)));
    }
  }
  return rows;
}

export function renderDay(el, { key, todayKey, daily, scheduled, people, who, day, onToggle, onUndo, onReset }) {
  const claimed = day.claimed || {};
  const future = key > todayKey;
  const common = { claimed, people, who, future, onToggle };
  const schedRows = choreRows({ ...common, chores: scheduled });
  const dailyRows = choreRows({ ...common, chores: daily });
  const doneCount = Object.keys(claimed).length;
  const total = schedRows.length + dailyRows.length;
  fill(el,
    h("div", { class: "dayview__bar" },
      h("p", { class: "dayview__count", text: future ? "Coming up. Chores can be logged on the day." : `${doneCount} of ${total} chores done` }),
      future ? null : h("div", { class: "dayview__actions" },
        h("button", { text: "Undo last change", attrs: { type: "button", disabled: !(day.log && day.log.length) }, on: { click: onUndo } }),
        h("button", { text: "Reset day", attrs: { type: "button", disabled: !doneCount }, on: { click: onReset } }))),
    schedRows.length ? h("section", { class: "dayview__section" },
      h("h2", { class: "section-title", text: "Scheduled" }),
      h("ul", { class: "chores", attrs: { "aria-label": `Scheduled chores for ${longDate(key)}` } }, schedRows)) : null,
    h("section", { class: "dayview__section" },
      h("h2", { class: "section-title", text: "Every day" }),
      h("ul", { class: "chores", attrs: { "aria-label": `Everyday chores for ${longDate(key)}` } }, dailyRows)));
}
