# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Installable as a PWA (`public/manifest.json`, `public/sw.js`). Most members open it on a phone.

## Users

- **Community members** of the Leuven Taiwanese group. They open Lilai on their phones to see upcoming meetups and RSVP by typing their name.
- **Organizers** create and edit events in Google Calendar (the 揪團啦 calendar needs membership of the Leuven Taiwanese Google Group). Lilai reads those events; organizers do not author events inside Lilai.
- **The owner and a few trusted people** use the admin pages (`/admin`, donations, booking queue). These pages are unlinked, not protected. The booking queue submits KU Leuven sports-court requests for this small group only.

## Product Purpose

Lilai shows what the community is doing and who is coming. A member should find an event and RSVP in seconds, with no account. Success means members check Lilai before a meetup, and organizers can trust the attendance count.

The booking queue has a separate job: KU Leuven opens sports-court booking at midnight Brussels time, 14 days before the play date. The queue sends the request at that moment, so nobody has to stay up for it.

## Positioning

- No login anywhere. RSVP is a typed name. Anyone can cancel anyone's RSVP. This trust model is deliberate: friction costs this community more than abuse would.
- Google Calendar stays the place where events are made. Lilai adds RSVP, attendance limits, live attendance counts and a 14-day view on top of the group's existing calendars.
- The booking queue does a timed submission that the KU Leuven form cannot do by itself.

## Operating Context

- Events come from three Google Calendars in `config/app.json`: SportsCenter, TSA, 揪團啦. An organizer sets a capacity by writing `limit: N` in the event description.
- Attendance updates reach every open client in real time over WebSocket.
- The group coordinates through the Google Group `leuven-taiwanese` (`joinGroupUrl`).
- Hosting: Heroku, with Postgres on Supabase (free tier, US East).
- Booking rules: two slots per name per Mon–Sun week; start times on :00 or :30 only; the season ends on `booking.seasonEndsOn`, renewed each September.

## Capabilities and Constraints

- Surfaces: Home (14-day band, events list, RSVP), FAQ, Donate, admin Events, admin Donations, admin Booking queue and booking detail.
- Vanilla HTML/CSS/JS with no build step. Express server in `server/app.js`.
- The events-list filter must never affect the calendar grid. The grid reads its own `/api/events?timeRange=all` source.
- Live booking submission runs only when `BOOKING_SUBMIT=live`. Otherwise a row ends as `not_sent`, and the board must never say "Request sent" for it.
- A request whose outcome cannot be read becomes `unconfirmed` and is never retried automatically.
- Do not add auth, identity checks or per-user gates to RSVP, attendance limits or the booking queue. Convenience that gates nothing (for example remembering a name in `localStorage`) is welcome.

## Brand Commitments

- Name: **Lilai**. It began serving the Leuven Taiwanese community and is growing into a welcoming app for anyone, so the interface carries no community label (removed 2026-09-27).
- Language: English is the primary UI. Traditional Chinese (zh-TW) is added where it helps, starting with the FAQ (`public/faq.zh-TW.md`). Chinese names such as 揪團啦 stay as written.
- Lilai is a personal project. It never uses the MbarQ work design system.
- No visual system is in force. The old one (`design-mockup.html`, `public/styles.css`) and the ligne claire comic attempt were both retired on 2026-09-27; treat them as anti-references. The owner's stated taste for the replacement: clean and minimal. A light touch of gamified, pixel or retro character is welcome if it is not overdone. Abstract minimal patterns built from geometric shapes are the other acceptable lane.

## Evidence on Hand

- Real FAQ copy in English and Traditional Chinese: `public/faq.md`, `public/faq.zh-TW.md`.
- App icons in `public/icons/`.
- Donations cover hosting and running costs (Heroku, Supabase and similar). Copy must not claim any other use of the money.
- No testimonials, member counts or usage statistics exist. Do not invent them.

## Product Principles

1. Fewest steps to RSVP. Never ask for more than a name.
2. Trust over control. Leave the open write paths open.
3. Say exactly what happened. A status shows what the system did, never what it hoped to do.
4. Google Calendar owns events. Lilai adds attendance on top and does not compete with it.
5. Phone first. The typical visit is a quick check on a phone.
