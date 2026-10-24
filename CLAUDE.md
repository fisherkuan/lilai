# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning Documents

When creating implementation plans, improvement analyses, or deployment guides:
- Store all planning documents in `.plans/` directory (git-ignored)
- Use descriptive filenames: `FEATURE_NAME_plan.md`, `IMPROVEMENT_analysis.md`, etc.
- Reference this directory when looking for existing plans or creating new ones

## Visual design: Shape Calendar

The old design system (`design-mockup.html`, `public/styles.css`) and a ligne claire comic attempt were both retired on 2026-09-27. The current world is Bauhaus form-colour grammar: each enabled calendar owns one primary shape in config order (blue circle, red square, yellow triangle), primaries appear only inside shapes, and text, rules and buttons stay black on white. `DESIGN.md` (repo root) is the visual authority; `PRODUCT.md` holds product truth. Every page loads `public/bauhaus/tokens.css` first, then `public/css/lilai.css` (lilai's additions and shared components), then its own page stylesheet in `public/css/` (`faq.css`, `donate.css`, `admin.css` for all admin pages, `booking.css`, `events.css` for Make an event and the host page). `tokens.css` is a verbatim copy of the owner's Bauhaus kit (`~/code/bauhaus`, commit in `public/bauhaus/KIT_COMMIT`): it owns the palette, both themes, strokes, radii and Jost (`public/bauhaus/fonts/`). Never edit it here; change the kit, copy the file over and bump `KIT_COMMIT`. Lilai keeps two deliberate deviations from the kit: primaries only inside calendar shapes (no red buttons or error marks), and the system sans for everything except page titles and big numerals (dates, the balance, the clock), which keep Jost. Dark mode follows the device setting, and the footer switch (`js/theme.js`) can force Light or Dark per device. Lilai's own dark additions (`--ink-3`, `--past`, `--scrim`) live twice in `lilai.css` (the `prefers-color-scheme` block and `:root[data-theme="dark"]`); keep both in sync. Colours belong in tokens, so a new hard-coded colour needs a copy in both dark blocks. The legacy `styles.css` is deleted. The date rail (replaced the 14-day band on 2026-10-22, which had replaced the Google Calendar iframe and the month grid) is the only calendar view; do not bring the others back. The events-list filter must not affect the rail — it reads its own `allCalendarEvents` source (`/api/events?from=&to=`, the rail's 14 days only). The rail's green (`--rail-sel`, `--rail-accent`) is the owner's choice and the one colour outside a shape besides links and focus.

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
- Tables: `events`, `rsvps`, `donations`, `feedback`, `booking_queue`, `booking_profiles`, `booking_series`
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
This is an event RSVP management system with Google Calendar integration and bank-transfer donations.

**Core data flow:**
1. Google Calendar events are fetched from configured calendar(s) via iCal feed
2. Events are synced to PostgreSQL if autoFetch is enabled: at startup, then in the background (`refreshCalendar`, one at a time) when a request finds the 5-minute cache stale. A request never waits for Google
3. Users RSVP to events; RSVPs are stored in database
4. WebSocket broadcasts real-time attendance updates to all connected clients
5. Admin pages allow event and donation management

### Server Architecture (server/app.js)
Single-file Express server (~840 lines) that handles:
- **WebSocket Server**: Real-time attendance updates via `broadcast()` function
- **Calendar Sync**: `fetchCalendarEvents()` fetches and parses iCal format from Google Calendar
- **Event Management**: CRUD operations for events with attendance tracking
- **RSVP System**: Add/remove attendance with capacity limits
- **Donation System**: Tracks donations entered by hand; the Donate page shows bank details (`server/donation-bank.js`)
- **Database**: PostgreSQL via `pg` Pool with auto-schema initialization

**Key patterns:**
- Calendar events have source field to track which calendar they came from
- Lilai owns an event's limit (`attendance_limit`) and links (`links`, JSONB `[{url, label?}]`); Google owns title, time, place and description. Nothing is read out of the description (since 2026-10-24); the sync never writes the limit or the links
- WebSocket broadcasts attendance changes to all clients for real-time updates
- Bank details for donations come from env vars, never `config/app.json` (the repo is public)

### Frontend Architecture (public/)
Vanilla JavaScript with no build step.

