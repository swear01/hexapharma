import { describe, expect, it } from "vitest";
import type { FactoryLayout, FactoryTile, PlacedMachine } from "../phase0_interfaces";
import { DEFAULT_CATALOG, DEFAULT_SHAPES } from "../phase0_interfaces";
import { quoteProductionBuild } from ".";

function layout(width = 3, height = 2): FactoryLayout {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, (): FactoryTile => ({ kind: "empty" })),
    machines: [],
  };
}

function withTile(base: FactoryLayout, index: number, tile: FactoryTile): FactoryLayout {
  const tiles = [...base.tiles];
  tiles[index] = tile;
  return { ...base, tiles };
}

function placed(id: number, x: number, y: number, footRot: 0 | 1 | 2 | 3 = 0): PlacedMachine {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === "push")!;
  return {
    id,
    def: {
      typeId: entry.typeId,
      path: entry.path,
      cost: entry.cost,
      speed: entry.speed,
    },
    anchor: { x, y },
    footRot,
    shape: DEFAULT_SHAPES.push!,
  };
}

describe("Production construction quote", () => {
  it("charges only newly installed routing and treats an unchanged layout as free", () => {
    const empty = layout();
    const belt = withTile(empty, 0, { kind: "belt", dir: 0 });

    expect(quoteProductionBuild(empty, empty)).toBe(0);
    expect(quoteProductionBuild(empty, belt)).toBe(2);
    expect(quoteProductionBuild(belt, belt)).toBe(0);
  });

  it("charges the replacement price for direction and routing-kind changes", () => {
    const empty = layout();
    const east = withTile(empty, 0, { kind: "belt", dir: 0 });
    const south = withTile(empty, 0, { kind: "belt", dir: 1 });
    const split = withTile(empty, 0, { kind: "splitter", inDir: 2, outDirs: [0, 1] });

    expect(quoteProductionBuild(east, south)).toBe(2);
    expect(quoteProductionBuild(east, split)).toBe(8);
  });

  it("does not refund removed construction", () => {
    const empty = layout();
    const source = withTile(empty, 0, { kind: "source", dir: 0, period: 1 });
    const sink = withTile(empty, 1, { kind: "sink" });

    expect(quoteProductionBuild(source, empty)).toBe(0);
    expect(quoteProductionBuild(empty, source)).toBe(12);
    expect(quoteProductionBuild(empty, sink)).toBe(6);
  });

  it("adds the price of every changed asset without charging untouched cells", () => {
    const empty = layout();
    const first = withTile(
      withTile(empty, 0, { kind: "belt", dir: 0 }),
      1,
      { kind: "merger", inDirs: [2, 3], outDir: 0 },
    );
    const second = withTile(first, 2, { kind: "source", dir: 0, period: 2 });

    expect(quoteProductionBuild(first, second)).toBe(12);
    expect(quoteProductionBuild(empty, second)).toBe(22);
  });

  it("charges ten times processing cost for a new, moved, or rotated machine", () => {
    const empty = layout(8, 8);
    const installed = { ...empty, machines: [placed(1, 1, 1)] };
    const moved = { ...empty, machines: [placed(1, 3, 1)] };
    const rotated = { ...empty, machines: [placed(1, 1, 1, 1)] };
    const price = DEFAULT_CATALOG.find((candidate) => candidate.typeId === "push")!.cost * 10;

    expect(quoteProductionBuild(empty, installed)).toBe(price);
    expect(quoteProductionBuild(installed, moved)).toBe(price);
    expect(quoteProductionBuild(installed, rotated)).toBe(price);
    expect(quoteProductionBuild(installed, empty)).toBe(0);
  });

  it("does not charge when only a machine id changes", () => {
    const empty = layout(8, 8);
    const before = { ...empty, machines: [placed(1, 1, 1)] };
    const after = { ...empty, machines: [placed(99, 1, 1)] };

    expect(quoteProductionBuild(before, after)).toBe(0);
  });
});
