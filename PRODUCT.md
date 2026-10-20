# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Solo players of puzzle-factory games (Big Pharma, shapez, Factorio, Opus Magnum audiences) who enjoy solving by hand. Primary setting: desktop browser with mouse and keyboard at 1280–1600px wide, in sessions long enough to explore, build and tune a line. Phones (≈390px) must stay fully playable by touch, but desktop density is never sacrificed for them.

## Product Purpose

HexaPharma joins Potion Craft–style map exploration with Big Pharma–style physical production. The player explores a fogged hex Atlas one paid machine stamp at a time until a disease is cured, then designs (free Plan) and builds (paid Production) a factory that produces that formula, ships it into finite demand, and unlocks the next machines. Success: a fresh player understands the next step at every moment, reaches a first profitable sale from $1000 without outside help, and wants to research the next disease.

## Positioning

The same machine is both a path on the map and a footprint on the factory floor: discovering a cure on the Atlas *is* designing a production recipe. Every map is generated from a seed with per-disease differences, so no single blueprint solves every run, and the human solves it — there is no in-game solver or auto-route.

## Operating Context

- Three world pages switched constantly: Research (F1), Production Plan (F2), Production (F3); management drawers Market (M), Technology (T), Blueprints (B), Formulas, Menu.
- Production keeps running while the player visits other pages; blocking confirmations pause it.
- Keyboard-heavy play: hotbar 1–0, R rotate, Q pick, Space play/pause, Ctrl+Z/Y/C/X/V, F focus.
- Playtests happen on a remote dev server; save files are open JSON.

## Capabilities and Constraints

- Pure deterministic TS sim; React UI + PixiJS 8 renderer; Vite. UI/renderer only read state and dispatch intents.
- Code-as-truth: no engine editors, scene files or raster asset pipelines; the world is drawn by code at runtime. One self-hosted font file is permitted (user-approved 2026-10-20); no other new dependencies.
- Pointy-top axial true hex in both Atlas and Factory; six directions E/SE/SW/W/NW/NE; six 60° footprint rotations.
- Fog secrecy is a game rule: only Walls show through fog; nothing hidden may leak through visuals, hover, preview, tooltips or camera.
- Research is reveal–decide: one complete PathStamp per paid step; no batch route, partial path or auto-solve.
- Plan is free/no clock; Production edits cost cash (diff quote); Commission builds a Plan into Production.
- Finite per-disease demand; shipping contracts (quota 3) gate patents.
- Hot render loops must not allocate per tick.
- Terminology for players: Research, Plan, Production, Commission, Formula, Cure, Side effect, Market, Technology, Knowledge, Blueprint. Internal `pilot` naming is never player copy.

## Brand Commitments

- Name: HexaPharma (codename).
- Visual direction set by the user (2026-10-20): modern clean lines combined with a hand-drawn feel, rendered procedurally; more game feel than the previous minimal schematic, while keeping a factory game's legibility floor.
- Must not feel: childish/cartoonish; factory information (flow, ports, numbers) harder to read; animation that slows operation.

## Evidence on Hand

- Live build and Playwright fixtures (seed 14 reference route) for screenshots; fixtures are not human playtest evidence.
- No human playtest record exists yet; never claim one.

## Product Principles

1. The world is the interface: map and factory lead; chrome serves them.
2. Always show the next step: the loop Research → Formula → Build → Ship → Unlock must be legible without the guide.
3. Discovery is the peak: a Cure is the moment the game celebrates; everything else stays fast.
4. One machine, one identity across map, hotbar, factory floor and formula.
5. Cost is always visible before it is spent.

## Accessibility & Inclusion

Keyboard-complete primary flows, visible focus, 44px touch targets on touch layouts, aria-live for status and errors, meaning never by colour alone (cure/side-effect/failure also differ in shape), reduced-motion respected.
