import { describe, expect, it } from "vitest";
import { labFeatureStyle, labPreviewTargetBadge } from "./labRenderer";

describe("Lab feature emphasis", () => {
  it("renders a revealed Cure as a full-strength tinted target", () => {
    const cure = labFeatureStyle("cure", 0x8ae8ff);
    const sideEffect = labFeatureStyle("sideEffect", 0xd6a6ed);

    expect(cure).toMatchObject({ alpha: 1, tint: 0x8ae8ff, targetRing: true });
    expect(cure.scale).toBeGreaterThan(sideEffect.scale);
    expect(sideEffect.targetRing).toBe(false);
  });

  it("keeps an add-path badge legible on the preview endpoint", () => {
    expect(labPreviewTargetBadge(40)).toEqual({
      dx: 12,
      dy: -12,
      radius: 5.2,
      strokeWidth: 2,
    });
    expect(labPreviewTargetBadge(20).radius).toBe(4);
  });
});
