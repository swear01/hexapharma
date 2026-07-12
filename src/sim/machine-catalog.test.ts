import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, DEFAULT_SHAPES } from "./phase0_interfaces";

describe("production-scale machine catalog", () => {
  it("uses meaningful atlas travel rather than one-cell nudges", () => {
    const distances = DEFAULT_CATALOG
      .filter((entry) => entry.transform.kind === "translate")
      .map((entry) => entry.transform.kind === "translate"
        ? Math.max(Math.abs(entry.transform.delta.x), Math.abs(entry.transform.delta.y))
        : 0);
    expect(Math.min(...distances)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...distances)).toBeGreaterThanOrEqual(7);
  });

  it("gives every machine a readable multi-cell physical silhouette", () => {
    for (const entry of DEFAULT_CATALOG) {
      const shape = DEFAULT_SHAPES[entry.typeId];
      expect(shape, entry.typeId).toBeDefined();
      expect(shape!.cells.length, entry.typeId).toBeGreaterThanOrEqual(3);
      expect(shape!.inPorts.length, entry.typeId).toBeGreaterThan(0);
      expect(shape!.outPorts.length, entry.typeId).toBeGreaterThan(0);
    }
    expect(DEFAULT_SHAPES.push2!.cells.length).toBeGreaterThanOrEqual(7);
    expect(DEFAULT_SHAPES.dilute!.cells.length).toBeGreaterThanOrEqual(7);
    expect(DEFAULT_SHAPES.swap01!.cells.length).toBeGreaterThanOrEqual(7);
  });

  it("makes long-travel machinery slower and dearer than the starter pump", () => {
    const pump = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const longBed = DEFAULT_CATALOG.find((entry) => entry.typeId === "push2")!;
    expect(longBed.speed).toBeGreaterThan(pump.speed);
    expect(longBed.cost).toBeGreaterThan(pump.cost);
  });
});
