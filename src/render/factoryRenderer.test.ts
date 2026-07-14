import { describe, expect, it } from "vitest";
import type { PlacedMachine } from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, SHAPE_1x1 } from "../sim/phase0_interfaces";
import {
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

  it("draws the complete authored path while identifying the active stroke prefix", () => {
    const path = [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 0, y: -1 },
    ] as const;
    const glyph = machinePathGlyph(path, 2);

    expect(glyph.points).toHaveLength(path.length + 1);
    expect(glyph.activePointCount).toBe(3);
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
        stroke: 2,
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
