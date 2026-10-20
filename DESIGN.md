---
name: HexaPharma
description: An orienteering map that prints itself as you run it; paper, ink and one purple course.
colors:
  paper: "#f6f3ec"
  paper-sunk: "#ece7db"
  paper-raised: "#fffdf8"
  ink: "#1e1f1c"
  ink-2: "#47463f"
  ink-3: "#6b675c"
  rule: "#ddd6c6"
  rule-strong: "#b9ae97"
  course: "#7b2cbf"
  course-ink: "#6421a3"
  course-tint: "#efe5f8"
  contour: "#a0673a"
  flow: "#2b78b8"
  cure: "#2f8f46"
  cure-ink: "#22703a"
  effect: "#d9822b"
  effect-ink: "#9a5410"
  failure-ink: "#a62b22"
  failure-border: "#c8372d"
  failure-surface: "#fbe9e6"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.01em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.01em"
  numeral:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1
    fontFeature: "tnum"
  nav:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.03em"
  action:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.05em"
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  hotkey:
    fontFamily: "Barlow Condensed, Arial Narrow, ui-sans-serif, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  body-small:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  none: "0px"
  key: "2px"
  control: "3px"
  full: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  shell: "20px"
  xl: "24px"
components:
  button:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  button-active:
    backgroundColor: "{colors.course-tint}"
    textColor: "{colors.course-ink}"
  button-disabled:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-raised}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.ink-2}"
  button-course:
    backgroundColor: "{colors.course}"
    textColor: "{colors.paper-raised}"
    typography: "{typography.nav}"
    rounded: "{rounded.control}"
    height: "48px"
    width: "132px"
  button-course-hover:
    backgroundColor: "{colors.course-ink}"
  button-danger:
    backgroundColor: "{colors.failure-border}"
    textColor: "{colors.paper-raised}"
    rounded: "{rounded.control}"
    height: "44px"
  button-danger-hover:
    backgroundColor: "{colors.failure-ink}"
  nav-tab:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    typography: "{typography.nav}"
    rounded: "{rounded.none}"
    padding: "0 14px"
  nav-tab-active:
    textColor: "{colors.course-ink}"
  legend-entry:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.control}"
    padding: "6px 12px 6px 8px"
    height: "56px"
  legend-entry-selected:
    backgroundColor: "{colors.course-tint}"
    textColor: "{colors.course-ink}"
  control-number:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.course-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    size: "24px"
  margin-card:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  input:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "44px"
  drawer:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    padding: "24px"
    width: "560px"
  modal:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "28px"
    width: "520px"
---

# Design System: HexaPharma

## Overview

**Creative North Star: "The Course Being Printed"**

HexaPharma is an orienteering map that is printed as you run it. The ground is paper (`paper`), structure is near-black ink (`ink`), the land carries ISOM-style map inks (brown contours, blue water, black cliffs, green cure screens, amber side-effect screens), and the only thing in purple is the player's own course. The Atlas, the Factory floor, the legend hotbar and every drawer are parts of one sheet: map, margin furniture, and legend. Game rules live in `docs/design.md`; its "Visual language" section is the short canonical statement this file expands into tokens.

Density follows the factory-game floor: tabular numerals everywhere, compact condensed caps for every name and number, and 44px hit areas on touch. Chrome is printed, not floated. Panels sit on the paper as ruled boxes with hairline borders and heavy ink rules at sheet edges; only drawers, toasts and modals that physically cover the map carry a soft shadow. The hand-drawn quality is narrow and deterministic: contour wobble, cliff ticks, hatch lines and the course leg's ink draw, all seeded from `src/render/ink.ts` so a redraw never shimmers.

`docs/design.md` rules out 3D perspective, glass blur, glow and gradients, and generated bitmaps. Everything in the world is drawn by code at runtime: Pixi `Graphics` for the Atlas and Factory, inline SVG for legend symbols. The one exception is the self-hosted Barlow Condensed 600 font.

**Key Characteristics:**
- Warm paper ground, near-black ink, and a strict map-ink palette in which every colour means something.
- Course purple marks the player's own line, selection and Plan overprint. Nothing else uses it.
- Condensed bold caps for headings, numerals, labels and controls. System sans for sentences.
- Heavy 2px ink rules mark sheet edges, 1px rules divide rows, and dashed lines mean draft or empty.
- Numbered control circles, a start triangle and a double-circle finish are drawn as orienteering symbols.
- One authored motion: the course leg inks itself in 220ms, and appears instantly under reduced motion.

## Colors

The palette is a printed map: three warm paper tones, three ink greys, two paper rules, one course purple, and map inks that each carry exactly one meaning.

