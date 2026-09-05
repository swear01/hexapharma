# Minimal frontend acceptance

This change keeps React/Pixi and the existing sim authority. The frontend uses flat neutral surfaces, quiet hex grids, distinct current/candidate markers, physical machine footprints, optional diagnostics, and an all-disease formula reference beside the desktop world.

## Agent-driven manual play

A fresh default seed 14 run started with $1000 and no injected state, funds, reference, solver, compiler, or prepared blueprint. The agent chose and tested individual Research tools, then placed every machine, transport tile, source, and sink through the UI.

| Observation | Recorded result |
|---|---|
| First cure | Disease 3, one side effect |
| Research sequence | Pump ×3, Wave ×2, Press, Coil ×3 |
| Assay | 9 paid steps, $28 |
| First test → cure | approximately 118 seconds |
| First test → first profitable sale | approximately 343 seconds |
| Construction | $320; no layout rebuilds |
| Minimum cash | $652 |
| First sale | $136 gross − $28 processing − $25 effect penalty = $83 net |
| After first sale | $735 cash, 1 Knowledge, 48 stock |

The run was saved with the normal UI. Its authority input trace and original screenshots are preserved in `/tmp/hexapharma-ui-acceptance` and `/tmp/hexapharma-ui-manual-*.png` on the task machine. Populated screenshot captures load that same manual checkpoint; they are not compiler fixtures. Browser traces of the capture pass document loading and interacting with the checkpoint, not the original fresh playthrough.

This is agent-driven interaction evidence, not human feedback or a willingness-to-continue measurement. A separate comprehension timer was not recorded. This run does not establish a D1 → D2 progression or the four-disease economy acceptance.

The review exposed a concrete usability problem: a formula drawer that disabled construction forced repeated opening and closing. Formulas now remains beside the desktop canvas while rooms change, with a paid-placement browser regression. Mobile retains a closable full-width panel. Construction prices now use the actual pointed placement/move quote, avoiding a misleading universal brush price.

## Verification scope

Browser regressions cover all-formula selection and Save/Load, desktop construction with the reference open, running Production paused behind New/Load/Rewind/Reset/expansion/blueprint-delete confirmations, Cancel/resume, and accepted runtime replacements. Compiled routes used by these correctness tests are explicitly fixtures.

Market's stock readout sums only currently profitable stock at successively declining demand. It is not a lifetime profit estimate. Technology uses authoritative costs and shipping progress for explicit shortfalls; the optional fresh-start guidance does not declare a run irrecoverable.

## Integrated economy exploration

A separate fresh seed 14 run on economy commit `1d6189b` used only visible Research controls and candidate previews, without references, compiler, injected funds, or prepared layouts. Across 61 paid steps in approximately 836 seconds, it spent $188, retained $812, and discovered clean Disease 3 and Disease 4 formulas. Three empty assays were ended; no factory was built, so construction spending and rebuilds were both zero. The D1 contract remained 0/3. This attempt does **not** pass D1 → Skew → D2 acceptance.

The native checkpoint, 61-step action log, screenshots, and two browser trace segments are preserved in `/tmp/hexapharma-ui-d1-d2/`: `research-checkpoint-latest.json`, `actions.json`, `fresh-research-trace.zip`, and `continued-research-trace.zip`. The UI sector projection was inspected without reading hidden target coordinates or solution recipes after the broad eastward survey failed to find D1.

## Final capture matrix

The corrected frontend was captured at 1440×900, 1280×720, and 390×844. Each viewport covers fresh Research on seeds 14 and 15, empty Production, explored cures/side effects, formulas, Production with a formula reference, running Production, Market, Technology, Blueprints, import error, and confirmation. The capture completed with no page or console errors. Populated states use the earlier manually played D3 checkpoint, explicitly not a fresh D1 → D2 success.

All PNGs and capture traces are in `/tmp/hexapharma-ui-acceptance/`; filenames begin with viewport width. The pre-density captures remain separately preserved in `/tmp/hexapharma-ui-acceptance-before-density/`. The corrected Research canvas matches its display pixel density, and the original world-height and Abyss-contrast regression thresholds remain intact.

## PR review regressions

Codex identified hidden Factory hotkeys behind mobile Formulas and map edges clamped outside the cover-cropped Research frame. Three browser regressions reproduced both bugs on the original PR head. The fixes track the mobile breakpoint for world input and use the frame’s visible logical viewport for camera pan, zoom, and focus. The regression also checks that Production continues behind mobile Formulas and desktop input returns after resizing.

After ending the manual attempts, a separate developer audit confirmed that D1 is on the initial map and its cure cells agree with the displayed east sector for seeds 14 and 15. The audit did not inspect reference recipes or print hidden coordinates; it is not gameplay completion evidence.
