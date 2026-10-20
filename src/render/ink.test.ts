import { describe, expect, it } from "vitest";
import { inkJitter } from "./ink";

describe("inkJitter", () => {
  it("is deterministic, bounded and varies by index", () => {
    const values = Array.from({ length: 64 }, (_, index) => inkJitter(14, index));
    expect(values).toEqual(Array.from({ length: 64 }, (_, index) => inkJitter(14, index)));
    expect(values.every((value) => value >= -1 && value <= 1)).toBe(true);
    expect(new Set(values.map((value) => value.toFixed(3))).size).toBeGreaterThan(48);
  });
});
