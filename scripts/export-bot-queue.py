#!/usr/bin/env python3
"""
Dump every booking the sports-booking-bot has planned, as JSON for the lilai importer.

The bot keeps no list of its bookings: they are expanded from the weekly schedules in
config.json on every run. This calls the bot's own expander so the export cannot drift
from what the bot would actually do, and joins it to the ledger so the delays it already
sampled and the attempts it already made come across unchanged.

Usage: python3 scripts/export-bot-queue.py [bot-dir] > bot-queue.json
"""
import json
import sqlite3
import sys
from pathlib import Path

BOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path.home() / "code/sports-booking-bot")
sys.path.insert(0, str(BOT))
import booking_bot as bot  # noqa: E402

config = json.loads((BOT / "config.json").read_text())
contact = config["contact"]

db = sqlite3.connect(BOT / "state/bookings.sqlite3")
delays = dict(db.execute("SELECT id, seconds FROM delays"))
attempts = {row[0]: row for row in db.execute("SELECT id, status, updated, detail FROM attempts")}

# The bot's own statuses, mapped onto the queue's. `request-received` is the receipt the
# thank-you page represents: the request reached KU Leuven, the answer comes by email.
STATUS = {
    "request-received": "sent",
    "uncertain": "unconfirmed",
    "failed": "failed",
    "missed": "missed",
}

rows = []
for cfg, booking in bot.configured_jobs(config, live=False):
    key = bot.booking_key(cfg, booking)
    request = cfg["request"]
    opens = bot.opens_at(booking.primary)

    row = {
        "id": key,
        "sport": request["sport"],
        "playDate": booking.primary.date().isoformat(),
        # The queue takes a calendar day plus two wall-clock times, not two instants;
        # it does the Brussels arithmetic itself.
        "startPreferred": booking.primary.strftime("%H:%M"),
        "startAlternative": (booking.alternative or booking.primary).strftime("%H:%M"),
        "durationHours": request["duration_hours"],
        "players": request["players"],
        "indoorOutdoor": request["indoor_outdoor"],
        "facility": request.get("facility") or "",
        "otherFacility": request.get("other_facility") or "",
        "language": contact["language"],
        "validSportsCard": bool(contact["valid_sports_card"]),
        "name": contact["name"],
        "email": contact["email"],
        "phone": contact["phone"],
        "remarks": request.get("remarks") or "",
        "opensAt": opens.isoformat(),
        # The delay the bot already rolled for this booking. Carrying it over keeps the
        # order requests go out in identical to what was planned.
        "sendAfterSeconds": delays.get(key, 0),
        "hasAlternative": booking.alternative is not None,
        "scheduleName": cfg.get("name", ""),
    }

    attempt = attempts.get(key)
    if attempt:
        _, status, updated, detail = attempt
        row["status"] = STATUS.get(status, "unconfirmed")
        row["submittedAt"] = updated
        row["responseNote"] = detail
        row["botStatus"] = status
    else:
        row["status"] = "queued"

    rows.append(row)

rows.sort(key=lambda r: (r["playDate"], r["startPreferred"]))
json.dump({"source": str(BOT), "count": len(rows), "bookings": rows}, sys.stdout, indent=1)
