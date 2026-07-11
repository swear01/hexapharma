import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, type GenOptions } from "./phase0_interfaces";
import { applyGameIntent, createGameState } from "./game";

const singleLayerOptions: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 63,
  height: 63,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

describe("ingredient-layer progression", () => {
  it("rejects a phase exchange before every addressed layer exists", () => {
    const game = createGameState(singleLayerOptions, 200, 0);
    const exchange = DEFAULT_CATALOG.find((entry) => entry.typeId === "swap01");
    if (exchange === undefined) throw new Error("missing phase exchange fixture");
    const template = {
      steps: [{
        typeId: exchange.typeId,
        transform: exchange.transform,
        orientation: { rot: 0 as const, flip: false },
      }],
    };
    expect(() => applyGameIntent(game, { kind: "runLab", template })).toThrow(/phase exchange.*layer/i);
    expect(() => applyGameIntent(game, { kind: "saveRecipe", recipe: template })).toThrow(/phase exchange.*layer/i);
  });

  it("deepens a centered run from A to A/B to A/B/C to A/B/C/D", () => {
    let game = createGameState(singleLayerOptions, 100_000, 100);
    expect(game.genOptions.nMaps).toBe(1);
    expect(game.fog[0]?.reduce((sum, cell) => sum + cell, 0)).toBe(49);

    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    game = applyGameIntent(game, { kind: "unlockPatent", id: "new-map" });
    expect(game.genOptions.nMaps).toBe(2);
    expect(game.genOptions.width).toBe(63);
    expect(game.genOptions.height).toBe(63);

    game = applyGameIntent(game, { kind: "unlockPatent", id: "new-map-4" });
    expect(game.genOptions.nMaps).toBe(3);

    game = applyGameIntent(game, { kind: "unlockPatent", id: "deep-map-4" });
    expect(game.genOptions.nMaps).toBe(4);
  });
});
