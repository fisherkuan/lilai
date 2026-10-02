---
name: Lilai
description: Meetups and who is coming, as a Shape Calendar, one Bauhaus primary shape per calendar on white paper.
colors:
  paper: "#ffffff"
  ink: "#111111"
  ink-2: "#444444"
  ink-3: "#676767"
  hair: "#e2e2e2"
  wash: "#f3f3f3"
  past: "#b4b4b4"
  blue: "#1f4fa3"
  red: "#d9352b"
  yellow: "#f2c230"
typography:
  numeral-lead:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "96px"
    fontWeight: 500
    lineHeight: 0.78
    letterSpacing: "-0.04em"
    fontFeature: "tnum"
  numeral-wide:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 500
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  numeral:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 500
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline-wide:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  sheet-title:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
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
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
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
  field: "10px"
  pill: "999px"
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
    typography: "{typography.section}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  button-solid-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  button-line:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.section}"
    rounded: "{rounded.pill}"
    padding: "0 24px"
    height: "44px"
  button-line-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-disabled:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    height: "44px"
  text-button:
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    height: "44px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.control}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "50px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    width: "480px"
  admin-tab:
    textColor: "{colors.ink-3}"
    typography: "{typography.body-small}"
    height: "44px"
  admin-tab-active:
    textColor: "{colors.ink}"
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

Lilai follows a Bauhaus form-colour grammar on white paper. Each enabled calendar owns one primary shape, assigned in config order: a blue circle, a red square, a yellow triangle. A fourth calendar, or an event with no known source, gets an ink diamond. The shape is the calendar's identity everywhere it appears: the wordmark, the 14-day band, the legend, the event title mark, the seat slots and the admin Events rows. The band reads as an abstract composition drawn from the real events.

Everything else is black ink on white. Text, rules and buttons carry no colour, so the primaries stay loud and always mean "this calendar". Each event sits in its own hairline box, so where one ends and the next begins is plain; sections are divided by 1.5px ink rules. Metadata sits at one constant size. Every event carries the same weight: there is no lead event. The date numerals are the only type that breaks scale, all at one size.

Motion is scarce and tied to state. When attendance changes, a shape scales from its centre with an exponential ease-out. A new RSVP prints bold into the names list. Nothing moves on load, and reduced motion is instant.

**Key Characteristics:**
- One primary shape per calendar, flat fill, 1.5px ink contour.
- Primaries appear only inside shapes (plus the yellow text selection).
- Ink rules divide sections; each event is a square 1px hairline box; 1px hairlines divide dense rows inside a section. There are no shadows, gradients or rounded corners.
- Every event has the same size and the same line Join button. The 14-day band and its readout already show what comes next.
- Constant 14px metadata; only numerals break scale (the event dates, the Donate balance, 96px on the booking detail date).
- Shapes carry state: outline open, calendar colour taken, all ink full, grey outline past.
- Motion happens on state change only, scaling shapes from their centre.

**Scope.** Every page is in the system. Each loads `public/css/lilai.css` (tokens and shared components) and then its own page stylesheet: Home uses `lilai.css` alone, FAQ adds `faq.css`, Donate adds `donate.css`, and admin Events, admin Donations, the Booking queue and booking detail add `admin.css` (the booking pages then add `booking.css`). The legacy `public/styles.css` is deleted.

## Colors

A monochrome ink-on-paper product with three Bauhaus primaries held inside shapes.

### Primary
- **Bauhaus Blue** (blue): fill of the first calendar's circle.
- **Signal Red** (red): fill of the second calendar's square.
- **Chrome Yellow** (yellow): fill of the third calendar's triangle, and the `::selection` background under ink text.

