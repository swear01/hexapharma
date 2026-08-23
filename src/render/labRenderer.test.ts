import { describe, expect, it } from "vitest";
import { LAB_SCHEMATIC_STYLE, labFeatureStyle, labPreviewTargetBadge } from "./labRenderer";

describe("Orbital wet-lab schematic", () => {
  it("uses one restrained semantic palette instead of asset-local colors", () => {
    expect(LAB_SCHEMATIC_STYLE).toEqual({
      void: 0x050a12,
      field: 0x18242b,
      structure: 0xe7e1d2,
      flow: 0x48d7e5,
      candidate: 0xf3b45d,
      cure: 0xb8e06c,
      sideEffect: 0xde5fb1,
      failure: 0xef6862,
    });
  });
});

describe("Lab feature emphasis", () => {
  it("requests a target ring only for a revealed Cure", () => {
    const cure = labFeatureStyle("cure");
    const sideEffect = labFeatureStyle("sideEffect");

    expect(cure).toEqual({ targetRing: true });
    expect(sideEffect).toEqual({ targetRing: false });
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
