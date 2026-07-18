import { describe, expect, it } from "vitest";
import { diseaseEmblem, diseaseName, outcomeEffectText } from "./effectLabels";

describe("player-facing effect labels", () => {
  it("uses one-based disease names and emblems", () => {
    expect(diseaseName(0)).toBe("Disease 1");
    expect(diseaseName(3)).toBe("Disease 4");
    expect(diseaseEmblem(0)).toBe("D1");
  });

  it("summarizes side effects without exposing global effect ids or coordinates", () => {
    const text = outcomeEffectText({
      failed: false,
      final: [{ x: 91, y: 73 }],
      cured: [0],
      sideEffects: [4001, 9002],
    });
    expect(text).toBe("Cure Disease 1 · 2 side effects");
    expect(text).not.toMatch(/4001|9002|91|73/);
  });

  it("rejects invalid disease ids rather than inventing a label", () => {
    expect(() => diseaseName(-1)).toThrow(/disease id/i);
    expect(() => diseaseName(1.5)).toThrow(/disease id/i);
  });
});
