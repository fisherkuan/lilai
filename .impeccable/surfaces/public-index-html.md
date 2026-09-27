---
version: 1
slug: "public-index-html"
primary_target: "public/index.html"
related_targets: ["public/app.js"]
---

Scope: Home (`public/index.html`, `public/app.js`, new `public/css/lilai.css`). Mode: Operate. First surface of a replacement world; FAQ, Donate and admin inherit it later. Build path: code-led (no image generation on this machine).

Job: a member on a phone sees what's next, sees who's coming, and joins with a typed name. Proof: real events, real names. Must stay: the band reads its own all-events source (the month grid was removed 2026-09-27 as redundant with it); trust model (anyone RSVPs or cancels any name); live WebSocket updates; "Load earlier events"; admin link injected by JS only. Owner's limits: no pixel font for body text, no points/badges/streaks, no sounds or bouncy motion. Start from committed `app.js` (the comic build's JS was discarded).

## Direction contract

THESIS: Each calendar is one primary shape, and the next two weeks are an abstract composition drawn from the real events. Refuses the event-card list with avatar stacks and a "Going" pill.

OWN-WORLD: Bauhaus form-colour grammar on white. Blue circle, red square, yellow triangle, one per calendar in config order. Flat fills, no shadows, no gradients, no rounded cards. Black 1.5px rules divide content; there are no boxes. Primaries appear only inside shapes; text, rules and buttons are black on white. Jost (Futura lineage) for everything Latin, system PingFang TC / Noto Sans TC for Chinese.

STORY: The member sees the next two weeks as a row of shapes, reads the next event's date and names, and joins; their seat fills with the calendar's shape and their name prints into the list.

FIRST VIEWPORT: Phone 390px. Wordmark "Lilai" with its three shapes at left, no community label, FAQ and Donate at right. Below, the 14-day band: day ticks, each event its shape sized by headcount, the Today rule at the left edge. Below the band, the next event: date numeral about 96px, weekday and time beside it, title, place, the seat-slot row, the names list, and a full-width black Join in thumb reach.

FORM: Shape Calendar (Bauhaus form-colour grammar), position 7 of 7, seed key 680d631f. Raises: one Today rule divides past and future in band and list (dive profile); four capacity states: outline slots open, solid slots filling, black slot row full, grey outlines past (tensegrity); a new RSVP prints as a line in the names list, never a toast (terminal); primaries only inside shapes (monochrome product); constant metadata scale, only the date numeral breaks it (Busytown). Signature interaction: Join fills your seat slot with the calendar's shape and grows that event's shape in the band one step. Motion grammar: shapes scale from their centre with an exponential ease-out on state change only; nothing moves on load; reduced motion is instant.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
