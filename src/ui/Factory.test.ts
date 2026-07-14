import { describe, expect, it } from "vitest";
import {
  facilityMayAnalyzeOutcome,
  formatFacilityOutcome,
  initialFacilityLayout,
} from "./Factory";

describe("facility workspace initialization", () => {
  it("starts an uncommissioned facility as an empty entitled floor without auto-packing a recipe", () => {
    const layout = initialFacilityLayout(null, 24, 12);

    expect(layout.width).toBe(24);
    expect(layout.height).toBe(12);
    expect(layout.machines).toEqual([]);
    expect(layout.tiles).toHaveLength(24 * 12);
    expect(layout.tiles.every((tile) => tile.kind === "empty")).toBe(true);
  });
});

describe("facility sample visibility", () => {
  it("evaluates zero-time Pilot samples and live Production outcomes", () => {
    expect(facilityMayAnalyzeOutcome("pilot")).toBe(true);
    expect(facilityMayAnalyzeOutcome("production")).toBe(true);
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