### Neutral
- **Ink** (ink): all text, every rule, shape contours, the solid button, the Today marker, the fourth-calendar and unsourced diamond, and the fill of every slot in a full event.
- **Paper** (paper): the page, the sheet, open seat slots, text on ink.
- **Ink Soft** (ink-2): metadata, descriptions, section counts.
- **Ink Faint** (ink-3): weekday ticks, placeholders, captions, the colophon, inactive range tabs and admin tabs, past titles and numerals, cancelled booking titles.
- **Hairline** (hair): the 1px rule between rows of a dense list (admin tables, the booking timeline, the booking detail table, the FAQ table), the thin Monday divider in the 14-day band, disabled button borders.
- **Wash** (wash): hover ground for icon buttons, disabled button fill.
- **Past Grey** (past): contour of every shape on a past event. Past shapes lose their fill. It is also the secondary text reversed out of the booking queue's ink midnight banner.
- **Scrim** (`rgba(17, 17, 17, 0.4)`): the only translucent value, behind an open sheet.

### Dark

The pages follow the device's light or dark setting by default. A footer switch (`Theme: Auto · Light · Dark`, `js/theme.js`) can override it per device; the choice lives in `localStorage` and a one-line script in each page's `<head>` applies it before first paint, so nothing flashes. Its tokens sit in two blocks, the media query guarded by `:root:not([data-theme="light"])` and an explicit `:root[data-theme="dark"]`, which must hold the same values. The favicon follows the device only. Dark inverts the ground and nothing else: `--paper` becomes #121212 and `--ink` #f2f1ee, with the greys, hairline, wash and scrim retuned in the `prefers-color-scheme: dark` block in `lilai.css`. Because every rule, contour, text and solid button reads `--ink`, they all turn light together: Join is a light button with dark text, and shape contours are paper-coloured on ink, as on the iPhone icon. The primaries do not change and still live only inside shapes. An open seat is the ground colour inside a light contour; a full row fills light. Icons drawn as data URIs carry their stroke colour inline, so each has a light copy in the same block. `favicon.svg` switches with the same media query.

### Named Rules
**The Shapes-Only Primaries Rule.** Blue, red and yellow appear only as the fill of a calendar shape. Text, rules, buttons, links and grounds are ink or paper. The one exception is the yellow text selection.

**The One Shape Per Calendar Rule.** Calendars take circle/blue, square/red, triangle/yellow in config order. The fourth and later calendars, and unsourced events, take the ink diamond. Never give a calendar a second shape or colour, and never use a primary shape for something that is not a calendar. On the band and its readout, a title emoji replaces the shape for that one event; everywhere else the event keeps its calendar's shape.

## Typography

**Display Font:** Jost (self-hosted in `public/fonts/`, SIL OFL, variable weight 400 to 700), token `--font-display`. It sets h1 to h3, the wordmark and the Numeral roles (`.event-day`, `.balance-amount`, `.bd-day`), and nothing else.
**Body Font:** the device's UI sans (San Francisco, Segoe UI, Roboto), token `--font`, falling back to PingFang TC, Noto Sans TC, Microsoft JhengHei for Chinese. It sets every reading role: control, body, meta, caption, small, buttons.
**Label/Mono Font:** none; numerals use tabular figures

**Character:** Jost carries the Futura lineage, so its geometric letterforms match the circle, square and triangle in headings and numerals. Its small x-height reads poorly at 14 to 16px, so running text uses the system sans, which also matches the CJK fallback that Chinese names and titles use. Users said the all-Jost version (2026-09-27 to 2026-10-02) was harder to read.

