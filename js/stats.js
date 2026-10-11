// stats.js - the Scores page: this week's standings toward each person's weekly reward,
// day-by-day bars, and the last few weeks. Weeks run Sunday to Saturday, like the calendar.

import { weekDays, addDays, goalOf, weeklyTargetOf, periodTotals } from "./calendar.js";
import { h, fill, avatar, tint, shortDate, weekdayShort, longDate } from "./views.js";

export const HISTORY_WEEKS = 8;
const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Rank people by progress toward their own weekly target (so a 14-point target and a 42-point
 * target compete fairly), then by points. Equal progress and points share a rank.
 * totals: periodTotals() output in the same order as people.
 */
export function standings(people, totals) {
  const rows = people.map((p, i) => {
    const target = weeklyTargetOf(p);
    const points = totals[i].points;
    return { person: p, totals: totals[i], points, target, progress: points / target, earned: points >= target };
  });
  rows.sort((a, b) => b.progress - a.progress || b.points - a.points || a.person.name.localeCompare(b.person.name));
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.progress === r.progress && prev.points === r.points ? prev.rank : i + 1;
  });
  return rows;
}

/** Whole days left in the week after today (0 on Saturday). */
export function daysLeft(weekKey, todayKey) {
  const keys = weekDays(weekKey);
  return keys.filter((k) => k > todayKey).length;
}

function dayBars(row, keys, todayKey) {
  const goal = goalOf(row.person);
  const top = Math.max(goal, ...keys.map((k) => row.totals.perDay[k] || 0), 1);
  return h("div", { class: "bars", attrs: { "aria-hidden": "true" } }, keys.map((k) => {
    const pts = row.totals.perDay[k] || 0;
    return h("div", { class: `bars__day${k === todayKey ? " bars__day--today" : ""}${k > todayKey ? " bars__day--future" : ""}` },
      h("div", { class: "bars__track" },
        h("span", { class: `bars__fill${pts >= goal ? " bars__fill--met" : ""}`, attrs: { style: `height:${Math.round((pts / top) * 100)}%` } }),
        h("span", { class: "bars__goal", attrs: { style: `bottom:${Math.round((goal / top) * 100)}%` } })),
      h("span", { class: "bars__num", text: pts || "" }),
      h("span", { class: "bars__label", text: weekdayShort(k).slice(0, 2) }));
  }));
}

function boardRow(row, keys, todayKey, final) {
  const p = row.person;
  const left = row.target - row.points;
  const status = row.earned ? (final ? "🎉 Reward earned" : "🎉 Reward earned!")
    : final ? `Missed by ${left} pt${left === 1 ? "" : "s"}` : `${left} pt${left === 1 ? "" : "s"} to go`;
  const pct = Math.min(100, Math.round(row.progress * 100));
  const summary = `${p.name}: ${row.points} of ${row.target} points${p.reward ? ` toward ${p.reward}` : ""}. ${status}. ${row.totals.goalDays} days at daily goal.`;
  return h("li", { class: `board__row${row.earned ? " board__row--earned" : ""}`, attrs: { style: tint(p.color), "aria-label": summary } },
    h("span", { class: "board__rank", text: row.points === 0 ? "·" : MEDALS[row.rank - 1] || String(row.rank), attrs: { "aria-hidden": "true" } }),
    avatar(p, "avatar--xl"),
    h("div", { class: "board__main", attrs: { "aria-hidden": "true" } },
      h("div", { class: "board__name" }, h("span", { text: p.name }),
        h("span", { class: "board__points" }, h("strong", { text: row.points }), h("span", { text: ` / ${row.target} pts` }))),
      h("div", { class: "board__reward", text: p.reward ? `🎁 ${p.reward}` : "No reward set yet" }),
      h("div", { class: "meter meter--big" }, h("span", { attrs: { style: `width:${pct}%` } })),
      h("div", { class: "board__status" },
        h("span", { class: row.earned ? "board__earned" : "", text: status }),
        h("span", { text: ` · ${row.totals.goalDays} of ${row.totals.daysSoFar} day${row.totals.daysSoFar === 1 ? "" : "s"} at daily goal` }))),
    dayBars(row, keys, todayKey));
}

