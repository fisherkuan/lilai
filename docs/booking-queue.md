## Booking Queue

**Organisers only (since 2026-10-25; open to anyone with the address before).** `/admin/bookings`, `/admin/bookings/:id`, every `/api/bookings*`, `/api/booking-profiles*`, `/api/booking-series*` route and the `booking_update` broadcast take an admin, an address on the organisers list (`server/organizers.js`, edited on `/admin/organisers`) signed in on `/me`, or `X-Admin-Key` (`bookingAccess`, `requireOrganizer`, `requireOrganizerPage` in `app.js`). A signed-out page goes to `/me?next=`; a signed-in address not on the list gets `not-organiser.html` (403). A WebSocket is checked once, when it connects. `js/admin-nav.js` sends a booking request answered 401 to sign-in and 403 to that page.

Queues KU Leuven sports-facility requests and submits them when the booking window
opens — midnight Brussels, 14 days before the play date.

- `server/booking-time.js` — Brussels wall-clock arithmetic; rejects ambiguous and nonexistent local times rather than guessing
- `server/booking-form.js` — the Plone EasyForm client (parse, build, encode, classify)
- `server/booking-scheduler.js` — the 15s tick. Claims a row (`UPDATE … WHERE status='queued'`) *before* the POST, so a request is never sent twice. A POST whose outcome cannot be read becomes `unconfirmed` and is never retried automatically
- `server/booking-quota.js` — two slots per name per Mon–Sun week, enforced under a Postgres advisory lock. `reportFailure` turns a sent request into `failed` and stamps `failure_reported_at`, which releases its slot
- `server/booking-profiles.js` — the address book, plus the `profile_id` link and its backfill from the existing queue
- `server/booking-repeat.js` — expands a repeat rule (every N days / weeks on chosen weekdays / months) into play dates; capped at 52, bounded by the season. A month without the anchor date is skipped, never slid
- `server/booking-series.js` — the recurring schedule as a record you can act on. A label on rows, never their owner; the only way to stop one is `cancel-remaining`, and it stays listed afterwards as the record of what it booked. Editing one re-expands the rule and reconciles the queue against it — see `PUT /api/booking-series/:id`. A schedule's own still-queued occurrences are excluded from the quota while it is being rebuilt (`countHeld`/`quotaFor` take `excludeSeries`), or it would block its own edit
- `config/app.json` → `booking` — delay bounds, `lateSubmissionGraceSeconds`, `cancelUndoSeconds` (how long a cancelled row keeps its Undo before leaving the board — nothing is deleted) and `seasonEndsOn` (the last bookable play date; renew it each September)

Start times are :00 or :30 only. Courts are handed out on the hour and half hour, so
`assertHalfHour` in `booking-validation.js` refuses anything else — the picker offers only
those, and the rule is enforced server-side because the import path arrives the same way.

**Submission is off unless `BOOKING_SUBMIT=live` is set.** Without it the scheduler runs
the whole path and stops short of the POST, and the row lands as `not_sent` — its own
terminal status, never `unconfirmed`, so a board that says "Request sent" always means one
was. `not_sent` costs the week no quota, because no request exists to hold a court. `server/../.plans/` holds the design notes.

Recovery is stateless: an entry stays due from its opening until grace after the later of
its opening and `send_after`, so any process alive inside that window picks it up through
the ordinary check. There is no
catch-up path. `lateSubmissionGraceSeconds` is 43200 — twelve hours, matching the Python
reference's live config — so a process that was not running at midnight still sends when
it next comes up. A late request will usually get a worse court than a punctual one, but
it is not nothing.

A slot whose window has already opened can still be queued, any time before it is played
(the picker offers dates from today). Its `send_after` is the moment it was queued, so its
grace counts from then, and the route calls `scheduler.nudge()` after the commit: the
request goes out within a second instead of at the next 15s tick. Pacing and the claim
still apply.

The board's midnight banner is deliberately **not** driven by this number: it uses its own
five-minute `LIVE_WINDOW_MS`, because a countdown clock running all morning would misstate
what is happening. A slot that goes out late still lifts out of the timeline and lands with
a fade; it just carries a "catching up" label instead of a countdown.

`~/code/sports-booking-bot` is the verified Python reference for the form protocol. It is
a specification, never called at runtime.