### Hierarchy
- **Numeral Lead** (500, 96px, 0.78, -0.04em): the play date on booking detail. It is the largest type in the system.
- **Numeral Wide** (500, 52px, 0.9, -0.03em): the Numeral from 640px, on list dates and the Donate balance.
- **Numeral** (500, 44px on phones, 0.9): the day number of every event in the list, and the Donate balance.
- **Headline Wide** (600, 30px, 1.25): the Headline step for wide screens. The booking detail title takes it from 1000px; the FAQ title takes it from 640px. The booking midnight clock uses 30px at numeral weight (500, -0.02em).
- **Headline** (600, 26px on phones, 1.25, -0.01em): every page title (admin, Donate, FAQ, booking detail) and the wordmark.
- **Sheet Title** (600, 22px, 1.25): the title of every sheet and dialog: the RSVP sheet, the booking sheet and the booking confirm dialog.
- **Title** (600, 20px, 1.25, balanced wrap): event titles, and the heads of booking sections, the explainer and the detail headline.
- **Control** (500, 17px): inputs, number fields and range tabs, so phones do not zoom into a field.
- **Section** (600, 16px): section heads, sidebar block titles, button labels, admin row titles, booking row titles and FAQ questions.
- **Body** (400, 16px, 1.5): running text.
- **Body Small** (400 to 600, 15px, 1.5): descriptions, the names list, FAQ answers, the Donate lede and donor lines, the booking explainer and notes, booking detail values, and the weekday line beside a 96px numeral. It also sets navigation: header links, admin tabs, back links and the FAQ language switch. Descriptions cap at 65ch and clamp to three lines on Home
- **Meta** (400 to 600, 14px): dates, times, places, seat labels, counts, field labels, table cells and heads, admin subtitles, row status lines and text buttons.
- **Caption** (400, 13px): captions, the colophon, and band weekday ticks from 640px.
- **Small** (400, 12px): weekday ticks in the band on phones.

The wordmark sets "Lilai" at the Headline size (600, -0.02em) above a 12px ink-soft subline. Inline calendar shapes are sized in em off the text they sit in (0.62em in a title) or at a fixed size (16px seat slots, 14px legend, 13px subscribe links); these size a shape, not type.

### Named Rules
**The Constant Meta Rule.** Every piece of metadata, in every component, is 14px. Hierarchy comes from weight and ink tone. Only numerals grow: the date numeral, and the balance on Donate.

**The Tabular Numerals Rule.** Dates, counts, seat labels, amounts and clock times use tabular figures so columns of numbers stay aligned. Amounts sit right-aligned.

## Layout

The page is a single column capped at 1180px, with a 16px gutter on phones and 32px from 640px. Spacing runs on an eight-step scale from 4px to 64px.

- **Order.** The 14-day band, then the event list, then the sidebar (calendar links, support).
- **From 1000px.** The band spans the full width. Below it the list takes the flexible column and the sidebar takes a 400px column with a 64px gap. The sidebar is sticky 16px from the top.
- **The 14-day band.** Fourteen equal columns between two ink rules. A 3px ink bar marks today's left edge and today's date sits reversed out of an ink block. A hairline marks each Monday. Each event is its calendar's shape, stacked in its day, sized by headcount. An event whose title holds an emoji shows that emoji instead (the first grapheme that renders as emoji by default or carries VS16), at the same size with a 14px floor so it stays legible on phones; the readout uses it as its mark and drops it from the title. Size: `min(max, base + n × step)` with n capped at 12. Phones use 8px + 1.4px per head up to 24px; 640px uses 12px + 3.5px up to 40px; 1000px uses 14px + 4.5px up to 64px. Day columns are 96px, 112px, 136px and 196px tall across the breakpoints.
- **The band readout.** One 14px ink line under the band names one event: its shape mark, then `Thu 1 Oct · 19:30 · title · seats`, with the seats in the event list's wording. It shows the hovered or focused shape, else the selected one, else the next upcoming event. The row is a fixed 56px, so the page never jumps; the text wraps to two lines at most and a long title ends in an ellipsis. A "Show" text button ends the line and jumps to the card. On phones the first tap on a shape selects it (1.5px ink ring, `aria-pressed`) and a second tap jumps; with a mouse a click jumps at once. No tooltip, no box.
- **Events.** Each event is a two-column row: a 56px date column (72px from 640px) and the body. Every event uses this layout, the next one included. The date column stacks the day number, weekday, month, the start time, an ink-faint en dash (the range mark, read aloud as "to") turned upright to follow the stack, and the end time, centred in their own column at the same line height as the rows above, so all rows sit evenly; an end on another day adds its date above the end time. There is no duration. The title's shape names the calendar, so the meta line under the title holds the place and, when the description has a link, an Event link. The link is the one coloured text on Home: `--link` (#0b57d0, #8ab4f8 in dark), 500, underlined, with a small arrow. A pill there made too many pills in one event. The `link: URL` line leaves the description. A 3px ink Today rule divides past from future in the list.
- **Phones.** On phones the header and band tighten so the first event lands in the first screen. The subline hides below 380px.
- **Other pages.** FAQ and Donate are a single 640px reading column. Admin pages use the same 1180px shell and gutter as Home. Booking detail caps its content at 720px. Donate left-aligns the balance on the same axis as the transaction list; nothing on it is centred.
- **Admin tables on phones.** From 640px an admin list is a real table. Below 640px each row stacks its cells as full-width blocks, the column heads hide, and a 14px 600 label above each value stands in for them. The Events row shows its time as on Home, 24-hour start and end: "Fri 2 Oct · 18:00–20:00".
- **Touch targets.** Links, tabs, legend items and icon buttons are at least 44px tall.

