import { describe, it, expect } from "vitest";
import * as dg from "./index";

// Smoke only — the drug-graph agent replaces this with property tests for INV-1..INV-8.
describe("drug-graph (smoke)", () => {
  it("exports the contract functions", () => {
    const fns = [
      "orient",
      "effectiveDelta",
      "initialState",
      "applyStep",
      "applyTemplate",
      "evaluate",
      "revealAlong",
    ] as const;
    const mod = dg as Record<string, unknown>;
    for (const f of fns) expect(typeof mod[f]).toBe("function");
  });
});
