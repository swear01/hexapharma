import { describe, expect, it } from "vitest";
import type { FactoryLayout, PlacedMachine, Rotation } from "../sim/phase0_interfaces";
import { buildFactoryTransportTopology } from "./factoryTransportTopology";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, SHAPE_1x1 } from "../sim/phase0_interfaces";
import { HEX_DIRS, HEX_DQ, HEX_DR } from "../sim/hex";
import { hexToPixel } from "./hexProjection";
import {
  FACTORY_HEX_SIZE,
  FACTORY_SCHEMATIC_STYLE,
  dashSegments,
  factoryCellCenter,
  factoryPrintStyle,
  factoryUnitBlocked,
  factoryTransportArmGeometry,
  factoryTransportFlowPoint,
  machineIconCell,
  machinePathGlyph,
  placedMachinePathGlyph,
} from "./factoryRenderer";
import { worldCells } from "../sim/factory-geom";

describe("printed factory map", () => {
  it("prints Plan as a dashed purple overprint and Production as solid black print", () => {
    const plan = factoryPrintStyle("plan");
    const production = factoryPrintStyle("production");
    expect(plan.ink).toBe(FACTORY_SCHEMATIC_STYLE.course);
    expect(plan.channel).toBe(FACTORY_SCHEMATIC_STYLE.course);
    expect(plan.dashed).toBe(true);
    expect(plan.inkAlpha).toBeLessThan(1);
    expect(production.ink).toBe(FACTORY_SCHEMATIC_STYLE.structure);
    expect(production.channel).toBe(FACTORY_SCHEMATIC_STYLE.flow);
    expect(production.dashed).toBe(false);
  });

  it("keeps hand-drawn wobble within 0.6px and off the Plan overprint", () => {
    expect(factoryPrintStyle("production").wobble).toBeLessThanOrEqual(0.6);
    expect(factoryPrintStyle("plan").wobble).toBe(0);
  });

  it("splits dashed outlines into dashes that start and end exactly on the edge", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 21, y: 0 };
    const dashes = dashSegments(from, to);
    expect(dashes.length).toBeGreaterThan(1);
    expect(dashes[0]!.from).toEqual(from);
    expect(dashes.at(-1)!.to.x).toBeCloseTo(to.x);
    for (let index = 1; index < dashes.length; index++) {
      expect(dashes[index]!.from.x).toBeGreaterThan(dashes[index - 1]!.to.x);
    }
  });
});

describe("factory machine visual language", () => {
  it("identifies every machine family by its own printed Atlas path", () => {
    const glyphs = DEFAULT_CATALOG.map((entry) => JSON.stringify(machinePathGlyph(entry.path).points));
    expect(new Set(glyphs).size).toBe(DEFAULT_CATALOG.length);
  });

  it("has one canonical footprint for every current path machine and no obsolete family", () => {
    const catalogIds = DEFAULT_CATALOG.map((entry) => entry.typeId).sort();
    expect(Object.keys(DEFAULT_SHAPES).sort()).toEqual(catalogIds);
    expect(DEFAULT_SHAPES.crane?.cells).toHaveLength(7);
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

  it("turns the icon with its footprint", () => {
    const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === "straight")!;
    const placed = (footRot: Rotation): PlacedMachine => ({
      id: 0,
      def: { typeId: entry.typeId, path: entry.path, turn: entry.turn, cost: entry.cost, speed: entry.speed },
      anchor: { q: 1, r: 1 },
      footRot,
      shape: SHAPE_1x1,
    });
    const upright = placedMachinePathGlyph(placed(0)).points;
    const turned = placedMachinePathGlyph(placed(1)).points;
    for (let index = 0; index < upright.length; index++) {
      const angle = Math.PI / 3;
      expect(turned[index]!.x).toBeCloseTo(upright[index]!.x * Math.cos(angle) - upright[index]!.y * Math.sin(angle));
      expect(turned[index]!.y).toBeCloseTo(upright[index]!.x * Math.sin(angle) + upright[index]!.y * Math.cos(angle));
    }
  });

  it("keeps every machine icon inside one of its own cells at every rotation", () => {
    // Inradius of a hex minus the end circle (r 3) and half its stroke.
    const limit = Math.sqrt(3) * FACTORY_HEX_SIZE / 2 - 3.8;
    for (const entry of DEFAULT_CATALOG) {
      for (const footRot of [0, 1, 2, 3, 4, 5] as const) {
        const machine: PlacedMachine = {
          id: 0,
          def: { typeId: entry.typeId, path: entry.path, turn: entry.turn, cost: entry.cost, speed: entry.speed },
          anchor: { q: 6, r: 6 },
          footRot,
          shape: DEFAULT_SHAPES[entry.typeId]!,
        };
        const cell = machineIconCell(machine);
        expect(worldCells(machine)).toContainEqual(cell);
        for (const point of placedMachinePathGlyph(machine).points) {
          expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(limit);
        }
      }
    }
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

describe("factory blocked units", () => {
  const emptyTiles = (width: number, height: number) =>
    Array.from({ length: width * height }, () => ({ kind: "empty" as const }));

  it("marks a unit on a belt that leads nowhere as blocked, but not one on a connected belt", () => {
    const tiles: FactoryLayout["tiles"][number][] = emptyTiles(4, 1);
    tiles[0] = { kind: "source", dir: 0, period: 1, base: 0 };
    tiles[1] = { kind: "belt", dir: 0 };
    tiles[2] = { kind: "belt", dir: 0 };
    const layout: FactoryLayout = { width: 4, height: 1, tiles, machines: [] };
    const topology = buildFactoryTransportTopology(layout);
    expect(factoryUnitBlocked(layout, topology, { q: 2, r: 0, machineId: -1, proc: 0 })).toBe(true);
    expect(factoryUnitBlocked(layout, topology, { q: 1, r: 0, machineId: -1, proc: 0 })).toBe(false);
  });

  it("marks a finished unit inside a machine with no output belt as blocked", () => {
    const entry = DEFAULT_CATALOG[0]!;
    const machine: PlacedMachine = {
      id: 3,
      def: { typeId: entry.typeId, path: entry.path, turn: entry.turn, cost: entry.cost, speed: entry.speed },
      anchor: { q: 2, r: 2 },
      footRot: 0,
      shape: SHAPE_1x1,
    };
    const layout: FactoryLayout = { width: 5, height: 5, tiles: emptyTiles(5, 5), machines: [machine] };
    const topology = buildFactoryTransportTopology(layout);
    expect(factoryUnitBlocked(layout, topology, { q: 2, r: 2, machineId: 3, proc: entry.speed })).toBe(true);
    expect(factoryUnitBlocked(layout, topology, { q: 2, r: 2, machineId: 3, proc: 0 })).toBe(false);
  });
});
