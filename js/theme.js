// theme.js - light/dark switch. Loaded as a plain script in <head> so a saved choice applies
// before the first paint. The choice is per device (localStorage); with none saved, the page
// follows the system setting.
(function () {
  var KEY = "chore-chart.theme";
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function saved() {
    try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch (e) { return null; }
  }
  function effective() {
    return root.dataset.theme || (media && media.matches ? "dark" : "light");
  }
  function label() {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var dark = effective() === "dark";
    btn.textContent = dark ? "☀️" : "🌙";
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.title = btn.getAttribute("aria-label");
  }

  var initial = saved();
  if (initial) root.dataset.theme = initial;

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      var next = effective() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (e) { /* private mode: still switches for this visit */ }
      label();
    });
    if (media && media.addEventListener) media.addEventListener("change", label);
    label();
  });
})();
