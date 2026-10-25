# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Planning Documents

When creating implementation plans, improvement analyses, or deployment guides:
- Store all planning documents in `.plans/` directory (git-ignored)
- Use descriptive filenames: `FEATURE_NAME_plan.md`, `IMPROVEMENT_analysis.md`, etc.
- Reference this directory when looking for existing plans or creating new ones

## Visual design: Shape Calendar

The old design system (`design-mockup.html`, `public/styles.css`) and a ligne claire comic attempt were both retired on 2026-09-27. The current world is Bauhaus form-colour grammar: each enabled calendar owns one primary shape in config order (blue circle, red square, yellow triangle), primaries appear only inside shapes, and text, rules and buttons stay black on white. `DESIGN.md` (repo root) is the visual authority; `PRODUCT.md` holds product truth. Copy rule: the design explains itself; a hint line only for a caveat or something not obvious (DESIGN.md, Do's). Every page loads `public/bauhaus/tokens.css` first, then `public/css/lilai.css` (lilai's additions and shared components), then its own page stylesheet in `public/css/` (`faq.css`, `donate.css`, `admin.css` for all admin pages, `booking.css`, `events.css` for Make an event and the host page). `tokens.css` is a verbatim copy of the owner's Bauhaus kit (`~/code/bauhaus`, commit in `public/bauhaus/KIT_COMMIT`): it owns the palette, both themes, strokes, radii and Jost (`public/bauhaus/fonts/`). Never edit it here; change the kit, copy the file over and bump `KIT_COMMIT`. Lilai keeps two deliberate deviations from the kit: primaries only inside calendar shapes (no red buttons or error marks), and the system sans for everything except page titles and big numerals (dates, the balance, the clock), which keep Jost. Dark mode follows the device setting, and the footer switch (`js/theme.js`) can force Light or Dark per device. Lilai's own dark additions (`--ink-3`, `--past`, `--scrim`) live twice in `lilai.css` (the `prefers-color-scheme` block and `:root[data-theme="dark"]`); keep both in sync. Colours belong in tokens, so a new hard-coded colour needs a copy in both dark blocks. The legacy `styles.css` is deleted. The date rail (replaced the 14-day band on 2026-10-22, which had replaced the Google Calendar iframe and the month grid) is the only calendar view; do not bring the others back. The events-list filter must not affect the rail — it reads its own `allCalendarEvents` source (`/api/events?from=&to=`, the rail's 14 days only). The rail's green (`--rail-sel`, `--rail-accent`) is the owner's choice and the one colour outside a shape besides links and focus; an event's chat reuses it for my bubbles and a liked heart (`--chat-*` tokens).

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
- Tables: `events`, `rsvps`, `places`, `admin_codes`, `admin_sessions`, `event_series`, `event_host_links`, `event_activity`, `calendar_keys`, `calendar_state`, `donations`, `feedback`, `booking_queue`, `booking_profiles`, `booking_series`, `contacts`, `contact_tokens`, `device_sessions`, `event_messages`, `event_message_likes`
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
Vanilla JavaScript with no build step.

**Structure:**
- `index.html` + `app.js` - Main event listing and RSVP interface
- `admin-donations.html` + `js/admin-donations.js` - Donation management
- `js/account-link.js` - The header's account link on every public page (Home, FAQ, Donate, host, calendar, sign-in): "Sign in", or "Profile" once this device signed in on `/me`; both open `/me`. It also adds "Admin" (to `/admin/bookings`, the star sprite, at the very end of the header) on all of them while the device carries the organiser flag (`lilaiOrganizer`, set on Home by `?admin=1` or five taps on its heading); below 360px the wordmark drops its name to make room. Home's sidebar "Sign in" link (`[data-signed-out]`) hides once signed in. The cookie is HttpOnly, so `js/me.js` keeps the note in `lilai.signedIn`. Admin pages keep their own sign-in
- `admin-login.html` + `js/admin-login.js` - Admin sign-in (`/admin/login?next=`): email, then the six-digit code (a full code signs in by itself)
- `js/admin-session.js` - On Donations and Places: who is signed in, Sign out, and `AdminSession.adminFetch` (a 401 goes back to sign-in)
- `admin-places.html` + `js/admin-places.js` - The saved places (`/admin/places`, signed in): add (with "Find on Google Maps" filling name and address), edit, reorder, remove
- `donations.html` + `js/donation.js` - Public donation submission page
- `faq.html` + `js/faq.js` - FAQ page
- `bauhaus/tokens.css` - The Bauhaus kit's tokens, copied verbatim (do not edit)
- `css/lilai.css` - Lilai's token additions, shared components and Home (Shape Calendar world, see `DESIGN.md`)
- `css/faq.css`, `css/donate.css`, `css/admin.css`, `css/booking.css`, `css/events.css` - Page stylesheets, loaded after `lilai.css` (`events.css`: the management and calendar pages; the event form itself is shared and lives in `lilai.css`)
- `js/sprites.js` - The header's icons as 16x16 pixel sprites in a Super Mario spirit, drawn for Lilai: Report a bug a Goomba-like critter (first after the wordmark), FAQ a ? block, Donate a coin, the account link a ghost when signed out and a capped head when signed in, Admin a star (last). `Sprites.svg(name)` draws one, `Sprites.iconize(link, name, label, short)` draws a link as its sprite (the word kept as `aria-label` and `title`) or, when the device chose the footer's "Header: Text" (`lilai.headerStyle`), as its short word (FAQ, Donate, Sign in / Profile, Admin; the bug stays an icon, splitly's line bug); either way the header stays one line at 320px. Loaded before `account-link.js` and `feedback.js`; tested in `tests/sprites.test.js`
- `js/feedback.js` - The "Send feedback" sheet, opened by the bug at the end of the header ("Report a bug", the Goomba sprite; splitly's line bug where sprites.js is not loaded) and by the footer's "Send feedback" button, on every page with a `.colophon` (ported from splitly)
- `js/sheet.js` - Shared behaviour for every sheet (`.modal`, `.bs-root`), on every page with feedback: locks the page scroll while one is open, keeps the sheet above the iOS keyboard (`--vv-top`/`--vv-h` from `visualViewport`) and the focused field in sight (centred; a combobox to the top, so its suggestions show), and makes the grabber work on phones (drag up for full screen, down to go back or dismiss, tap to toggle; `settle` tested in `tests/sheet.test.js`). Sheets do not touch `body.style.overflow` themselves
- `js/make-event.js` - Home's "Make an event" slide-in (`#event-sheet`), opened by any `[data-make-event]` button (the "+" by the view switch, the sidebar button) and by `/#new` or `/#new=<calendar>`. `/events/new` redirects there. After making, it shows the management link with Copy and Share, and points to Profile for finding it again (no email). It also renders "You manage" in Home's hosting card (`renderHosted`, called again by `app.js` once events load, for the time and who is coming); a management link entry stores `eventId` and `calendar` for that
- `js/event-form.js` - `EventForm.create(container, { mode })`: the one form for making (`create`: calendar, repeat, host) and editing (`edit`) an event. Repeat preview from `/api/events/repeat-preview`. Where is required: the saved places first (`/api/places`, ranked by `js/place-search.js`), then Google Maps suggestions under "Google Maps" when the server has a key (`/api/places/search`). A Google pick sends `locationAddress` and `placeId`; without a key any typed place is taken
- `js/time-wheel.js` - `TimeWheel.attach(select)`: a time `<select>` becomes a button that opens two snapping columns (hours, minutes) under it; Done, a tap outside or Escape writes the select and fires `change`, and a value set from code shows on the button. Used for the event form's Starts / Ends and the booking sheet's two start times
- `js/place-search.js` - `PlaceSearch.rank(places, query)`: the owner's places, closest match first (exact, start, word start, inside, every word, then aliases and addresses; letters-in-order guesses only when nothing else matches). Ignores case, accents and spaces. Tested in `tests/place-search.test.js`
- `js/event-links.js` - An event's links: `listHtml` draws them on cards and the RSVP sheet (name, else the site), `create` is the link editor inside the event form. Tested in `tests/event-links.test.js`
- `js/device-links.js` - What this device holds: management links (`lilai.hostedEvents`, listed as "You manage" in Home's sidebar) and calendar keys (`lilai.calendarKeys`), plus `share()` (Web Share, else the clipboard)
- `host.html` + `js/host.js` - An event's management page (`/host/:token`): the Google copy's status, Edit (the event form in a sheet), Copy management link (the page address, cut off, with a copy icon), Cancel / Restore, the dates of a series, and who is coming or asked to join (Accept / Decline / Undo). Live over WebSocket
- `calendar.html` + `js/calendar-page.js` - A calendar key's page (`/calendars/:token`): stores the key on the device, lists the calendar's upcoming events with Manage (mints a management link), "Make a <calendar> event", Share
- `me.html` + `js/me.js` - Sign in, then the profile (`/me`: titled Sign in when signed out, Profile when signed in: an initial in an ink disc with the name and email, then grouped cards (Name; You host, You joined and Past as day blocks with the calendar shape, a tap opens Manage or the event; Display with the Theme and Header pill switches, the footer's two switches kept in step through the `lilai:theme` and `lilai:header` page events; Sign out of this device and Delete my email); called Find my events until 2026-10-25), linked from the header and Home's sidebar; `/#lost-link` redirects there: type an email, open the emailed link (`/me/signin/<token>`, which signs in on load; the link works any number of times for 30 minutes, because mail scanners open links first), and this device lists the events that address hosts and joined. Manage mints a management link and keeps it under "You manage"; "Your name" (the email's name, Save); Sign out; Delete my email. Opened with `?next=/#chat-<id>` or `?next=/#new` (Make an event's Change link), both the sign-in and the profile show a Back link there, Save on the name returns there, and a new sign-in link carries it; Change keeps what was typed in `lilai.eventDraft` (30 minutes) and the sheet fills it back in. Signing in fills this device's empty `lilai.attendeeName` and `lilai.hostEmail`, which the RSVP sheet and Make an event read
- `js/event-chat.js` - Chat in an event (#56): the chat button on every card (past ones too, with its count) opens a slide-in thread (`#chat-sheet`) of bubbles, mine green on the right. Anyone reads and likes (a like belongs to a device key, `lilai.likerKey`); posting needs the sign-in session, so the panel asks for an email first and the emailed link lands back on `/#chat-<id>`. The author edits or deletes their own messages; live over `event_message`. `stampText`, `groupStarts` tested in `tests/event-chat.test.js`
- `sw.js` - Service worker for PWA support. It never caches `/host/`, `/calendars/`, `/me`, their APIs or an event's messages: those carry secret links, a person's events or who is signed in

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
- `places[]` - Seed only: copied into the `places` table the first time it is made. After that the list lives in the database and is edited on `/admin/places`; changing this array does nothing
- `rsvp` - RSVP behavior settings
- `joinGroupUrl` - Link to external group (displayed in UI)

## Key Implementation Details

### Events (Lilai owns them; Google calendars are published copies)
- `server/event-hosting.js` - `validateEvent` (one validator for `create` and `edit`; Brussels wall times; an end at or before the start is the next day; DST gaps refused; an edit may keep a start that has passed but not move one into the past), `googleEventResource` (the copy: description plus the links and a "Join, or see who is coming: <publicUrl>/#event-<id>" line, `source` back to Lilai), `convertLegacyDescription`, tokens, `publishState`, the schema
- Event ids are `cal-<google id>@google.com`, the shape the old feed used, so the import landed on the rows that held RSVPs. Lilai picks each new copy's Google id (`newGoogleEventId`, 32 hex) so a retried insert is refused with 409 instead of making a twin
- `server/calendar-publish.js` - Pushes rows with `managed AND version > synced_version`: insert (first copy; 409 → update), update (PUT; 404 → insert, which also brings back a copy deleted in Google), delete (cancelled; 404/410 = done). Success records the pushed version; failure stores `push_error`, `push_attempts` and `next_push_at` (30 s doubling to 6 h). 30 s tick plus `nudge()` after each change. Without credentials nothing is pushed and the management page says so
- `server/calendar-import.js` - Once per calendar (`calendar_state`): `events.list` (all pages, `singleEvents`, two years ahead), each Google event onto `cal-<iCalUID>` (a repeating event's instances by their own id) as `managed`; the old "limit: N" / "link: URL" description lines move into their fields once; upcoming events are published once so their copies match; unmanaged rows Google no longer lists are deleted. Retried every 10 minutes on failure
- `server/calendar-sync.js` + `fetchCalendarEvents` in `app.js` - The legacy iCal feed, only for calendars not yet imported, never touching a managed row. Remove once production has imported every calendar
- Places: an event stores the place's name in `location`, plus `location_address` and `place_id` when it was picked from the saved list or Google Maps. `validateEvent` takes a saved place (its spelling and address), a Google pick (a `placeId`), the place an edited event already had, or, with Google search off (`allowAnyPlace`), anything typed. `server/places.js` holds the saved list (table `places`, in memory, reloaded after each change). The Google copy's location is "name, address"
- `server/google-calendar.js` - Service-account JWT sign-in and `insertEvent` / `updateEvent` / `deleteEvent` / `listEvents`, no SDK
- `server/calendar-access.js` + `scripts/calendar-link.js` - Calendar keys (`calendar_keys`, hash only). `heroku run -a lilai-eu node scripts/calendar-link.js TSA --label "TSA admins"` prints a `/calendars/<token>` link once; `--revoke` stops the earlier ones. A key lets a device make events in a restricted calendar and mint a management link for any event in that calendar
- Management links: `event_host_links` maps a token hash to one event or one series. Made when an event is made (shown on the made screen, never emailed since 2026-10-25: the host is signed in, and Profile mints a fresh one), when Profile's Manage is used, and when a calendar key holder opens Manage. No accounts, in line with the RSVP trust model; whoever has the link is a host
- Every event has a host email (required since 2026-10-25, and since PR #70 the signed-in email: Make an event asks for a sign-in first, its link comes back to `/#new`, and the form shows the address with Change instead of an email field), so signing in is the one way back to a lost link; there is no admin recovery. The host name is only the host's place on the guest list, asked only when they join.
- Sign-in (`server/contacts.js`, #55 phase 1; once called Find my events): any address gets a sign-in link (30 minutes, reusable until then, 3 an hour per address, 20 an hour per network), so one can sign in only to chat; the page then lists whatever events the address hosts (`events.host_email`, any case) or joined. Opening it confirms the address in `contacts` and sets the `lilai_session` cookie (90 days, `device_sessions`, hashes only). `rsvps.contact_email` exists for phase 2's "Email me about changes" and is already listed under "You joined". Delete my email clears the address from events and RSVPs, the contact's name, and its sessions; event and RSVP names stay. `contacts.name` is set only through a proven address: on sign-in from the latest event's host name, by Save on `/me` (`PUT /api/me/name`), or when a signed-in device makes an event with that email. Design: `.plans/VERIFIED_CONTACT_plan.md`
- Activity: `event_activity` (`server/event-activity.js`) logs what happened to each event: made, joined, asked, left, accepted, declined, removed, readded, reasked, edited (with the fields that changed), cancelled, restored, and for the waiting list listed, leftlist, promoted, movedin, delisted, relisted. Each row is written in the transaction of the change it records. A row names the person a change was about, never who made it. When the table is first created it is seeded from the places and requests already in `rsvps`. The management page shows it (`activity` in `GET /api/host/:token`)
- Repeating events: a repeat rule (`server/booking-repeat.js`: every N days / weeks on chosen weekdays / months, until a date, at most 52) expands into ordinary rows sharing `series_id` (`event_series.rule`). Each date has its own RSVPs, approval queue and single Google copy. Edit and Cancel take `scope: this | later`; later dates keep their own day and take the new clock times and everything else. The rule is fixed once made
- Cancel sets `cancelled_at` (hidden from every public read, RSVPs kept, Google copy deleted); Restore clears it
- Approval events ("I approve each person"): Join reads "Ask to join", requests hold no seat, the card shows "N asking" and "<host> confirms each place"
- Waiting list (#57, `server/waiting-list.js`): a full event's Join reads "Join the waiting list", and so does any event with a list already, so nobody overtakes it. The card shows "N waiting" and, for the name this device remembers, "Ana is 2nd on the waiting list". When a place opens (someone leaves, the host removes someone, declines a request or raises or drops the limit), `promote` moves the first names up in the same transaction, under the event row lock: to `yes`, or on an approval event to `pending` while the open requests leave a seat for them. Automatic, no offer to confirm and no cut-off before the start; one list per date. The management page lists it in order with Move in (a place now, past the limit if need be) and Remove; Undo on a declined name puts it back on the list while the event is full. Remove a name on Home also leaves the list

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
- `ADMIN_EMAILS` - Optional, comma-separated. Who may sign in to the admin (default `lilai@fisherkuan.com`). Taking an address off ends its sessions
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

### Core Endpoints
- `GET /api/events` - List events. Query params:
  - `timeRange=future|past|all` (default from `events.defaultTimeRange`)
  - `from=<ISO>&to=<ISO>` - events starting in that window; the date rail uses it.
  - `before=<ISO>&limit=N` - paginated past-events fetch, newest-first; used by the "Load earlier events" flow on the Home page (`loadOlderEvents` in `app.js`).
- `GET /api/events/:id` - Get specific event (404 once cancelled)
- `GET /api/events/repeat-preview?date=&every=&unit=&weekdays=&until=` - The dates a repeat lands on (the form's preview), or `{error}`
- `POST /api/events` - Make an event, or a repeating one (anyone signed in; 401 on `hostEmail` otherwise). The host email is the signed-in one; a `hostEmail` in the body is ignored. Body `{title, calendar, date, start, end, location?, description?, links?, limit?, approval?, repeat?: {every, unit, weekdays, until}, hostName (required only when hostJoins), hostJoins?, calendarKeys?: [token]}`, times as Brussels wall time. A restricted calendar needs one of its keys in `calendarKeys` (403 otherwise). Saves first, then the publisher copies it to Google. Answers `{id, ids, count, date, hostPath, publishing}` and broadcasts `event_created`; 400 `{field, message}` on bad input
- `GET /api/host/:token[?event=<id>]` - The management page's data: the event (with its form values, calendar, publish status), every RSVP row with its status, and for a series its rule and dates. Without `event` a series opens on its next date
- `PUT /api/host/:token/events/:eventId` - Edit (the event form's fields plus `scope`); broadcasts `event_update`
- `POST /api/host/:token/events/:eventId/cancel` - Body `{scope}`; broadcasts `event_cancelled`
- `POST /api/host/:token/events/:eventId/restore`
- `POST /api/host/:token/events/:eventId/requests/:rsvpId` - Body `{decision: accept|decline|undo|wait}`. Accept respects the limit under a row lock (409 when full), except for a name on the waiting list (Move in). `wait` puts a declined name back on the list. Whatever a decision frees goes to the waiting list
- `GET /api/calendar-access/:token` - A calendar key's calendar and its upcoming events
- `POST /api/calendar-access/:token/events/:eventId/manage` - Mints a management link for one of that calendar's events (a series gets one link for all its dates)
- `GET /api/places` - The saved places in the owner's order (`{places: [{id, name, address, aliases, placeId}], google}`); `google` says whether Google Maps search is on. The form ranks them itself
- `GET /api/places/search?q=&session=` - Google Maps suggestions (`server/place-autocomplete.js`: Places API (New) Autocomplete, biased to Leuven, at most five, cached a day, 30 a minute per visitor). `[]` without `GOOGLE_MAPS_API_KEY`
- `POST /api/places`, `PUT /api/places/:id`, `DELETE /api/places/:id`, `PUT /api/places/order` (`{ids}`) - The saved places' admin, behind `X-Admin-Key`. A second place with the same name (any case) is 409 on `name`. Removing a place never touches events already there
- `POST /api/rsvp` - Submit RSVP (body: `{eventId, action: "add"|"remove", attendeeName}`). A cancelled event is not found. On an approval event, `add` asks to join: the row is `pending`, the answer carries `pending: true`, and one open request per name. On a full event `add` joins the waiting list: `listed: true` and `position`, one spot per name. Answers and the `attendance_update` broadcast carry `attendees`, `attendingCount`, `pendingCount` and `waitlist` (names in order); `GET /api/events` carries `waitlist` too
- Public event JSON never includes `host_email` or the publishing bookkeeping (`publicEvent` in `server/event-hosting.js`), and never a cancelled event

### Chat Endpoints
`server/event-chat.js`. 404 for a missing or cancelled event.
- `GET /api/events/:id/messages?liker=<device key>` - `{messages: [{id, name, wasName, body, at, editedAt, likes, liked, host, mine}], me: {email, name, host} | null}`
- `POST /api/events/:id/messages` - Body `{body}`, signed in (401 otherwise), under the address's name (409 on `name` without one); 429 over the limit
- `PUT /api/events/:id/messages/:messageId` - Body `{body}`; `DELETE` the same path. The author only (403)
- `POST /api/events/:id/messages/:messageId/like` - Body `{liker, like: true|false}`; open to anyone
- `POST /api/events/:id/messages/signin` - Body `{email}`. Mails a sign-in link to any address, back to `/#chat-<id>`
- `DELETE /api/host/:token/events/:eventId/messages/:messageId` - The host removes a message; answers the management page's view, which lists the thread as `messages`

### Sign-in Endpoints
`server/contacts.js`.
- `POST /api/me/link` - Body `{email}`. Mails a sign-in link to any address. 400 bad address, 429 too many tries from one network, 503 without email
- `POST /api/me/session` - Body `{token}`. Redeems the link once and sets `lilai_session`; answers `{email, name}`, so the page can ask for a missing name. 401 when used or expired
- `GET /api/me` - `{email, name, chatMessages, upcoming, past, joined}` (a series shows once, with `count`), or 401
- `POST /api/me/events/:eventId/manage` - A fresh management link (`created_via = 'email'`) for an event the address hosts; 404 otherwise
- `PUT /api/me/name` - Body `{name}`; empty clears it. Renames the address's chat messages (see Chat in an event)
- `DELETE /api/me/session` - Sign out this device. `DELETE /api/me` - Delete my email

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

### Admin Sign-in Endpoints
`server/admin-auth.js`. Guards `/admin/donations`, `/admin/places` (a page redirects to `/admin/login?next=`), `POST /api/donations` and the places writes (401). The booking queue stays open by design. Codes and sessions are stored as SHA-256 hashes; mail goes through Resend with `FEEDBACK_EMAIL_FROM`, so sign-in needs `RESEND_API_KEY` like the feedback mail.
- `POST /api/admin/code` - Body `{email}`. An address on `ADMIN_EMAILS` gets a six-digit code valid ten minutes (five an hour); every other address gets the same answer and no mail. 503 `{message}` when the mail cannot go out
- `POST /api/admin/session` - Body `{email, code}`. The right code (used once; five wrong tries spend it) sets the `lilai_admin` cookie: HttpOnly, SameSite=Lax, Secure in production, 30 days. 401 otherwise
- `GET /api/admin/session` - `{email}` of the signed-in admin, or 401
- `DELETE /api/admin/session` - Sign out: the session row is deleted and the cookie cleared, and this device's `/me` session with it
- A device signed in on `/me` (`lilai_session`) with an address on `ADMIN_EMAILS` is an admin too, with no code (`createAdminAuth({ emailOf })`)

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

## Release flow

Feature branches open their PRs against `staging`, never `main`. Several merged PRs are tried together on `staging` locally: there is no staging Heroku app (it would cost $5–12 a month). When `staging` holds a complete version, a release PR merges `staging` into `main`, and `main` deploys to production (`git push heroku main`). Fixes made on `main` directly are merged back into `staging` straight after.

To try `staging`, run it against its own scratch database, never `event_attendance` or production, and without the production keys, so nothing reaches people:
```bash
createdb lilai_staging   # once
git checkout staging
DATABASE_URL=postgresql://localhost/lilai_staging PUBLIC_URL=http://localhost:3100 PORT=3100 GOOGLE_SERVICE_ACCOUNT_JSON= npm start
```
- No `GOOGLE_SERVICE_ACCOUNT_JSON` while `config/app.json` lists the real calendars. Without it, events stay in the local database and the legacy feed only reads Google
- No `BOOKING_SUBMIT=live`, so booking requests stop short of KU Leuven (`not_sent`)
- No `RESEND_API_KEY`, so feedback is saved and never emailed

To try it from a phone, publish the local server on the tailnet over HTTPS. Only devices signed in to the owner's tailnet can reach it:
```bash
tailscale serve --bg 3100      # https://<machine>.<tailnet>.ts.net -> localhost:3100; `tailscale serve status` shows the name
PUBLIC_URL=https://<machine>.<tailnet>.ts.net  # in the start command above, so management links and emails point there
tailscale serve --https=443 off  # stop publishing
```
Use the `https://…ts.net` address, never `http://100.x.y.z:3100`. Over plain http on a non-localhost address the browser has no secure context: Copy link (`navigator.clipboard`), Web Share and the service worker do not work. WebSockets pass through `tailscale serve`.

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
