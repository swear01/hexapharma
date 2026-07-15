import { describe, expect, it } from "vitest";
import {
  facilityMayAnalyzeOutcome,
  formatFacilityOutcome,
  initialFacilityLayout,
  paintBeltRoute,
  previewProductionBuildCost,
} from "./Factory";

describe("facility workspace initialization", () => {
  it("starts a facility as an empty entitled floor without auto-packing a recipe", () => {
    const layout = initialFacilityLayout(null, 24, 12);

    expect(layout.width).toBe(24);
    expect(layout.height).toBe(12);
    expect(layout.machines).toEqual([]);
    expect(layout.tiles).toHaveLength(24 * 12);
    expect(layout.tiles.every((tile) => tile.kind === "empty")).toBe(true);
  });
});

describe("Production placement cost preview", () => {
  it("shows no price in Pilot and the exact paid delta in Production", () => {
    const current = initialFacilityLayout(null, 4, 4);
    const proposed = {
      ...current,
      tiles: current.tiles.map((tile, index) => index === 0 ? { kind: "belt" as const, dir: 0 as const } : tile),
    };

    expect(previewProductionBuildCost("pilot", current, proposed)).toBeNull();
    expect(previewProductionBuildCost("production", current, proposed)).toBe(2);
    expect(previewProductionBuildCost("production", proposed, proposed)).toBeNull();
  });

  it("quotes the whole one-bend belt gesture instead of only its endpoint", () => {
    const current = initialFacilityLayout(null, 6, 6);
    const proposed = paintBeltRoute(current, [
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 3, y: 2 }, { x: 3, y: 3 },
    ], 0);

    expect(previewProductionBuildCost("production", current, proposed)).toBe(10);
    expect(proposed.tiles[1 * proposed.width + 1]).toEqual({ kind: "belt", dir: 0 });
    expect(proposed.tiles[1 * proposed.width + 3]).toEqual({ kind: "belt", dir: 1 });
    expect(proposed.tiles[3 * proposed.width + 3]).toEqual({ kind: "belt", dir: 1 });
  });
});

describe("facility sample visibility", () => {
  it("evaluates zero-time Pilot samples but leaves Production to its live metrics", () => {
    expect(facilityMayAnalyzeOutcome("pilot", 1)).toBe(true);
    expect(facilityMayAnalyzeOutcome("pilot", 0)).toBe(false);
    expect(facilityMayAnalyzeOutcome("production", 1)).toBe(false);
  });

  it("reports the complete Pilot outcome, including side effects and endpoint", () => {
    expect(formatFacilityOutcome({
      failed: false,
      final: [{ x: 2, y: -1 }],
      cured: [7],
      sideEffects: [200, 201],
    })).toBe("cures 7 · side effects 200, 201 · final (2, -1)");

    expect(formatFacilityOutcome({
      failed: false,
      final: [{ x: 4, y: 3 }],
      cured: [],
      sideEffects: [202],
    })).toBe("no cure · side effects 202 · final (4, 3)");
  });
});
