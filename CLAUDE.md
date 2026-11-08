# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning Documents

When creating implementation plans, improvement analyses, or deployment guides:
- Store all planning documents in `.plans/` directory (git-ignored)
- Use descriptive filenames: `FEATURE_NAME_plan.md`, `IMPROVEMENT_analysis.md`, etc.
- Reference this directory when looking for existing plans or creating new ones

## Visual design: Shape Calendar

The old design system (`design-mockup.html`, `public/styles.css`) and a ligne claire comic attempt were both retired on 2026-09-27. The current world is Bauhaus form-colour grammar: each enabled calendar owns one primary shape in config order (blue circle, red square, yellow triangle), primaries appear only inside shapes, and text, rules and buttons stay black on white. `DESIGN.md` (repo root) is the visual authority; `PRODUCT.md` holds product truth. Copy rule: the design explains itself; a hint line only for a caveat or something not obvious (DESIGN.md, Do's). Every page loads `public/bauhaus/tokens.css` first, then `public/css/lilai.css` (lilai's additions and shared components), then its own page stylesheet in `public/css/` (`faq.css`, `donate.css`, `admin.css` for all admin pages, `booking.css`, `events.css` for Make an event and the host page). `tokens.css` is a verbatim copy of the owner's Bauhaus kit (`~/code/bauhaus`, commit in `public/bauhaus/KIT_COMMIT`): it owns the palette, both themes, `--ground`, `color-scheme`, strokes, radii and Jost (`public/bauhaus/fonts/`); lilai does not load the kit's `components.css`. Never edit it here; change the kit, copy the file over and bump `KIT_COMMIT`. Lilai keeps two deliberate deviations from the kit: primaries only inside calendar shapes (no red buttons or error marks), and the system sans for everything except page titles and big numerals (dates, the balance, the clock), which keep Jost. Pages are light by default whatever the device uses (no Auto since 2026-10-25); the footer's Dark switch (`js/theme.js`) and Profile's Dark switch pick Dark per device, and each page's head script always sets `data-theme`, so the device's dark setting never applies. Lilai's own dark additions (`--ink-3`, `--past`, `--scrim`) live twice in `lilai.css` (the `prefers-color-scheme` block and `:root[data-theme="dark"]`); keep both in sync. Colours belong in tokens, so a new hard-coded colour needs a copy in both dark blocks. The legacy `styles.css` is deleted. The date rail (replaced the 14-day band on 2026-10-22, which had replaced the Google Calendar iframe and the month grid) is the only calendar view; do not bring the others back. The events-list filter must not affect the rail — it reads its own `allCalendarEvents` source (`/api/events?from=&to=`, the rail's 14 days only). The rail's green (`--rail-sel`, `--rail-accent`) is the owner's choice and the one colour outside a shape besides links and focus; an event's chat reuses it for my bubbles and a liked heart (`--chat-*` tokens).

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
- Tables: `events`, `rsvps`, `places`, `admin_codes`, `admin_sessions`, `event_series`, `event_host_links`, `event_activity`, `calendar_keys`, `calendar_state`, `donations`, `feedback`, `booking_queue`, `booking_profiles`, `booking_series`, `contacts`, `contact_tokens`, `device_sessions`, `event_messages`, `event_message_likes`, `organizers`
- `rsvps.attendance` is `yes` (holds a seat), `pending` (asked to join an approval event), `waiting` (on a full event's waiting list, in `timestamp, id` order) or `declined` (the host said no). Every count of who is coming filters on `yes`
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

Full detail (pages, scripts, stylesheets, UI rules) lives in `docs/frontend-architecture.md`. Open it before changing anything under `public/`.

### Configuration (config/app.json)
Central configuration file with:
- `publicUrl` - Where links in emails and in the Google copies point (`https://lilai.fisherkuan.com`). `PUBLIC_URL` overrides it
- `calendars[]` - The published Google calendars, by embed URL, in shape order. `enabled`; `restricted: true` (TSA) means only signed-in addresses on its `CALENDAR_WRITERS` list, or on `ADMIN_EMAILS`, may make events in it
- `events.autoFetch` - The legacy feed, for a calendar not yet imported. Harmless once every calendar is
- `events.defaultTimeRange` - Default filter ("future", "past", "all")
- `events.defaultCreateCalendar` - The calendar pre-selected in Make an event. Must match a `calendars[].name`
- `places[]` - Seed only: copied into the `places` table the first time it is made. After that the list lives in the database and is edited on `/admin/places`; changing this array does nothing
- `rsvp` - RSVP behavior settings
- `joinGroupUrl` - Link to external group (displayed in UI)

## Key Implementation Details

### Events

Lilai owns events; Google calendars are published copies. The full rules live in `docs/events.md`. Open it before changing event creation, edits, publishing or the host page.

### Chat in an event
- `server/event-chat.js` - One thread per event (`event_messages`, `event_message_likes`). Posting needs a signed-in email (`lilai_session`), so a name in the thread is backed by an address; the address is never sent to anyone, and a message carries a Host mark only when its address is the event's `host_email`. The name is the address's one name (`contacts.name`), never typed in the chat: the sign-in page asks for it right after the emailed link when there is none (Skip for now), and the chat shows "Posting as Ann · Change" (to `/me?next=/#chat-<id>`, which goes back after Save) or "Add your name to post." (a post without a name is 409 on `name`). A name belongs to its address, not to a message: changing it (Save on `/me`, or making an event while signed in) renames every message that address wrote (`author_name`, through `contacts.setName`'s `onRename` hook, `chat.renameAuthor`), and for a week the messages read "Bob (was Ann)" (`chat_prev_name`, `chat_renamed_at`; within the week the note keeps the name from before the first change, changing back clears it, capitals alone add none, and it is measured against the messages, so clearing the name first does not hide a change). The threads that changed get an `event_message` `renamed`. The chat's sign-in link is the same link with `next` (`requestSignIn(..., { next })`), which brings the person back to the thread
- The author edits or deletes their own message; the host removes any from the management page. Likes are open to anyone, one per device key, stored as a hash. Limits: 10 posts a minute per address, 30 per network, 120 likes a minute per network
- Messages are deleted 180 days after their event (checked every six hours). Delete my email keeps the messages under their name and takes the address off them, so nobody can change them any more
- Readable by anyone, approval events included, like the guest list

### RSVP System
- Actions: "add" (RSVP yes) or "remove" (cancel RSVP)
- Attendee name is required for both actions
- Capacity checking: if attendance_limit is set, prevents RSVPs when full
- Real-time updates via WebSocket broadcast after each RSVP action
- Only `yes` holds a seat; `pending` (asked to join) and `declined` exist for approval events
- A full event puts `add` on the waiting list instead of refusing it; `remove` gives up a place, else a spot on the list, and the first name waiting moves up. The whole route runs in one transaction with the event row locked

### WebSocket Real-Time Updates
WebSocket server runs on same HTTP server as Express. Broadcast messages:
- `attendance_update` - Sent when an RSVP or a host decision changes who is coming (eventId, attendingCount, attendees, pendingCount, waitlist)
- `event_created`, `event_update`, `event_cancelled` - `{ ids }` of events made, edited or restored, cancelled; Home reloads its lists
- `event_published` - `{ id }` after the publisher tried an event's Google copy; its management page reloads the status
- `event_message` - `{ action: posted|edited|deleted|liked|renamed, eventId, message?, id?, likes?, count? }`. An open thread reloads (likes only update the count); cards update their chat count

Clients connect via WebSocket and listen for these messages to update UI without refresh.

### Environment Variables
Required in `.env`:
- `DATABASE_URL` - PostgreSQL connection string (format: postgresql://user:password@host:port/database)
- `DONATION_IBAN`, `DONATION_ACCOUNT_HOLDER` - Optional. Bank details on the Donate page; set both or neither. An invalid IBAN stops startup
- `DONATION_BIC`, `DONATION_REFERENCE`, `DONATION_PAY_LINK` - Optional: BIC, transfer message (default "Lilai donation"), an https card-payment link such as revolut.me
- `RESEND_API_KEY` - Optional. Without it feedback is saved but not emailed
- `FEEDBACK_EMAIL_TO` - Optional, comma-separated; overrides the default inbox `lilai@fisherkuan.com`
- `FEEDBACK_EMAIL_FROM` - Optional. Needs a domain verified in Resend, else the default `onboarding@resend.dev` only delivers to the Resend account's own address
- `NOTIFY_EMAIL_FROM` - Optional. Sender of sign-in links; falls back to `FEEDBACK_EMAIL_FROM`. Without `RESEND_API_KEY` the page answers 503
- `GOOGLE_SERVICE_ACCOUNT_JSON` - A Google service account key (the JSON file, or base64 of it) that publishes events to the Google calendars and runs the one-time import. Share every calendar in `config/app.json` with its `client_email` ("Make changes to events"); the address is logged at startup. Without it events still work in Lilai and their copies wait. A value that does not parse stops startup
- `GOOGLE_MAPS_API_KEY` - Optional. A Google Cloud API key with Places API (New) enabled; turns on Google Maps search in Where and on `/admin/places`. The key may be restricted to the website `lilai.fisherkuan.com` ("Websites" in Cloud Console): the server sends `publicUrl` as Referer. A local run with `PUBLIC_URL=localhost` is then refused, so test search against production's address or with an unrestricted key. Each search is one billed Autocomplete request (10,000 free a month); cap the daily quota in Cloud Console so it cannot bill
- `ADMIN_EMAILS` - Optional, comma-separated. Who may sign in to the admin (default `lilai@fisherkuan.com`). Taking an address off ends its sessions. Admins may also make events in every restricted calendar
- `CALENDAR_WRITERS` - Who may make events in a restricted calendar: `TSA=a@x.be,b@y.be`, several calendars split by `;`. Kept out of `config/app.json` because the repo is public
- `ADMIN_API_KEY` - Optional. Sent as `X-Admin-Key`, it still opens the admin APIs, for scripts; the pages use the sign-in
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

The endpoint catalog (core, chat, sign-in, donation, feedback, booking queue, admin sign-in, configuration) lives in `docs/api-endpoints.md`. Open it before adding or changing a route.

## Booking Queue

The booking queue design and rules live in `docs/booking-queue.md`. Open it before changing booking, waitlist or queue code.

## Release flow

Feature branches open their PRs against `staging`, never `main`. Several merged PRs are tried together on `staging` locally: there is no staging Heroku app (it would cost $5–12 a month). When `staging` holds a complete version, a release PR merges `staging` into `main`, and Heroku deploys `main` to production by itself within a few minutes of the merge (no `git push heroku`). Fixes made on `main` directly are merged back into `staging` straight after.

To try `staging`, run it against its own scratch database, never `event_attendance` or production, and without the production keys, so nothing reaches people:
```bash
createdb lilai_staging   # once
git checkout staging
DATABASE_URL=postgresql://localhost/lilai_staging PUBLIC_URL=http://localhost:3100 PORT=3100 GOOGLE_SERVICE_ACCOUNT_JSON= npm start
```
- No `GOOGLE_SERVICE_ACCOUNT_JSON` while `config/app.json` lists the real calendars. Without it, events stay in the local database and the legacy feed only reads Google
- No `BOOKING_SUBMIT=live`, so booking requests stop short of KU Leuven (`not_sent`)
- No `RESEND_API_KEY`, so feedback is saved and never emailed

## Deployment Notes

Taking the calendars over (once, when this lands in production):
1. Create a Google Cloud service account with the Calendar API enabled; set its key as `GOOGLE_SERVICE_ACCOUNT_JSON` on `lilai-eu`
2. Share each of the three calendars with the service account's email, "Make changes to events"
3. Deploy. On boot each calendar is imported (`[import]` lines in the log) and upcoming events are re-published
4. Make the calendars read-only in Google: remove other people's edit access (the Leuven Taiwanese Google Group on 揪團啦, organizers on SportsCenter, TSA managers on TSA); keep "See all event details" for the public
5. Set who may add TSA events: `heroku config:set -a lilai-eu CALENDAR_WRITERS="TSA=<emails>"`


- Designed for Heroku-style deployment (Procfile present)
- Production is the Heroku app `lilai-eu` (region eu, Basic dyno) serving `lilai.fisherkuan.com` (DNS on Cloudflare, DNS only). Its database is the Heroku Postgres `essential-0` add-on in eu-west-1, with daily backups at 04:00 Brussels (`heroku pg:backups -a lilai-eu`). The Supabase `lilai` project is a paused leftover, not production. Moved from the US app `lilai` on 2026-10-22
- PostgreSQL required in production (DATABASE_URL must be set)
- Static files served from `public/` directory
- WebSocket requires HTTP server support (not just Express)
- SSL automatically enabled for PostgreSQL when NODE_ENV=production
