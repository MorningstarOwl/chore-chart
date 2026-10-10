#!/usr/bin/env python3
"""Chore Chart server: serves the static app and keeps the household's shared state.

Every device (a kitchen tablet, phones) reads and writes the same state through this
server, so a chore logged on a phone shows up everywhere. Python standard library only;
state lives in two JSON files in the data directory.

  python3 server.py --port 8420 --data /var/lib/chore-chart

Settings (flags win over environment variables):
  --bind / CHORE_BIND          address to listen on (default 0.0.0.0)
  --port / CHORE_PORT          port (default 8420)
  --data / CHORE_DATA_DIR      where days.json and household.json live (default ./data)
  CHORE_TITLE                  page title (default "Chore Chart")
  CHORE_CONFIG_DIR             folder whose chores.json / participants.json / icons.json
                               replace the bundled ones in config/ (any file left out
                               falls back to the bundled copy)
  CHORE_TRUSTED_ORIGINS        extra comma-separated origins allowed to write, for a reverse
                               proxy that changes the Host header (the page's own http/https
                               origin is always allowed)
  TZ                           the household's time zone; "today" on the server follows it

API (all JSON):
  GET  /api/day/YYYY-MM-DD   -> {"claimed": {slotId: participantId}, "log": [...]}
  GET  /api/days?from=YYYY-MM-DD&to=YYYY-MM-DD -> {"days": {key: {"claimed": {...}}}} (calendar views, max 62 days)
  POST /api/day/YYYY-MM-DD   body {"op": "claim"|"release"|"clear"|"undo", "slotId", "participantId"}
                             -> the updated day; 409 if the op no longer applies (someone beat you to it).
                             Claims on days after tomorrow (server time) are refused: chores are logged, not planned.
  GET  /api/household        -> {"people": [...], "schedules": [...]} (archived entries included)
  POST /api/people           body {"name", "color", "icon", "goal"?} -> household; adds a person (goal 1-20, default 5)
  POST /api/people/ID        body with any of name/color/icon/goal/archived -> household
  POST /api/schedules        body {"name", "icon", "points", "assignee", "rule"} -> household
  POST /api/schedules/ID     body with any schedule field, or {"archived": true} -> household
  GET  /api/export           -> every stored day plus the household, as a download (backup)
  POST /api/import           body = an export; replaces the stored days (and household, if present)
Writes must be Content-Type: application/json from the page's own origin (no cross-site posts).
"""
import argparse
import html
import datetime
import json
import os
import secrets
import signal
import sys
import re
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# Only these files are served; nothing else in the directory (server.py, .git, data) is reachable.
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}
for _p in (ROOT / "js").glob("*.js"):
    STATIC[f"/js/{_p.name}"] = (f"js/{_p.name}", "text/javascript; charset=utf-8")
CONFIG_FILES = ("chores.json", "participants.json", "icons.json")
for _name in CONFIG_FILES:
    STATIC[f"/config/{_name}"] = (f"config:{_name}", "application/json; charset=utf-8")


def config_path(name):
    """A config file from $CHORE_CONFIG_DIR if it has one, else the bundled copy in config/."""
    override = os.environ.get("CHORE_CONFIG_DIR")
    if override and (Path(override) / name).is_file():
        return Path(override) / name
    return ROOT / "config" / name

MAX_LOG = 500
MAX_RANGE_DAYS = 62
KEEP_DAYS = 400  # about 13 months of history; older days are dropped on write


COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
SEED_COLORS = ["#1b7f79", "#d1495b", "#5e4bb3", "#e09f3e", "#3a86ff", "#6a994e", "#9c6644", "#c2185b"]
DEFAULT_GOAL = 5
SEED_ICONS = ["🦉", "🦊", "🐱", "🐰", "🐻", "🐸", "🦔", "🐙"]


class OpError(Exception):
    """An op that cannot apply to the current state (stale client): HTTP 409."""


def daily_slots():
    """Slot ids of the everyday chores, read fresh so config edits apply without a restart."""
    chores = json.loads(config_path("chores.json").read_text())["chores"]
    return {f"{c['id']}#{i}" for c in chores for i in range(int(c["slotsPerDay"]))}


