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
  numeral:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "44px"
    fontWeight: 500
    lineHeight: 0.9
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  section:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  meta:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  small:
    fontFamily: "Jost, PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
rounded:
  none: "0px"
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
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "48px"
  button-solid-hover:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
  button-line:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.section}"
    rounded: "{rounded.none}"
    padding: "0 24px"
    height: "48px"
  button-line-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  button-disabled:
    backgroundColor: "{colors.wash}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.none}"
    height: "48px"
  text-button:
    textColor: "{colors.ink}"
    typography: "{typography.meta}"
    height: "44px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "0 12px"
    height: "50px"
  sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    width: "480px"
---

# Design System: Lilai

## Overview

**Creative North Star: "The Shape Calendar"**

Lilai follows a Bauhaus form-colour grammar on white paper. Each enabled calendar owns one primary shape, assigned in config order: a blue circle, a red square, a yellow triangle. A fourth calendar, or an event with no known source, gets an ink diamond. The shape is the calendar's identity everywhere it appears: the wordmark, the 14-day band, the legend, the event title mark and the seat slots. The band reads as an abstract composition drawn from the real events.

Everything else is black ink on white. Text, rules and buttons carry no colour, so the primaries stay loud and always mean "this calendar". Content is divided by 1.5px ink rules, never boxed into cards. Metadata sits at one constant size. The only thing that breaks scale is the date numeral of the next event, so the page has one entry point.

Motion is scarce and tied to state. When attendance changes, a shape scales from its centre with an exponential ease-out. A new RSVP prints bold into the names list. Nothing moves on load, and reduced motion is instant.

**Key Characteristics:**
- One primary shape per calendar, flat fill, 1.5px ink contour.
- Primaries appear only inside shapes (plus the yellow text selection).
- Ink rules divide content; there are no cards, shadows, gradients or rounded corners.
- Constant 14px metadata; only the date numeral breaks scale (96px on the lead event).
- Shapes carry state: outline open, calendar colour taken, all ink full, grey outline past.
- Motion happens on state change only, scaling shapes from their centre.

**Scope today.** Only Home (`public/index.html`) loads `public/css/lilai.css`. FAQ, Donate and the admin pages still load the legacy `public/styles.css`. This is a known migration gap and not part of the system.

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
- **Ink Faint** (ink-3): weekday ticks, placeholders, captions, the colophon, inactive range tabs, past titles and numerals.
- **Hairline** (hair): the thin Monday divider in the 14-day band, disabled button borders.
- **Wash** (wash): hover ground for icon buttons, disabled button fill.
- **Past Grey** (past): contour of every shape on a past event. Past shapes lose their fill.
- **Scrim** (`rgba(17, 17, 17, 0.4)`): the only translucent value, behind an open sheet.

### Named Rules
**The Shapes-Only Primaries Rule.** Blue, red and yellow appear only as the fill of a calendar shape. Text, rules, buttons, links and grounds are ink or paper. The one exception is the yellow text selection.

**The One Shape Per Calendar Rule.** Calendars take circle/blue, square/red, triangle/yellow in config order. The fourth and later calendars, and unsourced events, take the ink diamond. Never give a calendar a second shape or colour, and never use a primary shape for something that is not a calendar.

## Typography

**Display Font:** Jost (self-hosted in `public/fonts/`, SIL OFL, variable weight 400 to 700)
**Body Font:** Jost, falling back to PingFang TC, Noto Sans TC, Microsoft JhengHei, system-ui for Chinese and missing glyphs
**Label/Mono Font:** none; numerals use tabular figures

**Character:** Jost carries the Futura lineage, so its geometric letterforms match the circle, square and triangle. Chinese names and titles fall to the system CJK sans and sit on the same line without a second display face.

### Hierarchy
- **Numeral Lead** (500, 96px, 0.78, -0.04em): the day number of the next event. It is the only type that breaks scale.
- **Numeral** (500, 44px on phones, 52px from 640px, 0.9): the day number of every other event in the list.
- **Headline** (600, 26px on phones, 30px from 1000px, 1.25): the next event's title.
- **Title** (600, 20px, 1.25, balanced wrap): event titles. The sheet title uses 22px.
- **Section** (600, 16px): section heads, sidebar block titles, button labels.
- **Body** (400, 16px, 1.5): running text. Descriptions and the names list use 15px; descriptions cap at 65ch and clamp to three lines (two for the lead event on phones).
- **Meta** (400 or 500, 14px): dates, times, places, seat labels, counts, field labels and text buttons.
- **Small** (400, 12px): weekday ticks in the band. Captions and the colophon use 13px.

