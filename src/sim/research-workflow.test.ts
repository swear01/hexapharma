import { describe, expect, it } from "vitest";
import type { FactoryLayout, GameIntent, GenOptions, Machine, Template } from "./phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
} from "./phase0_interfaces";
import { applyGameIntent, createGameState, currentDiscoveredFormula } from "./game";
import { previewStep } from "./drug-graph";
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

function shotCost(program: Template): number {
  return Math.max(1, program.steps.reduce((total, machine) => (
    total + DEFAULT_CATALOG.find((entry) => entry.typeId === machine.typeId)!.cost
  ), 0));
}

function emptyPilotLayout(): FactoryLayout {
  const tiles: FactoryLayout["tiles"][number][] = Array.from(
    { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
    () => ({ kind: "empty" }),
  );
  tiles[0] = { kind: "source", dir: 0, period: 1 };
  tiles[1] = { kind: "sink" };
  return {
    width: BASE_GAME_FACTORY_WIDTH,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles,
    machines: [],
  };
}

describe("ResearchProgram workflow", () => {
  it("starts and advances the first cartridge atomically in one intent", () => {
    const machine = DEFAULT_CATALOG[0]!;
    const initial = createGameState(options, 500, 0);
    const advanced = dispatch(initial, { kind: "advanceResearchShot", machine });

    expect(advanced.economy.cash).toBe(500 - machine.cost);
    expect(advanced.research.program.steps).toEqual([{ typeId: machine.typeId, path: machine.path }]);
    expect(advanced.research.lastOutcome).not.toBeNull();
  });

  it("starts free and executes exactly one owned full stamp with immediate feedback", () => {
    const machine = DEFAULT_CATALOG[0]!;
    const initial = createGameState(options, 500, 0);
    const started = dispatch(initial, { kind: "beginResearchShot" });

    expect(started.economy.cash).toBe(500);
    expect(started.research.program.steps).toEqual([]);
    expect(started.research.shot).toMatchObject({ step: 0, cost: 0 });

    const expected = previewStep(generate(options).mm, started.research.shot!.drug, machine);
    const advanced = dispatch(started, { kind: "advanceResearchShot", machine });

    expect(advanced.economy.cash).toBe(500 - machine.cost);
    expect(advanced.research.program.steps).toEqual([{ typeId: machine.typeId, path: machine.path }]);
    expect(advanced.research.shot).toMatchObject({
      step: 1,
      cost: machine.cost,
      drug: expected.next,
    });
    expect(advanced.research.lastOutcome).toEqual(expect.objectContaining({ cured: [] }));
  });

  it("builds a discovered formula from the whole reveal-decide session", () => {
    const { program } = reference();
    let game = dispatch(createGameState(options, 500, 0), { kind: "beginResearchShot" });
    let paid = 0;

    for (const machine of program.steps) {
      const entry = DEFAULT_CATALOG.find(({ typeId }) => typeId === machine.typeId)!;
      const before = game.economy.cash;
      game = dispatch(game, { kind: "advanceResearchShot", machine });
      paid += entry.cost;
      expect(game.economy.cash).toBe(before - entry.cost);
      if (game.research.lastOutcome?.cured.length === 0) {
        expect(game.research.shot).not.toBeNull();
      }
    }

    expect(game.research.shot).toBeNull();
    expect(currentDiscoveredFormula(game)).toEqual({
      disease: game.research.lastOutcome!.cured[0],
      program,
      researchCost: paid,
      outcome: game.research.lastOutcome,
    });
  });

  it("aborts without refund and rejects the removed batch-program path", () => {
    const machine = DEFAULT_CATALOG[0]!;
    let game = dispatch(createGameState(options, 500, 0), { kind: "beginResearchShot" });
    game = dispatch(game, { kind: "advanceResearchShot", machine });
    const cash = game.economy.cash;

    game = dispatch(game, { kind: "abortResearchShot" });
    expect(game.economy.cash).toBe(cash);
    expect(game.research).toMatchObject({
      program: { steps: [] },
      shot: null,
      lastOutcome: null,
    });
    expect(() => dispatch(game, { kind: "setResearchProgram", program: reference().program }))
      .toThrow(/unknown|removed|unsupported/i);
  });

  it("does not erase a terminal route and outcome when there is no active assay to abort", () => {
    let game = dispatch(createGameState(options, 500, 0), { kind: "beginResearchShot" });
    for (const machine of reference().program.steps) {
      game = dispatch(game, { kind: "advanceResearchShot", machine });
      if (game.research.shot === null) break;
    }
    expect(game.research.shot).toBeNull();
    expect(game.research.lastOutcome).not.toBeNull();

    expect(dispatch(game, { kind: "abortResearchShot" })).toBe(game);
  });

  it("rejects partial and unaffordable stamps atomically", () => {
    const machine = DEFAULT_CATALOG[0]!;
    const started = dispatch(createGameState(options, machine.cost - 1, 0), {
      kind: "beginResearchShot",
    });
    const partial: Machine = { ...machine, path: machine.path.slice(0, -1) };

    expect(() => dispatch(started, { kind: "advanceResearchShot", machine: partial }))
      .toThrow(/path does not match/i);
    expect(() => dispatch(started, { kind: "advanceResearchShot", machine }))
      .toThrow(/requires.*cash/i);
    expect(started.economy.cash).toBe(machine.cost - 1);
    expect(started.research.program.steps).toEqual([]);
  });

  it("starts in a centered radius-two hex disk and the first available stamp reveals new ground", () => {
    const entry = DEFAULT_CATALOG[0]!;
    let game = createGameState(options, 500, 0);
    const before = game.fog[0]!.reduce((sum, value) => sum + value, 0);
    expect(before).toBe(19);

    game = dispatch(game, { kind: "beginResearchShot" });
    game = dispatch(game, { kind: "advanceResearchShot", machine: entry });

    expect(game.fog[0]!.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(before);
    expect(game.research.lastOutcome?.cured).toEqual([]);
    expect(game.research.discoveredFormulas).toEqual([]);
  });

  it("reveals radius one around only the completed path trail", () => {
    const { program } = reference();
    let game = createGameState(options, 500, 0);
    game = dispatch(game, { kind: "beginResearchShot" });
    const before = game.fog.map((layer) => Uint8Array.from(layer));
    const level = generate(options);
    const preview = previewStep(level.mm, level.start, program.steps[0]!);
    const expected = before.map((layer) => Uint8Array.from(layer));

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

    game = dispatch(game, { kind: "advanceResearchShot", machine: program.steps[0]! });
    expect(fogSnapshot(game)).toEqual(expected.map((layer) => [...layer]));
    expect(game.production.runtime.tick).toBe(0);
  });

  it("keeps the latest successful Cure as an immutable discovered formula", () => {
    const { program } = reference();
    let game = createGameState(options, 500, 0);
    game = dispatch(game, { kind: "beginResearchShot" });
    for (const machine of program.steps) {
      game = dispatch(game, { kind: "advanceResearchShot", machine });
    }

    const formula = currentDiscoveredFormula(game);
    expect(game.research.discoveredFormulas).toHaveLength(1);
    expect(formula).toEqual({
      disease: game.research.lastOutcome!.cured[0],
      program,
      researchCost: shotCost(program),
      outcome: game.research.lastOutcome,
    });
    expect(formula?.program).not.toBe(program);
    expect(Object.isFrozen(formula)).toBe(true);
    expect(Object.isFrozen(formula?.program.steps)).toBe(true);
    expect(Object.isFrozen(formula?.outcome.cured)).toBe(true);

    game = dispatch(game, { kind: "beginResearchShot" });
    for (const machine of program.steps) {
      game = dispatch(game, { kind: "advanceResearchShot", machine });
    }
    expect(game.research.discoveredFormulas).toHaveLength(1);
  });

  it("owns an executed stamp instead of aliasing the caller", () => {
    const catalog = structuredClone(DEFAULT_CATALOG[0]!);
    const mutable: Machine = {
      typeId: catalog.typeId,
      path: catalog.path,
    };
    let game = dispatch(createGameState(options, 500, 0), { kind: "beginResearchShot" });
    game = dispatch(game, { kind: "advanceResearchShot", machine: mutable });
    (catalog.path as number[])[0] = 3;
    expect(game.research.program.steps[0]?.path[0]).toBe(0);
  });

  it("contains no phase-exchange machine or cross-layer calibration", () => {
    expect(DEFAULT_CATALOG.some((entry) => entry.typeId === "swap01")).toBe(false);
    for (const entry of DEFAULT_CATALOG) {
      expect(entry.path.every((direction) => direction >= 0 && direction <= 5)).toBe(true);
    }
  });

  it("applies exploration-aid patents only to an actually dispensed trail", () => {
    const machine = DEFAULT_CATALOG[0]!;
    const initial = createGameState(options, 500, 10);
    const before = fogSnapshot(initial);
    const aided = dispatch(initial, { kind: "unlockPatent", id: "reveal-aid" });
    expect(fogSnapshot(aided)).toEqual(before);

    const run = (game: ReturnType<typeof createGameState>) => {
      const next = dispatch(game, { kind: "beginResearchShot" });
      return dispatch(next, { kind: "advanceResearchShot", machine });
    };
    const revealed = (game: ReturnType<typeof createGameState>) => game.fog[0]!
      .reduce((sum, value) => sum + value, 0);
    expect(revealed(run(aided))).toBeGreaterThan(revealed(run(initial)));
  });
});

describe("optional Pilot and direct Production construction", () => {
  it("builds an independent no-cure Pilot layout exactly into Production for its cost", () => {
    const layout = emptyPilotLayout();
    let game = createGameState(options, 500, 0);

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
    let game = createGameState(options, 10_000, 0);
    expect(game.research.program.steps).toEqual([]);

    game = dispatch(game, { kind: "setPilotLayout", layout });
    game = dispatch(game, { kind: "buildProductionLayout", layout });
    expect(game.production.layout).toEqual(game.pilot.layout);
  });

  it("allows paid direct Production construction without creating a Pilot layout", () => {
    const layout = emptyPilotLayout();
    const initial = createGameState(options, 500, 0);
    const built = dispatch(initial, { kind: "buildProductionLayout", layout });

    expect(initial.pilot.layout).toBeNull();
    expect(built.pilot.layout).toBeNull();
    expect(built.production.layout).toEqual(layout);
    expect(built.production.layout).not.toBe(layout);
    expect(built.economy.cash).toBe(482);
  });
});