function historyTable(people, weekKey, todayKey, choresFor, daysMap) {
  const weeks = [];
  for (let i = 1; i <= HISTORY_WEEKS; i++) weeks.push(addDays(weekKey, -7 * i));
  const rows = weeks.map((wk) => {
    const keys = weekDays(wk);
    const totals = periodTotals(choresFor, people, daysMap, keys, todayKey);
    if (totals.every((t) => t.points === 0)) return null; // before the chart was in use, or a week off
    return h("tr", {},
      h("th", { attrs: { scope: "row" } }, h("a", { text: `${shortDate(keys[0])} – ${shortDate(keys[6])}`, attrs: { href: `#stats/${wk}` } })),
      people.map((p, i) => {
        const pts = totals[i].points;
        const earned = pts >= weeklyTargetOf(p);
        return h("td", { class: earned ? "hist--earned" : "", attrs: { "aria-label": `${p.name}: ${pts} points${earned ? ", reward earned" : ""}` } },
          h("span", { text: pts }), earned ? h("span", { class: "hist__medal", text: " 🏅", attrs: { "aria-hidden": "true" } }) : null);
      }));
  });
  if (!rows.some(Boolean)) {
    return h("section", { class: "history" },
      h("h2", { class: "section-title", text: "Earlier weeks" }),
      h("p", { class: "empty", text: "Past weeks will appear here once there are some." }));
  }
  return h("section", { class: "history" },
    h("h2", { class: "section-title", text: "Earlier weeks" }),
    h("div", { class: "history__scroll" },
      h("table", { class: "history__table" },
        h("thead", {}, h("tr", {}, h("th", { text: "Week", attrs: { scope: "col" } }),
          people.map((p) => h("th", { attrs: { scope: "col", style: tint(p.color) } }, avatar(p), h("span", { class: "history__name", text: p.name }))))),
        h("tbody", {}, rows.filter(Boolean)))),
    h("p", { class: "legend", text: "🏅 = reached their weekly target that week (using today's targets)." }));
}

/** "🎉 Sam and Jordan have earned their rewards this week!" */
export function cheer(names, final) {
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const one = names.length === 1;
  return final ? `🎉 ${who} earned ${one ? "their reward" : "their rewards"}.`
    : `🎉 ${who} ${one ? "has" : "have"} earned ${one ? "their reward" : "their rewards"} this week!`;
}

export function renderStats(el, { weekKey, todayKey, people, daysMap, choresFor }) {
  const keys = weekDays(weekKey);
  const current = weekKey === weekDays(todayKey)[0];
  const final = keys[6] < todayKey;
  const future = keys[0] > todayKey;
  const totals = periodTotals(choresFor, people, daysMap, keys, todayKey);
  const rows = standings(people, totals);
  const left = daysLeft(weekKey, todayKey);

  const note = future ? "This week hasn't started yet."
    : final ? "Final results for this week."
    : left === 0 ? "Last day of the week! Scores reset tomorrow (Sunday)."
    : `${left} day${left === 1 ? "" : "s"} left after today · scores reset on Sunday`;

  const earnedNames = rows.filter((r) => r.earned).map((r) => r.person.name);
  fill(el,
    h("div", { class: "stats__head" },
      h("p", { class: "stats__note", text: note }),
      earnedNames.length ? h("p", { class: "stats__cheer", text: cheer(earnedNames, final) }) : null),
    h("ol", { class: "board", attrs: { "aria-label": current ? "This week's standings" : `Standings for the week of ${longDate(keys[0])}` } },
      rows.map((r) => boardRow(r, keys, todayKey, final))),
    h("p", { class: "legend", text: "Ranked by progress toward each person's weekly target, so bigger and smaller targets compete fairly. Set targets and rewards on the People page." }),
    historyTable(people, weekKey, todayKey, choresFor, daysMap));
}