## Elevation & Depth

The system is flat. There are no shadows and no gradients. Depth comes from ink rules, the reversed ink block for today, and one scrim behind an open sheet. A shape's 1.5px ink contour separates it from paper, so even the yellow triangle holds its edge on white.

### Named Rules
**The Flat Paper Rule.** Nothing casts a shadow. When a layer must sit above the page, it gets the 40% ink scrim and an ink rule on its edge.

## Shapes

The form language has two registers.

- **Calendar shapes.** Circle, square, triangle and diamond are drawn from one SVG symbol set on a 24-unit grid. Each has a flat fill and a 1.5px ink contour with mitred joins that does not scale with size. The circle is the only curve in the system.
- **Controls are soft; structure is square.** Buttons and choice chips are full pills, fields have 10px corners. The sheet, the event boxes, the band and the reversed date block keep 0px corners. Rules are 1.5px ink. The Today marker is 3px ink. Active range tabs get a 2px ink underline.

**The Event Box Rule.** Each event on Home is a square box with a 1px hairline border, 24px padding (16px sides on phones) and 12px between boxes. Sections and sidebar blocks are still divided by full-width 1.5px ink rules. The box replaced a bare ink rule above each event on 2026-10-02, because users could not tell where one event ended. Only events, controls (buttons, inputs), the desktop sheet, the status mark and the balance bar carry a full border.

**The Hairline Rule.** Inside a section, a dense list divides its rows with a 1px hairline, and keeps the 1.5px ink rule for its edges: above the list and under a table's column heads. Admin tables, the booking timeline, the booking detail table and the FAQ table all work this way. A hairline never starts or ends a section. The heavier 3px ink rule marks a moment: Today on Home (between event boxes, 24px above it), NOW on the booking timeline, the row in flight, and a stale-data notice.

## Components

### Buttons
Soft pills on every page. Users found square 1.5px ink boxes too big and sharp (2026-10-02).
- **Shape:** full pill (999px), 1px border, 44px tall, 24px side padding, 16px 500 label.
- **Solid:** ink ground and edge, paper label. The one main action of a form or sheet: Confirm, Remove, Add entry, Donate with Stripe, Queue a slot, Next.
- **Line:** paper ground, ink label, ink-faint edge. Join on every event, and secondary calls such as "Create an event". A page of solid Joins read as a column of black blocks (removed 2026-10-02).
- **Event buttons:** inside an event the pill steps down to 40px with a 15px label, since every event carries one.
- **Hover:** solid lightens to ink-soft; line takes a wash ground and an ink edge. 140ms on the system ease.
- **Disabled:** wash ground, hairline border, ink-faint label. A full event shows a disabled "Full" button in place of Join.
- **Text button:** 14px 500 ink with a 1px underline offset 3px, 2px on hover, 44px tall. Used for Refresh, Remove a name, Show more, Load earlier events, Cancel and Keep it.
- **Icon button:** a 44px square holding a 22px ink line SVG (1.5px, square caps), with a wash ground on hover.
- **Focus:** every control gets a 2px ink outline offset 2px.

### Chips
- **Range tabs:** Upcoming and All are 17px 500 text tabs, ink-faint at rest. The active tab turns ink with a 2px ink underline.
- **Legend:** each calendar is its shape at 14px beside its name (15px). The legend is also the filter. A calendar that is switched off turns ink-faint, and its shape drops to an unfilled ink-faint outline.

