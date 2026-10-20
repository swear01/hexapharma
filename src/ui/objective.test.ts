import { describe, expect, it } from "vitest";
import type { ShippingContractProgress } from "../sim/phase0_interfaces";
import { currentObjective, type ObjectiveInput } from "./objective";

function contract(disease: number, sold: number): ShippingContractProgress {
  return { disease, sold, quota: 3, completed: sold >= 3 };
}

const base: ObjectiveInput = {
  contracts: [contract(0, 0), contract(1, 0)],
  formulaDiseases: [],
  unlockedPatents: [],
  gatedPatents: ["skew-unlock", "dilute-unlock"],
  profitableUnits: () => 0,
  stockFor: () => 0,
  productionHasMachines: false,
  producingOther: false,
  sector: "east",
};

describe("currentObjective", () => {
  it("walks the loop from research to build, production and shipping", () => {
    expect(currentObjective(base)).toMatchObject({ target: "research", text: "Find a cure for Disease 1 · look east" });
    expect(currentObjective({ ...base, sector: "local" }).text).toBe("Find a cure for Disease 1 · near the start");
    expect(currentObjective({ ...base, formulaDiseases: [0] })).toMatchObject({ target: "pilot", actionLabel: "Open Plan" });
    expect(currentObjective({ ...base, formulaDiseases: [0], productionHasMachines: true }).target).toBe("production");
    expect(currentObjective({ ...base, formulaDiseases: [0], productionHasMachines: true, profitableUnits: () => 4 }))
      .toMatchObject({ target: "market", text: "Ship Disease 1 · 0 of 3" });
  });

  it("sends a filled contract to its patent before the next disease, then moves on", () => {
    const filled = { ...base, contracts: [contract(0, 3), contract(1, 0)] };
    expect(currentObjective(filled)).toMatchObject({ target: "technology", text: "Unlock Zigzag still" });
    expect(currentObjective({ ...filled, unlockedPatents: ["skew-unlock"] }).text).toBe("Find a cure for Disease 2 · look east");
  });

  it("does not send the player to run a line that still makes the previous cure", () => {
    const next = { ...base, contracts: [contract(0, 3), contract(1, 0)], unlockedPatents: ["skew-unlock"], formulaDiseases: [0, 1], productionHasMachines: true };
    expect(currentObjective({ ...next, producingOther: true })).toMatchObject({ target: "pilot", text: "Build the Disease 2 formula · Production makes another cure" });
    expect(currentObjective({ ...next, stockFor: (d) => (d === 1 ? 5 : 0) })).toMatchObject({ target: "production", text: "Disease 2 stock no longer earns · improve the line" });
  });

  it("reports when every contract is filled", () => {
    const done = { ...base, contracts: [contract(0, 3), contract(1, 3)], unlockedPatents: ["skew-unlock", "dilute-unlock"] };
    expect(currentObjective(done).target).toBe("market");
  });
});
