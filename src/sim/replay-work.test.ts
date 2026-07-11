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
  it("accepts a single ingredient layer", () => {
    expect(estimateGameReplayWork({ ...options, nMaps: 1, diseaseCount: 1 }, [])).toBeGreaterThan(0);
  });
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

  it("charges every 63x63 layer across the complete one-to-four patent path", () => {
    const oneLayer = { ...options, nMaps: 1, width: 63, height: 63, diseaseCount: 1 };
    const trace: readonly GameIntent[] = [
      { kind: "unlockPatent", id: "new-map" },
      { kind: "runLab", template: { steps: [] } },
      { kind: "unlockPatent", id: "new-map-4" },
      { kind: "runLab", template: { steps: [] } },
      { kind: "unlockPatent", id: "deep-map-4" },
      { kind: "runLab", template: { steps: [] } },
    ];
    const cells = 63 * 63;
    const expected =
      cells * 32 +
      (262_144 + 2 * cells * 32) + 2 * cells * 4 +
      (262_144 + 3 * cells * 32) + 3 * cells * 4 +
      (262_144 + 4 * cells * 32) + 4 * cells * 4;
    expect(estimateGameReplayWork(oneLayer, trace)).toBe(expected);
  });
});
