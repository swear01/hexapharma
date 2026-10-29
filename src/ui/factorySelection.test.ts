import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, type FactoryLayout, type FactoryTile, type PlacedMachine } from "../sim/phase0_interfaces";
import { worldCells } from "../sim/factory-geom";
import {
  boxCells,
  copySelection,
  eraseItems,
  itemCells,
  moveSelection,
  placeFragment,
  rotateSelection,
  transformFragment,
} from "./factorySelection";

const W = 10;
const H = 8;

function floor(): FactoryLayout {
  return { width: W, height: H, tiles: Array.from({ length: W * H }, (): FactoryTile => ({ kind: "empty" })), machines: [] };
}

function withTile(layout: FactoryLayout, q: number, r: number, tile: FactoryTile): FactoryLayout {
  const tiles = layout.tiles.slice();
  tiles[r * layout.width + q] = tile;
  return { ...layout, tiles };
}

function machine(id: number, q: number, r: number): PlacedMachine {
  const entry = DEFAULT_CATALOG[0]!;
  return {
    id,
    def: { typeId: entry.typeId, path: [...entry.path], turn: entry.turn, cost: entry.cost, speed: entry.speed },
    anchor: { q, r },
    footRot: 0,
    shape: DEFAULT_SHAPES[entry.typeId]!,
  };
}

describe("boxCells", () => {
  it("covers exactly the clicked cell", () => {
    expect(boxCells(W, H, { q: 3, r: 2 }, { q: 3, r: 2 })).toEqual([{ q: 3, r: 2 }]);
  });

  it("covers a screen-aligned box, whichever corner the drag starts from", () => {
    const box = boxCells(W, H, { q: 1, r: 0 }, { q: 2, r: 2 });
    expect(box).toEqual(boxCells(W, H, { q: 2, r: 2 }, { q: 1, r: 0 }));
    // Rows 0..2 between screen x of (1,0) and (2,2), padded half a hex.
    expect(box).toEqual([
      { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 },
      { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 }, { q: 3, r: 1 },
      { q: 0, r: 2 }, { q: 1, r: 2 }, { q: 2, r: 2 },
    ]);
  });

  it("clips to the floor", () => {
    expect(boxCells(W, H, { q: 0, r: 0 }, { q: 0, r: 4 }).every((cell) => cell.q >= 0 && cell.q < W)).toBe(true);
  });
});

describe("selection", () => {
  const m = machine(4, 5, 4);
  const layout = withTile({ ...floor(), machines: [m] }, 1, 1, { kind: "belt", dir: 0 });

  it("takes whole machines and built tiles only", () => {
    expect(itemCells(layout, [{ q: 0, r: 0 }])).toEqual([]);
    expect(itemCells(layout, [{ q: 1, r: 1 }])).toEqual([{ q: 1, r: 1 }]);
    const touched = worldCells(m)[0]!;
    expect(itemCells(layout, [touched])).toHaveLength(worldCells(m).length);
  });

  it("erases everything the cells touch and nothing else", () => {
    const erased = eraseItems(layout, [worldCells(m)[0]!]);
    expect(erased.machines).toEqual([]);
    expect(erased.tiles[1 * W + 1]).toEqual({ kind: "belt", dir: 0 });
    expect(eraseItems(layout, [{ q: 0, r: 0 }])).toBe(layout);
  });
});

