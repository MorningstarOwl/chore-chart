"""Server tests: python3 -m unittest discover -s tests -p 'test_*.py'"""
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server  # noqa: E402

DAY = "2026-10-09"


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        server.Handler.store = server.Store(self.tmp.name)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_port}"

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def call(self, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def op(self, **body):
        return self.call(f"/api/day/{DAY}", body)

    def test_claim_is_visible_to_every_reader(self):
        self.assertEqual(self.op(op="claim", slotId="trash#0", participantId="alex")[0], 200)
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"], {"trash#0": "alex"})

    def test_second_claim_on_a_slot_conflicts(self):
        self.op(op="claim", slotId="trash#0", participantId="alex")
        status, body = self.op(op="claim", slotId="trash#0", participantId="sam")
        self.assertEqual(status, 409)
        self.assertEqual(body["day"]["claimed"], {"trash#0": "alex"})

    def test_unknown_slot_or_person_rejected(self):
        self.assertEqual(self.op(op="claim", slotId="nope#0", participantId="alex")[0], 400)
        self.assertEqual(self.op(op="claim", slotId="trash#0", participantId="mallory")[0], 400)
        self.assertEqual(self.op(op="claim", slotId="feed-pets#2", participantId="sam")[0], 400)

    def test_release_clear_and_undo(self):
        self.op(op="claim", slotId="trash#0", participantId="alex")
        self.op(op="claim", slotId="feed-pets#1", participantId="sam")
        self.op(op="release", slotId="trash#0")
        self.op(op="clear")
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"], {})
        self.op(op="undo")  # undo clear
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"], {"feed-pets#1": "sam"})
        self.op(op="undo")  # undo release
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"], {"feed-pets#1": "sam", "trash#0": "alex"})
        self.op(op="undo")
        self.op(op="undo")
        self.assertEqual(self.op(op="undo")[0], 409)

    def test_state_survives_restart(self):
        self.op(op="claim", slotId="trash#0", participantId="alex")
        self.assertEqual(server.Store(self.tmp.name).get(DAY)["claimed"], {"trash#0": "alex"})

    def test_corrupt_file_is_set_aside_not_fatal(self):
        path = Path(self.tmp.name) / "days.json"
        path.write_text("{not json")
        store = server.Store(self.tmp.name)
        self.assertEqual(store.get(DAY), {"claimed": {}, "log": []})
        self.assertEqual(len(list(Path(self.tmp.name).glob("days.json.corrupt-*"))), 1)

    def test_malformed_day_is_cleaned(self):
        path = Path(self.tmp.name) / "days.json"
        path.write_text(json.dumps({DAY: {"claimed": "garbage", "log": [1, {"type": "claim"}]}, "../etc": {}}))
        store = server.Store(self.tmp.name)
        self.assertEqual(store.get(DAY)["claimed"], {})
        self.assertNotIn("../etc", store.days)

    def test_export_then_import_round_trips(self):
        self.op(op="claim", slotId="trash#0", participantId="alex")
        backup = self.call("/api/export")[1]
        self.op(op="clear")
        self.assertEqual(self.call("/api/import", backup), (200, {"imported": 1}))
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"], {"trash#0": "alex"})

    def post_raw(self, path, data, headers):
        req = urllib.request.Request(self.base + path, data=data, headers=headers)
        try:
            with urllib.request.urlopen(req) as r:
                return r.status
        except urllib.error.HTTPError as e:
            e.close()
            return e.code

    def test_cross_site_writes_refused(self):
        self.op(op="claim", slotId="trash#0", participantId="alex")
        wipe = json.dumps({"days": {}}).encode()
        self.assertEqual(self.post_raw("/api/import", wipe, {"Content-Type": "text/plain"}), 403)
        self.assertEqual(self.post_raw("/api/import", wipe, {"Content-Type": "application/json", "Origin": "http://evil.example"}), 403)
        self.assertEqual(self.post_raw("/api/import", wipe, {"Content-Type": "application/json", "Sec-Fetch-Site": "cross-site"}), 403)
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"], {"trash#0": "alex"})
        host = f"127.0.0.1:{self.srv.server_port}"
        self.assertEqual(self.post_raw(f"/api/day/{DAY}", json.dumps({"op": "undo"}).encode(),
                                       {"Content-Type": "application/json", "Origin": f"http://{host}", "Sec-Fetch-Site": "same-origin"}), 200)

    def test_range_returns_only_days_with_claims_inside_it(self):
        self.op(op="claim", slotId="trash#0", participantId="alex")
        self.call("/api/day/2026-10-01", {"op": "claim", "slotId": "trash#0", "participantId": "sam"})
        self.call("/api/day/2026-10-02", {"op": "claim", "slotId": "trash#0", "participantId": "sam"})
        self.call("/api/day/2026-10-02", {"op": "undo"})
        status, body = self.call("/api/days?from=2026-10-01&to=2026-10-07")
        self.assertEqual(status, 200)
        self.assertEqual(body, {"days": {"2026-10-01": {"claimed": {"trash#0": "sam"}}}})
        self.assertEqual(self.call("/api/days?from=2026-10-01&to=2027-01-31")[0], 400)
        self.assertEqual(self.call("/api/days?from=2026-10-07&to=2026-10-01")[0], 400)
        self.assertEqual(self.call("/api/days?from=junk&to=2026-10-01")[0], 400)

    def test_future_claims_refused(self):
        import datetime
        later = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
        tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
        self.assertEqual(self.call(f"/api/day/{later}", {"op": "claim", "slotId": "trash#0", "participantId": "alex"})[0], 400)
        self.assertEqual(self.call(f"/api/day/{tomorrow}", {"op": "claim", "slotId": "trash#0", "participantId": "alex"})[0], 200)

    def test_household_seeded_from_config(self):
        status, house = self.call("/api/household")
        self.assertEqual(status, 200)
        self.assertEqual([p["id"] for p in house["people"]], ["alex", "sam", "riley", "jordan"])
        self.assertTrue(all(p["icon"] and p["color"].startswith("#") for p in house["people"]))
        self.assertEqual(house["schedules"], [])

    def test_people_add_edit_remove_restore(self):
        status, house = self.call("/api/people", {"name": "  Willow  ", "color": "#123ABC", "icon": "🦔"})
        self.assertEqual(status, 200)
        willow = house["people"][-1]
        self.assertEqual((willow["name"], willow["color"], willow["icon"]), ("Willow", "#123abc", "🦔"))
        status, house = self.call(f"/api/people/{willow['id']}", {"name": "Willow B", "icon": "🦉"})
        self.assertEqual(house["people"][-1]["name"], "Willow B")
        # New people can claim right away; removed ones cannot, but their history stays.
        self.assertEqual(self.op(op="claim", slotId="trash#0", participantId=willow["id"])[0], 200)
        self.call(f"/api/people/{willow['id']}", {"archived": True})
        self.assertEqual(self.op(op="claim", slotId="feed-pets#0", participantId=willow["id"])[0], 400)
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"]["trash#0"], willow["id"])
        status, house = self.call(f"/api/people/{willow['id']}", {"archived": False})
        self.assertFalse(house["people"][-1]["archived"])

    def test_people_validation(self):
        for bad in ({"name": "", "color": "#123456", "icon": "🦔"},
                    {"name": "x" * 31, "color": "#123456", "icon": "🦔"},
                    {"name": "Ok", "color": "red", "icon": "🦔"},
                    {"name": "Ok", "color": "#123456", "icon": "<script>"}):
            self.assertEqual(self.call("/api/people", bad)[0], 400, bad)
        self.assertEqual(self.call("/api/people/nobody", {"name": "X"})[0], 404)

    def test_daily_goal(self):
        house = self.call("/api/household")[1]
        self.assertTrue(all(p["goal"] == 5 for p in house["people"]))
        self.assertEqual(self.call("/api/people/jordan", {"goal": 3})[1]["people"][3]["goal"], 3)
        for bad in (0, 21, 2.5, "4", True):
            self.assertEqual(self.call("/api/people/jordan", {"goal": bad})[0], 400, bad)
        added = self.call("/api/people", {"name": "Willow", "color": "#123456", "icon": "🦔"})[1]["people"][-1]
        self.assertEqual(added["goal"], 5)
        added = self.call("/api/people", {"name": "Ash", "color": "#123456", "icon": "🦔", "goal": 8})[1]["people"][-1]
        self.assertEqual(added["goal"], 8)

    def test_weekly_target_and_reward(self):
        jordan = self.call("/api/household")[1]["people"][3]
        self.assertEqual((jordan["weeklyTarget"], jordan["reward"]), (None, None))
        house = self.call("/api/people/jordan", {"weeklyTarget": 14, "reward": "  Pick   Friday's movie "})[1]
        self.assertEqual((house["people"][3]["weeklyTarget"], house["people"][3]["reward"]), (14, "Pick Friday's movie"))
        house = self.call("/api/people/jordan", {"weeklyTarget": None, "reward": ""})[1]
        self.assertEqual((house["people"][3]["weeklyTarget"], house["people"][3]["reward"]), (None, None))
        for bad in ({"weeklyTarget": 0}, {"weeklyTarget": 1001}, {"weeklyTarget": "ten"}, {"reward": "x" * 61}):
            self.assertEqual(self.call("/api/people/jordan", bad)[0], 400, bad)

    def test_nine_week_range_allowed(self):
        self.assertEqual(self.call("/api/days?from=2026-08-09&to=2026-10-10")[0], 200)
        self.assertEqual(self.call("/api/days?from=2026-07-01&to=2026-10-10")[0], 400)

    def test_household_without_goals_loads_with_default(self):
        path = Path(self.tmp.name) / "household.json"
        path.write_text(json.dumps({"people": [{"id": "x", "name": "X", "color": "#123456", "icon": "🦔"}], "schedules": []}))
        self.assertEqual(server.Store(self.tmp.name).household()["people"][0]["goal"], 5)

    def test_everyday_chores_seeded_and_migrated(self):
        chores = self.call("/api/household")[1]["chores"]
        self.assertEqual(len(chores), 24)
        self.assertEqual(chores[0], {"id": "laundry-wash", "name": "Laundry - wash & dry", "icon": None,
                                     "points": 2, "slotsPerDay": 1, "room": "laundry", "archived": False})
        # A household saved before the chore editor picks up the config list, ids unchanged.
        path = Path(self.tmp.name) / "household.json"
        house = json.loads(path.read_text())
        del house["chores"]
        path.write_text(json.dumps(house))
        self.assertEqual(server.Store(self.tmp.name).household()["chores"][0]["id"], "laundry-wash")

    def test_rooms_seeded_and_migrated(self):
        house = self.call("/api/household")[1]
        self.assertEqual([r["id"] for r in house["rooms"]], ["kitchen", "living", "bathroom", "bedrooms", "laundry", "outdoors", "house"])
        self.assertEqual(next(c for c in house["chores"] if c["id"] == "wash-dishes")["room"], "kitchen")
        # A household saved before rooms: default rooms appear, starter chores land in their room,
        # chores added by the household have no room, and nothing else changes.
        self.call("/api/chores", {"name": "Walk the dog", "points": 1})
        path = Path(self.tmp.name) / "household.json"
        old = json.loads(path.read_text())
        del old["rooms"]
        for c in old["chores"]:
            c.pop("room", None)
        old["chores"][0]["name"] = "Washing"
        path.write_text(json.dumps(old))
        house = server.Store(self.tmp.name).household()
        self.assertEqual(len(house["rooms"]), 7)
        rooms = {c["id"]: c["room"] for c in house["chores"]}
        self.assertEqual((rooms["laundry-wash"], rooms["trash"]), ("laundry", "house"))
        self.assertIsNone(house["chores"][-1]["room"])
        self.assertEqual(house["chores"][0]["name"], "Washing")

    def test_room_guesses_for_household_chores_on_migration(self):
        self.call("/api/chores", {"name": "Wipe down oven", "points": 1})
        self.call("/api/chores", {"name": "Spiritual cleanse", "points": 1})
        self.call("/api/schedules", {"name": "Sweep front porch", "icon": "🧹", "points": 1, "assignee": None,
                                     "rule": {"type": "weekly", "every": 1, "weekdays": [6], "start": "2026-10-01"}})
        path = Path(self.tmp.name) / "household.json"
        old = json.loads(path.read_text())
        del old["rooms"]
        for item in old["chores"] + old["schedules"]:
            item.pop("room", None)
        path.write_text(json.dumps(old))
        house = server.Store(self.tmp.name).household()
        self.assertEqual([c["room"] for c in house["chores"][-2:]], ["kitchen", None])
        self.assertEqual(house["schedules"][0]["room"], "outdoors")
        # Guessing only happens once: a chore moved to no room stays there.
        self.assertEqual(server.guess_room("Vacuum Jamie’s Room", {"bedrooms", "house"}), "bedrooms")
        self.assertEqual(server.guess_room("Vacuum the living room", {"living", "house"}), "living")

    def test_rooms_add_edit_order_remove(self):
        house = self.call("/api/rooms", {"name": "Garage", "icon": "🚗"})[1]
        garage = house["rooms"][-1]
        self.assertEqual((garage["name"], garage["icon"]), ("Garage", "🚗"))
        self.assertEqual(self.call(f"/api/rooms/{garage['id']}", {"name": "Garage & shed"})[1]["rooms"][-1]["name"], "Garage & shed")
        chore = self.call("/api/chores", {"name": "Sweep garage", "points": 1, "room": garage["id"]})[1]["chores"][-1]
        self.assertEqual(chore["room"], garage["id"])
        sched = self.call("/api/schedules", {"name": "Mow", "icon": "🌱", "points": 2, "assignee": None, "room": "outdoors",
                                             "rule": {"type": "weekly", "every": 1, "weekdays": [6], "start": "2026-10-01"}})[1]["schedules"][-1]
        self.assertEqual(sched["room"], "outdoors")
        ids = [r["id"] for r in self.call("/api/household")[1]["rooms"]]
        self.assertEqual([r["id"] for r in self.call("/api/room-order", {"ids": ids[::-1]})[1]["rooms"]], ids[::-1])
        self.assertEqual(self.call("/api/room-order", {"ids": ids[1:]})[0], 400)
        # Removing a room leaves its chores in place, with no room.
        house = self.call(f"/api/rooms/{garage['id']}", {"remove": True})[1]
        self.assertNotIn(garage["id"], [r["id"] for r in house["rooms"]])
        self.assertIsNone(next(c for c in house["chores"] if c["id"] == chore["id"])["room"])
        house = self.call("/api/rooms/outdoors", {"remove": True})[1]
        self.assertIsNone(next(x for x in house["schedules"] if x["id"] == sched["id"])["room"])

    def test_room_validation(self):
        for bad in ({"name": "", "icon": "🚗"}, {"name": "x" * 31, "icon": "🚗"}, {"name": "Den", "icon": "<i>"}):
            self.assertEqual(self.call("/api/rooms", bad)[0], 400, bad)
        self.assertEqual(self.call("/api/rooms/nope", {"name": "X"})[0], 404)
        self.assertEqual(self.call("/api/chores", {"name": "X", "points": 1, "room": "attic"})[0], 400)
        house = self.call("/api/chores/trash", {"room": None})[1]
        self.assertIsNone(next(c for c in house["chores"] if c["id"] == "trash")["room"])

    def test_everyday_chores_add_edit_remove(self):
        house = self.call("/api/chores", {"name": "Walk the dog", "icon": "🐾", "points": 2, "slotsPerDay": 2})[1]
        dog = house["chores"][-1]
        self.assertEqual((dog["name"], dog["icon"], dog["points"], dog["slotsPerDay"]), ("Walk the dog", "🐾", 2, 2))
        self.assertEqual(self.op(op="claim", slotId=f"{dog['id']}#1", participantId="sam")[0], 200)
        self.call(f"/api/chores/{dog['id']}", {"slotsPerDay": 1, "icon": None})
        self.assertEqual(self.op(op="claim", slotId=f"{dog['id']}#1", participantId="alex")[0], 400)  # slot gone
        # The earlier claim on the removed slot stays recorded (so its points count) and can still be released.
        self.assertEqual(self.call(f"/api/day/{DAY}")[1]["claimed"][f"{dog['id']}#1"], "sam")
        self.assertEqual(self.op(op="release", slotId=f"{dog['id']}#1")[0], 200)
        self.call("/api/chores/trash", {"archived": True})
        self.assertEqual(self.op(op="claim", slotId="trash#0", participantId="alex")[0], 400)
        self.assertTrue(next(c for c in self.call("/api/household")[1]["chores"] if c["id"] == "trash")["archived"])
        self.call("/api/chores/trash", {"archived": False})
        self.assertEqual(self.op(op="claim", slotId="trash#0", participantId="alex")[0], 200)

    def test_everyday_chore_validation_and_order(self):
        for bad in ({"name": "", "points": 1}, {"name": "x", "points": 0}, {"name": "x", "points": 11},
                    {"name": "x", "points": 1, "slotsPerDay": 5}, {"name": "x", "points": 1, "icon": "<b>"}):
            self.assertEqual(self.call("/api/chores", bad)[0], 400, bad)
        self.assertEqual(self.call("/api/chores/nope", {"points": 2})[0], 404)
        ids = [c["id"] for c in self.call("/api/household")[1]["chores"]]
        status, house = self.call("/api/chore-order", {"ids": ids[::-1]})
        self.assertEqual([c["id"] for c in house["chores"]], ids[::-1])
        self.assertEqual(self.call("/api/chore-order", {"ids": ids[:-1]})[0], 400)

    def test_last_person_cannot_be_removed(self):
        for pid in ("alex", "sam", "riley"):
            self.assertEqual(self.call(f"/api/people/{pid}", {"archived": True})[0], 200)
        self.assertEqual(self.call("/api/people/jordan", {"archived": True})[0], 400)

    def test_schedules_can_be_claimed_and_removed(self):
        rule = {"type": "weekly", "every": 1, "weekdays": [2], "start": "2026-10-01"}
        status, house = self.call("/api/schedules", {"name": "Trash day", "icon": "🗑️", "points": 2, "assignee": "sam", "rule": rule})
        self.assertEqual(status, 200)
        sid = house["schedules"][0]["id"]
        self.assertEqual(self.op(op="claim", slotId=f"sched:{sid}#0", participantId="alex")[0], 200)
        self.call(f"/api/schedules/{sid}", {"archived": True})
        self.op(op="release", slotId=f"sched:{sid}#0")
        self.assertEqual(self.op(op="claim", slotId=f"sched:{sid}#0", participantId="alex")[0], 400)
        # Removing the assignee frees the chore for anyone.
        self.call("/api/schedules", {"name": "Mow", "icon": "🌱", "points": 3, "assignee": "sam",
                                     "rule": {"type": "monthly-nth", "every": 1, "nth": 2, "weekday": 5, "start": "2026-10-01"}})
        house = self.call("/api/people/sam", {"archived": True})[1]
        self.assertIsNone(house["schedules"][1]["assignee"])

    def test_schedule_validation(self):
        good = {"name": "Mow", "icon": "🌱", "points": 3, "assignee": None,
                "rule": {"type": "weekly", "every": 2, "weekdays": [5], "start": "2026-10-09"}}
        self.assertEqual(self.call("/api/schedules", good)[0], 200)
        for change in ({"points": 0}, {"points": 11}, {"icon": "x"}, {"assignee": "nobody"},
                       {"rule": {**good["rule"], "weekdays": []}},
                       {"rule": {**good["rule"], "every": 9}},
                       {"rule": {**good["rule"], "start": "soon"}},
                       {"rule": {"type": "monthly-nth", "every": 1, "nth": 5, "weekday": 5, "start": "2026-10-01"}},
                       {"rule": {"type": "yearly", "start": "2026-10-01"}}):
            self.assertEqual(self.call("/api/schedules", {**good, **change})[0], 400, change)

    def test_yearly_and_interval_rules_and_last_done(self):
        yearly = {"name": "Test smoke alarms", "icon": "🧯", "points": 2, "assignee": None, "carryOver": True,
                  "rule": {"type": "yearly", "month": 3, "day": 15, "start": "2026-01-01"}}
        filt = {"name": "Furnace filter", "icon": "🔧", "points": 3, "assignee": None, "carryOver": True,
                "rule": {"type": "interval", "days": 90, "fromLastDone": True, "start": "2026-10-01"}}
        self.assertEqual(self.call("/api/schedules", yearly)[0], 200)
        house = self.call("/api/schedules", filt)[1]
        sid = house["schedules"][-1]["id"]
        self.assertEqual(house["schedules"][-1]["rule"], filt["rule"])
        self.assertTrue(house["schedules"][-1]["carryOver"])
        self.assertEqual(house["lastDone"], {})
        self.call("/api/day/2026-10-03", {"op": "claim", "slotId": f"sched:{sid}#0", "participantId": "alex"})
        self.call("/api/day/2026-10-01", {"op": "claim", "slotId": f"sched:{sid}#0", "participantId": "sam"})
        self.assertEqual(self.call("/api/household")[1]["lastDone"], {sid: "2026-10-03"})
        for bad in ({"type": "yearly", "month": 13, "day": 1}, {"type": "yearly", "month": 2, "day": 0},
                    {"type": "interval", "days": 1}, {"type": "interval", "days": 731}):
            body = {**filt, "rule": {**bad, "start": "2026-10-01"}}
            self.assertEqual(self.call("/api/schedules", body)[0], 400, bad)

    def test_old_schedules_load_without_carry_over(self):
        self.call("/api/schedules", {"name": "Trash", "icon": "🗑️", "points": 1, "assignee": None,
                                     "rule": {"type": "weekly", "every": 1, "weekdays": [2], "start": "2026-10-01"}})
        path = Path(self.tmp.name) / "household.json"
        house = json.loads(path.read_text())
        del house["schedules"][0]["carryOver"]
        path.write_text(json.dumps(house))
        self.assertFalse(server.Store(self.tmp.name).household()["schedules"][0]["carryOver"])

    def test_household_survives_restart_and_backup(self):
        self.call("/api/people", {"name": "Willow", "color": "#123456", "icon": "🦔"})
        self.assertEqual(server.Store(self.tmp.name).household()["people"][-1]["name"], "Willow")
        backup = self.call("/api/export")[1]
        self.call("/api/people/alex", {"name": "Changed"})
        self.call("/api/import", backup)
        self.assertEqual(self.call("/api/household")[1]["people"][0]["name"], "Alex")

    def test_old_days_are_pruned(self):
        store = server.Handler.store
        store.days = {f"2020-01-{d:02d}": {"claimed": {}, "log": []} for d in range(1, 29)}
        old_keep, server.KEEP_DAYS = server.KEEP_DAYS, 10
        try:
            self.op(op="claim", slotId="trash#0", participantId="alex")
        finally:
            server.KEEP_DAYS = old_keep
        self.assertEqual(len(store.days), 10)
        self.assertIn(DAY, store.days)

    def test_title_from_environment_is_escaped(self):
        with mock.patch.dict(os.environ, {"CHORE_TITLE": "The <Smith> House"}):
            with urllib.request.urlopen(self.base + "/") as r:
                page = r.read()
        self.assertIn(b"<h1>The &lt;Smith&gt; House</h1>", page)
        self.assertNotIn(b"{{title}}", page)

    def test_config_dir_overrides_bundled_files(self):
        with tempfile.TemporaryDirectory() as cfg:
            Path(cfg, "chores.json").write_text(json.dumps({"chores": [
                {"id": "walk-dog", "name": "Walk the dog", "points": 2, "slotsPerDay": 1}]}))
            with mock.patch.dict(os.environ, {"CHORE_CONFIG_DIR": cfg}):
                with urllib.request.urlopen(self.base + "/config/chores.json") as r:
                    self.assertEqual(json.loads(r.read())["chores"][0]["id"], "walk-dog")
                # icons.json is not in the override folder, so the bundled one is served.
                with urllib.request.urlopen(self.base + "/config/icons.json") as r:
                    self.assertIn("groups", json.loads(r.read()))
                # chores.json seeds a brand-new household only.
                with tempfile.TemporaryDirectory() as fresh:
                    server.Handler.store = server.Store(fresh)
                    self.assertEqual([c["id"] for c in self.call("/api/household")[1]["chores"]], ["walk-dog"])
                    self.assertEqual(self.op(op="claim", slotId="walk-dog#0", participantId="alex")[0], 200)
                    self.assertEqual(self.op(op="claim", slotId="trash#0", participantId="alex")[0], 400)

    def test_https_origin_and_trusted_origins_may_write(self):
        host = f"127.0.0.1:{self.srv.server_port}"
        undo = json.dumps({"op": "clear"}).encode()
        headers = {"Content-Type": "application/json"}
        self.assertEqual(self.post_raw(f"/api/day/{DAY}", undo, {**headers, "Origin": f"https://{host}"}), 200)
        self.assertEqual(self.post_raw(f"/api/day/{DAY}", undo, {**headers, "Origin": "https://chores.example.com"}), 403)
        with mock.patch.dict(os.environ, {"CHORE_TRUSTED_ORIGINS": "https://chores.example.com/, http://other"}):
            self.assertEqual(self.post_raw(f"/api/day/{DAY}", undo, {**headers, "Origin": "https://chores.example.com"}), 200)

    def test_only_app_files_are_served(self):
        with urllib.request.urlopen(self.base + "/") as r:
            self.assertIn(b"<title>Chore Chart</title>", r.read())
            self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])
        for path in ("/server.py", "/.git/config", "/data/days.json", "/js/../server.py", "/tests/test_server.py"):
            with self.assertRaises(urllib.error.HTTPError, msg=path) as cm:
                urllib.request.urlopen(self.base + path)
            self.assertEqual(cm.exception.code, 404)


if __name__ == "__main__":
    unittest.main()
