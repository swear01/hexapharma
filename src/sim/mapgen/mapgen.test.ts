import { describe, it, expect } from "vitest";
import { generate, difficultyToBasePrice } from "./index";

// Smoke only — the mapgen agent replaces this with determinism/difficulty/pricing tests (INV-9..12).
describe("mapgen (smoke)", () => {
  it("exports generate + difficultyToBasePrice", () => {
    expect(typeof generate).toBe("function");
    expect(typeof difficultyToBasePrice).toBe("function");
  });
});
