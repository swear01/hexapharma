import { describe, expect, it } from "vitest";
import type { FactoryLayout, GameIntent, GenOptions, Machine, Template } from "./phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
} from "./phase0_interfaces";
import { applyGameIntent, createGameState } from "./game";
import { previewStep } from "./drug-graph";
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
  it("stores a program rather than a physical factory floor", () => {
    const { program } = reference();
    const initial = createGameState(options, 500, 0);
    const planned = dispatch(initial, { kind: "setResearchProgram", program });

    expect("layout" in planned.research).toBe(false);
    expect(planned.research.program).toEqual(program);
    expect(planned.economy.cash).toBe(500);
  });

  it("keeps planning free and charges exactly once on dispense", () => {
    const { program } = reference();
    const initial = createGameState(options, 500, 0);
    const beforeFog = fogSnapshot(initial);
    const planned = dispatch(initial, { kind: "setResearchProgram", program });

    expect(fogSnapshot(planned)).toEqual(beforeFog);
    expect(planned.economy.cash).toBe(500);

    const fired = dispatch(planned, { kind: "beginResearchShot" });
    expect(fired.economy.cash).toBe(500 - shotCost(program));
    expect(fogSnapshot(fired)).toEqual(beforeFog);
    expect(fired.research.shot).toMatchObject({ step: 0, cost: shotCost(program) });
    expect(() => dispatch(fired, { kind: "beginResearchShot" })).toThrow(/already|running/i);
  });

  it("reveals radius one around only the completed path trail", () => {
    const { program } = reference();
    let game = createGameState(options, 500, 0);
    game = dispatch(game, { kind: "setResearchProgram", program });
    game = dispatch(game, { kind: "beginResearchShot" });
    const before = game.fog.map((layer) => Uint8Array.from(layer));
    const level = generate(options);
    const preview = previewStep(level.mm, level.start, program.steps[0]!);
    const expected = before.map((layer) => Uint8Array.from(layer));

    for (let mapIndex = 0; mapIndex < expected.length; mapIndex++) {
      const map = level.mm.maps[mapIndex]!;
      const points = [...(preview.trails[mapIndex] ?? []), preview.next.pos[mapIndex]!];
      for (const point of points) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const x = point.x + dx;
            const y = point.y + dy;
            if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
              expected[mapIndex]![y * map.width + x] = 1;
            }
          }
        }
      }
    }

    game = dispatch(game, { kind: "advanceResearchShot" });
    expect(fogSnapshot(game)).toEqual(expected.map((layer) => [...layer]));
    expect(game.production.runtime).toBeNull();
  });

  it("completes one fixed machine at a time without advancing Production", () => {
    const { program } = reference();
    let game = createGameState(options, 500, 0);
    game = dispatch(game, { kind: "setResearchProgram", program });
    game = dispatch(game, { kind: "beginResearchShot" });
    for (let guard = 0; game.research.shot !== null && guard <= program.steps.length; guard++) {
      game = dispatch(game, { kind: "advanceResearchShot" });
    }
    expect(game.research.shot).toBeNull();
    expect(game.research.lastOutcome).not.toBeNull();
    expect(game.production.runtime).toBeNull();
  });

  it("freezes editing during a shot and aborts without refund or reveal", () => {
    const { program } = reference();
    let game = createGameState(options, 500, 0);
    game = dispatch(game, { kind: "setResearchProgram", program });
    game = dispatch(game, { kind: "beginResearchShot" });
    const cash = game.economy.cash;
    const fog = fogSnapshot(game);

    expect(() => dispatch(game, { kind: "setResearchProgram", program: { steps: [] } }))
      .toThrow(/cannot edit|running/i);
    game = dispatch(game, { kind: "abortResearchShot" });

    expect(game.research.shot).toBeNull();
    expect(game.research.lastOutcome).toBeNull();
    expect(game.economy.cash).toBe(cash);
    expect(fogSnapshot(game)).toEqual(fog);
  });

  it("owns planned paths and rejects empty, foreign, or invalid calibration programs", () => {
    const catalog = structuredClone(DEFAULT_CATALOG[0]!);
    const mutable: Machine = {
      typeId: catalog.typeId,
      path: catalog.path,
      stroke: catalog.path.length,
    };
    let game = createGameState(options, 500, 0);
    game = dispatch(game, { kind: "setResearchProgram", program: { steps: [mutable] } });
    (catalog.path[0] as { x: number }).x = -1;
    expect(game.research.program.steps[0]?.path[0]).toEqual({ x: 1, y: 0 });

    expect(() => dispatch(createGameState(options, 500, 0), { kind: "beginResearchShot" }))
      .toThrow(/at least one/i);
    expect(() => dispatch(createGameState(options, 500, 0), {
      kind: "setResearchProgram",
      program: { steps: [{ ...mutable, path: catalog.path }] },
    })).toThrow(/path does not match/i);
    expect(() => dispatch(createGameState(options, 500, 0), {
      kind: "setResearchProgram",
      program: { steps: [{ ...mutable, path: DEFAULT_CATALOG[0]!.path, stroke: 0 }] },
    })).toThrow(/stroke/i);
  });

  it("contains no phase-exchange machine or cross-layer calibration", () => {
    expect(DEFAULT_CATALOG.some((entry) => entry.typeId === "swap01")).toBe(false);
    for (const entry of DEFAULT_CATALOG) {
      expect(entry.path.every((delta) => Math.abs(delta.x) + Math.abs(delta.y) === 1)).toBe(true);
    }
  });

  it("applies exploration-aid patents only to an actually dispensed trail", () => {
    const machine = DEFAULT_CATALOG[0]!;
    const program = {
      steps: [{ typeId: machine.typeId, path: machine.path, stroke: machine.path.length }],
    };
    const initial = createGameState(options, 500, 10);
    const before = fogSnapshot(initial);
    const aided = dispatch(initial, { kind: "unlockPatent", id: "reveal-aid" });
    expect(fogSnapshot(aided)).toEqual(before);

    const run = (game: ReturnType<typeof createGameState>) => {
      let next = dispatch(game, { kind: "setResearchProgram", program });
      next = dispatch(next, { kind: "beginResearchShot" });
      return dispatch(next, { kind: "advanceResearchShot" });
    };
    const revealed = (game: ReturnType<typeof createGameState>) => game.fog[0]!
      .reduce((sum, value) => sum + value, 0);
    expect(revealed(run(aided))).toBeGreaterThan(revealed(run(initial)));
  });
});

