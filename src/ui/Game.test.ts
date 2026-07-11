import { describe, expect, it } from "vitest";
import { catalogForLayers, defaultGenOptions } from "./Game";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { MAX_GAME_MAP_CELLS, MAX_GAME_MAP_DIMENSION } from "../sim/phase0_interfaces";

describe("default Lab world options", () => {
  it("starts a new run on one large odd-sized map", () => {
    expect(defaultGenOptions(14)).toMatchObject({
      seed: 14,
      nMaps: 1,
      width: 63,
      height: 63,
      diseaseCount: 1,
    });
  });

  it("keeps every unlocked layer at the same large centered world size", () => {
    for (const nMaps of [1, 2, 3, 4]) {
      expect(defaultGenOptions(14, nMaps)).toMatchObject({
        nMaps,
        width: 63,
        height: 63,
        diseaseCount: nMaps,
      });
    }
  });

  it("authorizes the 63×63 world without opening the full public mapgen bound", () => {
    expect(MAX_GAME_MAP_DIMENSION).toBe(64);
    expect(MAX_GAME_MAP_CELLS).toBe(4_096);
    expect(63 * 63).toBeLessThanOrEqual(MAX_GAME_MAP_CELLS);
  });

  it("keeps phase exchange locked until both addressed layers exist", () => {
    expect(catalogForLayers(DEFAULT_CATALOG, 1).map((entry) => entry.typeId)).not.toContain("swap01");
    expect(catalogForLayers(DEFAULT_CATALOG, 2).map((entry) => entry.typeId)).toContain("swap01");
  });
});
