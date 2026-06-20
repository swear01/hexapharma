import { describe, it, expect } from "vitest";
import { solve } from "./index";

// Smoke only — the solver agent replaces this with soundness tests (INV-13).
describe("solver (smoke)", () => {
  it("exports solve", () => {
    expect(typeof solve).toBe("function");
  });
});
