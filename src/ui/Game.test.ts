import { describe, expect, it } from "vitest";
import {
  defaultGenOptions,
  researchBaseLevel,
  parseNewGameSeed,
  playerFacingIntentError,
  researchAssaySector,
  researchDeviation,
  researchKeyboardAction,
  researchPlanningMap,
  researchPlanningPreview,
  researchPlanningTrails,
  researchProgramCost,
  researchRoute,
  researchRunBlockReason,
  researchTrailsForProgram,
  transientSaveMessage,
} from "./Game";
import { researchOutcomeText } from "./App";
import { researchHeadingPath } from "./ResearchWorkspace";
import { createGameState } from "../sim/game";
import type { DrugState } from "../sim/phase0_interfaces";

const startAt = (q: number, r: number): DrugState => ({
  pos: [{ q, r }],
  offset: [{ q: 0, r: 0 }],
  heading: 0,
  failed: false,
});
import { CellKind, DEFAULT_CATALOG, type MultiMap } from "../sim/phase0_interfaces";
import { MAX_GAME_MAP_CELLS, MAX_GAME_MAP_DIMENSION } from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";

describe("default Lab world options", () => {
  it("gives Research one broad target sector without leaking a coordinate or distance", () => {
    const start = { q: 10, r: 10 };
    expect(researchAssaySector(start, { q: 17, r: 10 })).toBe("east");
    expect(researchAssaySector(start, { q: 10, r: 17 })).toBe("south-east");
    expect(researchAssaySector(start, { q: 3, r: 17 })).toBe("south-west");
    expect(researchAssaySector(start, { q: 3, r: 10 })).toBe("west");
    expect(researchAssaySector(start, { q: 10, r: 3 })).toBe("north-west");
    expect(researchAssaySector(start, { q: 17, r: 3 })).toBe("north-east");
    expect(researchAssaySector(start, start)).toBe("local");
  });

  it("starts a new run on one large odd-sized map", () => {
    expect(defaultGenOptions(14)).toMatchObject({
      seed: 14,
      nMaps: 3,
      width: 49,
      height: 49,
      diseaseCount: 6,
    });
    expect(defaultGenOptions(14).catalog).toEqual(DEFAULT_CATALOG);
  });

  it("authorizes the 49×49 world without opening the full public mapgen bound", () => {
    expect(MAX_GAME_MAP_DIMENSION).toBe(64);
    expect(MAX_GAME_MAP_CELLS).toBe(4_096);
    expect(49 * 49).toBeLessThanOrEqual(MAX_GAME_MAP_CELLS);
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
    expect(playerFacingIntentError(new Error('game intent: machine "zigzag" is locked')))
      .toBe("Zigzag still is off. Turn it on in Technology.");
    expect(playerFacingIntentError(new Error('game intent: machine "loop" definition does not match catalog')))
      .toBe("Loop vat has incompatible layout data.");
    expect(playerFacingIntentError(new Error("game intent: machine 7 footprint overlaps another machine")))
      .toBe("Machine footprint overlaps another machine.");
    expect(playerFacingIntentError(new Error("game intent: product 19 is duplicated, unavailable, or not a cure")))
      .toBe("That product is no longer available to ship.");
    expect(playerFacingIntentError(new Error("game intent: Research trial requires 42 cash")))
      .toBe("Need $42 to run this route.");
    expect(playerFacingIntentError(new Error("game intent: Production construction requires 42 cash")))
      .toBe("Need $42 to build in Production.");
    expect(playerFacingIntentError(new Error("another failure"))).toBe("another failure");
  });

  it("blocks Run for an empty plan or one the cash cannot pay for", () => {
    const machine = DEFAULT_CATALOG[0]!;
    const plan = { steps: [machine, machine] };
    expect(researchRunBlockReason(1_000, { steps: [] })).toMatch(/add a machine/i);
    expect(researchRunBlockReason(machine.cost * 2 - 1, plan)).toBe(`Need $${machine.cost * 2} to run this route.`);
    expect(researchRunBlockReason(machine.cost * 2, plan)).toBeNull();
  });

  it("never exposes cross-layer phase exchange", () => {
    expect(DEFAULT_CATALOG.map((entry) => entry.typeId)).not.toContain("swap01");
  });

  it("derives the completed Research trail from the fixed-path program", () => {
    const level = researchBaseLevel(generate(defaultGenOptions(14)), 0);
    const trails = researchTrailsForProgram(level.mm, level.start, level.diseases[0]!.reference, 1);

    expect(trails).toHaveLength(1);
    expect(trails[0]!.length).toBeGreaterThan(1);
    expect(trails[0]![0]).toEqual(level.start.pos[0]);
  });

  it("previews the planned route on the known map only, so fog secrecy holds", () => {
    const options = defaultGenOptions(14);
    const level = generate(options);
    const game = createGameState(options, 1_000);
    const plan = level.diseases[0]!.reference;
    const planned = researchPlanningPreview(level.mm, game.fog, level.start, plan);
    const onKnownMap = researchRoute(researchPlanningMap(level.mm, game.fog), level.start, plan);

    expect(planned).toEqual(onKnownMap);
    expect(planned.controls).toHaveLength(plan.steps.length);
    expect(planned.drug.failed).toBe(false);
  });

  it("draws swamp half steps as half-cell points and rotates hotbar glyphs to the heading", () => {
    const width = 7;
    const cells = width * width;
    const cell = new Uint8Array(cells);
    cell[3 * width + 4] = CellKind.Swamp;
    const mm: MultiMap = { maps: [{
      width,
      height: width,
      origin: { q: 3, r: 3 },
      start: { q: 3, r: 3 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      cureTier: new Uint8Array(cells),
      regionId: new Uint16Array(cells),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo: new Int32Array(cells).fill(-1),
      elevation: new Int16Array(cells),
      fog: new Uint8Array(cells),
    }] };
    const program = { steps: [{ typeId: "two-east", path: [0, 0] as const, turn: 2 }] };
    const route = researchRoute(mm, startAt(3, 3), program);

    expect(route.trails[0]).toEqual([{ q: 3, r: 3 }, { q: 4, r: 3 }, { q: 4.5, r: 3 }]);
    expect(route.controls).toEqual([{ q: 4.5, r: 3 }]);
    expect(route.drug.heading).toBe(2);
    expect(researchHeadingPath([0, 1, 5], 2)).toEqual([2, 3, 1]);
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
      origin: { q: 3, r: 3 },
      start: { q: 3, r: 3 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      cureTier: new Uint8Array(cells),
      regionId: new Uint16Array(cells),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo,
      elevation: new Int16Array(cells),
      fog: new Uint8Array(cells),
    }] };
    const start = startAt(3, 3);
    const program = { steps: [{
      typeId: DEFAULT_CATALOG[0]!.typeId,
      path: DEFAULT_CATALOG[0]!.path,
      turn: DEFAULT_CATALOG[0]!.turn,
    }] };

    expect(researchPlanningTrails(mm, [new Uint8Array(cells)], start, program)[0]).toEqual([
      { q: 3, r: 3 }, { q: 4, r: 3 }, { q: 5, r: 3 }, { q: 5, r: 4 },
    ]);
    const entryDiscovered = new Uint8Array(cells);
    entryDiscovered[3 * width + 4] = 1;
    expect(researchPlanningTrails(mm, [entryDiscovered], start, program)[0]).toEqual([
      { q: 3, r: 3 }, { q: 4, r: 3 }, { q: 5, r: 3 }, { q: 5, r: 4 },
    ]);
    const known = Uint8Array.from(entryDiscovered);
    known[1 * width + 1] = 1;
    expect(researchPlanningTrails(mm, [known], start, program)[0]).toEqual([
      { q: 3, r: 3 }, { q: 4, r: 3 }, null,
      { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 2 },
    ]);
    expect(researchTrailsForProgram(mm, start, program, 1)[0]).toEqual([
      { q: 3, r: 3 }, { q: 4, r: 3 }, null,
      { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 2, r: 2 },
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
      origin: { q: 3, r: 3 },
      start: { q: 3, r: 3 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      cureTier: new Uint8Array(cells),
      regionId: new Uint16Array(cells),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo,
      elevation: new Int16Array(cells),
      fog: new Uint8Array(cells),
    }] };
    const start = startAt(3, 3);
    const program = { steps: [{
      typeId: "known-wall",
      path: [0, 1] as const,
      turn: 0,
    }] };
    const fog = new Uint8Array(cells);
    fog[3 * width + 4] = 1;

    expect(researchPlanningTrails(mm, [fog], start, program)[0]).toEqual([
      { q: 3, r: 3 }, { q: 3, r: 4 },
    ]);
  });

  it("plans unrevealed ground, mountains included, as open floor", () => {
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
      origin: { q: 1, r: 1 },
      start: { q: 1, r: 1 },
      cell,
      cureId,
      cureTier: Uint8Array.from(cell, (kind) => (kind === CellKind.Cure ? 1 : 0)),
      regionId: Uint16Array.from(cell, (kind) => (kind === CellKind.Cure ? 1 : 0)),
      sideEffectId,
      portalTo,
      elevation: new Int16Array(cells),
      fog: new Uint8Array(cells),
    }] };

    const planning = researchPlanningMap(mm, [new Uint8Array(cells)]).maps[0]!;
    expect(planning.cell[0]).toBe(CellKind.Empty);
    expect(planning.cell[1]).toBe(CellKind.Empty);
    expect(planning.cell[2]).toBe(CellKind.Empty);
    expect(planning.cell[3]).toBe(CellKind.Empty);
    expect(planning.cell[4]).toBe(CellKind.Empty);
    expect(planning.cell[5]).toBe(CellKind.Empty);
    expect(planning.portalTo[3]).toBe(-1);
    expect(planning.cureId[4]).toBe(-1);
    expect(planning.sideEffectId[5]).toBe(-1);
  });

  it("maps Enter to Run and Backspace or Ctrl+Z to removing the last planned step", () => {
    expect(researchKeyboardAction("Enter")).toBe("run");
    expect(researchKeyboardAction("Backspace")).toBe("undo");
    expect(researchKeyboardAction("z", true)).toBe("undo");
    expect(researchKeyboardAction("Z", true)).toBe("undo");
    expect(researchKeyboardAction("z")).toBeNull();
    expect(researchKeyboardAction("Enter", true)).toBeNull();
    expect(researchKeyboardAction("x")).toBeNull();
  });

  it("quotes each complete stamp and the full shot before dispensing", () => {
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "hook")!;
    const shear = DEFAULT_CATALOG.find((entry) => entry.typeId === "elbow")!;

    expect(researchProgramCost({ steps: [] })).toBe(0);
    expect(researchProgramCost({ steps: [push, shear, push] })).toBe(
      push.cost + shear.cost + push.cost,
    );
  });

  it("reports side effects only as part of a resolved shot outcome", () => {
    expect(researchOutcomeText(null)).toBeNull();
    expect(researchOutcomeText({
      failed: false,
      final: [{ q: 7, r: 4 }],
      cured: [0],
      premium: [],
      regions: [1],
      sideEffects: [101, 102],
    })).toBe("Cure Disease 1 · 2 side effects");
    expect(researchOutcomeText({
      failed: false,
      final: [{ q: 7, r: 4 }],
      cured: [],
      premium: [],
      regions: [],
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
      origin: { q: 2, r: 2 },
      start: { q: 2, r: 2 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      cureTier: new Uint8Array(cells),
      regionId: new Uint16Array(cells),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo: new Int32Array(cells).fill(-1),
      elevation: new Int16Array(cells),
      fog: new Uint8Array(cells),
    }] };
    const start = startAt(2, 2);
    const program = { steps: [{
      typeId: DEFAULT_CATALOG[0]!.typeId,
      path: [0] as const,
      turn: 0,
    }] };

    expect(researchTrailsForProgram(mm, start, program, 1)[0]).toEqual([{ q: 2, r: 2 }]);
  });
});

