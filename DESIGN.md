---
name: Lilai
description: Meetups and who is coming, as a Shape Calendar, one Bauhaus primary shape per calendar on the Bauhaus kit's off-white paper.
colors:
  paper: "#efefea"
  paper-raised: "#fafaf7"
  stone: "#dcdbd3"
  line: "#85857e"
  ink: "#161616"
  ink-muted: "#55554f"
  ink-3: "#62625c"
  past: "#a9a9a2"
  blue: "#1a22b0"
  red: "#d63a2a"
  yellow: "#eeae53"
  link: "#0b57d0"
  focus: "#1a22b0"
typography:
  numeral-lead:
    fontFamily: "Jost, Futura, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "96px"
    fontWeight: 500
    lineHeight: 0.78
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  numeral-wide:
    fontFamily: "Jost, Futura, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 500
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  numeral:
    fontFamily: "Jost, Futura, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 500
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline-wide:
    fontFamily: "Jost, Futura, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Jost, Futura, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  sheet-title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  control:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "17px"
    fontWeight: 500
    lineHeight: 1.5
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  small:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, PingFang TC, Noto Sans TC, Microsoft JhengHei, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  none: "0px"
  control: "12px"
  card: "16px"
  sheet: "20px"
  full: "9999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
  s7: "48px"
  s8: "64px"
components:
  button-solid:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "0 24px"
    height: "44px"
  button-solid-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  button-line:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "0 24px"
    height: "44px"
  button-line-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-event:
    typography: "{typography.button}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "40px"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    height: "44px"
  text-button:
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    height: "44px"
  input:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "50px"
  field-label:
    textColor: "{colors.ink-muted}"
    typography: "{typography.label}"
  choice-chip:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body-small}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "44px"
  choice-chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  event-box:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "24px 16px"
  sheet:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    width: "480px"
  admin-tab:
    textColor: "{colors.ink-muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    height: "38px"
  admin-tab-active:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
  table-head:
    textColor: "{colors.ink}"
    typography: "{typography.label}"
  status-mark:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.none}"
    size: "10px"
  balance-bar:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.none}"
    height: "14px"
    width: "400px"
---

# Design System: Lilai

## Overview

**Creative North Star: "The Shape Calendar"**

Lilai follows a Bauhaus form-colour grammar on off-white paper. Each enabled calendar owns one primary shape, assigned in config order: a blue circle, a red square, a yellow triangle. A fourth calendar, or an event with no known source, gets an ink diamond. The shape is the calendar's identity everywhere it appears: the wordmark, the date rail, the legend, the event title mark, the seat slots and the management page's title. The rail reads as a compact picker of the next two weeks, marked with the real events.

Everything else is ink on paper. Text, rules and buttons carry no colour, so the primaries stay loud and always mean "this calendar". Each event sits in its own rounded box (16px) with a 2px ink outline on raised paper, so where one ends and the next begins is plain; sections are divided by 2px ink rules. Labels are short sentence-case Jost. Metadata sits at one constant size. Every event carries the same weight: there is no lead event. The date numerals are the only type that breaks scale, all at one size.

Motion is scarce and tied to state. When attendance changes, a shape scales from its centre with an exponential ease-out. A new RSVP prints bold into the names list. Nothing moves on load, and reduced motion is instant.

