import { describe, expect, it } from "vitest";
import {
  defaultGenOptions,
  parseNewGameSeed,
  playerFacingIntentError,
  researchCandidateTrails,
  researchAssaySector,
  researchDisplayDrug,
  researchKeyboardAction,
  researchPlanningMap,
  researchPlanningTrails,
  researchProgramCost,
  researchTestBlockReason,
  researchTrailsForProgram,
  transientSaveMessage,
} from "./Game";
import { researchOutcomeText } from "./App";
import { CellKind, DEFAULT_CATALOG, type MultiMap } from "../sim/phase0_interfaces";
import { MAX_GAME_MAP_CELLS, MAX_GAME_MAP_DIMENSION } from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";

describe("default Lab world options", () => {
  it("gives Research one broad target sector without leaking a coordinate or distance", () => {
    expect(researchAssaySector({ x: 10, y: 10 }, { x: 24, y: 13 })).toBe("east");
    expect(researchAssaySector({ x: 10, y: 10 }, { x: 14, y: 21 })).toBe("south-east");
    expect(researchAssaySector({ x: 10, y: 10 }, { x: 3, y: 3 })).toBe("north-west");
    expect(researchAssaySector({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe("local");
  });

  it("starts a new run on one large odd-sized map", () => {
    expect(defaultGenOptions(14)).toMatchObject({
      seed: 14,
      nMaps: 1,
      width: 63,
      height: 63,
      diseaseCount: 4,
    });
    expect(defaultGenOptions(14).catalog).toEqual(DEFAULT_CATALOG);
  });

  it("authorizes the 63×63 world without opening the full public mapgen bound", () => {
    expect(MAX_GAME_MAP_DIMENSION).toBe(64);
    expect(MAX_GAME_MAP_CELLS).toBe(4_096);
    expect(63 * 63).toBeLessThanOrEqual(MAX_GAME_MAP_CELLS);
  });

  it("accepts only canonical unsigned 32-bit New Game seeds", () => {
    expect(parseNewGameSeed("0")).toBe(0);
    expect(parseNewGameSeed("4294967295")).toBe(0xffff_ffff);
    expect(parseNewGameSeed("")).toBeNull();
    expect(parseNewGameSeed("01")).toBeNull();
    expect(parseNewGameSeed("-1")).toBeNull();
    expect(parseNewGameSeed("4294967296")).toBeNull();
    expect(parseNewGameSeed("1.5")).toBeNull();
  });

  it("translates technical intent details into player-facing errors", () => {
    expect(playerFacingIntentError(new Error('game intent: machine "skew" is locked')))
      .toBe("Zigzag still is locked. Unlock it in Technology.");
    expect(playerFacingIntentError(new Error('game intent: machine "dilute" definition does not match catalog')))
      .toBe("Loop vat has incompatible layout data.");
    expect(playerFacingIntentError(new Error("game intent: machine 7 footprint overlaps another machine")))
      .toBe("Machine footprint overlaps another machine.");
    expect(playerFacingIntentError(new Error("game intent: product 19 is duplicated, unavailable, or not a cure")))
      .toBe("That product is no longer available to ship.");
    expect(playerFacingIntentError(new Error("game intent: Research stamp requires 42 cash")))
      .toBe("Need $42 to test that cartridge.");
    expect(playerFacingIntentError(new Error("game intent: Production construction requires 42 cash")))
      .toBe("Need $42 to build in Production.");
    expect(playerFacingIntentError(new Error("another failure"))).toBe("another failure");
  });

  it("blocks a cartridge before opening an assay that cannot advance", () => {
    const machine = DEFAULT_CATALOG[0]!;
    expect(researchTestBlockReason(machine.cost - 1, 0, true, machine))
      .toBe(`Need $${machine.cost} to test that cartridge.`);
    expect(researchTestBlockReason(machine.cost, 256, true, machine)).toMatch(/end this assay/i);
    expect(researchTestBlockReason(machine.cost, 256, false, machine)).toBeNull();
    expect(researchTestBlockReason(machine.cost, 0, true, machine)).toBeNull();
  });

  it("never exposes cross-layer phase exchange", () => {
    expect(DEFAULT_CATALOG.map((entry) => entry.typeId)).not.toContain("swap01");
  });

  it("derives the completed Research trail from the fixed-path program", () => {
    const level = generate(defaultGenOptions(14));
    const trails = researchTrailsForProgram(level.mm, level.start, level.diseases[0]!.reference, 1);

    expect(trails).toHaveLength(1);
    expect(trails[0]!.length).toBeGreaterThan(1);
    expect(trails[0]![0]).toEqual(level.start.pos[0]);
  });

  it("keeps the dose marker at the committed endpoint while a candidate path is previewed", () => {
    const level = generate(defaultGenOptions(14));
    const candidate = level.diseases[0]!.reference.steps[0]!;
    const trails = researchTrailsForProgram(level.mm, level.start, { steps: [candidate] }, 1);
    const displayed = researchDisplayDrug(level.start, null, null);

    expect(trails[0]!.length).toBeGreaterThan(1);
    expect(displayed.pos[0]).toEqual(level.mm.maps[0]!.start);
  });

  it("keeps a portal out of planning until both endpoints are discovered", () => {
    const width = 7;
    const cells = width * width;
    const cell = new Uint8Array(cells);
    const portalTo = new Int32Array(cells).fill(-1);
    cell[3 * width + 4] = CellKind.Portal;
    portalTo[3 * width + 4] = 1 * width + 1;
    const mm: MultiMap = { maps: [{
      width,
      height: width,
      origin: { x: 3, y: 3 },
      start: { x: 3, y: 3 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo,
      fog: new Uint8Array(cells),
    }] };
    const start = { pos: [{ x: 3, y: 3 }], failed: false };
    const program = { steps: [{
      typeId: DEFAULT_CATALOG[0]!.typeId,
      path: DEFAULT_CATALOG[0]!.path,
    }] };

    expect(researchPlanningTrails(mm, [new Uint8Array(cells)], start, program)[0]).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 4 },
    ]);
    const entryDiscovered = new Uint8Array(cells);
    entryDiscovered[3 * width + 4] = 1;
    expect(researchPlanningTrails(mm, [entryDiscovered], start, program)[0]).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 5, y: 4 },
    ]);
    const known = Uint8Array.from(entryDiscovered);
    known[1 * width + 1] = 1;
    expect(researchPlanningTrails(mm, [known], start, program)[0]).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, null,
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    ]);
    expect(researchTrailsForProgram(mm, start, program, 1)[0]).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, null,
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    ]);
  });

  it("uses walls in planning before they are discovered", () => {
    const width = 7;
    const cells = width * width;
    const cell = new Uint8Array(cells);
    const portalTo = new Int32Array(cells).fill(-1);
    cell[3 * width + 4] = CellKind.Wall;
    const mm: MultiMap = { maps: [{
      width,
      height: width,
      origin: { x: 3, y: 3 },
      start: { x: 3, y: 3 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo,
      fog: new Uint8Array(cells),
    }] };
    const start = { pos: [{ x: 3, y: 3 }], failed: false };
    const program = { steps: [{
      typeId: "known-wall",
      path: [{ x: 1 as const, y: 0 as const }, { x: 0 as const, y: 1 as const }],
    }] };
    const fog = new Uint8Array(cells);
    fog[3 * width + 4] = 1;

    expect(researchPlanningTrails(mm, [fog], start, program)[0]).toEqual([
      { x: 3, y: 3 }, { x: 3, y: 4 },
    ]);
  });

  it("keeps only walls in the planning map before discovery", () => {
    const width = 4;
    const cells = width * width;
    const cell = new Uint8Array(cells);
    cell[0] = CellKind.Wall;
    cell[1] = CellKind.Abyss;
    cell[2] = CellKind.Swamp;
    cell[3] = CellKind.Portal;
    cell[4] = CellKind.Cure;
    cell[5] = CellKind.SideEffect;
    const cureId = new Int16Array(cells).fill(-1);
    cureId[4] = 4;
    const sideEffectId = new Int32Array(cells).fill(-1);
    sideEffectId[5] = 7;
    const portalTo = new Int32Array(cells).fill(-1);
    portalTo[3] = 7;
    const mm: MultiMap = { maps: [{
      width,
      height: width,
      origin: { x: 1, y: 1 },
      start: { x: 1, y: 1 },
      cell,
      cureId,
      sideEffectId,
      portalTo,
      fog: new Uint8Array(cells),
    }] };

    const planning = researchPlanningMap(mm, [new Uint8Array(cells)]).maps[0]!;
    expect(planning.cell[0]).toBe(CellKind.Wall);
    expect(planning.cell[1]).toBe(CellKind.Empty);
    expect(planning.cell[2]).toBe(CellKind.Empty);
    expect(planning.cell[3]).toBe(CellKind.Empty);
    expect(planning.cell[4]).toBe(CellKind.Empty);
    expect(planning.cell[5]).toBe(CellKind.Empty);
    expect(planning.portalTo[3]).toBe(-1);
    expect(planning.cureId[4]).toBe(-1);
    expect(planning.sideEffectId[5]).toBe(-1);
  });

  it("draws only the held candidate as the preview suffix", () => {
    expect(researchCandidateTrails(
      [[{ x: 3, y: 3 }, { x: 4, y: 3 }]],
      [[{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }]],
    )).toEqual([[{ x: 4, y: 3 }, { x: 4, y: 4 }]]);
  });

  it("maps Enter to the next cartridge and Backspace to ending the active assay", () => {
    expect(researchKeyboardAction("Enter")).toBe("apply");
    expect(researchKeyboardAction("Backspace")).toBe("abort");
    expect(researchKeyboardAction("x")).toBeNull();
  });

  it("quotes each complete stamp and the full shot before dispensing", () => {
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const shear = DEFAULT_CATALOG.find((entry) => entry.typeId === "shear")!;

    expect(researchProgramCost({ steps: [] })).toBe(0);
    expect(researchProgramCost({ steps: [push, shear, push] })).toBe(
      push.cost + shear.cost + push.cost,
    );
  });

  it("reports side effects only as part of a resolved shot outcome", () => {
    expect(researchOutcomeText(null)).toBeNull();
    expect(researchOutcomeText({
      failed: false,
      final: [{ x: 7, y: 4 }],
      cured: [0],
      sideEffects: [101, 102],
    })).toBe("Cure Disease 1 · 2 side effects");
    expect(researchOutcomeText({
      failed: false,
      final: [{ x: 7, y: 4 }],
      cured: [],
      sideEffects: [],
    })).toBe("No cure · No side effects");
  });

  it("auto-dismisses successful save notices but keeps recovery errors visible", () => {
    expect(transientSaveMessage("Saved slot 1.")).toBe(true);
    expect(transientSaveMessage("Loaded slot 1.")).toBe(true);
    expect(transientSaveMessage("Started seed 15.")).toBe(true);
    expect(transientSaveMessage("Could not load slot 1: invalid save")).toBe(false);
    expect(transientSaveMessage("Save v5 is unsupported")).toBe(false);
  });

  it("does not draw a teleport gap when every attempted delta is cancelled by walls", () => {
    const width = 5;
    const cells = width * width;
    const cell = new Uint8Array(cells);
    cell[2 * width + 3] = CellKind.Wall;
    const mm: MultiMap = { maps: [{
      width,
      height: width,
      origin: { x: 2, y: 2 },
      start: { x: 2, y: 2 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo: new Int32Array(cells).fill(-1),
      fog: new Uint8Array(cells),
    }] };
    const start = { pos: [{ x: 2, y: 2 }], failed: false };
    const program = { steps: [{
      typeId: DEFAULT_CATALOG[0]!.typeId,
      path: [{ x: 1 as const, y: 0 as const }],
    }] };

    expect(researchTrailsForProgram(mm, start, program, 1)[0]).toEqual([{ x: 2, y: 2 }]);
  });
});