### Primary
- **Course Purple** (`course`): the player's line. It covers the Atlas research course (start triangle, numbered control circles, legs, double-circle finish), the dashed candidate leg, the active nav tab underline, selected legend entries, the cure result card border, the Run and Open in Plan buttons, Plan-mode overprint in the Factory, and focus rings.
- **Course Ink** (`course-ink`): purple used for text and for hover on course buttons. Control numbers, the active tab label, formula IDs and step numbers use it because it reads better at small sizes than `course`.
- **Course Tint** (`course-tint`): the wash behind an active or selected control (`is-active`, `is-selected`, pressed toggles) and behind text selection.

### Secondary
- **Contour Brown** (`contour`): terrain only. It draws the contour texture on unprinted fog (alpha 0.2 thin and 0.26 index lines) and the Factory's unbuilt-ground paper, and it is one of the portal-marker inks.
- **Flow Blue** (`flow`): water and transport. It draws the marsh hatch on the Atlas, belt channels in Production, and the belt, splitter and merger tool symbols.

### Tertiary
- **Cure Green** (`cure`) / **Cure Ink** (`cure-ink`): cure zones (green screen and cross) and clean results ("Clean", cure counts, owned patents, sale feedback). Cure symbols always pair the colour with a cross or double circle.
- **Side-effect Amber** (`effect`) / **Effect Ink** (`effect-ink`): side-effect screen dots on the Atlas and tainted values in Market and Formulas. When Cure and Side effect share a cell, both screens stay visible.
- **Failure Red** (`failure-border`, `failure-ink`, `failure-surface`): failed steps (red cross), blocked Production, invalid placement ghosts (dashed red), the danger button and error alerts. Failure always comes with a cross, a dash or text.

### Neutral
- **Map Paper** (`paper`): the app background, top bar and Atlas canvas ground. The Pixi canvas uses the same value (`SHARED_SCHEMATIC_STYLE.background`).
- **Unprinted Paper** (`paper-sunk`): fog on the Atlas, the Factory's unbuilt ground and disabled course buttons.
- **Printed Paper** (`paper-raised`): revealed hex cells, cards, drawers, modals, inputs and button faces.
- **Ink** (`ink`): text, walls and cliffs, Production machine print, primary button fill and the heavy sheet rules.
- **Ink 2** (`ink-2`) / **Ink 3** (`ink-3`): secondary text and muted labels, hotkeys and disabled text.
- **Rule** (`rule`) / **Rule Strong** (`rule-strong`): hairline row dividers and control borders. `rule-strong` also draws the Factory floor neatline.

### Named Rules
**The Course Purple Rule.** Purple belongs to the player's own line: the course, the candidate, the current selection and Plan overprint. If an element is not something the player drew, chose or is about to commit, it does not use purple.

**The Ink-Means-Something Rule.** Green means cure, amber means side effect, red means failure, blue means water or flow, and brown means terrain. Each one also has a shape (cross, dots, X, hatch, contour), so meaning never depends on colour alone.

**The Shared Inks Rule.** The Pixi renderers read the same values as CSS, from `src/render/schematicStyle.ts` (`SHARED_SCHEMATIC_STYLE`). A new world colour is added to both places.

## Typography

**Display Font:** Barlow Condensed 600, self-hosted from `src/ui/fonts/` under the OFL (fallback: Arial Narrow, ui-sans-serif)
**Body Font:** system UI sans (ui-sans-serif, system-ui, -apple-system, Segoe UI)

**Character:** The display face works like the lettering on a printed map: condensed bold uppercase for names, numbers and controls, so a dense HUD stays compact. The system sans carries sentences, tooltips and descriptions, and gets out of the way.

### Hierarchy
- **Display** (600, 30px, line-height 1, uppercase): drawer and inspector titles (`h1`). The inspector uses 24px.
- **Headline** (600, 26px, 1.1, uppercase): modal titles, the cure card's formula title, formula IDs.
- **Title** (600, 19px, 1.1, uppercase): section headings (`h2`), patent names and market values. Legend and machine names use the same face at 15–17px.
- **Numeral** (600, 22px, 1, tabular): HUD resources (Cash, Knowledge, Stock, Contract) and other headline numbers. Market net uses 23px and formula step numbers use 22px.
- **Nav** (600, 18px, 1, 0.03em, uppercase): Research, Plan and Production tabs, and the compass disease name. The Run button uses the same face at 19px.
- **Action** (600, 16px, 1, 0.05em, uppercase): primary buttons. Factory and utility controls use 15px.
- **Label** (600, 13px, 1.2, 0.06em, uppercase, `ink-3`): field labels, sheet `dt` labels, patent group headings and resource labels.
- **Hotkey** (600, 11px, 1, 0.04em, `ink-3`): keycap hints beside controls (F1, M, 1–0). Hotkey hints are hidden below 1050–1180px.
- **Body** (400, 14px, 1.55): root size and paragraphs. **Body small** (13px, 1.45) covers drawer copy, toasts and readouts. Blueprint import text uses 12px monospace.

