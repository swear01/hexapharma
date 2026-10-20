---
version: 1
slug: "src-ui-game-tsx"
primary_target: "src/ui/Game.tsx"
related_targets: ["src/ui/App.tsx","src/ui/Factory.tsx","src/render/labRenderer.ts","src/render/factoryRenderer.ts"]
---

# Surface brief — HexaPharma game shell (Research / Plan / Production + panels)

Scope: whole game UI. Mode: Operate (a working game screen; world lends type, palette, density, one signature move; controls stay standard web controls).
Audience/job: desktop puzzle-factory player (mobile playable) exploring the Atlas, building lines, shipping cures.
Constraints: PRODUCT.md; fog secrecy; reveal–decide; no auto-solve; Plan free / Production paid; code-drawn world (one self-hosted font allowed); no per-tick allocation.
Memorable moment: a Cure lands as an orienteering FINISH symbol and the course becomes Formula F-0n.
Rejected on 2026-10-20: riso overprint (assigned), skeletal-formula chalkboard (pick), category canon.

## Direction contract
THESIS: The game is an orienteering map being printed as you run it. Refuses the dark tool-app shell (tabs + drawers + glowing schematic) that every factory web game ships.
OWN-WORLD: Paper ground (#F6F3EC) with near-black ink (#1E1F1C); ISOM colour language — white runnable, olive thicket screen, blue marsh hatch, black cliffs, brown contour ink; COURSE PURPLE (#7B2CBF) reserved for the player's own line (research course, candidate, selection, Plan overprint). Cure green, side-effect amber screen, failure red only where they mean that. Condensed bold display caps (self-hosted Barlow Condensed 600) for headings, numerals, control numbers; system sans body; tabular numbers everywhere. Linework crisp; hand-drawn only in terrain contour wobble and ink-leg draw.
STORY: Player reads the legend, runs a course across fog to a Cure, sees it become a formula, prints it as a factory, ships it, unlocks the next symbol.
FIRST VIEWPORT: Top bar on paper — wordmark, Research/Plan/Production tabs with purple underline, centre Objective line ("Find Disease 1 · look east"), right Cash · Knowledge · Stock→Ship · Contract 0/3, Menu. World fills the rest: unprinted fog with faint contour texture, printed 19-cell disk, purple start triangle, dashed purple candidate leg to a hollow control circle. Bottom-left: legend hotbar (machine symbol + name + cost rows). Bottom-right: step readout + primary "Run leg · $2".
FORM: Orienteering map and legend (challenger notation-diagram-systems-orienteering-map, chosen over assigned list item 6). seed:329088f635ab5b11
SIGNATURE: Course overprint — every executed step stamps a numbered purple control circle and inks its leg (≤250 ms, instant under reduced motion); Cure draws the double-circle finish and opens a result card "Formula F-01 saved → Open in Plan". Plan layouts render as purple overprint; Production renders as black print.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