def allowed_icons():
    groups = json.loads(config_path("icons.json").read_text())["groups"]
    return {icon for g in groups for icon in g["icons"]}


def write_json(path, obj):
    """Atomic replace, so a crash mid-write never leaves a half file behind."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}-")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _text(value, field, limit):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    value = " ".join(value.split())
    if len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError(f"{field} must be at most {limit} characters")
    return value


def _int(value, field, lo, hi):
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ValueError(f"{field} must be a whole number from {lo} to {hi}")
    return value


def _date(value, field):
    try:
        return datetime.date.fromisoformat(value).isoformat()
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a YYYY-MM-DD date") from None


def check_person(body, current=None):
    """A full person from a create/update body; `current` supplies fields the update leaves out."""
    out = dict(current or {})
    if "name" in body or current is None:
        out["name"] = _text(body.get("name"), "name", 30)
    if "color" in body or current is None:
        color = body.get("color")
        if not isinstance(color, str) or not COLOR_RE.match(color):
            raise ValueError("color must look like #rrggbb")
        out["color"] = color.lower()
    if "icon" in body or current is None:
        if body.get("icon") not in allowed_icons():
            raise ValueError("pick an icon from the menu")
        out["icon"] = body["icon"]
    if "goal" in body or current is None:
        out["goal"] = _int(body.get("goal", DEFAULT_GOAL), "daily goal", 1, 20)
    if "archived" in body:
        out["archived"] = bool(body["archived"])
    return out


def check_rule(rule):
    if not isinstance(rule, dict):
        raise ValueError("rule is required")
    kind = rule.get("type")
    out = {"type": kind, "start": _date(rule.get("start"), "start")}
    if kind == "weekly":
        out["every"] = _int(rule.get("every"), "every", 1, 8)
        days = rule.get("weekdays")
        if not isinstance(days, list) or not days:
            raise ValueError("pick at least one weekday")
        out["weekdays"] = sorted({_int(d, "weekday", 0, 6) for d in days})
    elif kind == "monthly-day":
        out["every"] = _int(rule.get("every"), "every", 1, 12)
        out["day"] = _int(rule.get("day"), "day", 1, 31)
    elif kind == "monthly-nth":
        out["every"] = _int(rule.get("every"), "every", 1, 12)
        nth = rule.get("nth")
        if nth not in (1, 2, 3, 4, -1) or isinstance(nth, bool):
            raise ValueError("nth must be 1-4 or -1 (last)")
        out["nth"] = nth
        out["weekday"] = _int(rule.get("weekday"), "weekday", 0, 6)
    else:
        raise ValueError("rule type must be weekly, monthly-day or monthly-nth")
    return out


def check_schedule(body, active_people, current=None):
    out = dict(current or {})
    if "name" in body or current is None:
        out["name"] = _text(body.get("name"), "name", 40)
    if "icon" in body or current is None:
        if body.get("icon") not in allowed_icons():
            raise ValueError("pick an icon from the menu")
        out["icon"] = body["icon"]
    if "points" in body or current is None:
        out["points"] = _int(body.get("points"), "points", 1, 10)
    if "assignee" in body or current is None:
        who = body.get("assignee")
        if who is not None and who not in active_people:
            raise ValueError("assignee must be a current household member")
        out["assignee"] = who
    if "rule" in body or current is None:
        out["rule"] = check_rule(body.get("rule"))
    if "archived" in body:
        out["archived"] = bool(body["archived"])
    return out


def clean_day(raw):
    """Coerce a stored or imported day into {claimed, log}; anything malformed is dropped."""
    if not isinstance(raw, dict):
        return {"claimed": {}, "log": []}
    claimed = raw.get("claimed")
    claimed = {k: v for k, v in claimed.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(claimed, dict) else {}
    log = raw.get("log")
    log = [e for e in log if isinstance(e, dict) and e.get("type") in ("claim", "release", "clear")] if isinstance(log, list) else []
    return {"claimed": claimed, "log": log[-MAX_LOG:]}


def apply_op(day, body, slots, people):
    """Apply one op to a day in place. Mirrors the original js/state.js semantics."""
    op = body.get("op")
    slot, who = body.get("slotId"), body.get("participantId")
    claimed, log = day["claimed"], day["log"]
    if op == "claim":
        if slot not in slots or who not in people:
            raise ValueError("unknown chore or person")
        if slot in claimed:
            raise OpError(f"{slot} is already claimed")
        claimed[slot] = who
        log.append({"type": "claim", "slotId": slot, "participantId": who})
    elif op == "release":
        if slot not in claimed:
            raise OpError(f"{slot} is not claimed")
        log.append({"type": "release", "slotId": slot, "participantId": claimed.pop(slot)})
    elif op == "clear":
        if claimed:
            log.append({"type": "clear", "previousClaimed": dict(claimed)})
            claimed.clear()
    elif op == "undo":
        if not log:
            raise OpError("nothing to undo")
        last = log.pop()
        if last["type"] == "claim":
            claimed.pop(last.get("slotId"), None)
        elif last["type"] == "release":
            claimed[last["slotId"]] = last["participantId"]
        elif last["type"] == "clear":
            claimed.clear()
            claimed.update(last.get("previousClaimed") or {})
    else:
        raise ValueError(f"unknown op {op!r}")
    del log[:-MAX_LOG]
    return day


class Store:
    """All days in one JSON file, rewritten atomically on every change."""

    def __init__(self, data_dir):
        self.path = Path(data_dir) / "days.json"
        self.house_path = Path(data_dir) / "household.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.days = self._load()
        self.house = self._load_house()

    def _load_house(self):
        if self.house_path.exists():
            try:
                raw = json.loads(self.house_path.read_text())
                return self._clean_house(raw)
            except (ValueError, OSError, KeyError, TypeError) as err:
                aside = self.house_path.with_name(f"household.json.corrupt-{int(time.time())}")
                self.house_path.rename(aside)
                print(f"household.json unreadable ({err}); moved to {aside.name}, reseeding", flush=True)
        # First run: seed from config/participants.json, keeping their ids so old claims still match.
        seed = json.loads(config_path("participants.json").read_text())["participants"]
        people = [{"id": p["id"], "name": p["name"], "color": p.get("color") or SEED_COLORS[i % len(SEED_COLORS)],
                   "icon": SEED_ICONS[i % len(SEED_ICONS)], "goal": DEFAULT_GOAL} for i, p in enumerate(seed)]
        house = {"people": people, "schedules": []}
        write_json(self.house_path, house)
        return house

    @staticmethod
    def _clean_house(raw):
        if not isinstance(raw, dict) or not isinstance(raw.get("people"), list):
            raise ValueError("household needs a people list")
        icons = allowed_icons()
        people = []
        for i, p in enumerate(raw["people"]):
            if isinstance(p, dict) and isinstance(p.get("id"), str):
                # Lenient on looks (an icon dropped from icons.json must not lose the person).
                body = {**p, "icon": p.get("icon") if p.get("icon") in icons else SEED_ICONS[i % len(SEED_ICONS)],
                        "color": p.get("color") if isinstance(p.get("color"), str) and COLOR_RE.match(p["color"])
                        else SEED_COLORS[i % len(SEED_COLORS)],
                        "goal": p.get("goal") if isinstance(p.get("goal"), int) and 1 <= p["goal"] <= 20 else DEFAULT_GOAL}
                people.append({"id": p["id"], **check_person(body, None), "archived": bool(p.get("archived"))})
        if not any(not p["archived"] for p in people):
            raise ValueError("household has nobody in it")
        active = {p["id"] for p in people if not p["archived"]}
        schedules = []
        for sch in raw.get("schedules") or []:
            if isinstance(sch, dict) and isinstance(sch.get("id"), str):
                body = dict(sch)
                if body.get("icon") not in icons:
                    body["icon"] = "🧹"
                if body.get("assignee") not in active:
                    body["assignee"] = None
                schedules.append({"id": sch["id"], **check_schedule(body, active), "archived": bool(sch.get("archived"))})
        return {"people": people, "schedules": schedules}

    def household(self):
        with self.lock:
            return json.loads(json.dumps(self.house))

    def _active_people(self):
        return {p["id"] for p in self.house["people"] if not p.get("archived")}

    def add_person(self, body):
        with self.lock:
            person = {"id": f"p-{secrets.token_hex(4)}", **check_person(body), "archived": False}
            self.house["people"].append(person)
            write_json(self.house_path, self.house)
        return self.household()

    def update_person(self, pid, body):
        with self.lock:
            person = next((p for p in self.house["people"] if p["id"] == pid), None)
            if person is None:
                raise KeyError("no such person")
            updated = check_person(body, person)
            if updated.get("archived") and len(self._active_people() - {pid}) == 0:
                raise ValueError("the household needs at least one person")
            person.update(updated)
            if person.get("archived"):
                for sch in self.house["schedules"]:
                    if sch.get("assignee") == pid:
                        sch["assignee"] = None
            write_json(self.house_path, self.house)
        return self.household()

    def add_schedule(self, body):
        with self.lock:
            sch = {"id": f"s-{secrets.token_hex(4)}", **check_schedule(body, self._active_people()), "archived": False}
            self.house["schedules"].append(sch)
            write_json(self.house_path, self.house)
        return self.household()

    def update_schedule(self, sid, body):
        with self.lock:
            sch = next((x for x in self.house["schedules"] if x["id"] == sid), None)
            if sch is None:
                raise KeyError("no such scheduled chore")
            sch.update(check_schedule(body, self._active_people(), sch))
            write_json(self.house_path, self.house)
        return self.household()

    def _load(self):
        if not self.path.exists():
            return {}
        try:
            raw = json.loads(self.path.read_text())
            if not isinstance(raw, dict):
                raise ValueError("top level is not an object")
            return {k: clean_day(v) for k, v in raw.items() if DAY_RE.match(k)}
        except (ValueError, OSError) as err:
            # Never let a damaged file take the chart down: keep it aside and start fresh.
            aside = self.path.with_name(f"days.json.corrupt-{int(time.time())}")
            self.path.rename(aside)
            print(f"days.json unreadable ({err}); moved to {aside.name}, starting empty", flush=True)
            return {}

    def _save(self):
        write_json(self.path, self.days)

    def get(self, key):
        with self.lock:
            return clean_day(self.days.get(key))

    def range(self, start, end):
        with self.lock:
            return {k: {"claimed": dict(v["claimed"])} for k, v in self.days.items() if start <= k <= end and v["claimed"]}

    def apply(self, key, body):
        if body.get("op") == "claim":
            tomorrow = datetime.date.today() + datetime.timedelta(days=1)
            if key > tomorrow.isoformat():
                raise ValueError("can't log chores for a future day")
        slots = daily_slots()
        with self.lock:
            slots |= {f"sched:{x['id']}#0" for x in self.house["schedules"] if not x.get("archived")}
            people = self._active_people()
            day = clean_day(self.days.get(key))
            apply_op(day, body, slots, people)
            self.days[key] = day
            for old in sorted(self.days)[:-KEEP_DAYS]:
                del self.days[old]
            self._save()
            return day

    def export(self):
        with self.lock:
            return {"format": "chore-chart", "version": 2, "days": dict(self.days), "household": self.house}

    def replace(self, payload):
        days = payload.get("days") if isinstance(payload, dict) else None
        if not isinstance(days, dict):
            raise ValueError('expected {"days": {...}}')
        house = self._clean_house(payload["household"]) if payload.get("household") is not None else None
        with self.lock:
            self.days = {k: clean_day(v) for k, v in days.items() if DAY_RE.match(k)}
            self._save()
            if house is not None:
                self.house = house
                write_json(self.house_path, self.house)
            return len(self.days)


class Handler(BaseHTTPRequestHandler):
    store = None
    server_version = "ChoreChart/1"

    def _send(self, status, body, ctype="application/json; charset=utf-8", extra=None):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def _day_key(self):
        m = re.fullmatch(r"/api/day/(\d{4}-\d{2}-\d{2})", self.path.split("?")[0])
        return m.group(1) if m else None

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 5_000_000:
            raise ValueError("body too large")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in STATIC:
            name, ctype = STATIC[path]
            if name.startswith("config:"):
                return self._send(200, config_path(name[7:]).read_bytes(), ctype)
            body = (ROOT / name).read_bytes()
            if name == "index.html":
                title = html.escape(os.environ.get("CHORE_TITLE") or "Chore Chart")
                body = body.replace(b"{{title}}", title.encode())
            return self._send(200, body, ctype)
        if path == "/api/export":
            stamp = time.strftime("%Y-%m-%d")
            return self._send(200, self.store.export(), extra={
                "Content-Disposition": f'attachment; filename="chore-chart-{stamp}.json"'})
        if path == "/api/days":
            return self._days_range()
        if path == "/api/household":
            return self._send(200, self.store.household())
        key = self._day_key()
        if key:
            return self._send(200, self.store.get(key))
        self._send(404, {"error": "not found"})

    def _days_range(self):
        q = parse_qs(urlsplit(self.path).query)
        try:
            start = datetime.date.fromisoformat(q["from"][0])
            end = datetime.date.fromisoformat(q["to"][0])
        except (KeyError, ValueError):
            return self._send(400, {"error": "from and to must be YYYY-MM-DD"})
        if end < start or (end - start).days >= MAX_RANGE_DAYS:
            return self._send(400, {"error": f"range must be 1-{MAX_RANGE_DAYS} days"})
        return self._send(200, {"days": self.store.range(start.isoformat(), end.isoformat())})

    def _same_origin_json(self):
        """Refuse cross-site writes: a page elsewhere can send a text/plain form POST with no
        preflight, but it cannot send application/json without one (which we never answer)."""
        if (self.headers.get("Content-Type") or "").split(";")[0].strip().lower() != "application/json":
            return False
        if self.headers.get("Sec-Fetch-Site") not in (None, "same-origin", "none"):
            return False
        origin = self.headers.get("Origin")
        if origin is None:
            return True
        host = self.headers.get("Host")
        extra = {o.strip().rstrip("/") for o in os.environ.get("CHORE_TRUSTED_ORIGINS", "").split(",") if o.strip()}
        return origin in {f"http://{host}", f"https://{host}"} | extra

    def do_POST(self):
        if not self._same_origin_json():
            return self._send(403, {"error": "cross-site or non-JSON write refused"})
        try:
            body = self._body()
            if self.path == "/api/import":
                return self._send(200, {"imported": self.store.replace(body)})
            if not isinstance(body, dict):
                raise ValueError("expected a JSON object")
            m = re.fullmatch(r"/api/(people|schedules)(?:/([\w-]{1,40}))?", self.path)
            if m:
                kind, ident = m.groups()
                if kind == "people":
                    house = self.store.update_person(ident, body) if ident else self.store.add_person(body)
                else:
                    house = self.store.update_schedule(ident, body) if ident else self.store.add_schedule(body)
                return self._send(200, house)
            key = self._day_key()
            if not key:
                return self._send(404, {"error": "not found"})
            return self._send(200, self.store.apply(key, body))
        except OpError as err:
            self._send(409, {"error": str(err), "day": self.store.get(self._day_key() or "")})
        except KeyError as err:
            self._send(404, {"error": str(err).strip("'")})
        except (ValueError, TypeError) as err:
            self._send(400, {"error": str(err)})

    def log_message(self, fmt, *args):
        if self.command != "GET" or not str(args[1]).startswith("2"):
            super().log_message(fmt, *args)


def main():
    env = os.environ.get
    ap = argparse.ArgumentParser(description="Chore Chart server")
    ap.add_argument("--bind", default=env("CHORE_BIND", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(env("CHORE_PORT", "8420")))
    ap.add_argument("--data", default=env("CHORE_DATA_DIR", str(ROOT / "data")))
    a = ap.parse_args()
    Handler.store = Store(a.data)
    srv = ThreadingHTTPServer((a.bind, a.port), Handler)
    # As PID 1 in a container, SIGTERM has no default action; exit cleanly so `docker stop` is instant.
    # Writes are atomic renames, so stopping mid-request never leaves a half-written file.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    print(f"chore chart on http://{a.bind}:{a.port}/  data={Handler.store.path.parent}", flush=True)
    try:
        srv.serve_forever()
    except (KeyboardInterrupt, SystemExit):
        pass


if __name__ == "__main__":
    main()
