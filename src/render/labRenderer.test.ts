import { describe, expect, it } from "vitest";
import { LAB_SCHEMATIC_STYLE } from "./labRenderer";

describe("flat atlas palette", () => {
  it("separates candidate, active flow, and failure", () => {
    expect(new Set([LAB_SCHEMATIC_STYLE.candidate, LAB_SCHEMATIC_STYLE.flow, LAB_SCHEMATIC_STYLE.failure]).size).toBe(3);
    const channels = [16, 8, 0].map((shift) => (LAB_SCHEMATIC_STYLE.background >> shift) & 255);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThan(16);
  });
});
