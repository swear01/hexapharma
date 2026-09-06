import { expect, it } from "vitest";
import { applyGameIntent, createGameState, hashGame, MAX_REPLAY_TICKS } from "./game";
import { DEFAULT_CATALOG, MAX_GAME_REPLAY_WORK, type GameIntent, type GenOptions } from "./phase0_interfaces";
import { generate } from "./mapgen";
import { compileEntitledPrototype } from "./recipe";
import { estimateGameReplayWork } from "./replay-work";
import { deserializeGame, deserializeSnapshot, pushSnapshot, rewind, serializeGame, serializeSnapshot } from "./save";

const options: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 63,
  height: 63,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 4,
  difficulty: { min: 4, max: 12 },
};

it("seed 14 continues through lifetime tick 100001 without requiring Reset", () => {
  let game = createGameState(options, 1000, 0);
  game = applyGameIntent(game, { kind: "productionTicks", ticks: MAX_REPLAY_TICKS });
  const before = pushSnapshot([], game);
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
  expect(game.production.runtime.tick).toBe(100001);
  const after = pushSnapshot(before, game);
  expect(hashGame(rewind(after).state)).toBe(hashGame(before[0]!));
  const savedHash = hashGame(game);
  game = deserializeGame(serializeGame(game));
  expect(hashGame(game)).toBe(savedHash);
  game = applyGameIntent(game, { kind: "resetProduction" });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
  expect(game.production.runtime.tick).toBe(1);
  expect(game.economy).toEqual({ cash: 1000, research: 0, sold: [] });
});

it("continues Research after exhausting the lifetime intent-entry budget", () => {
  let game = createGameState(options, 1000, 0);
  for (let cycle = 0; cycle <= 4096 / 2; cycle++) {
    game = applyGameIntent(game, { kind: "beginResearchShot" });
    game = applyGameIntent(game, { kind: "abortResearchShot" });
  }
  expect(game.production.runtime.tick).toBe(0);
  expect(game.research.shot).toBeNull();
  expect(game.economy.cash).toBe(1000);
  expect(game).not.toHaveProperty("intentTrace");
  expect(hashGame(deserializeGame(serializeGame(game)))).toBe(hashGame(game));
});

it("continues paid Production before the tick cap when cumulative weighted work fills", () => {
  let game = createGameState(options, 1000, 0);
  const layout = {
    ...game.production.layout,
    tiles: game.production.layout.tiles.map(() => ({ kind: "belt" as const, dir: 0 as const })),
  };
  const build = { kind: "buildProductionLayout" as const, layout };
  expect(estimateGameReplayWork(options, [build, { kind: "productionTicks", ticks: 1000 }]))
    .toBeLessThan(MAX_GAME_REPLAY_WORK);
  expect(estimateGameReplayWork(options, [build, { kind: "productionTicks", ticks: 1500 }]))
    .toBeGreaterThan(MAX_GAME_REPLAY_WORK);
  game = applyGameIntent(game, build);
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 1000 });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 500 });
  expect(game.production.runtime.tick).toBe(1500);
  expect(game.production.layout).toEqual(layout);
  expect(game.economy.cash).toBe(1000 - layout.tiles.length * 2);
  expect(hashGame(deserializeGame(serializeGame(game)))).toBe(hashGame(game));
});


it("preserves Research, paid builds, sales, patents and in-flight state through repeated snapshots", () => {
  let uninterrupted = createGameState(options, 10000, 0);
  let resumed = deserializeSnapshot(serializeSnapshot(uninterrupted));
  const apply = (intent: GameIntent): void => {
    uninterrupted = applyGameIntent(uninterrupted, intent);
    resumed = deserializeSnapshot(serializeSnapshot(applyGameIntent(resumed, intent)));
    expect(resumed).toEqual(uninterrupted);
    expect(hashGame(resumed)).toBe(hashGame(uninterrupted));
  };
  const recipe = generate(options).diseases[0]!.reference;
  for (const machine of recipe.steps) apply({ kind: "advanceResearchShot", machine });
  const layout = compileEntitledPrototype(recipe, 24, 12).layout;
  apply({ kind: "setPilotLayout", layout });
  apply({ kind: "buildProductionLayout", layout });
  for (let cycle = 0; cycle < 12; cycle++) {
    apply({ kind: "productionTicks", ticks: 100 });
    expect(resumed.production.runtime.unitCount).toBeGreaterThan(0);
    const first = resumed.inventory[0]!;
    apply({ kind: "sellProduct", productId: first.inventoryId, disease: first.outcome.cured[0]! });
    apply({ kind: "advanceResearchShot", machine: recipe.steps[0]! });
    apply({ kind: "abortResearchShot" });
  }
  apply({ kind: "unlockPatent", id: "reveal-aid" });
  apply({ kind: "unlockPatent", id: "bench-2" });
  apply({ kind: "productionTicks", ticks: 20 });
}, 15_000);

it("rejects safe-integer overflow atomically without changing the saved state", () => {
  const game = createGameState(options, 1000, 0);
  const wire = JSON.parse(serializeGame(game));
  wire.game.production.runtime.tick = Number.MAX_SAFE_INTEGER;
  const loaded = deserializeGame(JSON.stringify(wire));
  const before = hashGame(loaded);
  expect(() => applyGameIntent(loaded, { kind: "productionTicks", ticks: 1 })).toThrow(/safe-integer/);
  expect(hashGame(loaded)).toBe(before);
  const reset = applyGameIntent(loaded, { kind: "resetProduction" });
  expect(applyGameIntent(reset, { kind: "productionTicks", ticks: 1 }).production.runtime.tick).toBe(1);
});
