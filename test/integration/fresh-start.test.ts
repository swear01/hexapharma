import { describe, expect, it } from "vitest";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  type GenOptions,
} from "../../src/sim/phase0_interfaces";
import {
  DEFAULT_STARTING_CASH,
  applyGameIntent,
  createGameState,
} from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { quoteProductionBuild } from "../../src/sim/construction";

function options(seed: number): GenOptions {
  return {
    seed,
    nMaps: 1,
    width: 63,
    height: 63,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 4,
    difficulty: { min: 4, max: 12 },
  };
}

describe("fresh-save playable loop", () => {
  it("can research, build, produce, and sell the first generated cure without injected money", () => {
    const genOptions = options(14);
    const level = generate(genOptions);
    expect(level.diseases).toHaveLength(4);
    const program = level.diseases[0]!.reference;
    let game = createGameState(genOptions, DEFAULT_STARTING_CASH, 0);

    game = applyGameIntent(game, { kind: "setResearchProgram", program });
    game = applyGameIntent(game, { kind: "beginResearchShot" });
    while (game.research.shot !== null) {
      game = applyGameIntent(game, { kind: "advanceResearchShot" });
    }
    expect(game.research.lastOutcome?.cured).toContain(level.diseases[0]!.id);

    const layout = compileEntitledPrototype(
      program,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    expect(quoteProductionBuild(game.production.layout, layout)).toBeLessThanOrEqual(
      game.economy.cash,
    );
    game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 400 });
    const product = game.inventory.find((candidate) =>
      candidate.outcome.cured.includes(level.diseases[0]!.id),
    );
    expect(product).toBeDefined();

    const beforeSale = game.economy.cash;
    game = applyGameIntent(game, {
      kind: "sellProduct",
      productId: product!.inventoryId,
      disease: level.diseases[0]!.id,
    });
    expect(game.economy.cash).toBeGreaterThan(beforeSale);
    expect(game.economy.research).toBe(1);
  });
});
