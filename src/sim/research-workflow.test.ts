import { describe, expect, it } from "vitest";
import type { FactoryLayout, GameIntent, GenOptions, Template } from "./phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
} from "./phase0_interfaces";
import { applyGameIntent, createGameState } from "./game";
import { previewStep } from "./drug-graph";
import { generate } from "./mapgen";
import { compileEntitledPrototype, deriveLinearRoute } from "./recipe";

const options: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 32,
  height: 32,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

function reference(): { readonly template: Template; readonly layout: FactoryLayout } {
  const template = generate(options).diseases[0]!.reference;
  return {
    template,
    layout: compileEntitledPrototype(
      template,
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

describe("Research shot workflow", () => {
  it("keeps planning free of fog and cash mutations, then charges exactly once on Dispense", () => {
    const { layout, template } = reference();
    const initial = createGameState(options, 200, 0);
    const beforeFog = fogSnapshot(initial);

    const planned = dispatch(initial, { kind: "setResearchLayout", layout });
    expect(planned.fog.map((layer) => [...layer])).toEqual(beforeFog);
    expect(planned.economy.cash).toBe(200);
    expect(planned.research.layout).toEqual(layout);
    expect(planned.research.shot).toBeNull();

    const expectedCost = Math.max(1, template.steps.reduce((total, machine) => {
      return total + DEFAULT_CATALOG.find((entry) => entry.typeId === machine.typeId)!.cost;
    }, 0));
    const fired = dispatch(planned, { kind: "beginResearchShot" });
    expect(fired.economy.cash).toBe(200 - expectedCost);
    expect(fired.fog.map((layer) => [...layer])).toEqual(beforeFog);
    expect(fired.research.shot).toMatchObject({ step: 0, cost: expectedCost });
    expect(() => dispatch(fired, { kind: "beginResearchShot" })).toThrow(/already|running/i);
  });

  it("reveals only after advancing the frozen shot and never advances Production time", () => {
    const { layout } = reference();
    let game = createGameState(options, 200, 0);
    game = dispatch(game, { kind: "setResearchLayout", layout });
    game = dispatch(game, { kind: "beginResearchShot" });
    const beforeAdvance = fogSnapshot(game);
    const productionTick = game.production.runtime?.tick ?? 0;

    game = dispatch(game, { kind: "advanceResearchShot" });

    expect(game.fog.map((layer) => [...layer])).not.toEqual(beforeAdvance);
    expect(game.production.runtime?.tick ?? 0).toBe(productionTick);
  });

  it("reveals exactly radius one around the completed step and no future route segment", () => {
    const { layout } = reference();
    let game = createGameState(options, 200, 0);
    game = dispatch(game, { kind: "setResearchLayout", layout });
    game = dispatch(game, { kind: "beginResearchShot" });
    const before = game.fog.map((layer) => Uint8Array.from(layer));
    const level = generate(options);
    const machine = deriveLinearRoute(layout).template.steps[0]!;
    const preview = previewStep(level.mm, level.start, machine);
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

    expect(game.fog.map((layer) => [...layer])).toEqual(expected.map((layer) => [...layer]));
  });

  it("freezes editing during a shot and aborts without refunding or revealing", () => {
    const { layout } = reference();
    let game = createGameState(options, 200, 0);
    game = dispatch(game, { kind: "setResearchLayout", layout });
    game = dispatch(game, { kind: "beginResearchShot" });
    const chargedCash = game.economy.cash;
    const fog = fogSnapshot(game);

    expect(() => dispatch(game, { kind: "setResearchLayout", layout: { ...layout } })).toThrow(
      /cannot edit|running/i,
    );
    game = dispatch(game, { kind: "abortResearchShot" });

    expect(game.research.shot).toBeNull();
    expect(game.research.lastOutcome).toBeNull();
    expect(game.economy.cash).toBe(chargedCash);
    expect(fogSnapshot(game)).toEqual(fog);
  });

  it("rejects an invalid route atomically without charging or revealing", () => {
    const { layout } = reference();
    const invalid: FactoryLayout = {
      ...layout,
      tiles: layout.tiles.map((tile) => tile.kind === "sink" ? { kind: "empty" as const } : tile),
    };
    const initial = createGameState(options, 200, 0);
    const planned = dispatch(initial, { kind: "setResearchLayout", layout: invalid });
    const fog = fogSnapshot(planned);

    expect(() => dispatch(planned, { kind: "beginResearchShot" })).toThrow(/sink|route|topology/i);
    expect(planned.economy.cash).toBe(200);
    expect(planned.fog.map((layer) => [...layer])).toEqual(fog);
  });

  it("copies a successful Research line into Pilot, then Pilot into Production exactly", () => {
    const { layout } = reference();
    let game = createGameState(options, 200, 0);
    game = dispatch(game, { kind: "setResearchLayout", layout });
    game = dispatch(game, { kind: "beginResearchShot" });
    for (let guard = 0; game.research.shot !== null && guard < 300; guard++) {
      game = dispatch(game, { kind: "advanceResearchShot" });
    }
    expect(game.research.lastOutcome?.failed).toBe(false);

    game = dispatch(game, { kind: "sendResearchToPilot" });
    expect(game.pilot.layout).toEqual(layout);
    expect(game.pilot.contract).not.toBeNull();
    expect(game.production.layout).toBeNull();

    game = dispatch(game, { kind: "sendPilotToProduction" });
    expect(game.production.layout).toEqual(layout);
    expect(game.production.contract).toEqual(game.pilot.contract);
    expect(game.production.runtime?.tick).toBe(0);
  });

  it("rejects a direct Production layout before Pilot has commissioned a contract", () => {
    const { layout } = reference();
    const initial = createGameState(options, 200, 0);

    expect(() => dispatch(initial, { kind: "setProductionLayout", layout })).toThrow(
      /commission|contract|Pilot/i,
    );
    expect(initial.production.layout).toBeNull();
  });

  it("does not transfer a completed route that found no cure", () => {
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const layout = compileEntitledPrototype(
      {
        steps: [{ typeId: push.typeId, transform: push.transform, orientation: { rot: 0, flip: false } }],
      },
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    let game = createGameState(options, 200, 0);
    game = dispatch(game, { kind: "setResearchLayout", layout });
    game = dispatch(game, { kind: "beginResearchShot" });
    game = dispatch(game, { kind: "advanceResearchShot" });

    expect(game.research.lastOutcome?.cured).toEqual([]);
    expect(() => dispatch(game, { kind: "sendResearchToPilot" })).toThrow(/cure|Research/i);
    expect(game.pilot.layout).toBeNull();
  });

  it("reveals the arrival cells of a Phase Exchange step even though it has no sweep trail", () => {
    const layeredOptions: GenOptions = { ...options, nMaps: 2, diseaseCount: 2 };
    const swap = DEFAULT_CATALOG.find((entry) => entry.typeId === "swap01")!;
    const layout = compileEntitledPrototype(
      {
        steps: [{ typeId: swap.typeId, transform: swap.transform, orientation: { rot: 0, flip: false } }],
      },
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    let game = createGameState(layeredOptions, 200, 0);
    const level = generate(layeredOptions);
    game = dispatch(game, { kind: "setResearchLayout", layout });
    game = dispatch(game, { kind: "beginResearchShot" });
    game = dispatch(game, { kind: "advanceResearchShot" });

    expect(game.fog[0]![level.start.pos[1]!.y * level.mm.maps[0]!.width + level.start.pos[1]!.x]).toBe(1);
    expect(game.fog[1]![level.start.pos[0]!.y * level.mm.maps[1]!.width + level.start.pos[0]!.x]).toBe(1);
  });
});
