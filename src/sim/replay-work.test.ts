import { describe, expect, it } from "vitest";
import { generate } from "./mapgen";
import {
  DEFAULT_CATALOG,
  MAX_GAME_REPLAY_WORK,
  MAX_FACTORY_REPLAY_TICKS,
  type GenOptions,
  type GameIntent,
} from "./phase0_interfaces";
import { MAX_INTENT_TRACE } from "./game";
import { estimateGameReplayWork } from "./replay-work";

const options: GenOptions = {
  seed: 14,
  nMaps: 2,
  width: 12,
  height: 12,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 2,
  difficulty: { min: 4, max: 12 },
};

describe("game replay work", () => {
  it("uses the compiled factory instead of blocking a normal recipe trace early", () => {
    const recipe = generate(options).diseases[0]!.reference;
    const trace: readonly GameIntent[] = [
      { kind: "saveRecipe", recipe },
      { kind: "factoryTicks", ticks: MAX_FACTORY_REPLAY_TICKS },
    ];

    expect(estimateGameReplayWork(options, trace)).toBeLessThanOrEqual(MAX_GAME_REPLAY_WORK);
  });

  it("charges no-op lab intents for their map-sized allocation and traversal work", () => {
    const maximumMaps: GenOptions = {
      ...options,
      nMaps: 4,
      width: 32,
      height: 32,
      diseaseCount: 4,
    };
    const trace: readonly GameIntent[] = new Array(MAX_INTENT_TRACE).fill({
      kind: "runLab",
      template: { steps: [] },
    });

    expect(estimateGameReplayWork(maximumMaps, trace)).toBeGreaterThan(50_000_000);
  });
});