### Cards / Containers
An event is a square hairline box. See The Event Box Rule.

### Inputs / Fields
- **Style:** 50px tall, 1px ink-faint border, 10px corners, paper ground, 17px text, ink-faint placeholder. Labels are 14px 600 above the field. The select adds an ink chevron at the right.
- **Focus:** the edge turns ink, plus a 2px ink outline offset 2px.
- **Choice chips:** the booking sheet's exclusive answers (segments, weekday pills) are separate 44px pills with an 8px gap (4px for the seven weekdays), a 1px ink-faint edge, and an ink fill when chosen.
- **Error:** a 14px 500 ink line below the field. The current build leads it with a 10px red square. That mark collides with the red-square calendar, so treat it as drift to fix, not a pattern to reuse.

### Navigation
The masthead puts the wordmark at left: the three calendar shapes at 15px, then "Lilai" and its subline. FAQ and Donate sit at right as 15px 500 ink links without underline, underlined on hover. Body links are ink with a 1px underline offset 3px, 2px on hover. Links that leave the app from content (the event link on Home and in the RSVP sheet, links in FAQ answers) take `--link` at 500 instead.

### Admin Navigation and Header
Every admin page opens with the same header.
- **Tabs:** Events, Donations and Booking queue are 15px 500 text tabs, ink-faint at rest and ink on hover, 44px tall. The current page turns ink with a 2px ink underline.
- **Rule:** one 1.5px ink rule runs under the tabs and ends at the content edges, inside the gutter, like every other rule.
- **Title:** the page title follows 16px below the rule at the Headline size (26px 600, -0.01em). A 14px ink-soft subline sits 8px under it. The header block ends 24px later.

On FAQ and Donate the current page in the masthead is marked the same way: a 2px underline offset 3px.

### Status Marks
A booking's status is a word first. A 10px square with a 1.5px ink contour sits beside the word so a column of them can be scanned.
- **Filled** (ink): the request went out ("Request sent").
- **Open** (paper): something is still ahead, a reply or the moment itself.
- **Half** (lower half ink): "Missed".
- **Cross** (ink with a paper X): "Request failed".
- **Slash** (paper with an ink diagonal): nothing left this server ("Not sent").

Weight is the second channel. A request that left sets its outcome line in 600 ink. A slot that never left sets it in 500 ink-soft. A cancelled slot holds its place struck through in ink-faint until its undo runs out. The booking detail steps reuse the square on a 1.5px ink rail: filled for what happened, open for what is ahead. Marks never use colour.

### Balance Bar (Donate)
A flat ink meter under the balance, 400px wide at most and 14px tall, with a 1.5px ink border and square corners. The bar is centred on zero because the balance can run negative. A 2px ink tick marks zero and stands 3px proud of the track at each edge. The fill is an ink half-track fixed at the tick. It grows right for a positive balance and left for a negative one, and it moves by `transform: scaleX()` over 400ms on the system ease, never by an animated width. A 14px ink-soft scale sits under it, left, centre and right.

### Row Status (print in place)
An admin action reports its result in a line under the row it changed, never in a toast. The line is 14px ink-soft and sits 8px under the row's controls. An error sets the same line in ink 500. The line has no coloured marker. Page-level messages print into a state line in the page the same way, and a booking row that crosses the NOW rule prints in over 700ms like a new name on Home.

### Seat Slots (signature)
Seat slots show capacity as a row of the event's calendar shape at 16px with a 5px gap.
- **Open:** a paper fill inside the ink contour.
- **Taken:** the calendar's colour.
- **Full:** every slot turns ink and the label turns ink 600 ("Full · 12 of 12").
- **Past:** every shape on the event drains to an unfilled past-grey outline. The title and numeral turn ink-faint.
- Only an event with a limit of 10 or fewer (`MAX_SLOTS` in `app.js`) draws slots, one per place. An event with no limit, or more than 10 places, shows the label alone: a long row of shapes stopped reading as seats and crowded the page.
- A 14px ink-soft label follows the row: "5 of 12 spots taken", "3 going", "4 went".

