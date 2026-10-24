import { describe, expect, it } from "vitest";
import type { ShippingContractProgress } from "../sim/phase0_interfaces";
import { currentObjective, type ObjectiveInput } from "./objective";

function contract(disease: number, sold: number): ShippingContractProgress {
  return { disease, sold, quota: 3, completed: sold >= 3 };
}

const base: ObjectiveInput = {
  contracts: [contract(0, 0), contract(1, 0)],
  knownCureDiseases: [],
  profitableUnits: () => 0,
  stockFor: () => 0,
  planHasMachines: false,
  productionHasMachines: false,
  producingOther: false,
  sector: "east",
};

describe("currentObjective", () => {
  it("walks the loop: find a Cure, Plan, Commission, run Production, ship", () => {
    expect(currentObjective(base)).toMatchObject({ target: "research", text: "Find Disease 1 · look east" });
    expect(currentObjective({ ...base, sector: "local" }).text).toBe("Find Disease 1 · near the start");
    expect(currentObjective({ ...base, knownCureDiseases: [1] }).target).toBe("research");
    const cured = { ...base, knownCureDiseases: [0] };
    expect(currentObjective(cured)).toMatchObject({ target: "pilot", actionLabel: "Plan", text: "Plan a line to Disease 1" });
    expect(currentObjective({ ...cured, planHasMachines: true }))
      .toMatchObject({ target: "pilot", text: "Commission the Plan for Disease 1" });
    expect(currentObjective({ ...cured, planHasMachines: true, productionHasMachines: true }))
      .toMatchObject({ target: "production", text: "Run Production to make Disease 1" });
    expect(currentObjective({ ...cured, productionHasMachines: true, profitableUnits: () => 4 }))
      .toMatchObject({ target: "market", actionLabel: "Ship", text: "Ship Disease 1" });
  });

  it("ships profitable stock even before the Cure is revealed on this map", () => {
    expect(currentObjective({ ...base, profitableUnits: () => 1 }).target).toBe("market");
  });

  it("moves to the next disease once a contract is filled", () => {
    const filled = { ...base, contracts: [contract(0, 3), contract(1, 0)] };
    expect(currentObjective(filled).text).toBe("Find Disease 2 · look east");
  });

  it("does not send the player to run a line that still makes the previous cure", () => {
    const next = { ...base, contracts: [contract(0, 3), contract(1, 0)], knownCureDiseases: [0, 1], productionHasMachines: true };
    expect(currentObjective({ ...next, producingOther: true })).toMatchObject({ target: "pilot", text: "Plan a line to Disease 2 · Production makes another cure" });
    expect(currentObjective({ ...next, stockFor: (d) => (d === 1 ? 5 : 0) })).toMatchObject({ target: "production", text: "Disease 2 stock no longer earns · improve the line" });
  });

  it("reports when every contract is filled", () => {
    const done = { ...base, contracts: [contract(0, 3), contract(1, 3)] };
    expect(currentObjective(done)).toMatchObject({ target: "market", text: "Every contract filled" });
  });
});
