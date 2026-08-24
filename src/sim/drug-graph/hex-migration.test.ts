import { describe, expect, it } from "vitest";
import type {
  EffectMap,
  Machine,
  MultiMap,
  PathStamp,
  Template,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import type { HexCoord, HexDir } from "../hex";
import {
  initialState,
  previewStep,
  revealAlong,
  validatePathStamp,
} from "./index";

const E = 0 as HexDir;
const SE = 1 as HexDir;

function emptyMap(width: number, height: number, start: HexCoord): EffectMap {
  const length = width * height;
  return {
    width,
    height,
    origin: start,
    start,
    cell: new Uint8Array(length),
    cureId: new Int16Array(length).fill(-1),
    sideEffectId: new Int32Array(length).fill(-1),
    portalTo: new Int32Array(length).fill(-1),
    fog: new Uint8Array(length),
  };
}

const indexOf = (map: EffectMap, coord: HexCoord): number =>
  coord.r * map.width + coord.q;

function portal(
  map: EffectMap,
  entry: HexCoord,
  exit: HexCoord,
): EffectMap {
  const cell = Uint8Array.from(map.cell);
  const portalTo = Int32Array.from(map.portalTo);
  cell[indexOf(map, entry)] = CellKind.Portal;
  portalTo[indexOf(map, entry)] = indexOf(map, exit);
  return { ...map, cell, portalTo };
}

const machine = (path: PathStamp): Machine => ({ typeId: "hex-stamp", path });
const maps = (...value: EffectMap[]): MultiMap => ({ maps: value });

describe("true-hex drug paths", () => {
  it("accepts exactly the six numeric HexDir values", () => {
    expect(() => validatePathStamp([0, 1, 2, 3, 4, 5])).not.toThrow();
    for (const invalid of [-1, 6, 1.5]) {
      expect(() => validatePathStamp([invalid] as unknown as PathStamp)).toThrow(
        /hex direction.*0.*5/i,
      );
    }
  });

  it.each([
    [0, { q: 3, r: 2 }],
    [1, { q: 2, r: 3 }],
    [2, { q: 1, r: 3 }],
    [3, { q: 1, r: 2 }],
    [4, { q: 2, r: 1 }],
    [5, { q: 3, r: 1 }],
  ] as const)("walks HexDir %s to its axial neighbor", (dir, expected) => {
    const map = emptyMap(5, 5, { q: 2, r: 2 });
    const mm = maps(map);

    const result = previewStep(mm, initialState(mm), machine([dir]));

    expect(result.next).toEqual({ pos: [expected], failed: false });
    expect(result.trails).toEqual([[expected]]);
  });

  it("preserves portal entry, exit, continuation, and fog reveal on axial cells", () => {
    const map = portal(
      emptyMap(7, 5, { q: 1, r: 2 }),
      { q: 2, r: 2 },
      { q: 4, r: 1 },
    );
    const mm = maps(map);
    const stamp = machine([E, SE]);
    const start = initialState(mm);
    const preview = previewStep(mm, start, stamp);

    expect(preview.next).toEqual({ pos: [{ q: 4, r: 2 }], failed: false });
    expect(preview.trails).toEqual([[
      { q: 2, r: 2 },
      { q: 4, r: 1 },
      { q: 4, r: 2 },
    ]]);

    const revealed = revealAlong(mm, start, { steps: [stamp] } satisfies Template);
    expect([
      { q: 2, r: 2 },
      { q: 4, r: 1 },
      { q: 4, r: 2 },
    ].map((coord) => revealed.maps[0]!.fog[indexOf(map, coord)]))
      .toEqual([1, 1, 1]);
  });
});
