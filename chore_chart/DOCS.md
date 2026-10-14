# Chore Chart

A shared chore calendar for the household. Open it from **Chores** in the sidebar, or on
any phone or tablet on your network at `http://<your-home-assistant>:8420/`, and tap your
picture when you've done a chore.

## First steps

1. Start the add-on and turn on **Show in sidebar**.
2. Open **Chores** in the sidebar.
3. **People**: rename the four sample people, pick colours and critters, and set each
   person's daily goal and weekly reward. Add or remove people.
4. **Rooms**: the day's chores are grouped by room. Add, rename, reorder or remove rooms.
5. **Chores**: trim the starter list of everyday chores, give each a room, and add the ones
   that happen on particular days (bin night every Tuesday, the furnace filter every 90 days,
   the smoke alarms once a year).
6. Bookmark `http://<your-home-assistant>:8420/` (or "Add to Home Screen") on everyone's
   phone and on a kitchen tablet.

## Options

| Option | What it does |
| --- | --- |
| `title` | The name at the top of the page, e.g. "The Smith House Chores". |

The time zone is Home Assistant's own (Settings → System → General), so days roll over at
your midnight.

## Network access

Port **8420** is open on your network so phones and a kitchen tablet can use the chart
without a Home Assistant login. Anyone on your Wi-Fi can then log chores and edit people
and chores. That is intended for a home network. To allow only signed-in Home Assistant
users, clear the port under **Network** in the add-on's Configuration tab; the sidebar
panel keeps working.

Don't forward port 8420 through your router.

## Your data

Everything is stored in the add-on's own folder and included in Home Assistant backups.
The page also has a **Download a backup** link at the bottom, and a backup can be restored
with:

```
curl -X POST -H "Content-Type: application/json" --data-binary @backup.json http://<your-home-assistant>:8420/api/import
```

That is also how to move a chart from the standalone Docker image into the add-on: download
a backup from the old one, then post it to the add-on.

## More

Full feature list and the standalone Docker version: https://github.com/MorningstarOwl/chore-chart