**Structure:**
- `index.html` + `app.js` - Main event listing and RSVP interface
- `admin.html` + `admin.js` - Event management interface
- `admin-donations.html` + `js/admin-donations.js` - Donation management
- `donations.html` + `js/donation.js` - Public donation submission page
- `faq.html` + `js/faq.js` - FAQ page
- `bauhaus/tokens.css` - The Bauhaus kit's tokens, copied verbatim (do not edit)
- `css/lilai.css` - Lilai's token additions, shared components and Home (Shape Calendar world, see `DESIGN.md`)
- `css/faq.css`, `css/donate.css`, `css/admin.css`, `css/booking.css` - Page stylesheets, loaded after `lilai.css`
- `js/feedback.js` - Footer "Send feedback" button and sheet, on every page with a `.colophon` (ported from splitly)
- `js/sheet.js` - Shared behaviour for every sheet (`.modal`, `.bs-root`), on every page with feedback: locks the page scroll while one is open, keeps the sheet above the iOS keyboard (`--vv-top`/`--vv-h` from `visualViewport`), and makes the grabber work on phones (drag up for full screen, down to go back or dismiss, tap to toggle; `settle` tested in `tests/sheet.test.js`). Sheets do not touch `body.style.overflow` themselves
- `new-event.html` + `js/new-event.js` - Make an event (`/events/new`). Remembers the host links made on this device in localStorage (`lilai.hostedEvents`) and lists them as "You host"
- `host.html` + `js/host.js` - The host page (`/host/:token`): who is coming, and on an approval event who asked, with Accept / Decline / Undo, plus Places and links (edit the limit and the links, one Save). Live over WebSocket
- `js/event-links.js` - An event's links: `listHtml` draws them on cards and the RSVP sheet (name, else the site), `create` is the editor (address, optional name, remove, "Add a link") on Make an event, the host page and admin Events. Tested in `tests/event-links.test.js`
- `sw.js` - Service worker for PWA support. It never caches `/host/` or `/api/host/`: those carry the secret link