**Key Characteristics:**
- One primary shape per calendar, flat fill, 1.5px ink contour.
- Primaries appear only inside shapes. The two exceptions come from the kit: the yellow text selection and the blue focus ring. Outbound links take lilai's own azure, not a primary.
- Lifted, as in iOS grouped lists: a grey ground (`--ground`, the kit's fill; paper in dark) under raised, borderless 16px cards with a soft shadow. Buttons and chips are filled pills with no outline; fields are filled with 12px corners. Calendar shapes and status marks stay square. 1px line-grey hairlines divide dense rows inside a section. There are no gradients.
- Every event has the same size and the same grey Join pill. The date rail and its agenda already show what comes next.
- Constant 14px metadata; only numerals break scale (the event dates, the Donate balance, 96px on the booking detail date).
- Shapes carry state: outline open, calendar colour taken, all ink full, grey outline past.
- Motion happens on state change only, scaling shapes from their centre.

**The kit.** Lilai's base tokens come from the owner's Bauhaus kit at `~/code/bauhaus`. Its source of truth is the claude.ai artifact https://claude.ai/artifact/LS4XQ7G4sWamw5Tpt9ooFJ. The kit owns the palette and both themes, the stroke weights, the radii, the label style and Jost. Lilai holds a verbatim copy at `public/bauhaus/tokens.css`, with Jost in `public/bauhaus/fonts/`, and records the kit commit it copied in `public/bauhaus/KIT_COMMIT`. To update: copy the kit's `tokens.css` and `fonts/` over `public/bauhaus/`, write the new commit hash into `KIT_COMMIT`, then check both themes on Home, a sheet and an admin page. Never edit `public/bauhaus/tokens.css` by hand. Lilai's own names and additions live at the top of `lilai.css`, written in terms of the kit's tokens.

**Deviations from the kit.** Each is deliberate.
- **The solid button is ink, never red.** The kit's primary button is a red fill. In lilai red is the second calendar's colour, so a red button would read as that calendar. One exception (owner, 2026-10-24): **destructive actions are red, and loudly so.** Cancel event and Remove, on a management page, are red fills (`.btn-danger`). Removing a person is the quiet level: a plain sheet ("Remove <name>?", one line on what happens) whose confirm is red, the same on Home ("Whose spot to give up") and on a management page. Cancelling an event is the loud level, a danger sheet: a full-bleed red band holding an outlined stop-sign octagon with "!", a WARNING kicker (14px 700, uppercase, 0.08em), a round outlined close button and the question in Jost 700 (32px, 36px from 640px); under the band a 10px hazard stripe of ink and red at -45°; then the event line, what will happen as a short list with 8px ink square markers (ink, because a red square is the second calendar's shape), and a 52px red "Yes, cancel event" beside a "Keep it" text button. On phones the grabber strip turns red too. Text on red is `--on-danger` (white in light, paper in dark), which keeps 4.5:1 on both reds. The octagon is a warning sign, never a calendar shape.
- **The field error mark is an 8px ink square.** The kit marks errors with a red square and a red border. A red square is the second calendar's shape.
- **Running text uses the device's UI sans.** The kit sets everything in Jost. Users found the all-Jost version (2026-09-27 to 2026-10-02) harder to read, so Jost sets only headings, numerals and labels. From 2026-10-23 it narrows further, to page titles and the big numerals: buttons, labels, event titles and section heads read better in the system sans (owner).
- **Spacing keeps lilai's eight-step scale (4px to 64px).** The kit's four steps (8, 16, 32, 64) are all on it; lilai's rail, slots and dense admin rows need the 4px, 12px, 24px and 48px steps.
- **Lilai keeps its own type ramp, motion, date rail, seat slots and status marks.** The kit's 72px display and 44px H1 have no place on a list of meetups; lilai titles stop at 30px.
- **Buttons are 44px tall, not the kit's 40px,** so every touch target holds 44px. Event buttons step down to 40px.
- **The text button keeps an ink underline on hover.** The kit turns a quiet button's underline red.
- **The rail is green.** The selected day (`--rail-sel`, light text) and the agenda bar (`--rail-accent`) are green, the owner's choice (2026-10-22). Green is no calendar's colour, so it cannot be read as one.
- **The scrim stays lilai's** in light (ink at 40%); dark uses black at 40%, the kit's value, since the sheet carries its own shadow (owner, 2026-10-22). Like `--link`, it is redefined in `lilai.css`.

**Scope.** Every page is in the system. Each loads `public/bauhaus/tokens.css` first, then `public/css/lilai.css` (lilai's additions and shared components), then its own page stylesheet: Home uses `lilai.css` alone (the event form is a shared component there), FAQ adds `faq.css`, Donate adds `donate.css`, an event's management page and a calendar's key page add `events.css`, and admin Donations, the Booking queue and booking detail add `admin.css` (the booking pages then add `booking.css`). The legacy `public/styles.css` is deleted.

## Colors

An ink-on-paper product with three Bauhaus primaries held inside shapes. All values except ink-3, past and the scrim come from the kit.

### Primary
- **Ultramarine** (blue): fill of the first calendar's circle. The kit also uses it as the focus ring.
- **Signal Vermilion** (red): fill of the second calendar's square.
- **Warm Yellow** (yellow): fill of the third calendar's triangle, and the `::selection` background under ink text.

### Neutral
- **Ink** (ink): all text, every rule, control and event outlines, shape contours, the solid button, the Today marker, the fourth-calendar and unsourced diamond, the field error mark, and the fill of every slot in a full event.
- **Paper** (paper): the page, open seat slots, status marks and text on ink.
- **Paper Raised** (paper-raised): the ground of event boxes, fields, choice chips and sheets.
- **Ink Muted** (ink-muted, also named `--ink-2` in lilai): metadata, descriptions, section counts, disabled button labels.
- **Ink Faint** (ink-3, a lilai addition): weekday ticks, placeholders, captions, the colophon, inactive range tabs, past titles and numerals, cancelled booking titles.
- **Line** (line, also named `--hair`): the 1px rule between rows of a dense list (the booking timeline, the booking detail table, the FAQ questions and the FAQ table).
- **Stone** (stone, also named `--wash`): hover ground for icon buttons.
- **Past Grey** (past, a lilai addition): contour of every shape on a past event. Past shapes lose their fill. It is also the secondary text reversed out of the booking queue's ink midnight banner.
- **Link** (link): outbound links from content, at 500 with an underline. Lilai's own azure, #0b57d0 in light and #8ab4f8 in dark, set in `lilai.css` over the kit's value. The kit's link equals blue in light, the first calendar's colour, so a link would read as "this calendar".
- **Focus** (focus): the 2px keyboard focus ring on every control. It is the kit's blue in both themes.
- **Scrim** (`rgba(22, 22, 22, 0.4)`, `rgba(0, 0, 0, 0.6)` in dark, a lilai addition): the only translucent value, behind an open sheet.

### Dark

The pages follow the device's light or dark setting by default. A footer switch (`Theme: Auto · Light · Dark`, `js/theme.js`) can override it per device; the choice lives in `localStorage` and a one-line script in each page's `<head>` applies it before first paint, so nothing flashes. The kit's `tokens.css` swaps its own palette in two blocks: the media query guarded by `:root:not([data-theme="light"])` and an explicit `:root[data-theme="dark"]`. Lilai's dark additions (ink-3 #8f9095, past #55565b, the 0.4 black scrim) sit in the same two blocks in `lilai.css`, and those two blocks must hold the same values. Any new hard-coded colour needs a copy in both. The favicon stays light.

In dark the kit sets paper #111214, paper-raised #1b1c1f, stone #26272b, line #77787d, ink #f2f2ee and ink-muted #aeafb3. Because every rule, contour, text and solid button reads `--ink`, they all turn light together: Join is a light outline, and shape contours are light on a dark ground, as on the iPhone icon. The primaries brighten to the kit's night values (red #ff3b28, blue #4d5fff, yellow #ffb000) and still live only inside shapes. An open seat is the ground colour inside a light contour; a full row fills light. Icons drawn as data URIs carry their stroke colour inline (#161616 light, #f2f2ee dark), so each has a light copy in both dark blocks. The browser bar colour (theme-color metas, `manifest.json` and `js/theme.js`) is #efefea in light and #111214 in dark. `favicon.svg` stays light in both themes, like the Ledger and Splitly icons.

### Named Rules
**The Shapes-Only Primaries Rule.** Blue, red and yellow appear only as the fill of a calendar shape. Text, rules, buttons and grounds are ink or paper. Two exceptions come from the kit and stay narrow: the yellow text selection and the blue focus ring. Outbound links use lilai's own azure `--link`, which is not a primary.

**The One Shape Per Calendar Rule.** Calendars take circle/blue, square/red, triangle/yellow in config order. The fourth and later calendars, and unsourced events, take the ink diamond. Never give a calendar a second shape or colour, and never use a primary shape for something that is not a calendar. On the date rail, a title emoji replaces the shape for that one event; everywhere else the event keeps its calendar's shape.

**The Kit Owns Tokens Rule.** Change a kit colour, stroke or radius in `~/code/bauhaus` and copy it across. Lilai adds tokens in `lilai.css`; it never overrides a kit value.

## Typography

**Display Font:** Jost (from the kit, self-hosted in `public/bauhaus/fonts/`, SIL OFL, variable weight 400 to 700), token `--font-display`. It sets page titles (every h1, the wordmark, and Home's "Upcoming") and the big numerals (`.event-day`, the rail's day numbers, `.balance-amount`, `.bd-day`, the midnight clock), and nothing else.
**Body Font:** the device's UI sans (San Francisco, Segoe UI, Roboto), token `--font`, falling back to PingFang TC, Noto Sans TC, Microsoft JhengHei for Chinese. It sets everything that is not a page title or a big numeral: event and sheet titles, section heads, buttons, labels, tabs and every reading role.
**Label/Mono Font:** the system sans in the kit's label style (600, sentence case); numerals use tabular figures.

**Character:** Jost carries the Futura lineage, so its geometric letterforms match the circle, square and triangle in page titles and numerals. Its small x-height reads poorly at 13 to 20px, so everything smaller, labels and buttons included, uses the system sans, which also matches the CJK fallback that Chinese names and titles use.

### Hierarchy
- **Numeral Lead** (500, 96px, 0.78, -0.04em): the play date on booking detail. It is the largest type in the system.
- **Numeral Wide** (500, 52px, 0.9, -0.03em): the Numeral from 640px, on list dates and the Donate balance.
- **Numeral** (500, 44px on phones, 0.9): the day number of every event in the list, and the Donate balance.
- **Headline Wide** (600, 30px, 1.25): the Headline step for wide screens. The booking detail title takes it from 1000px; the FAQ title takes it from 640px. The booking midnight clock uses 30px at numeral weight (500, -0.02em).
- **Headline** (600, 26px on phones, 1.25, -0.01em): every page title (admin, Donate, FAQ, booking detail) and the wordmark.
- **Sheet Title** (600, 22px, 1.25): the title of every sheet and dialog: the RSVP sheet, the booking sheet and the booking confirm dialog.
- **Title** (600, 20px, 1.25, balanced wrap): event titles, the booking section heads (Recurring, Timeline), and the heads of the explainer and the detail headline.
- **Control** (500, 17px): inputs, number fields and range tabs, so phones do not zoom into a field.
- **Section** (600, 16px, sentence case): section and sidebar titles ("Next 14 days", "Subscribe on Google Calendar", "Keep this running", "Transactions"), and booking row titles and FAQ questions. The owner kept these titles out of the label style (2026-10-13).
- **Body** (400, 16px, 1.5): running text.
- **Body Small** (400 to 600, 15px, 1.5): descriptions, the names list, FAQ answers, the Donate lede and donor lines, the booking explainer and notes, booking detail values, the booking sheet's choice chips, and the weekday line beside a 96px numeral. It also sets navigation: header links and the FAQ language switch. Descriptions cap at 65ch and clamp to three lines on Home.
- **Meta** (400 to 600, 14px): dates, times, places, seat labels, counts, table cells, admin subtitles, row status lines and text buttons.
- **Button** (600, 15px, sentence case): the kit's button style, for every button label.
- **Label** (600, 13px, sentence case): the kit's label style. It sets booking sheet labels and admin table heads. Field labels above a text field are 600 17px in ink, the field's own size, 12px above it so the focus ring keeps clear; the field carries no placeholder hint (owner, 2026-10-22). Inside a sheet a field label takes the label style instead, 13px 600 with 8px under it, as in the booking queue (owner, 2026-10-25).
- **Caption** (400, 13px): captions, the colophon and agenda details.
- **Small** (400, 12px): weekday labels in the date rail.

The wordmark sets "Lilai" at the Headline size (600, -0.02em) above a 12px ink-muted subline. Inline calendar shapes are sized in em off the text they sit in (0.62em in a title) or at a fixed size (16px seat slots, 14px legend, 13px subscribe links); these size a shape, not type.

### Named Rules
**The Constant Meta Rule.** Every piece of metadata, in every component, is 14px. Hierarchy comes from weight and ink tone. Only numerals grow: the date numeral, and the balance on Donate.

**The Label Rule.** A word that names a control or a group (a button, a field, a section, a table column) is set in the label style. Reading text never is.

**The Tabular Numerals Rule.** Dates, counts, seat labels, amounts and clock times use tabular figures so columns of numbers stay aligned. Amounts sit right-aligned.

## Layout

The page is a single column capped at 1180px, with a 16px gutter on phones and 32px from 640px. Spacing runs on an eight-step scale from 4px to 64px.

- **Order.** The date rail, then the event list (Cards view) or the selected day's agenda rows (Rows view), then the sidebar: the hosting card, Subscribe on Google Calendar, Keep this running (owner, 2026-10-25: hosting is part of the app's flow, subscribing is secondary). From 1000px, Rows view puts the rail beside the sidebar.
- **From 1000px.** The rail spans the full width. Below it the list takes the flexible column and the sidebar takes a 400px column with a 64px gap. The sidebar is sticky 16px from the top.
- **The date rail.** The header reads "Upcoming", the range ("22 Oct – 4 Nov") in ink-muted, and at the right a Cards | Rows pill switch with two icons. Under 360px the range drops below the title. Below it, today and the next 13 days scroll sideways as day buttons: abbreviated weekday (12px, ink-muted), day number (Jost 600, 20px) and the day's marks. A mark is the event's title emoji, else its calendar's shape: 16px for one or two events, 13px when three share the row, and past three, two marks and "+N". About seven days show on a phone, the eighth cut off to show the row scrolls; from 640px all fourteen fit. The row bleeds to the screen edge and snaps gently. A month change puts the new month's short name, set vertically, between the days. Today is selected by default and today's weekday is green when another day is selected. The selected day is a 14px-rounded solid green (`--rail-sel`) with light text; others stay clear. Days are 44px wide at least. Arrow keys, Home and End move the selection; it scrolls into view.
- **The agenda.** Under a hairline, the selected day's heading ("Today · 22 Oct", "Saturday · 24 Oct") with its event count opposite, then one row per event sorted by start: the start time, a 3px green bar (`--rail-accent`), the title and the place (or calendar) with the seat count, and a raised Join pill ("Full" when full, none for a past event). The agenda shows in Rows view, and in Cards view only for a day without events, which says "No events planned." In Cards view a day click scrolls to that day's first card instead.
- **Events.** Each event is a two-column row: a 56px date column (72px from 640px) and the body. Every event uses this layout, the next one included. The date column holds the day number over the weekday ("Today" for today); the month shows in the rail. The time range ("16:00–18:00", ink, 500) leads the meta line under the title; an end on another day adds its date before the end time. There is no duration (owner, 2026-10-22). The title's shape names the calendar, so after the time the meta line holds the place. The event's links (set in Lilai, up to five) sit in a wrapping row under the meta line, each named by its label or else its site. Links are the one coloured text on Home: `--link`, 500, underlined, with a small arrow. The description shows exactly as the host wrote it. A 3px ink Today rule divides past from future in the list.
- **Phones.** On phones the header tightens so the rail and the first agenda row land in the first screen. The subline hides below 380px.
- **Other pages.** FAQ and Donate are a single 640px reading column. Admin pages use the same 1180px shell and gutter as Home. Booking detail caps its content at 720px. Donate left-aligns the balance on the same axis as the transaction list; nothing on it is centred.
- **Hosting card (sidebar).** No title. A solid "+ Create an event" button, then "You manage" (the side subtitle) over a 2px ink rule: one row per event this device manages, soonest first, each a link to its management page: a day block (the day in Jost 700 24px over the 12px weekday, 40px wide), the calendar shape and title (15px 600, one line), a meta line (the time or "8 dates · next 20:00", then "6 coming", "2 asking" when Home has the event loaded), and a muted chevron; 1px hairlines between rows. "Lost a management link?" closes the card as a text button. With nothing managed, the card is the button and that link.
- **Subscribe on Google Calendar (sidebar).** One 44px row per calendar: its shape, its name, and a muted ↗ at the right, hairlines between rows.
- **Lost a management link?** The hosting card's last line opens a sheet: three places to look as a list with 8px ink squares, then under a 2px ink rule "Ask the admins" (Event as a list of upcoming events, Your name, as host, Email for the new link) with Send solid. Sent replaces the form with one line and Done.
- **Make an event.** A sheet that slides in (up from the bottom on phones, a drawer from the right from 640px), opened by a round stone "+" beside the Cards | Rows switch (the two wrap as one group) or the sidebar's "Create an event" button. The sheet's title is Jost 700 32px over a full-width 2px ink rule, and Make event with Cancel is pinned at its foot under another (owner, 2026-10-25, matching the booking queue's frame). The form (`js/event-form.js`) reads top to bottom: Calendar as shape tiles (one per calendar, its shape 32px outlined until picked, then filled with the calendar's colour on an ink-bordered raised tile; a restricted calendar only on a device holding its key; hidden with one calendar), What, Day, Starts and Ends side by side as half-hour lists (00:00 to 23:30; an older off-grid time is kept, never moved; picking a start sets the end two hours later until the end is touched; "Ends the next day." when the end is earlier), Repeats (Once | Repeats; then "Every [1] [week]", seven weekday pills M–S inked when chosen, Until, and a preview line such as "18 dates, Thu 5 Nov to Sat 2 Jan."), Where (suggests places used before), Details, Links, then under ink rules "Who gets a place" (No limit | Limited with a − 8 + stepper; Open or I approve each person as two stacked choices, the chosen one ink-bordered) and "You" (name, I'm coming too, optional email). Make event is the solid button. When it is made, the sheet shows "<title> is on the calendar", the date or "18 dates, from …", and a raised card with the management link, Copy link and (on phones) Share. The link editor is a row per link: the address, an optional name and a remove ×, with the name under the address on phones; "Add a link" is a text button.
- **Management page.** "Manage event" eyebrow, then the title with its calendar shape, the when-line, the place, the links, a meta line (calendar · Open or You approve each person · Hosted by …) and the Google copy's status in muted text (ink 500 when it is waiting or refused). A cancelled event opens with an ink bar: "Cancelled." A series adds "Repeats" under an ink rule: its rule and a sideways-scrolling row of date chips (paper-raised, the open one ink-bordered, a cancelled one struck through, the count of people under each). Then Edit (solid), Copy link, Cancel event (red, see Deviations). Copy link is a raised-paper box with 16px corners: a 32px ink-outlined round copy icon beside "Copy link" (15px 600) over the page address cut off with an ellipsis (13px, ink-3); a tap copies the address and the label reads "Copied" for two seconds. It copies rather than opening the share sheet, so the host sees which link leaves; Restore replaces Edit when cancelled. Edit and Cancel are sheets; on a series both ask "This date" or "This and later dates". The tally and the request lists follow, as before. Activity comes last: what happened to the event, newest first, grouped under day labels (Today, Yesterday, Wed 22 Oct), one hairline row each with a square mark (filled: took a place; open: lost one; half: asked; a short dash: the event itself changed), the sentence with the person's name in 600 ink and the rest in ink-2, and the time at right in tabular ink-3. On phones it is one more section under an ink rule showing the latest six, with "Show all N". From 1000px the page widens to the app's 1180px: the event and its lists take the flexible column and Activity sits in a 400px raised card beside it, 64px apart as on Home, sticky 16px from the top, holding the whole history and scrolling inside itself.
- **Calendar page.** "Calendar access" eyebrow, the calendar's name, one sentence on what the key allows, "Make a <calendar> event" (solid) and Share this page, then its upcoming events as rows with a Manage pill.
- **Admin Donations.** The page uses Home's layout: the main column, then a sidebar of cards that sits beside it (320px, 64px gap, sticky) from 1000px. It puts the form in one raised card (amount and date side by side from 640px, no placeholders, a hint line under a field where needed, Add entry solid then Reset) and the admin key in a sidebar card. There is no admin page for events (removed 2026-10-24): each event is managed on its own page.
- **Touch targets.** Links, tabs, legend items, buttons and icon buttons are at least 44px tall. Event buttons are the one 40px exception.

## Elevation & Depth

The page is lifted. The ground is grey (`--ground`: the kit's fill in light, paper in dark, so cards always sit lighter than the ground). Event boxes, sidebar cards and sheets sit on paper-raised; fields sit on the kit's `fill` and switch tracks on stone. Cards take `--shadow-raised`, sheets `--shadow-float`. There are no gradients. A shape's 1.5px ink contour separates it from paper, so even the yellow triangle holds its edge.

### Named Rules
**The Lifted Card Rule.** Cards are raised paper with 16px corners and `--shadow-raised`, never an outline. A sheet gets paper-raised, the scrim behind it and `--shadow-float`. On phones it slides up from the bottom edge with a grabber and a round filled close button; from 640px it slides in from the right as a full-height panel (420px; the booking sheet 520px) with 20px corners on its left side. This deviates from the kit's Float Rule, which keeps cards on the page shadowless (owner's choice, 2026-10-22).

## Shapes

The form language has two registers.

- **Calendar shapes.** Circle, square, triangle and diamond are drawn from one SVG symbol set on a 24-unit grid. Each has a flat fill and a 1.5px ink contour with mitred joins that does not scale with size. The circle is the only curve in the system.
- **Controls are soft; geometry stays square.** Buttons, choice chips, icon-button hovers and switches are pills (`--radius-full`). Fields are filled with 12px corners (`--radius-control`). Event boxes and the desktop sheet take 16px (`--radius-card`); the phone sheet takes 20px on its top corners (`--radius-sheet`). Status marks, seat pips and the balance bar stay square. Buttons, chips, fields and event boxes carry no outline. Section rules are 2px ink (`--rule` is `--stroke-2`). The Today marker is 3px ink. The range and language switches are the kit's pill switch.

**The Event Box Rule.** Each event on Home is a lifted card (see The Lifted Card Rule), 24px padding (16px sides on phones) and 12px between cards. Sidebar blocks are the same cards. The box replaced a bare rule above each event on 2026-10-02, because users could not tell where one event ended; the 2px ink outline gave way to the lift on 2026-10-22. Only the status mark and the balance bar carry a full border.

**The Hairline Rule.** Inside a section, a dense list divides its rows with a 1px line-grey hairline, and keeps the 2px ink rule for its edges: above the list, and under a table's column heads when it has them. The FAQ questions (under their 2px section header rule) and the FAQ table work this way. Lists that sit on a raised card (the Recurring schedules, the booking timeline's two cards, the booking detail table) use only the hairlines: the card's own edge replaces the 2px rules. A hairline never starts or ends a section. The heavier 3px ink rule marks a moment: Today on Home (between event boxes, 24px above it), NOW on the booking timeline (between its two cards, the same way), the row in flight, and a stale-data notice.

## Components

Soft, sentence case, outlined or filled in ink, as in the kit. Hover swaps fills; nothing fades. Every focusable control shows the 2px blue focus ring.

### Buttons
- **Shape:** a pill, 2px ink outline, 44px tall, 24px side padding, button style (15px 600, sentence case).
- **Solid:** ink ground, paper label. The one main action of a form or sheet: Confirm, Add entry, Queue a slot, Next. It stays ink; only a destructive confirm (Remove, Yes, cancel event) is red (see Deviations).
- **Line:** clear ground, ink label, ink outline. Join on every event, and secondary calls such as "Create an event" and "Pay by card". A page of solid Joins read as a column of black blocks (removed 2026-10-02).
- **Event buttons:** inside an event the button steps down to 40px tall with 16px side padding, since every event carries one.
- **Hover:** the fills swap. Solid turns paper with an ink label; line turns ink with a paper label. 140ms on the system ease.
- **Disabled:** clear ground, line-grey border, ink-muted label. A full event shows a disabled "Full" button in place of Join.
- **Text button:** 14px 500 ink with a 1px underline offset 3px, 2px on hover, 44px tall. Used for Refresh, Remove a name, Show more, Load earlier events, Cancel, Keep it and the visible booking row actions.
- **Icon button:** a 44px square holding a 22px ink line SVG (1.5px, square caps), with a stone ground on hover.
- **Focus:** every control gets a 2px focus-blue outline offset 2px.

### Chips
- **Range tabs:** Upcoming and All are 17px 500 text tabs, ink-faint at rest. The active tab turns ink with a 2px ink underline.
- **Legend:** each calendar is its shape at 14px beside its name (15px). The legend is also the filter. A calendar that is switched off turns ink-faint, and its shape drops to an unfilled ink-faint outline.

### Cards / Containers
An event is a 16px rounded box with a 2px ink outline on paper-raised. See The Event Box Rule.

### Inputs / Fields
- **Style:** a filled field: 50px tall, `fill` ground, a transparent 2px border, 12px corners, 17px text, ink-faint placeholder. Labels sit 8px above the field in the label style, in ink-muted. The select adds a 2px ink chevron at the right.
- **Focus:** a 2px focus-blue outline offset 2px outside the border.
- **Choice chips:** the booking sheet's exclusive answers (segments, weekday chips) are separate 44px pill chips with an 8px gap (4px for the seven weekdays), a 2px ink outline on paper-raised, and 15px 500 text. Hover and the chosen state both fill ink with a paper label; chosen sets the text at 600. The event form's chips (Once | Repeats, No limit | Limited) are slimmer: 36px drawn on a filled ground, 14px side padding, 14px text, with the tap area kept at 44px (owner, 2026-10-25).
- **Error:** a 14px 500 ink line below the field, led by an 8px ink square. The kit's red mark is not used (see Deviations).

### Navigation
The wordmark is the way home on every page, so no page carries a Back link (removed 2026-10-02). The masthead puts the wordmark at left: the app icon without its tile (circle, square and triangle on an ink baseline, 20px tall, primaries from the kit tokens so they take the night values in dark), then "Lilai" and its subline. FAQ and Donate sit at right as 15px 500 ink links without underline, underlined on hover. Body links are ink with a 1px underline offset 3px, 2px on hover. Links that leave the app from content (an event's links on Home, in the RSVP sheet and on its management page, links in FAQ answers) take `--link` at 500 instead.

### Admin Navigation and Header
Every admin page opens with the same header.
- **Tabs:** Events, Donations and Booking queue sit in Home's pill switch (the Upcoming | All switch): a stone track hugging the tabs, each tab 14px 600 ink-muted, the current page a raised paper pill in ink. The track sits 8px under the masthead on the content's left edge. There is no rule under it (2026-10-23, to match Home).
- **Title:** the page title follows 24px below the tabs at the Headline size (26px 600, -0.01em). A 14px ink-muted subline sits 8px under it. The header block ends 24px later.
- **Table heads:** where a booking table has column heads, they use the label style above a 2px ink rule.

On FAQ and Donate the current page in the masthead is marked the same way: a 2px underline offset 3px.

### Booking Queue

The board uses Home's grammar. Section heads (Recurring, Timeline) are 20px titles with a 14px ink-muted count, and no rule above them. The Recurring schedules sit on one raised card. The timeline is two raised cards, what went out and then what is waiting, with the NOW rule between them; each row is divided from the next by a hairline. The first-visit explainer, the standing notices and the stale-code warning are raised cards too (the warning keeps a 3px ink top edge). The midnight banner stays an ink block, with 16px corners. On phones a row's when line ("in 2 h 59 m · today 03:49") sits above its title, so the title gets the card's full width. The booking detail page puts its headline, What happened and What we sent on raised cards under the 96px numeral.

**The Fixed Places Rule.** Every booking action has one place, whatever else the row carries, so the same button never moves between rows. Visible: Edit (waiting slots and schedules), Details (every past row), Undo with its time left (a cancelled slot), Undo all (a schedule inside its window). Behind a More button: Duplicate, Cancel, Report failure and Cancel the remaining N. A row with nothing behind More (a cancelled slot) shows no More button. Counting actions instead ("collapse past two") put Duplicate in view on some rows and behind More on the next (owner, 2026-10-23). The More button is a 44px icon button with three dots; it opens a menu of 44px items on paper-raised with `--shadow-float` and 12px corners. A destructive item is set in 600, never in a colour. An item that asks first (Cancel, Report failure) asks in the row, exactly as a visible link would. The menu closes on a click outside it and on Escape, which returns focus to the More button. A redraw keeps an open menu open.

### Status Marks
A booking's status is a word first. A 10px square with a 2px ink contour sits beside the word so a column of them can be scanned.
- **Filled** (ink): the request went out ("Request sent").
- **Open** (paper): something is still ahead, a reply or the moment itself.
- **Half** (lower half ink): "Missed".
- **Cross** (ink with a paper X): "Request failed".
- **Slash** (paper with an ink diagonal): nothing left this server ("Not sent").

Weight is the second channel. A request that left sets its outcome line in 600 ink. A slot that never left sets it in 500 ink-muted. A cancelled slot holds its place struck through in ink-faint until its undo runs out. The booking detail steps reuse the square on a 1.5px ink rail: filled for what happened, open for what is ahead. Marks never use colour.

### Balance Bar (Donate)
A flat ink meter under the balance, 400px wide at most and 14px tall, with a 2px ink border and square corners. The bar is centred on zero because the balance can run negative. A 2px ink tick marks zero and stands 3px proud of the track at each edge. The fill is an ink half-track fixed at the tick. It grows right for a positive balance and left for a negative one, and it moves by `transform: scaleX()` over 400ms on the system ease, never by an animated width. A 14px ink-muted scale sits under it, left, centre and right.

### Row Status (print in place)
An admin action reports its result in a line under the row it changed, never in a toast. The line is 14px ink-muted and sits 8px under the row's controls. An error sets the same line in ink 500. The line has no coloured marker. Page-level messages print into a state line in the page the same way, and a booking row that crosses the NOW rule prints in over 700ms like a new name on Home.

### Seat Slots (signature)
Seat slots show capacity as a row of the event's calendar shape at 16px with a 5px gap.
- **Open:** a paper fill inside the ink contour.
- **Taken:** the calendar's colour.
- **Full:** every slot turns ink and the label turns ink 600 ("Full · 12 of 12").
- **Past:** every shape on the event drains to an unfilled past-grey outline. The title and numeral turn ink-faint.
- Only an event with a limit of 10 or fewer (`MAX_SLOTS` in `app.js`) draws slots, one per place. An event with no limit, or more than 10 places, shows the label alone: a long row of shapes stopped reading as seats and crowded the page.
- A 14px ink-muted label follows the row: "5 of 12 spots taken", "3 going", "4 went".

### Names List and the RSVP Print
Attendees are a wrapped list of 15px names with 16px between them. A name added since the last render prints in 600 weight and fades in over 700ms. There is no toast. The new seat slot grows from scale 0 over 480ms. The event's band shape steps from 0.6 to full size over 640ms.

### RSVP Sheet
The sheet is a paper-raised panel, 480px wide at most. On phones it rises from the bottom edge under a 2px ink top rule. From 640px it is centred with a full 2px ink border. It opens with a 16px rise and fade over 260ms. It holds a 22px title, a 14px when-line ("Saturday 3 October, 19:30–21:30"), an optional scrolling description, one field, and a solid button beside a text button. The booking sheets follow the same pattern.

### App Icon and Favicon

The icon is the date rail reduced to three marks: a blue circle, a red square and a yellow triangle in a row on paper, standing on a 24-unit ink baseline. There are no contours, so the primaries are the icon (it follows Splitly's icon: paper ground, flat kit colours, one idea). Sources live in `public/icons/`: `icon.svg` (any purpose; the 192 and 512 PNGs come from it), maskable PNGs drawn at 85% so the row sits inside the 80% safe circle, and `favicon.svg`, drawn on a 32-unit pixel grid so it stays sharp at 32px and 16px. `favicon.ico` (16, 32, 48) is rendered from `favicon.svg`. The iPhone icon, `apple-touch-icon.png` (180, from `apple-touch-icon.svg`), is the night version: #111214 ground, a light baseline and the kit's night primaries. iOS 18+ darkens home-screen icons in Dark mode and a web clip cannot supply its own dark variant, so a paper icon turns muddy; a dark icon has nothing left for iOS to darken.

### Motion
One easing, `cubic-bezier(0.16, 1, 0.3, 1)`, drives every movement. Shapes scale from their centre when state changes: a new seat slot grows, and an event scrolled to from the rail steps its shapes for 520ms while nothing else moves. A rail day swaps to and from green over 150ms. Under `prefers-reduced-motion` every animation and transition runs in 1ms.

**The State-Only Motion Rule.** Motion marks a change in attendance or a pointer landing, and nothing else. Nothing moves on load.

**The Print-Not-Toast Rule.** Feedback is the change itself, printed where it happened: for an RSVP a filled slot and a bold name, for an admin action a status line under its row. Do not announce it in a floating message.

### Known accepted limit

## Do's and Don'ts

### Do:
- **Do** let the design explain itself (owner, 2026-10-24). Labels, layout and state carry the meaning; a hint line is added only for a caveat or something a person could not see coming: who gets told, what cannot be undone, what a link unlocks, where a default comes from. No line restates what a label, heading or button already says, and no line explains how a feature works when using it shows that. A caveat the person must act on (a failed email) is `.ev-warn`: ink, 600, a 2px ink rule at its left, never red.
- **Do** take colours, strokes, radii and Jost from the kit's `tokens.css`, and change them in `~/code/bauhaus` first.
- **Do** give each calendar its shape in config order (circle/blue, square/red, triangle/yellow) and the ink diamond to the fourth and later calendars and unsourced events.
- **Do** draw every shape with a flat fill and a 1.5px ink contour.
- **Do** box each event in a 16px rounded, 2px ink outline on paper-raised, divide sections with full-width 2px ink rules, and the rows of a dense list with 1px line-grey hairlines.
- **Do** set button labels in the button style (15px 600), table heads in the label style (13px 600), and field labels at the field's 17px, all in sentence case.
- **Do** show hover by swapping fills: line to ink, solid to paper.
- **Do** keep metadata at 14px and let only numerals break scale (event dates, the Donate balance, 96px on the booking detail date).
- **Do** carry status in a word, with ink weight and a 10px ink status mark as the second channel.
- **Do** show capacity with the four slot states (outline open, calendar colour taken, all ink full, grey outline past) on events of 10 places or fewer, and with the label alone otherwise.
- **Do** print a new RSVP bold into the names list and grow its slot from the centre.
- **Do** keep touch targets at least 44px tall and focus as a 2px focus-blue outline offset 2px.

### Don't:
- **Don't** put blue, red or yellow on text, rules, buttons or grounds. The kit's focus ring is the only primary blue outside a shape; the azure `--link` is a separate link colour.
- **Don't** make the solid button or the error mark red; red is a calendar.
- **Don't** round the geometry: calendar shapes, status marks, seat pips and the balance bar stay square.
- **Don't** use gradients, put a shadow on an event box or section, or show hover by fading.
- **Don't** confirm an RSVP or an admin action with a toast or banner.
- **Don't** animate on page load, or use bouncy or spring motion.
- **Don't** set anything but page titles and big numerals in Jost, or add a third typeface.
- **Don't** reuse a primary shape as decoration or for anything that is not a calendar.
- **Don't** edit `public/bauhaus/tokens.css` by hand, or redefine a kit token in `lilai.css` beyond the named deviations (`--link`, `--scrim`).
