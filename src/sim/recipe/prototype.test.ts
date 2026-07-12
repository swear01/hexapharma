import { describe, expect, it } from "vitest";
import type { EffectMap, FactoryTile, Machine, MultiMap, Template } from "../phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  CellKind,
  DEFAULT_CATALOG,
} from "../phase0_interfaces";
import { evaluate, initialState } from "../drug-graph";
import {
  compileEntitledPrototype,
  compilePrototype,
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