### Named Rules
**The Two Faces Rule.** Use condensed caps for every name, number and control, and use system sans for sentences. Never set a sentence in Barlow, and never set a heading in the body face.

**The Tabular Rule.** Every number is tabular (`font-variant-numeric: tabular-nums` on `strong`, `output`, `td`, `.num` and all readouts), so changing values don't shift the layout.

## Layout

The game is a full-viewport grid (`100dvw × 100dvh`, no page scroll). On desktop it has three rows: a 56px top bar (wordmark, field tabs, resource strip, Menu), a 44px utility row (Objective line with a direct action on the left, drawer links on the right) and the world stage. The world fills the stage. Map-margin furniture is inset 12px from the stage edges: compass and disease card top-left, course list below it, result card top-right, atlas status bottom-left. Below the world, the legend hotbar and the command bar share a bottom row separated from the map by a 2px ink rule.

The Factory uses a canvas / toolbelt / status-and-controls grid with a 56px bottom bar and an optional 280px inspector. Drawers slide over from the right at `min(560px, 100%)`. The formula reference stays docked at 340px above 769px.

Spacing runs on a 4px base: 4, 8, 12, 16, 20 and 24px. Gaps inside controls are 8–12px, edge insets are 12px, shell gutters are 20px and drawer padding is 24px. Breakpoints:
- **1180px** hides the wordmark and legend hotkeys.
- **1100px** stacks the Factory status, toolbelt and controls.
- **1050px** compacts resource labels and drops nav hotkeys.
- **768px** switches to the touch layout: the top bar and utility row each become two 44–48px rows, the course list becomes a horizontal snap strip, the result card moves above the bottom bar, drawers go full width and every control is at least 44px.

### Named Rules
**The World-First Rule.** The map or floor fills everything chrome doesn't need. Margin furniture sits in the corners at a fixed 12px inset and never covers the centre of the sheet.

## Elevation & Depth

The system is flat print. Depth comes from paper tone (sunk fog, map paper, printed cells and cards) and from rule weight, not from shadows. Furniture printed on the map has a border and no shadow ("printed on paper, never glass"). Only surfaces that physically cover the map get an ambient shadow, and the strength follows how much they cover.

### Shadow Vocabulary
- **Drawer edge** (`box-shadow: -12px 0 32px rgb(30 31 28 / 10%)`): the right-hand drawer over the world. The docked formula reference has no shadow.
- **Toast** (`box-shadow: 0 6px 18px rgb(30 31 28 / 12%)`): transient status and error messages, top-right.
- **Modal** (`box-shadow: 0 18px 48px rgb(30 31 28 / 22%)`): blocking confirmations over a `rgb(30 31 28 / 45%)` ink scrim.

### Named Rules
**The Printed-Not-Glass Rule.** Anything that sits on the map is printed on it: paper fill, a 1–2px border, no shadow and no blur. Shadows belong only to sheets lying on top of the map.

## Shapes

Corners are nearly square: 3px on buttons, inputs, cards, toasts and modals, and 2px on legend keycaps. Field tabs are square, with a 4px underline. Circles are reserved for orienteering controls: numbered control circles (24px in the course list, 18px on the Factory floor), the start triangle, the double-circle finish and the cure card's ring symbol. Both worlds use pointy-top true hexes.

Line weight follows a fixed hierarchy:
- **2px ink:** sheet edges (top bar bottom, hotbar top, drawer left, modal, formula ribbon).
- **1.5px ink:** print marks (Factory mode mark, machine selection legend, quoted cost).
- **1px rule:** row dividers.

Dashed lines mean draft or absence: Plan overprint outlines and the Plan mode mark, the candidate leg, empty-state boxes and invalid placement ghosts.

### Named Rules
**The Overprint Rule.** A Plan is purple overprint: dashed outlines at 0.85 ink alpha, 0.4 alpha channels, 0.06 fill and no wobble. Production is solid black print with blue flow channels and 0.6px outline wobble. Free drafts and paid builds must never look alike.

**The Steady Hand Rule.** The hand-drawn look comes only from the deterministic `inkJitter` (`src/render/ink.ts`). It applies to contours, cliff ticks, hatch lines, course legs and non-functional footprint outlines. It never touches ports, belt joints, hit-test geometry or text, and the same state renders identically every frame.

## Components

