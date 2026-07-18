import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { machineName, machineShortName } from "./machineLabels";

describe("player-facing machine labels", () => {
  it("gives every catalog machine a readable name instead of exposing its type id", () => {
    for (const machine of DEFAULT_CATALOG) {
      const name = machineName(machine.typeId);
      const shortName = machineShortName(machine.typeId);
      expect(name.toLowerCase()).not.toBe(machine.typeId.toLowerCase());
      expect(shortName.toLowerCase()).not.toBe(machine.typeId.toLowerCase());
      expect(name).not.toMatch(/\d/);
      expect(shortName).not.toMatch(/\d/);
    }
  });

  it("rejects an unmapped machine rather than silently leaking an internal id", () => {
    expect(() => machineName("unknown-machine")).toThrow(/player-facing name/i);
    expect(() => machineShortName("unknown-machine")).toThrow(/player-facing name/i);
  });
});
