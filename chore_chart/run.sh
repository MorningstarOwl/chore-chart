#!/bin/sh
# Start the chore chart with the add-on's options. Everything lives in /data, so it is in
# Home Assistant's backups; TZ comes from Home Assistant.
set -e
CHORE_TITLE="$(python -c 'import json; print(json.load(open("/data/options.json")).get("title") or "Chore Chart")' 2>/dev/null || echo "Chore Chart")"
export CHORE_TITLE
echo "Chore Chart: title \"$CHORE_TITLE\", time zone ${TZ:-UTC}"
exec python /app/server.py --bind 0.0.0.0 --port 8420 --data /data