describe("paste transform", () => {
  const source: FactoryLayout = withTile(
    withTile(floor(), 2, 2, { kind: "source", dir: 0, period: 3, base: 1 }),
    3, 2, { kind: "splitter", inDir: 3, outDirs: [0, 1] },
  );

  it("copies through the Blueprint capture with payloads intact", () => {
    const copied = copySelection(source, [{ q: 2, r: 2 }, { q: 3, r: 2 }]);
    expect(copied?.layout.tiles[2 * W + 2]).toEqual({ kind: "source", dir: 0, period: 3, base: 1 });
    expect(copied?.pivot).toEqual({ q: 3, r: 2 });
    expect(copySelection(source, [{ q: 0, r: 0 }])).toBeNull();
  });

  it("turns positions and directions about the pivot", () => {
    const turned = transformFragment(source, { q: 2, r: 2 }, { q: 5, r: 4 }, 1);
    expect(turned.tiles).toEqual([
      { q: 5, r: 4, tile: { kind: "source", dir: 1, period: 3, base: 1 } },
      { q: 5, r: 5, tile: { kind: "splitter", inDir: 4, outDirs: [1, 2] } },
    ]);
    const back = transformFragment(source, { q: 2, r: 2 }, { q: 2, r: 2 }, 0);
    expect(placeFragment(source, back, true)).toBe(source);
  });

  it("turns a machine footprint the same way as its anchor", () => {
    const m = machine(0, 4, 3);
    const turned = transformFragment({ ...floor(), machines: [m] }, { q: 4, r: 3 }, { q: 4, r: 3 }, 2).machines[0]!;
    expect(turned.footRot).toBe(2);
    expect(turned.anchor).toEqual({ q: 4, r: 3 });
  });

  it("refuses out-of-bounds or blocked placements and numbers pasted machines afresh", () => {
    const fragment = transformFragment({ ...floor(), machines: [machine(0, 4, 3)] }, { q: 4, r: 3 }, { q: 4, r: 3 }, 0);
    const once = placeFragment({ ...floor(), machines: [machine(7, 0, 6)] }, fragment, true);
    expect(once?.machines.map((placed) => placed.id)).toEqual([7, 8]);
    expect(placeFragment(once!, fragment, true)).toBeNull();
    const off = transformFragment({ ...floor(), machines: [machine(0, 4, 3)] }, { q: 4, r: 3 }, { q: W, r: 3 }, 0);
    expect(placeFragment(floor(), off, true)).toBeNull();
  });

  it("moves a selection, keeping machine ids, and reports where it went", () => {
    const layout = withTile({ ...floor(), machines: [machine(3, 2, 4)] }, 1, 1, { kind: "belt", dir: 0 });
    const cells = itemCells(layout, [{ q: 1, r: 1 }, { q: 2, r: 4 }]);
    const moved = moveSelection(layout, cells, { q: 1, r: 1 }, { q: 2, r: 1 }, 0);
    expect(moved.layout?.tiles[1 * W + 2]).toEqual({ kind: "belt", dir: 0 });
    expect(moved.layout?.tiles[1 * W + 1]).toEqual({ kind: "empty" });
    expect(moved.layout?.machines.map((placed) => [placed.id, placed.anchor])).toEqual([[3, { q: 3, r: 4 }]]);
    expect(moved.cells).toHaveLength(cells.length);
    expect(moveSelection(layout, cells, { q: 1, r: 1 }, { q: 1, r: 1 }, 0).layout).toBe(layout);
    expect(moveSelection(layout, cells, { q: 1, r: 1 }, { q: W, r: 1 }, 0).layout).toBeNull();
  });

  it("turns a selection in place about its centre cell, refusing a turn off the floor", () => {
    const layout = withTile(withTile(floor(), 2, 3, { kind: "belt", dir: 0 }), 4, 3, { kind: "belt", dir: 0 });
    const turned = rotateSelection(layout, [{ q: 2, r: 3 }, { q: 4, r: 3 }], 1);
    expect(turned.layout?.tiles.flatMap((tile, index) => tile.kind === "empty" ? [] : [[index % W, Math.floor(index / W), tile]]))
      .toEqual([[3, 2, { kind: "belt", dir: 1 }], [3, 4, { kind: "belt", dir: 1 }]]);
    expect(turned.cells).toEqual([{ q: 3, r: 2 }, { q: 3, r: 4 }]);
    let full = layout;
    let cells = itemCells(layout, [{ q: 2, r: 3 }, { q: 4, r: 3 }]);
    for (let turn = 0; turn < 6; turn++) {
      const next = rotateSelection(full, cells, 1);
      full = next.layout!;
      cells = next.cells;
    }
    expect(full.tiles).toEqual(layout.tiles);
    const edge = withTile(withTile(floor(), 2, 0, { kind: "belt", dir: 0 }), 4, 0, { kind: "belt", dir: 0 });
    expect(rotateSelection(edge, [{ q: 2, r: 0 }, { q: 4, r: 0 }], 1).layout).toBeNull();
  });
});
