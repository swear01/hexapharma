import { describe, expect, it } from "vitest";
import type { FactoryLayout, GameIntent, GenOptions, Machine, MultiMap, Template } from "./phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  CellKind,
  DEFAULT_CATALOG,
} from "./phase0_interfaces";
import { applyGameIntent, createGameState } from "./game";
import { evaluate, previewStep } from "./drug-graph";
import { HEX_DIRS, HEX_DQ, HEX_DR } from "./hex";
import { generate } from "./mapgen";
import { compileEntitledPrototype } from "./recipe";

const options: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 32,
  height: 32,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

function reference(): { readonly program: Template; readonly layout: FactoryLayout } {
  const program = generate(options).diseases[0]!.reference;
  return {
    program,
    layout: compileEntitledPrototype(
      program,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout,
  };
}

function dispatch(game: ReturnType<typeof createGameState>, intent: object) {
  return applyGameIntent(game, intent as GameIntent);
}

function fogSnapshot(game: ReturnType<typeof createGameState>): readonly number[][] {
  return game.fog.map((layer) => [...layer]);
}

function trialCost(program: Template): number {
  return program.steps.reduce((total, machine) => (
    total + DEFAULT_CATALOG.find((entry) => entry.typeId === machine.typeId)!.cost
  ), 0);
}

/** Fog-masked planning map: unknown cells read as Empty (walls stay as outlines). */
function researchPlanningOnFog(mm: MultiMap, fog: readonly Uint8Array[]): MultiMap {
  return {
    maps: mm.maps.map((map, mapIndex) => {
      const known = fog[mapIndex]!;
      const cell = Uint8Array.from(map.cell);
      const cureId = Int16Array.from(map.cureId);
      const cureTier = Uint8Array.from(map.cureTier);
      const regionId = Uint16Array.from(map.regionId);
      const sideEffectId = Int32Array.from(map.sideEffectId);
      const portalTo = Int32Array.from(map.portalTo);
      for (let index = 0; index < cell.length; index++) {
        if (known[index] === 1 && cell[index] !== CellKind.Portal) continue;
        if (cell[index] === CellKind.Wall) continue;
        cell[index] = CellKind.Empty;
        cureId[index] = -1;
        cureTier[index] = 0;
        regionId[index] = 0;
        sideEffectId[index] = -1;
        portalTo[index] = -1;
      }
      return { ...map, cell, cureId, cureTier, regionId, sideEffectId, portalTo };
    }),
  };
}

function emptyPilotLayout(): FactoryLayout {
  const tiles: FactoryLayout["tiles"][number][] = Array.from(
    { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
    () => ({ kind: "empty" }),
  );
  tiles[0] = { kind: "source", dir: 0, period: 1, base: 0 };
  tiles[1] = { kind: "sink" };
  return {
    width: BASE_GAME_FACTORY_WIDTH,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles,
    machines: [],
  };
}

describe("Run-based Research trials", () => {
  it("runs the whole program from the start, charges Σ catalog cost once, and keeps the trial", () => {
    const { program } = reference();
    const level = generate(options);
    const initial = createGameState(options, 500);
    const game = dispatch(initial, { kind: "runResearchTrial", program, base: 0 });

    expect(game.economy.cash).toBe(500 - trialCost(program));
    expect(game.research.lastTrial).toEqual({
      base: 0,
      program,
      cost: trialCost(program),
      outcome: evaluate(level.mm, level.start, program),
    });
    expect(game.research.lastTrial?.outcome.cured).toEqual([0]);
    expect(Object.keys(game.research)).toEqual(["lastTrial"]);
    expect(game.research.lastTrial?.program).not.toBe(program);
    expect(Object.isFrozen(game.research.lastTrial)).toBe(true);
    expect(Object.isFrozen(game.research.lastTrial?.program.steps)).toBe(true);
    expect(Object.isFrozen(game.research.lastTrial?.outcome.cured)).toBe(true);
  });

  it("never creates formulas; a later trial simply replaces the last one", () => {
    const { program } = reference();
    let game = dispatch(createGameState(options, 500), { kind: "runResearchTrial", program, base: 0 });
    const machine = DEFAULT_CATALOG[0]!;
    game = dispatch(game, { kind: "runResearchTrial", program: { steps: [machine] }, base: 0 });

    expect(game.research.lastTrial?.program.steps).toEqual([
      { typeId: machine.typeId, path: machine.path, turn: machine.turn },
    ]);
    expect(game.economy.cash).toBe(500 - trialCost(program) - machine.cost);
    expect("discoveredFormulas" in game.research).toBe(false);
  });

  it("rejects unaffordable, empty, forged, locked, and removed intents atomically", () => {
    const { program } = reference();
    const poor = createGameState(options, trialCost(program) - 1);
    const before = fogSnapshot(poor);
    const machine = DEFAULT_CATALOG[0]!;
    const partial: Machine = { ...machine, path: machine.path.slice(0, -1) };
    const turned: Machine = { ...machine, turn: machine.turn + 1 };
    const locked = DEFAULT_CATALOG.find((entry) => entry.typeId === "crane")!;

    expect(() => dispatch(poor, { kind: "runResearchTrial", program, base: 0 })).toThrow(/requires.*cash/i);
    expect(() => dispatch(poor, { kind: "runResearchTrial", program: { steps: [] }, base: 0 })).toThrow(/1\.\.256/);
    expect(() => dispatch(poor, { kind: "runResearchTrial", program: { steps: [partial] }, base: 0 }))
      .toThrow(/path does not match/i);
    expect(() => dispatch(poor, { kind: "runResearchTrial", program: { steps: [turned] }, base: 0 }))
      .toThrow(/path does not match/i);
    expect(() => dispatch(poor, { kind: "runResearchTrial", program: { steps: [locked] }, base: 0 }))
      .toThrow(/locked/i);
    for (const kind of ["beginResearchShot", "advanceResearchShot", "abortResearchShot"]) {
      expect(() => dispatch(poor, { kind, machine })).toThrow(/unknown|removed/i);
    }
    expect(poor.economy.cash).toBe(trialCost(program) - 1);
    expect(poor.research.lastTrial).toBeNull();
    expect(fogSnapshot(poor)).toEqual(before);
  });

  it("starts in a centered radius-two hex disk and a trial reveals new ground", () => {
    const entry = DEFAULT_CATALOG[0]!;
    let game = createGameState(options, 500);
    const before = game.fog[0]!.reduce((sum, value) => sum + value, 0);
    expect(before).toBe(19);

    game = dispatch(game, { kind: "runResearchTrial", program: { steps: [entry] }, base: 0 });

    expect(game.fog[0]!.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(before);
    expect(game.research.lastTrial?.outcome.cured).toEqual([]);
  });

  it("reveals radius one around exactly the actual trail of every step", () => {
    const { program } = reference();
    const level = generate(options);
    const initial = createGameState(options, 500);
    const expected = initial.fog.map((layer) => Uint8Array.from(layer));
    let drug = level.start;
    for (const machine of program.steps) {
      const preview = previewStep(level.mm, drug, machine);
      for (let mapIndex = 0; mapIndex < expected.length; mapIndex++) {
        const map = level.mm.maps[mapIndex]!;
        const points = [...(preview.trails[mapIndex] ?? []), preview.next.pos[mapIndex]!];
        for (const point of points) {
          expected[mapIndex]![point.r * map.width + point.q] = 1;
          for (const direction of HEX_DIRS) {
            const q = point.q + (HEX_DQ[direction] ?? 0);
            const r = point.r + (HEX_DR[direction] ?? 0);
            if (q >= 0 && r >= 0 && q < map.width && r < map.height) {
              expected[mapIndex]![r * map.width + q] = 1;
            }
          }
        }
      }
      drug = preview.next;
    }

    const game = dispatch(initial, { kind: "runResearchTrial", program, base: 0 });
    expect(fogSnapshot(game)).toEqual(expected.map((layer) => [...layer]));
    expect(game.production.runtime.tick).toBe(0);
  });

  it("runs on the true map, so hidden terrain can make the actual trail differ from a fog plan", () => {
    const level = generate(options);
    const game = createGameState(options, 5_000);
    const mm = level.mm;
    const plan = researchPlanningOnFog(mm, game.fog);
    const machines = DEFAULT_CATALOG.slice(0, 4);
    let differs = 0;
    for (let code = 0; code < 4 ** 5 && differs === 0; code++) {
      const program = { steps: [0, 1, 2, 3, 4].map((digit) => machines[Math.floor(code / 4 ** digit) % 4]!) };
      const actual = dispatch(game, { kind: "runResearchTrial", program, base: 0 }).research.lastTrial!.outcome;
      expect(actual).toEqual(evaluate(mm, level.start, program));
      if (JSON.stringify(actual) !== JSON.stringify(evaluate(plan, level.start, program))) differs++;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it("owns the executed program instead of aliasing the caller", () => {
    const catalog = structuredClone(DEFAULT_CATALOG[0]!);
    const mutable: Machine = {
      typeId: catalog.typeId,
      path: catalog.path,
      turn: catalog.turn,
    };
    const game = dispatch(createGameState(options, 500), {
      kind: "runResearchTrial",
      program: { steps: [mutable] },
      base: 0,
    });
    (catalog.path as number[])[0] = 3;
    expect(game.research.lastTrial?.program.steps[0]?.path[0]).toBe(0);
  });

  it("contains no phase-exchange machine or cross-layer calibration", () => {
    expect(DEFAULT_CATALOG.some((entry) => entry.typeId === "swap01")).toBe(false);
    for (const entry of DEFAULT_CATALOG) {
      expect(entry.path.every((direction) => direction >= 0 && direction <= 5)).toBe(true);
    }
  });

  it("applies exploration-aid patents only to an actually dispensed trail", () => {
    const machine = DEFAULT_CATALOG[0]!;
    const initial = createGameState(options, 500);
    const before = fogSnapshot(initial);
    const aided = dispatch(initial, { kind: "setPatent", id: "reveal-aid", enabled: true });
    expect(fogSnapshot(aided)).toEqual(before);

    const run = (game: ReturnType<typeof createGameState>) =>
      dispatch(game, { kind: "runResearchTrial", program: { steps: [machine] }, base: 0 });
    const revealed = (game: ReturnType<typeof createGameState>) => game.fog[0]!
      .reduce((sum, value) => sum + value, 0);
    expect(revealed(run(aided))).toBeGreaterThan(revealed(run(initial)));
  });
});

describe("optional Pilot and direct Production construction", () => {
  it("builds an independent no-cure Pilot layout exactly into Production for its cost", () => {
    const layout = emptyPilotLayout();
    let game = createGameState(options, 500);

    game = dispatch(game, { kind: "setPilotLayout", layout });
    game = dispatch(game, { kind: "buildProductionLayout", layout });

    expect(game.production.layout).toEqual(layout);
    expect(game.production.runtime.tick).toBe(0);
    expect(game.economy.cash).toBe(482);
    expect("contract" in game.pilot).toBe(false);
    expect("contract" in game.production).toBe(false);
  });

  it("does not require or infer a Research route before building a Pilot design", () => {
    const { layout } = reference();
    let game = createGameState(options, 10_000);
    expect(game.research.lastTrial).toBeNull();

    game = dispatch(game, { kind: "setPilotLayout", layout });
    game = dispatch(game, { kind: "buildProductionLayout", layout });
    expect(game.production.layout).toEqual(game.pilot.layout);
  });

  it("allows paid direct Production construction without creating a Pilot layout", () => {
    const layout = emptyPilotLayout();
    const initial = createGameState(options, 500);
    const built = dispatch(initial, { kind: "buildProductionLayout", layout });

    expect(initial.pilot.layout).toBeNull();
    expect(built.pilot.layout).toBeNull();
    expect(built.production.layout).toEqual(layout);
    expect(built.production.layout).not.toBe(layout);
    expect(built.economy.cash).toBe(482);
  });
});