### Buttons
Square, printed and plainly labelled.
- **Shape:** gently squared (3px). Minimum height is 44px, or 40px in dense desktop bars.
- **Default:** `paper-raised` face, 1px `rule-strong` border and body type. Hover darkens the border to `ink-2`. Background, border and colour transition over 0.12s ease-out.
- **Primary:** solid `ink` with `paper-raised` Action caps, `ink-2` on hover. Use it for the Objective action, Commission/Ship-style commands and confirmations.
- **Course:** solid `course` with `paper-raised` caps, `course-ink` on hover. Reserve it for committing the player's line: Run (48px tall) and Open in Plan. When disabled it drops to `paper-sunk` with `ink-3` text.
- **Danger:** solid `failure-border`, `failure-ink` on hover. Use it only for destructive confirmations.
- **Quiet:** transparent, borderless display caps for utility links, factory controls and atlas status. Hover shows a `rule-strong` border or a `course-tint` wash when active.
- **Active / Selected:** `course` border, `course-ink` text and `course-tint` wash.
- **Focus:** 2px `course` outline with a 2px offset on every focusable element.

### Navigation
Field tabs are display caps (18px) on the paper top bar. The active tab is `course-ink` with a 4px `course` underline sitting on the 2px ink rule. Hover shows a `rule-strong` underline. On touch they share a 48px row with Menu. Menu is an outlined ink button in display caps.

### Map-margin cards
The compass and disease card, the course list, the step readout, the cure card and the atlas status are printed boxes: `paper-raised`, a 1px `rule-strong` border, 3px corners and no shadow. The course list numbers each row with a control circle (2px `course` ring, `course-ink` numeral). A failed readout switches to the failure surface with a red cross.

### Cure card (signature)
When a Cure lands, the last control becomes a double-circle finish on the map, and a 320px card bordered in 2px `course` shows the ring symbol, the formula title (Headline, e.g. "F-01 · Disease 1"), tabular stats with "Clean" in `cure-ink` or effects in `effect-ink`, and a full-width course button to Open in Plan.

### Legend hotbar / toolbelt
The machine key is printed in the map margin. In Research each entry is a 36px machine symbol beside the name (display caps 15px), the cost (12px tabular) and a hotkey. In the Factory, tool slots are 76px wide with the symbol stacked over the name. Entries are transparent. The selected entry gets a `course` border with a `course-tint` wash. Locked entries fade the symbol to 0.45 and show a lock. A machine's symbol is the same path/footprint SVG (`MachineIcon`) on the map, in the hotbar, on the floor and in formulas.

### Inputs / Fields
- **Style:** same face as buttons: `paper-raised`, 1px `rule-strong`, 3px corners, 44px tall. The caret is `course`.
- **Focus:** the border turns `course`, plus the 2px focus outline.
- **Error:** `failure-border` border with a 12px `failure-ink` message below. A field label uses the Label style above the input.

### Drawers and sheets
Market, Technology, Blueprints, Formulas, Guide and Menu are legend and control-description sheets: `paper-raised`, with a 2px ink rule under the Display title and rows divided by 1px rules. Values use display numerals, and labels use the Label style. The Formula ribbon is a 2px-ink-bordered sheet whose step rows have column rules (icon, `course-ink` step number, name).

### Factory mode mark
A small top-left print mark names the sheet ("Production ▸ Running"): 1.5px ink border, display caps with 0.08em tracking. In Plan it is dashed `course`, and when blocked it has a `failure-border` border.

## Do's and Don'ts

### Do:
- **Do** draw new world elements with code (Pixi `Graphics` or inline SVG) using `SHARED_SCHEMATIC_STYLE` / CSS custom properties, never raster assets.
- **Do** give every status colour a shape partner: cross for cure, dots for side effect, X or dash for failure.
- **Do** use condensed display caps (Barlow Condensed 600) for names, numbers and controls, with tabular numerals.
- **Do** keep map furniture printed: `paper-raised`, 1px `rule-strong` border, 3px corners, 12px inset, no shadow.
- **Do** keep the course leg ink draw at or under 250ms (currently 220ms, exponential ease-out) and make it instant under `prefers-reduced-motion`.
- **Do** keep touch targets at least 44px and a visible 2px `course` focus outline.

### Don't:
- **Don't** use course purple for anything the player didn't draw, select or isn't about to commit.
- **Don't** use 3D perspective, glass blur, glow, gradients or generated bitmaps (per `docs/design.md`).
- **Don't** put shadows on anything printed on the map. Only drawers, toasts and modals get them.
- **Don't** apply ink jitter to ports, belt joints, hit-test geometry or text, or seed it from anything nondeterministic.
- **Don't** let fog texture reveal hidden terrain. Fog contours depend only on seed and coordinates, and only walls show through.
- **Don't** render Plan and Production the same way. Plan is dashed purple overprint, and Production is solid black print.
