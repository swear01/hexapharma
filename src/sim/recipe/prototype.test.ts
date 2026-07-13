import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { EffectMap, FactoryTile, Machine, MultiMap, Template } from "../phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  CellKind,
  DEFAULT_CATALOG,
} from "../phase0_interfaces";
import { evaluate, initialState } from "../drug-graph";
import { generate } from "../mapgen";
import {
  compileEntitledPrototype,
  compilePrototype,
  deriveLinearRoute,
  derivePrototypeTemplate,
  factoryOutcome,
} from ".";

function openMap(width = 32, height = 20): EffectMap {
  const size = width * height;
  return {
    width,
    height,
    origin: { x: 16, y: 10 },
    start: { x: 10, y: 10 },
    cell: new Uint8Array(size),
    cureId: new Int16Array(size).fill(-1),
    sideEffectId: new Int32Array(size).fill(-1),
    fog: new Uint8Array(size).fill(1),
  };
}

function step(typeId: string): Machine {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId)!;
  return {
    typeId: entry.typeId,
    transform: entry.transform,
    orientation: { rot: 0, flip: false },
  };
}

describe("compilePrototype", () => {
  it("describes the immutable physical route in connectivity order", () => {
    const template: Template = { steps: [step("push"), step("pull")] };
    const layout = compilePrototype(template, 22, 10, [
      { anchor: { x: 5, y: 4 }, footRot: 0 },
      { anchor: { x: 12, y: 3 }, footRot: 0 },
    ]);
    const route = deriveLinearRoute({ ...layout, machines: [...layout.machines].reverse() });

    expect(route.machineIds).toEqual([0, 1]);
    expect(route.template).toEqual(template);
    expect(route.nodes.map((node) => node.kind)).toEqual([
      "source",
      "machine",
      "machine",
      "sink",
    ]);
    expect(route.nodes.filter((node) => node.kind === "machine").map((node) => node.machineId))
      .toEqual([0, 1]);
    expect(route.segments).toHaveLength(3);
    for (let index = 0; index < route.segments.length; index++) {
      const segment = route.segments[index]!;
      expect(segment.fromNodeIndex).toBe(index);
      expect(segment.toNodeIndex).toBe(index + 1);
      expect(segment.cells.length).toBeGreaterThanOrEqual(2);
      const from = route.nodes[segment.fromNodeIndex]!;
      const to = route.nodes[segment.toNodeIndex]!;
      const expectedStart = from.kind === "machine" ? from.output.position : from.position;
      const expectedEnd = to.kind === "machine" ? to.input.position : to.position;
      expect(segment.cells[0]).toEqual(expectedStart);
      expect(segment.cells.at(-1)).toEqual(expectedEnd);
      for (let cellIndex = 1; cellIndex < segment.cells.length; cellIndex++) {
        const previous = segment.cells[cellIndex - 1]!;
        const current = segment.cells[cellIndex]!;
        expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(1);
      }
    }

    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.isFrozen(route.machineIds)).toBe(true);
    expect(Object.isFrozen(route.template)).toBe(true);
    expect(Object.isFrozen(route.template.steps)).toBe(true);
    expect(Object.isFrozen(route.nodes)).toBe(true);
    expect(Object.isFrozen(route.nodes[0])).toBe(true);
    expect(Object.isFrozen(route.nodes[0]?.position)).toBe(true);
    expect(Object.isFrozen(route.segments)).toBe(true);
    expect(Object.isFrozen(route.segments[0])).toBe(true);
    expect(Object.isFrozen(route.segments[0]?.cells)).toBe(true);
    expect(Object.isFrozen(route.segments[0]?.cells[0])).toBe(true);
    expect(() => (route.machineIds as number[]).push(99)).toThrow(TypeError);
    expect(() => {
      (route.nodes[0]!.position as { x: number; y: number }).x = 99;
    }).toThrow(TypeError);
  });

  it("rejects every non-linear or ambiguous physical topology", () => {
    const template: Template = { steps: [step("push")] };
    const layout = compilePrototype(template, 18, 9, [
      { anchor: { x: 7, y: 3 }, footRot: 0 },
    ]);
    const withoutSource = layout.tiles.map((tile): FactoryTile =>
      tile.kind === "source" ? { kind: "empty" } : tile);
    expect(() => deriveLinearRoute({ ...layout, tiles: withoutSource })).toThrow(
      /exactly one source/,
    );

    const disconnectedTiles = [...layout.tiles];
    const empty = disconnectedTiles.findIndex((tile, index) =>
      tile.kind === "empty" && index > layout.width);
    disconnectedTiles[empty] = { kind: "belt", dir: 0 };
    expect(() => deriveLinearRoute({ ...layout, tiles: disconnectedTiles })).toThrow(
      /every belt/,
    );

    for (const branch of [
      { kind: "splitter", inDir: 2, outDirs: [0, 1] } as const,
      { kind: "merger", inDirs: [2, 3], outDir: 0 } as const,
    ]) {
      const branchedTiles = [...layout.tiles];
      branchedTiles[empty] = branch;
      expect(() => deriveLinearRoute({ ...layout, tiles: branchedTiles })).toThrow(
        /splitters and mergers/,
      );
    }

    const firstMachine = layout.machines[0]!;
    expect(() => deriveLinearRoute({
      ...layout,
      machines: [firstMachine, { ...firstMachine, id: 99 }],
    })).toThrow(/ambiguous machine input/);

    const cycleTiles: FactoryTile[] = Array.from(
      { length: 5 * 3 },
      (): FactoryTile => ({ kind: "empty" }),
    );
    cycleTiles[5] = { kind: "source", dir: 0, period: 1 };
    cycleTiles[6] = { kind: "belt", dir: 0 };
    cycleTiles[7] = { kind: "belt", dir: 1 };
    cycleTiles[12] = { kind: "belt", dir: 2 };
    cycleTiles[11] = { kind: "belt", dir: 3 };
    cycleTiles[9] = { kind: "sink" };
    expect(() => deriveLinearRoute({
      width: 5,
      height: 3,
      tiles: cycleTiles,
      machines: [],
    })).toThrow(/cycle/);
  });

  it("rejects duplicate machine ids even when connectivity is unambiguous", () => {
    const template: Template = { steps: [step("push"), step("pull")] };
    const layout = compilePrototype(template, 22, 10, [
      { anchor: { x: 5, y: 4 }, footRot: 0 },
      { anchor: { x: 12, y: 3 }, footRot: 0 },
    ]);
    const machines = layout.machines.map((machine) => ({ ...machine, id: 0 }));

    expect(() => deriveLinearRoute({ ...layout, machines })).toThrow(/unique machine id/);
  });

  it("keeps player-owned anchors and produces the same effect as the recipe", () => {
    const map = openMap();
    const cureIndex = 10 * map.width + 13;
    map.cell[cureIndex] = CellKind.Cure;
    map.cureId[cureIndex] = 4;
    const mm: MultiMap = { maps: [map] };
    const template: Template = { steps: [step("push")] };
    const layout = compilePrototype(template, 18, 9, [
      { anchor: { x: 7, y: 3 }, footRot: 0 },
    ]);

    expect(layout.machines[0]?.anchor).toEqual({ x: 7, y: 3 });
    expect(layout.machines[0]?.shape.cells.length).toBe(3);
    expect(derivePrototypeTemplate(layout)).toEqual(template);
    expect(factoryOutcome(layout, mm, initialState(mm))).toEqual(
      evaluate(mm, initialState(mm), template),
    );
  });

  it("derives recipe order from the physical route rather than machine array order", () => {
    const template: Template = { steps: [step("push"), step("pull")] };
    const layout = compilePrototype(template, 22, 10, [
      { anchor: { x: 5, y: 4 }, footRot: 0 },
      { anchor: { x: 12, y: 3 }, footRot: 0 },
    ]);
    const reordered = { ...layout, machines: [...layout.machines].reverse() };
    expect(derivePrototypeTemplate(reordered).steps.map((machine) => machine.typeId)).toEqual([
      "push",
      "pull",
    ]);
  });

  it("rejects disconnected machinery instead of hiding it from the recipe", () => {
    const template: Template = { steps: [step("push")] };
    const layout = compilePrototype(template, 18, 9, [
      { anchor: { x: 7, y: 3 }, footRot: 0 },
    ]);
    const bypassTiles: FactoryTile[] = layout.tiles.map((tile): FactoryTile => tile.kind === "source"
      ? { kind: "source" as const, dir: 0 as const, period: 1 }
      : tile.kind === "sink"
        ? tile
        : { kind: "empty" as const });
    for (let x = 1; x < layout.width - 1; x++) {
      bypassTiles[Math.floor(layout.height / 2) * layout.width + x] = { kind: "belt", dir: 0 };
    }
    expect(() => derivePrototypeTemplate({ ...layout, tiles: bypassTiles })).toThrow(/every placed machine/);
  });

  it("rejects disconnected belt debris instead of accepting hidden topology", () => {
    const template: Template = { steps: [step("push")] };
    const layout = compilePrototype(template, 18, 9, [
      { anchor: { x: 7, y: 3 }, footRot: 0 },
    ]);
    const tiles = [...layout.tiles];
    const empty = tiles.findIndex((tile, index) => tile.kind === "empty" && index > layout.width);
    tiles[empty] = { kind: "belt", dir: 0 };
    expect(() => derivePrototypeTemplate({ ...layout, tiles })).toThrow(/every belt/);
  });

  it("auto-arranges onto the exact shared Lab and Factory entitlement", () => {
    const template: Template = {
      steps: ["push", "skew", "push", "push2", "swap01", "push2", "push2", "push"]
        .map(step),
    };
    const prototype = compileEntitledPrototype(
      template,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    );
    expect(prototype.layout.width).toBe(BASE_GAME_FACTORY_WIDTH);
    expect(prototype.layout.height).toBe(BASE_GAME_FACTORY_HEIGHT);
    expect(derivePrototypeTemplate(prototype.layout)).toEqual(template);
  });

  it("keeps a straight eight-machine prototype compact enough for normal production", () => {
    const template: Template = { steps: Array.from({ length: 8 }, () => step("push")) };
    const { layout } = compileEntitledPrototype(
      template,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    );
    expect(layout.tiles.filter((tile) => tile.kind === "belt")).toHaveLength(6);
    expect(derivePrototypeTemplate(layout)).toEqual(template);
  });

  for (const nMaps of [1, 2, 3, 4]) {
    it(`preserves generated reference recipes on the exact entitlement at ${nMaps} map${nMaps === 1 ? "" : "s"}`, () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
          const level = generate({
            seed,
            nMaps,
            width: 63,
            height: 63,
            catalog: DEFAULT_CATALOG.filter((entry) =>
              ["push", "push2", "pull", "shear"].includes(entry.typeId),
            ),
            diseaseCount: nMaps,
            difficulty: { min: 4, max: 12 },
          });

          for (const disease of level.diseases) {
            const { layout } = compileEntitledPrototype(
              disease.reference,
              BASE_GAME_FACTORY_WIDTH,
              BASE_GAME_FACTORY_HEIGHT,
            );
            expect(layout.width).toBe(BASE_GAME_FACTORY_WIDTH);
            expect(layout.height).toBe(BASE_GAME_FACTORY_HEIGHT);
            expect(derivePrototypeTemplate(layout)).toEqual(disease.reference);
            expect(factoryOutcome(layout, level.mm, level.start)).toEqual(
              evaluate(level.mm, level.start, disease.reference),
            );
          }
        }),
        { numRuns: 12, seed: 0x5eed + nMaps },
      );
    });
  }

  it("rejects colliding placements instead of silently repacking them", () => {
    const template: Template = { steps: [step("push"), step("push")] };
    expect(() => compilePrototype(template, 18, 9, [
      { anchor: { x: 6, y: 3 }, footRot: 0 },
      { anchor: { x: 6, y: 3 }, footRot: 0 },
    ])).toThrow(/overlaps/);
  });

  it("rejects an outward-facing footprint rather than moving it behind the player", () => {
    const template: Template = { steps: [step("push2")] };
    expect(() => compilePrototype(template, 18, 9, [
      { anchor: { x: 16, y: 3 }, footRot: 0 },
    ])).toThrow(/outside/);
  });
});