describe("researchDeviation", () => {
  const width = 7;
  const cells = width * width;
  const atlas = (kind: CellKind): MultiMap => {
    const cell = new Uint8Array(cells);
    cell[3 * width + 5] = kind;
    if (kind === CellKind.Swamp) cell[3 * width + 4] = kind;
    return { maps: [{
      width,
      height: width,
      origin: { q: 3, r: 3 },
      start: { q: 3, r: 3 },
      cell,
      cureId: new Int16Array(cells).fill(-1),
      cureTier: new Uint8Array(cells),
      regionId: new Uint16Array(cells),
      sideEffectId: new Int32Array(cells).fill(-1),
      portalTo: new Int32Array(cells).fill(-1),
      elevation: new Int16Array(cells),
      fog: new Uint8Array(cells),
    }] };
  };
  const program = { steps: [{ typeId: "east", path: [0, 0, 0] as const, turn: 0 }] };
  const deviation = (kind: CellKind, fog = new Uint8Array(cells)) => {
    const mm = atlas(kind);
    return researchDeviation(mm, researchPlanningMap(mm, [fog]), startAt(3, 3), program);
  };

  it("marks the hidden terrain where the Run first left its estimate", () => {
    expect(deviation(CellKind.Wall)).toEqual({ pos: { q: 5, r: 3 }, reason: "Wall" });
    expect(deviation(CellKind.Abyss)).toEqual({ pos: { q: 5, r: 3 }, reason: "Abyss" });
    expect(deviation(CellKind.Swamp)).toEqual({ pos: { q: 4, r: 3 }, reason: "Swamp" });
  });

  it("reports nothing when known terrain already shaped the estimate", () => {
    const fog = new Uint8Array(cells);
    fog[3 * width + 5] = 1;
    expect(deviation(CellKind.Wall, fog)).toBeNull();
    expect(deviation(CellKind.Empty)).toBeNull();
  });
});
