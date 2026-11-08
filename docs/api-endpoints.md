## API Endpoints

### Core Endpoints
- `GET /api/events` - List events. Query params:
  - `timeRange=future|past|all` (default from `events.defaultTimeRange`)
  - `from=<ISO>&to=<ISO>` - events starting in that window; the date rail uses it.
  - `before=<ISO>&limit=N` - paginated past-events fetch, newest-first; used by the "Load earlier events" flow on the Home page (`loadOlderEvents` in `app.js`).
- `GET /api/events/:id` - Get specific event (404 once cancelled)
- `GET /api/events/repeat-preview?date=&every=&unit=&weekdays=&until=` - The dates a repeat lands on (the form's preview), or `{error}`
- `POST /api/events` - Make an event, or a repeating one (anyone signed in; 401 on `hostEmail` otherwise). The host email is the signed-in one; a `hostEmail` in the body is ignored. Body `{title, calendar, date, start, end, location?, description?, links?, limit?, approval?, repeat?: {every, unit, weekdays, until}, hostName (required only when hostJoins), hostJoins?}`, times as Brussels wall time. A restricted calendar needs the signed-in email on its allow list (403 otherwise). Saves first, then the publisher copies it to Google. Answers `{id, ids, count, date, hostPath, publishing}` and broadcasts `event_created`; 400 `{field, message}` on bad input
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
- `POST /api/me/session` - Body `{token}` (the link) or `{email, code}` (the six digits). Signs in and sets `lilai_session`; answers `{email, name}`, so the page can ask for a missing name. 401 when expired, or on `code` for a wrong or spent code
- `GET /api/me` - `{email, name, chatMessages, upcoming, past, joined}` (a series shows once, with `count`), or 401
- `POST /api/me/events/:eventId/manage` - A fresh management link (`created_via = 'email'`) for an event the address hosts; 404 otherwise. An admin (`ADMIN_EMAILS`, signed in on `/me` or the admin) gets one for any managed event (`created_via = 'admin'`): a silent co-host, named nowhere on the event. Home shows admins a key on every card for it (`checkAdminDevice` asks `/api/admin/session` only when the device notes a sign-in)
- `PUT /api/me/name` - Body `{name}`; empty clears it. Renames the address's chat messages (see Chat in an event)
- `GET /api/me/roles` - `{admin, organizer}` for the signed-in device (an admin counts as an organiser), or 401
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
`server/admin-auth.js`. Guards `/admin/donations`, `/admin/places` (a page redirects to `/admin/login?next=`), `POST /api/donations` and the places writes (401). The booking queue takes its organisers too (see Booking Queue). Codes and sessions are stored as SHA-256 hashes; mail goes through Resend with `FEEDBACK_EMAIL_FROM`, so sign-in needs `RESEND_API_KEY` like the feedback mail.
- `POST /api/admin/code` - Body `{email}`. An address on `ADMIN_EMAILS` gets a six-digit code valid ten minutes (five an hour); every other address gets the same answer and no mail. 503 `{message}` when the mail cannot go out
- `POST /api/admin/session` - Body `{email, code}`. The right code (used once; five wrong tries spend it) sets the `lilai_admin` cookie: HttpOnly, SameSite=Lax, Secure in production, 30 days. 401 otherwise
- `GET /api/admin/session` - `{email}` of the signed-in admin, or 401
- `GET /api/organizers`, `POST /api/organizers` (`{email}`), `DELETE /api/organizers/:email` - The booking organisers, admins only; each answers the list
- `DELETE /api/admin/session` - Sign out: the session row is deleted and the cookie cleared, and this device's `/me` session with it
- A device signed in on `/me` (`lilai_session`) with an address on `ADMIN_EMAILS` is an admin too, with no code (`createAdminAuth({ emailOf })`)

### Configuration
- `GET /api/config` - Get app configuration (calendars, settings)
- `GET /api/health` - Health check

