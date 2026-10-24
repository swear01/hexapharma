import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG,
  type GenOptions,
} from "./phase0_interfaces";
import { applyGameIntent, createGameState } from "./game";
import { DEFAULT_PATENTS } from "./patent";

const singleAtlasOptions: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 49,
  height: 49,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

describe("single Research Atlas authority", () => {
  it("uses only fixed six-neighbor PathStamps without phase-exchange controls", () => {
    expect(DEFAULT_CATALOG.some((entry) => entry.typeId.startsWith("swap"))).toBe(false);
    for (const entry of DEFAULT_CATALOG) {
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.path.every((direction) => direction >= 0 && direction <= 5)).toBe(true);
    }

    const machine = DEFAULT_CATALOG[0]!;
    const game = applyGameIntent(createGameState(singleAtlasOptions, 200), {
      kind: "runResearchTrial",
      program: { steps: [machine] },
      base: 0,
    });
    expect(game.research.lastTrial?.program.steps[0]).toEqual({
      typeId: machine.typeId,
      path: machine.path,
      turn: machine.turn,
    });
  });

  it("accepts one map per base drug and rejects more maps than bases", () => {
    expect(createGameState({ ...singleAtlasOptions, nMaps: 3, diseaseCount: 6 }, 200).fog).toHaveLength(3);
    expect(() => createGameState({
      ...singleAtlasOptions,
      nMaps: 4,
      diseaseCount: 4,
    }, 200)).toThrow(/1\.\.3 base maps/i);
  });

  it("supports several independent diseases on the one active Atlas", () => {
    const game = createGameState({
      ...singleAtlasOptions,
      diseaseCount: 3,
    }, 800);

    expect(game.genOptions.nMaps).toBe(1);
    expect(game.genOptions.diseaseCount).toBe(3);
  });

  it("has no layer or map-depth patents", () => {
    expect(DEFAULT_PATENTS.map((node) => node.id)).not.toEqual(
      expect.arrayContaining(["new-map", "new-map-4", "deep-map-4"]),
    );
  });
});
