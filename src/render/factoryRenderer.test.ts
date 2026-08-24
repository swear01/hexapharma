import { describe, expect, it } from "vitest";
import type { PlacedMachine } from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, SHAPE_1x1 } from "../sim/phase0_interfaces";
import {
  FACTORY_MACHINE_SHADOW_ALPHA,
  FACTORY_SCHEMATIC_STYLE,
  factoryTransportArmGeometry,
  factoryTransportFlowPoint,
  machinePathGlyph,
  machineVisualStyle,
  placedMachinePathGlyph,
} from "./factoryRenderer";

describe("factory orbital wet-lab schematic", () => {
  it("shares the atlas semantic colors on a dark industrial deck", () => {
    expect(FACTORY_SCHEMATIC_STYLE).toEqual({
      background: 0x050a12,
      deck: 0x18242b,
      shadow: 0x000000,
      gridLine: 0x35454e,
      belt: 0x40515a,
      beltRail: 0x101920,
      merge: 0x303a3f,
      source: 0x173d45,
      sink: 0x2b3d27,
      chassis: 0x28343b,
      structure: 0xe7e1d2,
      flow: 0x48d7e5,
      selection: 0xf3b45d,
      cure: 0xb8e06c,
      failure: 0xef6862,
      portFrame: 0x19242d,
      portDisconnected: 0x7b858d,
      portInput: 0x48d7e5,
      portOutput: 0xe7e1d2,
      pushBody: 0x2a373f,
      pushFace: 0xbcc6c9,
      push2Body: 0x24323a,
      push2Face: 0xc9d1d1,
      pullBody: 0x303840,
      pullFace: 0xd2d3cd,
      shearBody: 0x34383a,
      shearFace: 0xd8d3c5,
      skewBody: 0x25363c,
      skewFace: 0xc7d5d4,
      diluteBody: 0x293a38,
      diluteFace: 0xcbd8d0,
      settleBody: 0x34333a,
      settleFace: 0xd4ccd3,
      bottleneckBody: 0x3b352a,
      bottleneckFace: 0xddd1b9,
    });
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