### Names List and the RSVP Print
Attendees are a wrapped list of 15px names with 16px between them. A name added since the last render prints in 600 weight and fades in over 700ms. There is no toast. The new seat slot grows from scale 0 over 480ms. The event's band shape steps from 0.6 to full size over 640ms.

### RSVP Sheet
The sheet is a paper panel, 480px wide at most. On phones it rises from the bottom edge under a 1.5px ink top rule. From 640px it is centred with a full 1.5px ink border. It opens with a 16px rise and fade over 260ms. It holds a 22px title, a 14px when-line ("Saturday 3 October, 19:30–21:30"), an optional scrolling description, one field, and a solid button beside a text button.

### App Icon and Favicon

The icon is a 2x2 calendar of shapes on paper: blue circle, red square, yellow triangle, and an open white square in the fourth cell, which reads as an open seat. Every shape has an ink contour. Sources live in `public/icons/`: `icon.svg` (any purpose), maskable PNGs with the grid inside the 80% safe circle, and `favicon.svg`, drawn on a 32-unit pixel grid so it stays sharp at 32px and 16px. `favicon.ico` (16, 32, 48) is rendered from `favicon.svg`. The iPhone icon, `apple-touch-icon.png` (180, from `apple-touch-icon.svg`), is the same grid inverted: ink ground, paper contours, and the open seat as a paper outline. iOS 18+ darkens home-screen icons in Dark mode and a web clip cannot supply its own dark variant, so a white icon loses its white cell to black; an ink icon has nothing left for iOS to darken. The white fourth cell keeps the rule that primaries live only inside shapes.

### Motion
One easing, `cubic-bezier(0.16, 1, 0.3, 1)`, drives every movement. Shapes scale from their centre when state changes: a new seat slot grows, a band shape steps, and an event pointed at from the band steps its shapes for 520ms while nothing else moves. Band shapes scale by 1.12 on hover. The band readout fades in over 220ms when it names a different event, and a selected shape's ring fades in over 140ms. Under `prefers-reduced-motion` every animation and transition runs in 1ms.

**The State-Only Motion Rule.** Motion marks a change in attendance or a pointer landing, and nothing else. Nothing moves on load.

**The Print-Not-Toast Rule.** Feedback is the change itself, printed where it happened: for an RSVP a filled slot and a bold name, for an admin action a status line under its row. Do not announce it in a floating message.

### Known accepted limit
On phones the band's column is about 25px wide, so the headcount scale caps at 24px. One RSVP changes a shape's resting size by only 1.4px. The step animation carries the signal. The owner chose to ship this.

## Do's and Don'ts

### Do:
- **Do** give each calendar its shape in config order (circle/blue, square/red, triangle/yellow) and the ink diamond to the fourth and later calendars and unsourced events.
- **Do** draw every shape with a flat fill and a 1.5px ink contour.
- **Do** box each event in a 1px hairline, divide sections with full-width 1.5px ink rules, and the rows of a dense list with 1px hairlines.
- **Do** keep metadata at 14px and let only numerals break scale (event dates, the Donate balance, 96px on the booking detail date).
- **Do** carry status in a word, with ink weight and a 10px ink status mark as the second channel.
- **Do** show capacity with the four slot states (outline open, calendar colour taken, all ink full, grey outline past) on events of 10 places or fewer, and with the label alone otherwise.
- **Do** print a new RSVP bold into the names list and grow its slot from the centre.
- **Do** keep touch targets at least 44px tall and focus as a 2px ink outline offset 2px.

### Don't:
- **Don't** put blue, red or yellow on text, rules, buttons, links or grounds. The event link's `--link` blue is a link colour, not the calendar primary; keep it to that one link.
- **Don't** use shadows, gradients, or rounded corners on containers or controls, except the event pills.
- **Don't** confirm an RSVP or an admin action with a toast or banner.
- **Don't** animate on page load, or use bouncy or spring motion.
- **Don't** set running text in Jost, or add a third typeface; Jost is for headings and numerals, the system sans for reading.
- **Don't** reuse a primary shape as decoration or for anything that is not a calendar.
