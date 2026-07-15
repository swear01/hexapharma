import { describe, expect, it } from "vitest";
import {
  defaultGenOptions,
  researchCandidateTrails,
  researchDisplayDrug,
  researchKeyboardAction,
  researchPlanningMap,
  researchPlanningTrails,
  researchTrailsForProgram,
  transientSaveMessage,
} from "./Game";
import { CellKind, DEFAULT_CATALOG, type MultiMap } from "../sim/phase0_interfaces";
import { MAX_GAME_MAP_CELLS, MAX_GAME_MAP_DIMENSION } from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";

describe("default Lab world options", () => {
  it("starts a new run on one large odd-sized map", () => {
    expect(defaultGenOptions(14)).toMatchObject({
      seed: 14,
      nMaps: 1,
      width: 63,
      height: 63,
      diseaseCount: 1,
    });
  });

  it("authorizes the 63×63 world without opening the full public mapgen bound", () => {
    expect(MAX_GAME_MAP_DIMENSION).toBe(64);
    expect(MAX_GAME_MAP_CELLS).toBe(4_096);
    expect(63 * 63).toBeLessThanOrEqual(MAX_GAME_MAP_CELLS);
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

  it("keeps portals active before discovery and breaks an actually traversed portal jump", () => {
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

    const hidden = new Uint8Array(cells);
    hidden[3 * width + 4] = 1;
    expect(researchPlanningTrails(mm, [hidden], start, program)[0]).toEqual([
      { x: 3, y: 3 }, { x: 4, y: 3 }, null,
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 },
    ]);
    const known = Uint8Array.from(hidden);
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

  it("uses structural terrain in planning before it is discovered", () => {
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

  it("hides undiscovered effects without hiding structural terrain", () => {
    const width = 3;
    const cells = width * width;
    const cell = new Uint8Array(cells);
    cell[0] = CellKind.Wall;
    cell[1] = CellKind.Cure;
    cell[2] = CellKind.SideEffect;
    const cureId = new Int16Array(cells).fill(-1);
    cureId[1] = 4;
    const sideEffectId = new Int32Array(cells).fill(-1);
    sideEffectId[2] = 7;
    const mm: MultiMap = { maps: [{
      width,
      height: width,
      origin: { x: 1, y: 1 },
      start: { x: 1, y: 1 },
      cell,
      cureId,
      sideEffectId,
      portalTo: new Int32Array(cells).fill(-1),
      fog: new Uint8Array(cells),
    }] };

    const planning = researchPlanningMap(mm, [new Uint8Array(cells)]).maps[0]!;
    expect(planning.cell[0]).toBe(CellKind.Wall);
    expect(planning.cell[1]).toBe(CellKind.Empty);
    expect(planning.cell[2]).toBe(CellKind.Empty);
    expect(planning.cureId[1]).toBe(-1);
    expect(planning.sideEffectId[2]).toBe(-1);
  });

  it("draws only the held candidate as the preview suffix", () => {
    expect(researchCandidateTrails(
      [[{ x: 3, y: 3 }, { x: 4, y: 3 }]],
      [[{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }]],
    )).toEqual([[{ x: 4, y: 3 }, { x: 4, y: 4 }]]);
  });

  it("maps Enter to Dispense instead of committing another stamp", () => {
    expect(researchKeyboardAction("Enter")).toBe("dispense");
    expect(researchKeyboardAction("Backspace")).toBe("erase");
    expect(researchKeyboardAction("x")).toBeNull();
  });

  it("auto-dismisses successful save notices but keeps recovery errors visible", () => {
    expect(transientSaveMessage("Saved slot 1.")).toBe(true);
    expect(transientSaveMessage("Loaded slot 1.")).toBe(true);
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
