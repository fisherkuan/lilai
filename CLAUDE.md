# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning Documents

When creating implementation plans, improvement analyses, or deployment guides:
- Store all planning documents in `.plans/` directory (git-ignored)
- Use descriptive filenames: `FEATURE_NAME_plan.md`, `IMPROVEMENT_analysis.md`, etc.
- Reference this directory when looking for existing plans or creating new ones

## Active work: UI redesign

Ongoing work lives on `feature/redesign` in `.worktrees/redesign/`. The redesign adopts the design system defined in `design-mockup.html` (repo root) — treat that file as the visual source of truth. Status and handoff notes: `.plans/REDESIGN_status.md`. The custom month-grid calendar has replaced the Google Calendar iframe; do not revert. The events-list filter must not affect the calendar — the calendar reads from its own `allCalendarEvents` source (`/api/events?timeRange=all`).

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
- Tables: `events`, `rsvps`, `donations`, `booking_queue`
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
This is an event RSVP management system with Google Calendar integration and Stripe donation support.

**Core data flow:**
1. Google Calendar events are fetched from configured calendar(s) via iCal feed
2. Events are synced to PostgreSQL (upserted on each fetch if autoFetch is enabled)
3. Users RSVP to events; RSVPs are stored in database
4. WebSocket broadcasts real-time attendance updates to all connected clients
5. Admin pages allow event and donation management

### Server Architecture (server/app.js)
Single-file Express server (~840 lines) that handles:
- **WebSocket Server**: Real-time attendance updates via `broadcast()` function
- **Calendar Sync**: `fetchCalendarEvents()` fetches and parses iCal format from Google Calendar
- **Event Management**: CRUD operations for events with attendance tracking
- **RSVP System**: Add/remove attendance with capacity limits
- **Donation System**: Tracks donations with Stripe integration
- **Database**: PostgreSQL via `pg` Pool with auto-schema initialization

**Key patterns:**
- Calendar events have source field to track which calendar they came from
- Attendance limits can be set in calendar event description with "limit: N" text
- WebSocket broadcasts attendance changes to all clients for real-time updates
- Stripe checkout sessions are created server-side for donations

### Frontend Architecture (public/)
Vanilla JavaScript with no build step.

**Structure:**
- `index.html` + `app.js` - Main event listing and RSVP interface
- `admin.html` + `admin.js` - Event management interface
- `admin-donations.html` + `js/admin-donations.js` - Donation management
- `donations.html` + `js/donation.js` - Public donation submission page
- `faq.html` + `js/faq.js` - FAQ page
- `styles.css` - Global styles (~1000 lines)
- `sw.js` - Service worker for PWA support

**Client-side features:**
- WebSocket connection for real-time attendance updates
- Event cards with RSVP buttons (add/remove attendance)
- **Custom month-grid calendar** rendered client-side from `/api/events?timeRange=all` (replaces the old Google Calendar iframe). Implemented in `app.js` (`renderCalendarGrid`, `loadAllCalendarEvents`, `wireCreateEventButtons`).
- Admin pages for creating/editing events and managing donations

### Configuration (config/app.json)
Central configuration file with:
- `calendars[]` - Array of Google Calendar embed URLs with enable/disable flags
- `events.autoFetch` - Whether to sync calendar events automatically. **Must be `true`** for the custom month grid and events list to populate from Google Calendar.
- `events.defaultTimeRange` - Default filter ("future", "past", "all")
- `events.defaultCreateCalendar` - Name of the calendar pre-selected by the "Create event" button. Must match a `calendars[].name`. The button links to `https://calendar.google.com/calendar/render?action=TEMPLATE&src=<calendar-id>`.
- `rsvp` - RSVP behavior settings
- `stripe.donationPriceId` - Stripe price ID for donations
- `stripe.donationProgress` - Current/goal for donation progress bar
- `joinGroupUrl` - Link to external group (displayed in UI)

## Key Implementation Details

### Google Calendar Integration
- Calendars are configured in `config/app.json` with embed URLs
- Server extracts calendar ID from URL and fetches iCal feed
- Custom iCal parser handles line folding (RFC 5545), HTML entities, and text sanitization
- Events are uniquely identified by `cal-{UID}` where UID comes from iCal
- Attendance limits can be specified in event description with "limit: N" format
- Stale events (removed from calendar) are automatically deleted from database

### RSVP System
- Actions: "add" (RSVP yes) or "remove" (cancel RSVP)
- Attendee name is required for both actions
- Capacity checking: if attendance_limit is set, prevents RSVPs when full
- Real-time updates via WebSocket broadcast after each RSVP action
- Only "yes" attendance status is currently tracked

### WebSocket Real-Time Updates
WebSocket server runs on same HTTP server as Express. Broadcast messages:
- `attendance_update` - Sent when RSVP is added/removed (includes eventId, attendingCount, attendees)
- `event_update` - Sent when event is updated via admin API

Clients connect via WebSocket and listen for these messages to update UI without refresh.