**Client-side features:**
- WebSocket connection for real-time attendance updates
- Event cards with RSVP buttons (add/remove attendance)
- **Date rail** rendered client-side from `/api/events?from=<ISO>&to=<ISO>` (the rail's 14 days; requested at boot alongside `/api/config`): today plus 13 days as day buttons, each marked with its events' title emoji or calendar shape (`titleEmoji`/`bandMark`), up to three, then "+N". The component is `public/js/date-rail.js` (`DateRail.create(container, { events, selected, onSelect, mark })`, pure helpers tested in `tests/date-rail.test.js`); `app.js` wires it (`renderRail`, `renderAgenda`, `loadAllCalendarEvents`). Today is selected by default. A Cards | Rows switch (`setHomeView`, kept in localStorage as `lilaiHomeView`) picks the view. In Cards view, clicking a day scrolls to its first card (`onSelect` reports `via: 'click'`; arrow keys never scroll), the agenda never shows, and a fixed back-to-top button (`#to-top-btn`) is always on screen. In Rows view the card list hides and the selected day's agenda rows carry a Join button that opens the RSVP sheet (`findEvent` looks up events outside the list too); tapping a row opens it to a "Show card" button (`showCard`) that switches to Cards and scrolls to that card.
- **Pull to refresh** (`public/js/pull-to-refresh.js`, `PullToRefresh.attach(onRefresh)`) on Home and Donate, ported from splitly. There are no Refresh buttons.
- Admin pages for creating/editing events and managing donations

### Configuration (config/app.json)
Central configuration file with:
- `calendars[]` - Array of Google Calendar embed URLs with enable/disable flags
- `events.autoFetch` - Whether to sync calendar events automatically. **Must be `true`** for the date rail and events list to populate from Google Calendar.
- `events.defaultTimeRange` - Default filter ("future", "past", "all")
- `events.createCalendars` - Names of the calendars the Make an event page may write to (each must be shared with the service account). Defaults to `[defaultCreateCalendar]`.
- `events.defaultCreateCalendar` - The calendar pre-selected on Make an event. Must match a `calendars[].name`. When event creation is not set up (no `GOOGLE_SERVICE_ACCOUNT_JSON`), the "Create an event" button falls back to `https://calendar.google.com/calendar/render?action=TEMPLATE&src=<calendar-id>`.
- `rsvp` - RSVP behavior settings
- `joinGroupUrl` - Link to external group (displayed in UI)

## Key Implementation Details

### Google Calendar Integration
- Calendars are configured in `config/app.json` with embed URLs
- Server extracts calendar ID from URL and fetches iCal feed
- Custom iCal parser handles line folding (RFC 5545), HTML entities, and text sanitization
- Events are uniquely identified by `cal-{UID}` where UID comes from iCal
- The description is shown as written. The "limit: N" and "link: URL" conventions are gone; when the `links` column was added, each existing event's description link was copied into it once (`linkFromLegacyDescription`)
- Stale events (removed from calendar) are automatically deleted from database

### Events made in Lilai
- `server/google-calendar.js` - service-account JWT sign-in and `insertEvent` / `deleteEvent` / `eventGone`, no SDK. Reading still uses the public iCal feed
- `server/event-hosting.js` - the create form's rules (`validateNewEvent`), the Google resource (the description goes as written), `validateLimit` / `validateLinks` / `validateEventSettings` (at most 5 links, http(s) only, names up to 40 characters), host tokens, the `events` columns (`approval_required`, `host_name`, `host_email`, `host_token_hash`, `google_calendar_id`, `google_event_id`, `google_link`, `links`, `created_in_app_at`)
- The host is anyone with the host link, `/host/<32-char token>`; only its SHA-256 is stored. No accounts, in line with the RSVP trust model
- Google's public feed can lag hours behind an API insert. A Lilai-made event missing from the feed is asked about with `eventGone` before the stale sweep may delete it (`appEventsToCheck`, `keepAppEvent` in `server/calendar-sync.js`); with no answer it is kept for a day after it was made
- Approval events ("I approve each person"): Join reads "Ask to join", requests hold no seat, the card shows "N asking" and "<host> confirms each place"

### RSVP System
- Actions: "add" (RSVP yes) or "remove" (cancel RSVP)
- Attendee name is required for both actions
- Capacity checking: if attendance_limit is set, prevents RSVPs when full
- Real-time updates via WebSocket broadcast after each RSVP action
- Only "yes" attendance status is currently tracked

### WebSocket Real-Time Updates
WebSocket server runs on same HTTP server as Express. Broadcast messages:
- `attendance_update` - Sent when RSVP is added/removed (includes eventId, attendingCount, attendees)
- `event_update` - Sent when an event's limit or links change (admin page or host page); Home patches its lists (`applyEventUpdate`)

Clients connect via WebSocket and listen for these messages to update UI without refresh.

### Environment Variables
Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string (format: postgresql://user:password@host:port/database)
- `DONATION_IBAN`, `DONATION_ACCOUNT_HOLDER` - Optional. Bank details on the Donate page; set both or neither. An invalid IBAN stops startup
- `DONATION_BIC`, `DONATION_REFERENCE`, `DONATION_PAY_LINK` - Optional: BIC, transfer message (default "Lilai donation"), an https card-payment link such as revolut.me
- `RESEND_API_KEY` - Optional. Without it feedback is saved but not emailed
- `FEEDBACK_EMAIL_TO` - Optional, comma-separated; overrides the default inbox `lilai@fisherkuan.com`
- `FEEDBACK_EMAIL_FROM` - Optional. Needs a domain verified in Resend, else the default `onboarding@resend.dev` only delivers to the Resend account's own address
- `GOOGLE_SERVICE_ACCOUNT_JSON` - Optional. A Google service account key (the JSON file, or base64 of it) that turns on Make an event. Share each calendar in `events.createCalendars` with its `client_email`, "Make changes to events"; the address is logged at startup. Without it the create page says it is not set up. A value that does not parse stops startup
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
- `GET /api/events/:id` - Get specific event
- `POST /api/events` - Make an event (open to anyone, like RSVP). Body `{title, calendar, date, start, end, location?, description?, links?: [{url, label?}], limit?, approval?, hostName, hostJoins?, hostEmail?}`, times as Brussels wall time; an end at or before the start is the next day. Writes to Google Calendar first, then the row `cal-<iCalUID>` with the host fields; if the row fails the Google event is deleted again. Answers `{id, date, hostPath, googleLink, emailed}` and broadcasts `event_created`. 503 when not set up, 400 `{field, message}` on bad input
- `GET /api/host/:token` - The host page's data: the event (with host fields) and every RSVP row with its status
- `PUT /api/host/:token/event` - Body `{limit?, links?}`: the host changes the limit (null for none) or the links; broadcasts `event_update`
- `POST /api/host/:token/requests/:rsvpId` - Body `{decision: accept|decline|undo}`. Accept respects the limit under a row lock (409 when full); undo puts a row back to `pending`
- `PUT /api/events/:id` - Admin Events: body `{attendanceLimit?, links?}` (also `limit`). Only Lilai's own fields; broadcasts `event_update` with the public event and its attendance
- `DELETE /api/events/:id` - Delete event (admin)
- `POST /api/rsvp` - Submit RSVP (body: `{eventId, action: "add"|"remove", attendeeName}`). On an approval event, `add` asks to join: the row is `pending`, the answer carries `pending: true`, and one open request per name. Answers and the `attendance_update` broadcast carry `attendees`, `attendingCount` and `pendingCount`
- Public event JSON never includes `host_email` or `host_token_hash` (`publicEvent` in `server/event-hosting.js`)

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

- Designed for Heroku-style deployment (Procfile present)
- Production is the Heroku app `lilai-eu` (region eu, Basic dyno) serving `lilai.fisherkuan.com` (DNS on Cloudflare, DNS only). Its database is the Heroku Postgres `essential-0` add-on in eu-west-1, with daily backups at 04:00 Brussels (`heroku pg:backups -a lilai-eu`). The Supabase `lilai` project is a paused leftover, not production. Moved from the US app `lilai` on 2026-10-22
- PostgreSQL required in production (DATABASE_URL must be set)
- Static files served from `public/` directory
- WebSocket requires HTTP server support (not just Express)
- SSL automatically enabled for PostgreSQL when NODE_ENV=production