The wordmark sets "Lilai" at 26px 600 (-0.02em) above a 12px ink-soft subline. Inputs use 17px so phones do not zoom.

### Named Rules
**The Constant Meta Rule.** Every piece of metadata, in every component, is 14px. Hierarchy comes from weight and ink tone. Only the date numeral grows.

**The Tabular Numerals Rule.** Dates, counts and seat labels use tabular figures so columns of numbers stay aligned.

## Layout

The page is a single column capped at 1180px, with a 16px gutter on phones and 32px from 640px. Spacing runs on an eight-step scale from 4px to 64px.

- **Order.** The 14-day band, then the event list, then the sidebar (calendar links, support).
- **From 1000px.** The band spans the full width. Below it the list takes the flexible column and the sidebar takes a 400px column with a 64px gap. The sidebar is sticky 16px from the top.
- **The 14-day band.** Fourteen equal columns between two ink rules. A 3px ink bar marks today's left edge and today's date sits reversed out of an ink block. A hairline marks each Monday. Each event is its calendar's shape, stacked in its day, sized by headcount: `min(max, base + n × step)` with n capped at 12. Phones use 8px + 1.4px per head up to 24px; 640px uses 12px + 3.5px up to 40px; 1000px uses 14px + 4.5px up to 64px. Day columns are 96px, 112px, 136px and 196px tall across the breakpoints.
- **Events.** Each event is a two-column row: a 56px date column (72px from 640px) and the body. The next event drops to one column on phones, with the numeral beside its weekday, month and time. From 1000px it uses a 180px date column. A 3px ink Today rule divides past from future in the list.
- **Phones.** On phones the header, band and lead event tighten so Join lands in the first screen. The subline hides below 380px.
- **Touch targets.** Links, tabs, legend items and icon buttons are at least 44px tall.

## Elevation & Depth

The system is flat. There are no shadows and no gradients. Depth comes from ink rules, the reversed ink block for today, and one scrim behind an open sheet. A shape's 1.5px ink contour separates it from paper, so even the yellow triangle holds its edge on white.

### Named Rules
**The Flat Paper Rule.** Nothing casts a shadow. When a layer must sit above the page, it gets the 40% ink scrim and an ink rule on its edge.

## Shapes

The form language has two registers.

- **Calendar shapes.** Circle, square, triangle and diamond are drawn from one SVG symbol set on a 24-unit grid. Each has a flat fill and a 1.5px ink contour with mitred joins that does not scale with size. The circle is the only curve in the system.
- **Everything else is square.** Buttons, inputs, the sheet and the reversed date block all have 0px corners. Rules are 1.5px ink. The Today marker is 3px ink. Active range tabs get a 2px ink underline.

**The Rules Not Boxes Rule.** Content is divided by full-width 1.5px ink rules above each event, section and sidebar block. Only controls (buttons, inputs) and the desktop sheet carry a full border.

## Components

### Buttons
Blunt ink blocks that invert on hover.
- **Shape:** square corners (0px), 1.5px ink border, 48px tall, 24px side padding, 16px 600 label.
- **Solid:** ink ground, paper label. Join, Confirm and Remove use it. On the lead event Join stretches full width within thumb reach.
- **Line:** paper ground, ink label. Used for secondary calls such as "Create an event".
- **Hover:** solid and line swap ground and label over 140ms on the system ease.
- **Disabled:** wash ground, hairline border, ink-faint label. A full event shows a disabled "Full" button in place of Join.
- **Text button:** 14px 500 ink with a 1px underline offset 3px, 2px on hover, 44px tall. Used for Refresh, Remove a name, Show more, Load earlier events, Cancel and Keep it.
- **Icon button:** a 44px square holding a 22px ink line SVG (1.5px, square caps), with a wash ground on hover.
- **Focus:** every control gets a 2px ink outline offset 2px.