describe("contract-free Pilot commissioning", () => {
  it("commissions an independent no-cure Pilot layout exactly into Production", () => {
    const layout = emptyPilotLayout();
    let game = createGameState(options, 500, 0);

    game = dispatch(game, { kind: "setPilotLayout", layout });
    game = dispatch(game, { kind: "sendPilotToProduction" });

    expect(game.production.layout).toEqual(layout);
    expect(game.production.runtime?.tick).toBe(0);
    expect("contract" in game.pilot).toBe(false);
    expect("contract" in game.production).toBe(false);
  });

  it("does not require or infer a Research route before commissioning", () => {
    const { layout } = reference();
    let game = createGameState(options, 500, 0);
    expect(game.research.program.steps).toEqual([]);

    game = dispatch(game, { kind: "setPilotLayout", layout });
    game = dispatch(game, { kind: "sendPilotToProduction" });
    expect(game.production.layout).toEqual(game.pilot.layout);
  });

  it("rejects direct Production edits until a Pilot layout has been commissioned", () => {
    const layout = emptyPilotLayout();
    const game = createGameState(options, 500, 0);
    expect(() => dispatch(game, { kind: "setProductionLayout", layout })).toThrow(/commission|Pilot/i);
    expect(game.production.layout).toBeNull();
  });
});