### Environment Variables
Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string (format: postgresql://user:password@host:port/database)
- `STRIPE_SECRET_KEY` - Stripe API secret key
- `STRIPE_PUBLISHABLE_KEY` - Stripe public key (served to client via /api/stripe-key)
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
  - `before=<ISO>&limit=N` - paginated past-events fetch, newest-first; used by the "Load earlier events" flow on the Home page (`loadOlderEvents` in `app.js`).
- `GET /api/events/:id` - Get specific event
- `POST /api/events` - Create event (admin)
- `PUT /api/events/:id` - Update event (admin)
- `DELETE /api/events/:id` - Delete event (admin)
- `POST /api/rsvp` - Submit RSVP (body: `{eventId, action: "add"|"remove", attendeeName}`)

### Donation Endpoints
- `GET /api/donations` - Get donations with balance (query param: `limit`)
- `POST /api/donations` - Create donation entry (body: `{amount, description, donator, entry_date}`)
- `GET /api/donation-progress` - Get current/goal for progress bar
- `POST /api/create-donation-checkout-session` - Create Stripe checkout session

### Booking Queue Endpoints
- `GET /api/bookings` - Board data: `queued[]`, `history[]`, `historyHasMore`, `quotaPerWeek`. Params: `limit`, `before=<ISO>`
- `GET /api/bookings/quota?name=` - Live quota tally for a typed name
- `GET /api/bookings/form-options` - Sports and facilities read from the live KU Leuven form, plus `seasonEndsOn`
- `GET|POST /api/booking-profiles`, `GET|PUT|DELETE /api/booking-profiles/:id` - The address book. The list masks email and phone; only a single read returns them in full
- `POST /api/bookings` - Queue a slot. `profileId` takes name/email/phone from the address book; `repeat: {every, unit, weekdays, until}` expands into one row per occurrence and answers with `created[]` and `skipped[]`
- `GET /api/bookings/repeat-preview` - What a rule would expand to. The sheet's preview, so it cannot promise a date the server refuses
- `GET /api/booking-series` - Recurring schedules with their tallies
- `POST /api/booking-series/:id/cancel-remaining` - Cancel every occurrence not yet sent; reports how many had already gone
- `POST /api/booking-series/:id/restore-remaining` - Undo that, inside the undo window
- `DELETE /api/booking-series/:id` - Forget the schedule, keep every booking it made
- `GET /api/bookings/:id` - One entry, including what was submitted
- `DELETE /api/bookings/:id` - Cancel a queued entry (used by the quota swap)

### Configuration
- `GET /api/config` - Get app configuration (calendars, settings)
- `GET /api/stripe-key` - Get Stripe publishable key
- `GET /api/health` - Health check

## Booking Queue

Queues KU Leuven sports-facility requests and submits them when the booking window
opens — midnight Brussels, 14 days before the play date.

- `server/booking-time.js` — Brussels wall-clock arithmetic; rejects ambiguous and nonexistent local times rather than guessing
- `server/booking-form.js` — the Plone EasyForm client (parse, build, encode, classify)
- `server/booking-scheduler.js` — the 15s tick. Claims a row (`UPDATE … WHERE status='queued'`) *before* the POST, so a request is never sent twice. A POST whose outcome cannot be read becomes `unconfirmed` and is never retried automatically
- `server/booking-quota.js` — two slots per name per Mon–Sun week, enforced under a Postgres advisory lock
- `server/booking-profiles.js` — the address book, plus the `profile_id` link and its backfill from the existing queue
- `server/booking-repeat.js` — expands a repeat rule (every N days / weeks on chosen weekdays / months) into play dates; capped at 52, bounded by the season. A month without the anchor date is skipped, never slid
- `server/booking-series.js` — the recurring schedule as a record you can act on. A label on rows, never their owner: deleting it cancels nothing
- `config/app.json` → `booking` — delay bounds, `lateSubmissionGraceSeconds`, `cancelUndoSeconds` (how long a cancelled row keeps its Undo before leaving the board — nothing is deleted) and `seasonEndsOn` (the last bookable play date; renew it each September)

Start times are :00 or :30 only. Courts are handed out on the hour and half hour, so
`assertHalfHour` in `booking-validation.js` refuses anything else — the picker offers only
those, and the rule is enforced server-side because the import path arrives the same way.

**Submission is off unless `BOOKING_SUBMIT=live` is set.** Without it the scheduler runs
the whole path and stops short of the POST. `server/../.plans/` holds the design notes.

Recovery is stateless: an entry stays due from its opening until opening + grace, so any
process alive inside that window picks it up through the ordinary check. There is no
catch-up path. `lateSubmissionGraceSeconds` is 43200 — twelve hours, matching the Python
reference's live config — so a process that was not running at midnight still sends when
it next comes up. A late request will usually get a worse court than a punctual one, but
it is not nothing.

The board's midnight banner is deliberately **not** driven by this number: it uses its own
five-minute `LIVE_WINDOW_MS`, because a countdown clock running all morning would misstate
what is happening. A slot that goes out late still lifts out of the timeline and lands with
a fade; it just carries a "catching up" label instead of a countdown.

`~/code/sports-booking-bot` is the verified Python reference for the form protocol. It is
a specification, never called at runtime.

## Deployment Notes

- Designed for Heroku-style deployment (Procfile present)
- PostgreSQL required in production (DATABASE_URL must be set)
- Stripe keys required for donation functionality
- Static files served from `public/` directory
- WebSocket requires HTTP server support (not just Express)
- SSL automatically enabled for PostgreSQL when NODE_ENV=production
