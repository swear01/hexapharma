import { describe, expect, it } from "vitest";
import type { PlacedMachine } from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, SHAPE_1x1 } from "../sim/phase0_interfaces";
import { HEX_DIRS, HEX_DQ, HEX_DR } from "../sim/hex";
import { hexToPixel } from "./hexProjection";
import {
  FACTORY_HEX_SIZE,
  FACTORY_MACHINE_SHADOW_ALPHA,
  FACTORY_SCHEMATIC_STYLE,
  factoryCellCenter,
  factoryTransportArmGeometry,
  factoryTransportFlowPoint,
  machinePathGlyph,
  machineVisualStyle,
  placedMachinePathGlyph,
} from "./factoryRenderer";

describe("flat factory schematic", () => {
  it("shares the atlas semantic colors on a dark industrial deck", () => {
    expect(FACTORY_SCHEMATIC_STYLE.portInput).toBe(FACTORY_SCHEMATIC_STYLE.flow);
    expect(FACTORY_SCHEMATIC_STYLE.portOutput).toBe(FACTORY_SCHEMATIC_STYLE.structure);
    expect(FACTORY_SCHEMATIC_STYLE.selection).not.toBe(FACTORY_SCHEMATIC_STYLE.flow);;
  });

  it("keeps machine shadows subordinate to the chassis", () => {
    expect(FACTORY_SCHEMATIC_STYLE.shadow).not.toBe(FACTORY_SCHEMATIC_STYLE.background);
    expect(FACTORY_MACHINE_SHADOW_ALPHA).toBe(0.28);
  });
});

describe("factory machine visual language", () => {
  it("gives every machine family a distinct bounded chassis palette", () => {
    const styles = DEFAULT_CATALOG.map((entry) => machineVisualStyle(entry.typeId));
    const signatures = styles.map((style) => `${style.body}:${style.face}`);

    expect(new Set(signatures).size).toBe(DEFAULT_CATALOG.length);
    for (const style of styles) {
      expect(style).not.toHaveProperty("accent");
      expect(style.body).toBeGreaterThanOrEqual(0);
      expect(style.body).toBeLessThanOrEqual(0xffffff);
      expect(style.face).toBeGreaterThanOrEqual(0);
      expect(style.face).toBeLessThanOrEqual(0xffffff);
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
    const path = [0, 1, 3, 4] as const;
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
      anchor: { q: 1, r: 1 },
      footRot,
      shape: SHAPE_1x1,
    });

    expect(placedMachinePathGlyph(placed(0))).toEqual(placedMachinePathGlyph(placed(1)));
  });
});

describe("factory connected transport geometry", () => {
  it("runs every arm from the cell centre to the exact shared boundary", () => {
    const arms = factoryTransportArmGeometry(0b111111);
    expect(arms.map((arm) => arm.side)).toEqual(HEX_DIRS);
    for (const arm of arms) {
      const neighbor = hexToPixel(HEX_DQ[arm.side]!, HEX_DR[arm.side]!, FACTORY_HEX_SIZE);
      expect(arm.to.x - arm.from.x).toBeCloseTo(neighbor.x / 2);
      expect(arm.to.y - arm.from.y).toBeCloseTo(neighbor.y / 2);
    }
  });

  it("keeps animated arrows outside a machine body while reaching its port boundary", () => {
    const intoMachine = factoryTransportFlowPoint(
      { from: { q: 1, r: 1 }, to: { q: 2, r: 1 }, dir: 0 },
      false,
      true,
      0.75,
    );
    const outOfMachine = factoryTransportFlowPoint(
      { from: { q: 2, r: 1 }, to: { q: 3, r: 1 }, dir: 0 },
      true,
      false,
      0.25,
    );

    expect(intoMachine.x).toBeLessThanOrEqual(
      (factoryCellCenter(1, 1).x + factoryCellCenter(2, 1).x) / 2,
    );
    expect(outOfMachine.x).toBeGreaterThanOrEqual(
      (factoryCellCenter(2, 1).x + factoryCellCenter(3, 1).x) / 2,
    );
    expect(intoMachine.dir).toBe(0);
    expect(outOfMachine.dir).toBe(0);
  });
});
