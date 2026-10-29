import { describe, expect, it } from "vitest";
import { diseaseName, outcomeEffectText } from "./effectLabels";

describe("player-facing effect labels", () => {
  it("uses one-based disease names", () => {
    expect(diseaseName(0)).toBe("Disease 1");
    expect(diseaseName(3)).toBe("Disease 4");
  });

  it("summarizes side effects without exposing global effect ids or coordinates", () => {
    const text = outcomeEffectText({
      failed: false,
      final: [{ q: 91, r: 73 }],
      cured: [0],
      premium: [],
      regions: [1],
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
