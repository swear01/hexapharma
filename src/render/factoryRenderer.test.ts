import { describe, expect, it } from "vitest";
import type { PlacedMachine } from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, SHAPE_1x1 } from "../sim/phase0_interfaces";
import {
  factoryTransportArmGeometry,
  factoryTransportFlowPoint,
  machinePathGlyph,
  machineVisualStyle,
  placedMachinePathGlyph,
} from "./factoryRenderer";

describe("factory machine visual language", () => {
  it("gives every machine family a distinct bounded chassis palette", () => {
    const styles = DEFAULT_CATALOG.map((entry) => machineVisualStyle(entry.typeId));
    const signatures = styles.map((style) => `${style.body}:${style.face}:${style.accent}`);

    expect(new Set(signatures).size).toBe(DEFAULT_CATALOG.length);
    for (const style of styles) {
      expect(style.body).toBeGreaterThanOrEqual(0);
      expect(style.body).toBeLessThanOrEqual(0xffffff);
      expect(style.face).toBeGreaterThanOrEqual(0);
      expect(style.face).toBeLessThanOrEqual(0xffffff);
      expect(style.accent).toBeGreaterThanOrEqual(0);
      expect(style.accent).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("does not collapse push and pull into the same visual family", () => {
    expect(machineVisualStyle("push")).not.toEqual(machineVisualStyle("pull"));
  });

  it("has one canonical footprint for every current path machine and no obsolete family", () => {
    const catalogIds = DEFAULT_CATALOG.map((entry) => entry.typeId).sort();
    expect(Object.keys(DEFAULT_SHAPES).sort()).toEqual(catalogIds);
    expect(DEFAULT_SHAPES.settle?.cells).toHaveLength(7);
    expect(DEFAULT_SHAPES.swap01).toBeUndefined();
  });

  it("draws the complete authored path", () => {
    const path = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ] as const;
    const glyph = machinePathGlyph(path);

    expect(glyph.points).toHaveLength(path.length + 1);
    expect(glyph.points[1]!.x).toBeGreaterThan(glyph.points[0]!.x);
    expect(glyph.points[2]!.y).toBeGreaterThan(glyph.points[1]!.y);
    expect(glyph.points[3]!.x).toBeLessThan(glyph.points[2]!.x);
  });

  it("never rotates the chemical path when the physical footprint rotates", () => {
    const entry = DEFAULT_CATALOG[0]!;
    const placed = (footRot: 0 | 1): PlacedMachine => ({
      id: footRot,
      def: {
        typeId: entry.typeId,
        path: entry.path,
        cost: entry.cost,
        speed: entry.speed,
      },
      anchor: { x: 1, y: 1 },
      footRot,
      shape: SHAPE_1x1,
    });

    expect(placedMachinePathGlyph(placed(0))).toEqual(placedMachinePathGlyph(placed(1)));
  });
});

describe("factory connected transport geometry", () => {
  it("runs every arm from the cell centre to the exact shared boundary", () => {
    expect(factoryTransportArmGeometry((1 << 2) | (1 << 1))).toEqual([
      { side: 1, from: { x: 21, y: 21 }, to: { x: 21, y: 42 } },
      { side: 2, from: { x: 21, y: 21 }, to: { x: 0, y: 21 } },
    ]);
    expect(factoryTransportArmGeometry(0b1111).map((arm) => arm.to)).toEqual([
      { x: 42, y: 21 },
      { x: 21, y: 42 },
      { x: 0, y: 21 },
      { x: 21, y: 0 },
    ]);
  });

  it("keeps animated arrows outside a machine body while reaching its port boundary", () => {
    const intoMachine = factoryTransportFlowPoint(
      { from: { x: 1, y: 1 }, to: { x: 2, y: 1 }, dir: 0 },
      false,
      true,
      0.75,
    );
    const outOfMachine = factoryTransportFlowPoint(
      { from: { x: 2, y: 1 }, to: { x: 3, y: 1 }, dir: 0 },
      true,
      false,
      0.25,
    );

    expect(intoMachine.x).toBeLessThanOrEqual(12 + 2 * 42);
    expect(outOfMachine.x).toBeGreaterThanOrEqual(12 + 3 * 42);
    expect(intoMachine.dir).toBe(0);
    expect(outOfMachine.dir).toBe(0);
  });
});
