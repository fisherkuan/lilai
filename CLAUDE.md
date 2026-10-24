# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning Documents

When creating implementation plans, improvement analyses, or deployment guides:
- Store all planning documents in `.plans/` directory (git-ignored)
- Use descriptive filenames: `FEATURE_NAME_plan.md`, `IMPROVEMENT_analysis.md`, etc.
- Reference this directory when looking for existing plans or creating new ones

## Visual design: Shape Calendar

The old design system (`design-mockup.html`, `public/styles.css`) and a ligne claire comic attempt were both retired on 2026-09-27. The current world is Bauhaus form-colour grammar: each enabled calendar owns one primary shape in config order (blue circle, red square, yellow triangle), primaries appear only inside shapes, and text, rules and buttons stay black on white. `DESIGN.md` (repo root) is the visual authority; `PRODUCT.md` holds product truth. Copy rule: the design explains itself; a hint line only for a caveat or something not obvious (DESIGN.md, Do's). Every page loads `public/bauhaus/tokens.css` first, then `public/css/lilai.css` (lilai's additions and shared components), then its own page stylesheet in `public/css/` (`faq.css`, `donate.css`, `admin.css` for all admin pages, `booking.css`, `events.css` for Make an event and the host page). `tokens.css` is a verbatim copy of the owner's Bauhaus kit (`~/code/bauhaus`, commit in `public/bauhaus/KIT_COMMIT`): it owns the palette, both themes, strokes, radii and Jost (`public/bauhaus/fonts/`). Never edit it here; change the kit, copy the file over and bump `KIT_COMMIT`. Lilai keeps two deliberate deviations from the kit: primaries only inside calendar shapes (no red buttons or error marks), and the system sans for everything except page titles and big numerals (dates, the balance, the clock), which keep Jost. Dark mode follows the device setting, and the footer switch (`js/theme.js`) can force Light or Dark per device. Lilai's own dark additions (`--ink-3`, `--past`, `--scrim`) live twice in `lilai.css` (the `prefers-color-scheme` block and `:root[data-theme="dark"]`); keep both in sync. Colours belong in tokens, so a new hard-coded colour needs a copy in both dark blocks. The legacy `styles.css` is deleted. The date rail (replaced the 14-day band on 2026-10-22, which had replaced the Google Calendar iframe and the month grid) is the only calendar view; do not bring the others back. The events-list filter must not affect the rail — it reads its own `allCalendarEvents` source (`/api/events?from=&to=`, the rail's 14 days only). The rail's green (`--rail-sel`, `--rail-accent`) is the owner's choice and the one colour outside a shape besides links and focus.

## Development Commands

### Running the Application
```bash
npm install                 # Install dependencies
npm start                   # Start production server (node server/app.js)
npm run dev                 # Start development server with auto-reload (nodemon)
```

The server runs on `http://localhost:3000` by default (configurable via PORT env var).

### Database
- PostgreSQL is used for production (connection via `DATABASE_URL` env var)
- Database schema is auto-initialized on server startup via `initializeDatabase()` in server/app.js
- Tables: `events`, `rsvps`, `event_series`, `event_host_links`, `event_activity`, `calendar_keys`, `calendar_state`, `donations`, `feedback`, `booking_queue`, `booking_profiles`, `booking_series`
- `rsvps.attendance` is `yes` (holds a seat), `pending` (asked to join an approval event) or `declined` (the host said no). Every count of who is coming filters on `yes`
- Schema migrations are idempotent and run automatically on startup

### Testing
```bash
npm test                    # node --test, unit tests only (DB-backed tests skip)
npm run test:db             # also runs the DB-backed tests
```
`test:db` needs a scratch Postgres database and refuses to run unless the database
name contains `test`, `scratch` or `local` — the suite truncates tables. Override the
target with `TEST_DATABASE_URL`; it defaults to `postgresql://localhost/lilai_booking_test`.
Files run with `--test-concurrency=1` because several truncate the same tables.

## Architecture Overview

### Application Flow
An event and RSVP app whose events live in its own database and are published to public Google calendars, plus bank-transfer donations and the booking queue.

**Who owns what (since 2026-10-24).** Lilai's database is the source of truth for every event. Each calendar in `config/app.json` is a **published** Google calendar: Lilai writes it through the API and nobody edits it in Google; people subscribe to it from their own calendar apps. There is no two-way sync and nothing is read back from Google once Lilai has taken a calendar over. Design notes: `.plans/LILAI_OWNS_EVENTS_plan.md`.

**Core data flow:**
1. Events are made, edited and cancelled in Lilai (Home's "Make an event" sheet, the event's management page). Each change bumps the row's `version`
2. The publisher (`server/calendar-publish.js`) copies every changed event to its Google calendar, retrying with backoff; the management page shows where the copy stands
3. People RSVP in Lilai; WebSocket broadcasts attendance and event changes to every open page
4. Once per calendar, with Google credentials, the import (`server/calendar-import.js`) takes the calendar over from Google onto the rows the old feed had made. Until then the legacy iCal feed still reads that calendar (never touching a Lilai-owned row)

### Server Architecture (server/app.js)
Express server in one file (~2,800 lines), with domain modules beside it in `server/`. It handles:
- **WebSocket Server**: Real-time attendance updates via `broadcast()` function
- **Events**: make, edit, cancel and restore (management links, calendar keys), published to Google by `server/calendar-publish.js`; the legacy iCal feed (`fetchCalendarEvents()`) only for calendars not yet imported
- **RSVP System**: Add/remove attendance with capacity limits
- **Donation System**: Tracks donations entered by hand; the Donate page shows bank details (`server/donation-bank.js`)
- **Database**: PostgreSQL via `pg` Pool with auto-schema initialization

**Key patterns:**
- An event's `source` is its Google calendar id; `managed = true` means Lilai owns the row (every event once its calendar is imported, and every event made in Lilai)
- Lilai owns everything about an event: title, time, place, description, `attendance_limit`, `links` (JSONB `[{url, label?}]`), approval, host. Nothing is read out of a description
- WebSocket broadcasts attendance and event changes to all clients for real-time updates
- Bank details for donations come from env vars, never `config/app.json` (the repo is public)

### Frontend Architecture (public/)
Vanilla JavaScript with no build step.

**Structure:**
- `index.html` + `app.js` - Main event listing and RSVP interface
- `admin-donations.html` + `js/admin-donations.js` - Donation management
- `donations.html` + `js/donation.js` - Public donation submission page
- `faq.html` + `js/faq.js` - FAQ page
- `bauhaus/tokens.css` - The Bauhaus kit's tokens, copied verbatim (do not edit)
- `css/lilai.css` - Lilai's token additions, shared components and Home (Shape Calendar world, see `DESIGN.md`)
- `css/faq.css`, `css/donate.css`, `css/admin.css`, `css/booking.css`, `css/events.css` - Page stylesheets, loaded after `lilai.css` (`events.css`: the management and calendar pages; the event form itself is shared and lives in `lilai.css`)
- `js/feedback.js` - Footer "Send feedback" button and sheet, on every page with a `.colophon` (ported from splitly)
- `js/sheet.js` - Shared behaviour for every sheet (`.modal`, `.bs-root`), on every page with feedback: locks the page scroll while one is open, keeps the sheet above the iOS keyboard (`--vv-top`/`--vv-h` from `visualViewport`), and makes the grabber work on phones (drag up for full screen, down to go back or dismiss, tap to toggle; `settle` tested in `tests/sheet.test.js`). Sheets do not touch `body.style.overflow` themselves
- `js/make-event.js` - Home's "Make an event" slide-in (`#event-sheet`), opened by any `[data-make-event]` button (the "+" by the view switch, the sidebar button) and by `/#new` or `/#new=<calendar>`. `/events/new` redirects there. After making, it shows the management link with Copy and Share. It also renders "You manage" in Home's hosting card (`renderHosted`, called again by `app.js` once events load, for the time and who is coming); a management link entry stores `eventId` and `calendar` for that
- `js/lost-link.js` - Home's "Lost a management link?" sheet (sidebar button, `/#lost-link`, linked from the FAQ): where the link may still be, then "Ask the admins" (event, host name, email) sent through `/api/feedback` with `page: lost-link`. An admin checks the host and replies with a new link minted by a calendar key's Manage
- `js/event-form.js` - `EventForm.create(container, { mode })`: the one form for making (`create`: calendar, repeat, host) and editing (`edit`) an event. Repeat preview from `/api/events/repeat-preview`. Where is required and searches the owner's places (`/api/places`, ranked by `js/place-search.js`)
- `js/place-search.js` - `PlaceSearch.rank(places, query)`: the owner's places, closest match first (exact, start, word start, inside, every word, then aliases and addresses; letters-in-order guesses only when nothing else matches). Ignores case, accents and spaces. Tested in `tests/place-search.test.js`
- `js/event-links.js` - An event's links: `listHtml` draws them on cards and the RSVP sheet (name, else the site), `create` is the link editor inside the event form. Tested in `tests/event-links.test.js`
- `js/device-links.js` - What this device holds: management links (`lilai.hostedEvents`, listed as "You manage" in Home's sidebar) and calendar keys (`lilai.calendarKeys`), plus `share()` (Web Share, else the clipboard)
- `host.html` + `js/host.js` - An event's management page (`/host/:token`): the Google copy's status, Edit (the event form in a sheet), Copy management link (the page address, cut off, with a copy icon), Cancel / Restore, the dates of a series, and who is coming or asked to join (Accept / Decline / Undo). Live over WebSocket
- `calendar.html` + `js/calendar-page.js` - A calendar key's page (`/calendars/:token`): stores the key on the device, lists the calendar's upcoming events with Manage (mints a management link), "Make a <calendar> event", Share
- `sw.js` - Service worker for PWA support. It never caches `/host/`, `/calendars/` or their APIs: those carry secret links

**Client-side features:**
- WebSocket connection for real-time attendance updates
- Event cards with RSVP buttons (add/remove attendance)
- **Date rail** rendered client-side from `/api/events?from=<ISO>&to=<ISO>` (the rail's 14 days; requested at boot alongside `/api/config`): today plus 13 days as day buttons, each marked with its events' title emoji or calendar shape (`titleEmoji`/`bandMark`), up to three, then "+N". The component is `public/js/date-rail.js` (`DateRail.create(container, { events, selected, onSelect, mark })`, pure helpers tested in `tests/date-rail.test.js`); `app.js` wires it (`renderRail`, `renderAgenda`, `loadAllCalendarEvents`). Today is selected by default. A Cards | Rows switch (`setHomeView`, kept in localStorage as `lilaiHomeView`) picks the view. In Cards view, clicking a day scrolls to its first card (`onSelect` reports `via: 'click'`; arrow keys never scroll), the agenda never shows, and a fixed back-to-top button (`#to-top-btn`) is always on screen. In Rows view the card list hides and the selected day's agenda rows carry a Join button that opens the RSVP sheet (`findEvent` looks up events outside the list too); tapping a row opens it to a "Show card" button (`showCard`) that switches to Cards and scrolls to that card.
- **Pull to refresh** (`public/js/pull-to-refresh.js`, `PullToRefresh.attach(onRefresh)`) on Home and Donate, ported from splitly. There are no Refresh buttons.
- Admin pages for donations and the booking queue (`/admin` opens the queue). There is no admin page for events: each event is managed on its own page

### Configuration (config/app.json)
Central configuration file with:
- `publicUrl` - Where links in emails and in the Google copies point (`https://lilai.fisherkuan.com`). `PUBLIC_URL` overrides it
- `calendars[]` - The published Google calendars, by embed URL, in shape order. `enabled`; `restricted: true` (TSA) means only holders of a calendar key may make events in it
- `events.autoFetch` - The legacy feed, for a calendar not yet imported. Harmless once every calendar is
- `events.defaultTimeRange` - Default filter ("future", "past", "all")
- `events.defaultCreateCalendar` - The calendar pre-selected in Make an event. Must match a `calendars[].name`
- `places[]` - The places an event can be at (`{name, address?, aliases?}`), kept by the owner for consistent names. An event's place must be one of them (an edit may keep an older place the event already had); the name is stored, and the Google copy gets "name, address". Edit the list here and restart; there is no admin page for it
- `rsvp` - RSVP behavior settings
- `joinGroupUrl` - Link to external group (displayed in UI)

## Key Implementation Details

### Events (Lilai owns them; Google calendars are published copies)
- `server/event-hosting.js` - `validateEvent` (one validator for `create` and `edit`; Brussels wall times; an end at or before the start is the next day; DST gaps refused; an edit may keep a start that has passed but not move one into the past), `googleEventResource` (the copy: description plus the links and a "Join, or see who is coming: <publicUrl>/#event-<id>" line, `source` back to Lilai), `convertLegacyDescription`, tokens, `publishState`, the schema
- Event ids are `cal-<google id>@google.com`, the shape the old feed used, so the import landed on the rows that held RSVPs. Lilai picks each new copy's Google id (`newGoogleEventId`, 32 hex) so a retried insert is refused with 409 instead of making a twin
- `server/calendar-publish.js` - Pushes rows with `managed AND version > synced_version`: insert (first copy; 409 → update), update (PUT; 404 → insert, which also brings back a copy deleted in Google), delete (cancelled; 404/410 = done). Success records the pushed version; failure stores `push_error`, `push_attempts` and `next_push_at` (30 s doubling to 6 h). 30 s tick plus `nudge()` after each change. Without credentials nothing is pushed and the management page says so
- `server/calendar-import.js` - Once per calendar (`calendar_state`): `events.list` (all pages, `singleEvents`, two years ahead), each Google event onto `cal-<iCalUID>` (a repeating event's instances by their own id) as `managed`; the old "limit: N" / "link: URL" description lines move into their fields once; upcoming events are published once so their copies match; unmanaged rows Google no longer lists are deleted. Retried every 10 minutes on failure
- `server/calendar-sync.js` + `fetchCalendarEvents` in `app.js` - The legacy iCal feed, only for calendars not yet imported, never touching a managed row. Remove once production has imported every calendar
- `server/google-calendar.js` - Service-account JWT sign-in and `insertEvent` / `updateEvent` / `deleteEvent` / `listEvents`, no SDK
- `server/calendar-access.js` + `scripts/calendar-link.js` - Calendar keys (`calendar_keys`, hash only). `heroku run -a lilai-eu node scripts/calendar-link.js TSA --label "TSA admins"` prints a `/calendars/<token>` link once; `--revoke` stops the earlier ones. A key lets a device make events in a restricted calendar and mint a management link for any event in that calendar
- Management links: `event_host_links` maps a token hash to one event or one series. Made when an event is made (emailed to the host when `hostEmail` and Resend are set) and when a calendar key holder opens Manage. No accounts, in line with the RSVP trust model; whoever has the link is a host
- Activity: `event_activity` (`server/event-activity.js`) logs what happened to each event: made, joined, asked, left, accepted, declined, removed, readded, reasked, edited (with the fields that changed), cancelled, restored. Each row is written in the transaction of the change it records. A row names the person a change was about, never who made it. When the table is first created it is seeded from the places and requests already in `rsvps`. The management page shows it (`activity` in `GET /api/host/:token`)
- Repeating events: a repeat rule (`server/booking-repeat.js`: every N days / weeks on chosen weekdays / months, until a date, at most 52) expands into ordinary rows sharing `series_id` (`event_series.rule`). Each date has its own RSVPs, approval queue and single Google copy. Edit and Cancel take `scope: this | later`; later dates keep their own day and take the new clock times and everything else. The rule is fixed once made
- Cancel sets `cancelled_at` (hidden from every public read, RSVPs kept, Google copy deleted); Restore clears it
- Approval events ("I approve each person"): Join reads "Ask to join", requests hold no seat, the card shows "N asking" and "<host> confirms each place"

### RSVP System
- Actions: "add" (RSVP yes) or "remove" (cancel RSVP)
- Attendee name is required for both actions
- Capacity checking: if attendance_limit is set, prevents RSVPs when full
- Real-time updates via WebSocket broadcast after each RSVP action
- Only `yes` holds a seat; `pending` (asked to join) and `declined` exist for approval events

### WebSocket Real-Time Updates
WebSocket server runs on same HTTP server as Express. Broadcast messages:
- `attendance_update` - Sent when an RSVP or a host decision changes who is coming (eventId, attendingCount, attendees, pendingCount)
- `event_created`, `event_update`, `event_cancelled` - `{ ids }` of events made, edited or restored, cancelled; Home reloads its lists
- `event_published` - `{ id }` after the publisher tried an event's Google copy; its management page reloads the status

Clients connect via WebSocket and listen for these messages to update UI without refresh.

### Environment Variables
Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string (format: postgresql://user:password@host:port/database)
- `DONATION_IBAN`, `DONATION_ACCOUNT_HOLDER` - Optional. Bank details on the Donate page; set both or neither. An invalid IBAN stops startup
- `DONATION_BIC`, `DONATION_REFERENCE`, `DONATION_PAY_LINK` - Optional: BIC, transfer message (default "Lilai donation"), an https card-payment link such as revolut.me
- `RESEND_API_KEY` - Optional. Without it feedback is saved but not emailed
- `FEEDBACK_EMAIL_TO` - Optional, comma-separated; overrides the default inbox `lilai@fisherkuan.com`
- `FEEDBACK_EMAIL_FROM` - Optional. Needs a domain verified in Resend, else the default `onboarding@resend.dev` only delivers to the Resend account's own address
- `GOOGLE_SERVICE_ACCOUNT_JSON` - A Google service account key (the JSON file, or base64 of it) that publishes events to the Google calendars and runs the one-time import. Share every calendar in `config/app.json` with its `client_email` ("Make changes to events"); the address is logged at startup. Without it events still work in Lilai and their copies wait. A value that does not parse stops startup
- `PUBLIC_URL` - Optional. Overrides `publicUrl` (local runs)
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Set to "production" to enable SSL for PostgreSQL

## Coding Conventions

### Style
- 4-space indentation
- Semicolons required
- `const`/`let` (no `var`)
- camelCase for variables and functions
- kebab-case for filenames

### Organization
- Server logic in `server/app.js` (monolithic currently)
- Client scripts in `public/` (HTML) and `public/js/` (modular JS)
- Configuration in `config/app.json`
- Static assets (icons, manifest) in `public/icons/`

### Database Patterns
- Use parameterized queries ($1, $2, etc.) to prevent SQL injection
- Release client connections in `finally` blocks
- Transactions for multi-step operations (BEGIN/COMMIT)
- Schema changes use idempotent migrations with error suppression for existing columns

## API Endpoints

### Core Endpoints
- `GET /api/events` - List events. Query params:
  - `timeRange=future|past|all` (default from `events.defaultTimeRange`)
  - `from=<ISO>&to=<ISO>` - events starting in that window; the date rail uses it.
  - `before=<ISO>&limit=N` - paginated past-events fetch, newest-first; used by the "Load earlier events" flow on the Home page (`loadOlderEvents` in `app.js`).
- `GET /api/events/:id` - Get specific event (404 once cancelled)
- `GET /api/events/repeat-preview?date=&every=&unit=&weekdays=&until=` - The dates a repeat lands on (the form's preview), or `{error}`
- `POST /api/events` - Make an event, or a repeating one (open to anyone, like RSVP). Body `{title, calendar, date, start, end, location?, description?, links?, limit?, approval?, repeat?: {every, unit, weekdays, until}, hostName, hostJoins?, hostEmail?, calendarKeys?: [token]}`, times as Brussels wall time. A restricted calendar needs one of its keys in `calendarKeys` (403 otherwise). Saves first, then the publisher copies it to Google. Answers `{id, ids, count, date, hostPath, emailed, publishing}` and broadcasts `event_created`; 400 `{field, message}` on bad input
- `GET /api/host/:token[?event=<id>]` - The management page's data: the event (with its form values, calendar, publish status), every RSVP row with its status, and for a series its rule and dates. Without `event` a series opens on its next date
- `PUT /api/host/:token/events/:eventId` - Edit (the event form's fields plus `scope`); broadcasts `event_update`
- `POST /api/host/:token/events/:eventId/cancel` - Body `{scope}`; broadcasts `event_cancelled`
- `POST /api/host/:token/events/:eventId/restore`
- `POST /api/host/:token/events/:eventId/requests/:rsvpId` - Body `{decision: accept|decline|undo}`. Accept respects the limit under a row lock (409 when full)
- `GET /api/calendar-access/:token` - A calendar key's calendar and its upcoming events
- `POST /api/calendar-access/:token/events/:eventId/manage` - Mints a management link for one of that calendar's events (a series gets one link for all its dates)
- `GET /api/places` - The owner's places from `config/app.json`, in the owner's order (`{places: [{name, address, aliases}]}`); the form ranks them itself
- `POST /api/rsvp` - Submit RSVP (body: `{eventId, action: "add"|"remove", attendeeName}`). A cancelled event is not found. On an approval event, `add` asks to join: the row is `pending`, the answer carries `pending: true`, and one open request per name. Answers and the `attendance_update` broadcast carry `attendees`, `attendingCount` and `pendingCount`
- Public event JSON never includes `host_email` or the publishing bookkeeping (`publicEvent` in `server/event-hosting.js`), and never a cancelled event

### Donation Endpoints
- `GET /api/donations` - Get donations with balance (query param: `limit`)
- `POST /api/donations` - Create donation entry (body: `{amount, description, donator, entry_date}`)
- `GET /api/donation-details` - Account holder, masked IBAN and pay link for the Donate page (404 when not configured). The full IBAN travels only in the QR code and `GET /api/donation-iban`, which the Copy button calls on click
- `GET /api/donation-qr.svg` - SEPA "scan to pay" QR code (EPC069-12) for the same details

### Feedback Endpoint
- `POST /api/feedback` - Body `{message, email?, page?, files?: [{name, type, data: base64}]}`, up to 5 files and 10 MB in all. Saves to the `feedback` table, then emails it through Resend (`server/feedback.js`), subject prefixed `[Lilai]`, Reply-To the sender's email when given. Files travel in the email only (Heroku's disk does not keep them); the table keeps their names and an `emailed` flag. A failed email is logged, never shown to the sender. Nothing reads feedback back over HTTP: use `heroku pg:psql -a lilai-eu`

### Booking Queue Endpoints
- `GET /api/bookings` - Board data: `queued[]`, `history[]`, `historyHasMore`, `quotaPerWeek`. Params: `limit`, `before=<ISO>`
- `GET /api/bookings/quota?name=` - Live quota tally for a typed name
- `GET /api/bookings/form-options` - Sports and facilities read from the live KU Leuven form, plus `seasonEndsOn`
- `GET|POST /api/booking-profiles`, `GET|PUT|DELETE /api/booking-profiles/:id` - The address book. The list masks email and phone; only a single read returns them in full
- `POST /api/bookings` - Queue a slot. `profileId` takes name/email/phone from the address book; `repeat: {every, unit, weekdays, until}` expands into one row per occurrence and answers with `created[]` and `skipped[]`
- `GET /api/bookings/repeat-preview` - What a rule would expand to. The sheet's preview, so it cannot promise a date the server refuses
- `GET /api/booking-series` - Recurring schedules with their tallies
- `GET /api/booking-series/:id` - One schedule plus a template occurrence, which is what the edit sheet opens from
- `PUT /api/booking-series/:id` - Change the rule, the details, or both. Reconciles the queue against the new rule: a queued occurrence the rule still wants is updated in place and keeps its id, one it no longer wants is cancelled, a newly wanted date is queued. Anything already sent is never touched
- `POST /api/booking-series/:id/cancel-remaining` - Cancel every occurrence not yet sent; reports how many had already gone
- `POST /api/booking-series/:id/restore-remaining` - Undo that, inside the undo window
- `GET /api/bookings/:id` - One entry, including what was submitted
- `PUT /api/bookings/:id` - Edit a queued entry. Re-validated whole; the send delay is re-rolled only when the opening moves
- `POST /api/bookings/:id/restore` - Undo a cancellation inside the undo window, without a quota check
- `DELETE /api/bookings/:id` - Cancel a queued entry (used by the quota swap)
- `POST /api/bookings/:id/report-failure` - Mark a `sent` or `unconfirmed` request as `failed` by hand (KU Leuven refuses by email, which the app never sees). `failed` holds no quota, so the person's slot that week comes back. No undo

### Configuration
- `GET /api/config` - Get app configuration (calendars, settings)
- `GET /api/health` - Health check

## Booking Queue

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

## Deployment Notes

Taking the calendars over (once, when this lands in production):
1. Create a Google Cloud service account with the Calendar API enabled; set its key as `GOOGLE_SERVICE_ACCOUNT_JSON` on `lilai-eu`
2. Share each of the three calendars with the service account's email, "Make changes to events"
3. Deploy. On boot each calendar is imported (`[import]` lines in the log) and upcoming events are re-published
4. Make the calendars read-only in Google: remove other people's edit access (the Leuven Taiwanese Google Group on 揪團啦, organizers on SportsCenter, TSA managers on TSA); keep "See all event details" for the public
5. Mint TSA's calendar link and give it to TSA's admins: `heroku run -a lilai-eu node scripts/calendar-link.js TSA --label "TSA admins"`


- Designed for Heroku-style deployment (Procfile present)
- Production is the Heroku app `lilai-eu` (region eu, Basic dyno) serving `lilai.fisherkuan.com` (DNS on Cloudflare, DNS only). Its database is the Heroku Postgres `essential-0` add-on in eu-west-1, with daily backups at 04:00 Brussels (`heroku pg:backups -a lilai-eu`). The Supabase `lilai` project is a paused leftover, not production. Moved from the US app `lilai` on 2026-10-22
- PostgreSQL required in production (DATABASE_URL must be set)
- Static files served from `public/` directory
- WebSocket requires HTTP server support (not just Express)
- SSL automatically enabled for PostgreSQL when NODE_ENV=production
