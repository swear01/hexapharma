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
  width: 63,
  height: 63,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

describe("single Research Atlas authority", () => {
  it("uses only fixed cardinal PathStamps without phase-exchange controls", () => {
    expect(DEFAULT_CATALOG.some((entry) => entry.typeId.startsWith("swap"))).toBe(false);
    for (const entry of DEFAULT_CATALOG) {
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.path.every((delta) => Math.abs(delta.x) + Math.abs(delta.y) === 1)).toBe(true);
    }

    const machine = DEFAULT_CATALOG[0]!;
    const game = applyGameIntent(createGameState(singleAtlasOptions, 200, 0), {
      kind: "setResearchProgram",
      program: {
        steps: [{ typeId: machine.typeId, path: machine.path }],
      },
    });
    expect(game.research.program.steps[0]).toEqual({
      typeId: machine.typeId,
      path: machine.path,
    });
  });

  it("rejects multi-map Game authority while leaving low-level mapgen reusable", () => {
    expect(() => createGameState({
      ...singleAtlasOptions,
      nMaps: 2,
      diseaseCount: 2,
    }, 200, 0)).toThrow(/single Research Atlas/i);
  });

  it("supports several independent diseases on the one active Atlas", () => {
    const game = createGameState({
      ...singleAtlasOptions,
      diseaseCount: 3,
    }, 800, 0);

    expect(game.genOptions.nMaps).toBe(1);
    expect(game.genOptions.diseaseCount).toBe(3);
  });

  it("has no layer or map-depth patents", () => {
    expect(DEFAULT_PATENTS.map((node) => node.id)).not.toEqual(
      expect.arrayContaining(["new-map", "new-map-4", "deep-map-4"]),
    );
  });
});
