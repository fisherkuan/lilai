# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Installable as a PWA (`public/manifest.json`, `public/sw.js`). Most members open it on a phone.

## Users

- **Community members** of the Leuven Taiwanese group. They open Lilai on their phones to see upcoming meetups and RSVP by typing their name.
- **Hosts** make events in Lilai (Home's "Make an event" sheet), one-off or repeating, with an optional seat limit, links, and the choice to approve each person. Each event has a management page reached by its own link, not an account: edit, cancel, approve, and share the link with co-hosts. Anyone can host in an open calendar.
- **Calendar admins** hold a calendar's key link. TSA is restricted: only its admin group (holders of the TSA link) can add TSA events. A key also opens the management page of any event in that calendar.
- **Subscribers** follow the group's Google calendars in their own calendar apps. Those calendars are read-only copies that Lilai publishes.
- **The owner and a few trusted people** use the admin pages (`/admin`: donations, booking queue). These pages are unlinked, not protected. The booking queue submits KU Leuven sports-court requests for this small group only.

## Product Purpose

Lilai shows what the community is doing and who is coming. A member should find an event and RSVP in seconds, with no account. Success means members check Lilai before a meetup, and organizers can trust the attendance count.

The booking queue has a separate job: KU Leuven opens sports-court booking at midnight Brussels time, 14 days before the play date. The queue sends the request at that moment, so nobody has to stay up for it.

## Positioning

- No login anywhere. RSVP is a typed name. Anyone can cancel anyone's RSVP. This trust model is deliberate: friction costs this community more than abuse would.
- Lilai is where events live (since 2026-10-24): its database is the source of truth, and it publishes each calendar to Google as a read-only copy so people can subscribe from any calendar app. Nothing flows back from Google. Lilai adds RSVP, seat limits, host approval, repeating events, live attendance and a 14-day view.
- The booking queue does a timed submission that the KU Leuven form cannot do by itself.

## Operating Context

- Three calendars in `config/app.json`, all published: SportsCenter, TSA (restricted to its admins), 揪團啦. Every field of an event, the seat limit and links included, is set in Lilai, never in a Google description.
- Attendance updates reach every open client in real time over WebSocket.
- The group coordinates through the Google Group `leuven-taiwanese` (`joinGroupUrl`).
- Hosting: Heroku (`lilai-eu`), with Heroku Postgres in eu-west-1. Publishing uses a Google service account that each calendar is shared with.
- Booking rules: two slots per name per Mon–Sun week; start times on :00 or :30 only; the season ends on `booking.seasonEndsOn`, renewed each September.

## Capabilities and Constraints

- Surfaces: Home (date rail, events list, RSVP, the "Make an event" sheet), an event's management page, a calendar's key page, FAQ, Donate, admin Donations, admin Booking queue and booking detail. There is no admin page for events.
- Vanilla HTML/CSS/JS with no build step. Express server in `server/app.js`.
- The events-list filter must never affect the date rail. The rail reads its own `/api/events?from=&to=` source.
- A Google calendar is output only. Never read an event back from Google after its calendar is imported, and never add a two-way sync.
- Live booking submission runs only when `BOOKING_SUBMIT=live`. Otherwise a row ends as `not_sent`, and the board must never say "Request sent" for it.
- A request whose outcome cannot be read becomes `unconfirmed` and is never retried automatically.
- Do not add auth, identity checks or per-user gates to RSVP, attendance limits or the booking queue. Host approval is the host's choice per event, not a gate Lilai adds. Management pages and calendar keys are capability links; TSA's restriction is the one write gate, and it limits who adds events to a calendar, never who joins one. Convenience that gates nothing (for example remembering a name in `localStorage`) is welcome.

## Brand Commitments

- Name: **Lilai**. It began serving the Leuven Taiwanese community and is growing into a welcoming app for anyone, so the interface carries no community label (removed 2026-09-27).
- Language: English is the primary UI. Traditional Chinese (zh-TW) is added where it helps, starting with the FAQ (`public/faq.zh-TW.md`). Chinese names such as 揪團啦 stay as written.
- Lilai is a personal project. It never uses the MbarQ work design system.
- The visual system is Shape Calendar, recorded in `DESIGN.md` (adopted 2026-09-27). It replaced the old design system (`design-mockup.html`, `public/styles.css`) and a ligne claire comic attempt; treat both as anti-references. The owner's taste behind it: clean and minimal, with a light touch of play that is never overdone.

## Evidence on Hand

- Real FAQ copy in English and Traditional Chinese: `public/faq.md`, `public/faq.zh-TW.md`.
- App icons in `public/icons/`.
- Donations cover hosting and running costs (Heroku and similar). Copy must not claim any other use of the money.
- No testimonials, member counts or usage statistics exist. Do not invent them.

## Product Principles

1. Fewest steps to RSVP. Never ask for more than a name, also when asking a host to join.
2. Trust over control. Leave the open write paths open.
3. Say exactly what happened. A status shows what the system did, never what it hoped to do.
4. Lilai owns events; Google calendars are copies. A status shows whether a copy has reached Google, and a Google outage never blocks a host.
5. Phone first. The typical visit is a quick check on a phone.