### Chips
- **Range tabs:** Upcoming and All are 17px 500 text tabs, ink-faint at rest. The active tab turns ink with a 2px ink underline.
- **Legend:** each calendar is its shape at 14px beside its name (15px). The legend is also the filter. A calendar that is switched off turns ink-faint, and its shape drops to an unfilled ink-faint outline.

### Cards / Containers
There are no cards. An event is a row under a 1.5px ink rule with 24px top and 32px bottom padding. See Layout and The Rules Not Boxes Rule.

### Inputs / Fields
- **Style:** 50px tall, 1.5px ink border, 0px corners, paper ground, 17px text, ink-faint placeholder. Labels are 14px 600 above the field. The select adds an ink chevron at the right.
- **Focus:** 2px ink outline offset 2px.
- **Error:** a 14px 500 ink line below the field. The current build leads it with a 10px red square. That mark collides with the red-square calendar, so treat it as drift to fix, not a pattern to reuse.

### Navigation
The masthead puts the wordmark at left: the three calendar shapes at 15px, then "Lilai" and its subline. FAQ and Donate sit at right as 15px 500 ink links without underline, underlined on hover. Body links are ink with a 1px underline offset 3px, 2px on hover.

### Seat Slots (signature)
Seat slots show capacity as a row of the event's calendar shape at 16px with a 5px gap.
- **Open:** a paper fill inside the ink contour.
- **Taken:** the calendar's colour.
- **Full:** every slot turns ink and the label turns ink 600 ("Full · 12 of 12").
- **Past:** every shape on the event drains to an unfilled past-grey outline. The title and numeral turn ink-faint.
- Events with a limit show one slot per place. Events without one show one slot per person. Slots past the row cap collapse into a "+N" count.
- A 14px ink-soft label follows the row: "5 of 12 spots taken", "3 going", "4 went".

### Names List and the RSVP Print
Attendees are a wrapped list of 15px names with 16px between them. A name added since the last render prints in 600 weight and fades in over 700ms. There is no toast. The new seat slot grows from scale 0 over 480ms. The event's band shape steps from 0.6 to full size over 640ms.

### RSVP Sheet
The sheet is a paper panel, 480px wide at most. On phones it rises from the bottom edge under a 1.5px ink top rule. From 640px it is centred with a full 1.5px ink border. It opens with a 16px rise and fade over 260ms. It holds a 22px title, a 14px when-line, an optional scrolling description, one field, and a solid button beside a text button.

### Motion
One easing, `cubic-bezier(0.16, 1, 0.3, 1)`, drives every movement. Shapes scale from their centre when state changes: a new seat slot grows, a band shape steps, and an event pointed at from the band steps its shapes for 520ms while nothing else moves. Band shapes scale by 1.12 on hover. Under `prefers-reduced-motion` every animation and transition runs in 1ms.

**The State-Only Motion Rule.** Motion marks a change in attendance or a pointer landing, and nothing else. Nothing moves on load.

**The Print-Not-Toast Rule.** Feedback for an RSVP is the change itself: a filled slot and a bold name. Do not announce it in a floating message.

### Known accepted limit
On phones the band's column is about 25px wide, so the headcount scale caps at 24px. One RSVP changes a shape's resting size by only 1.4px. The step animation carries the signal. The owner chose to ship this.

## Do's and Don'ts

### Do:
- **Do** give each calendar its shape in config order (circle/blue, square/red, triangle/yellow) and the ink diamond to the fourth and later calendars and unsourced events.
- **Do** draw every shape with a flat fill and a 1.5px ink contour.
- **Do** divide content with full-width 1.5px ink rules.
- **Do** keep metadata at 14px and let only the date numeral break scale (96px on the lead event).
- **Do** show capacity with the four slot states: outline open, calendar colour taken, all ink full, grey outline past.
- **Do** print a new RSVP bold into the names list and grow its slot from the centre.
- **Do** keep touch targets at least 44px tall and focus as a 2px ink outline offset 2px.

### Don't:
- **Don't** put blue, red or yellow on text, rules, buttons, links or grounds.
- **Don't** use shadows, gradients, rounded corners on containers or controls, or card boxes.
- **Don't** confirm an RSVP with a toast or banner.
- **Don't** animate on page load, or use bouncy or spring motion.
- **Don't** introduce a second typeface for Latin text; Jost carries display and body.
- **Don't** reuse a primary shape as decoration or for anything that is not a calendar.
