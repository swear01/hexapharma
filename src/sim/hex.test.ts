import { describe, expect, it } from "vitest";
import {
  HEX_DIRS,
  HEX_DQ,
  HEX_DR,
  hexDistance,
  hexInBounds,
  hexIndex,
  oppositeHexDir,
  rotateHexCoord,
  type HexDir,
} from "./hex";

describe("pointy-top axial hex authority", () => {
  it("freezes the six clockwise directions E, SE, SW, W, NW, NE", () => {
    expect(HEX_DIRS).toEqual([0, 1, 2, 3, 4, 5]);
    expect(HEX_DQ).toEqual([1, 0, -1, -1, 0, 1]);
    expect(HEX_DR).toEqual([0, 1, 1, 0, -1, -1]);
    expect(Object.isFrozen(HEX_DIRS)).toBe(true);
    expect(Object.isFrozen(HEX_DQ)).toBe(true);
    expect(Object.isFrozen(HEX_DR)).toBe(true);
  });

  it("returns to the same cell after a direction and its opposite", () => {
    for (const dir of HEX_DIRS) {
      const opposite = oppositeHexDir(dir);
      expect({
        q: (HEX_DQ[dir] ?? 0) + (HEX_DQ[opposite] ?? 0),
        r: (HEX_DR[dir] ?? 0) + (HEX_DR[opposite] ?? 0),
      }).toEqual({ q: 0, r: 0 });
    }
  });

  it("rotates E clockwise through all six directions and returns after six turns", () => {
    let cell = { q: 1, r: 0 };
    const expected = [
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
    ];
    for (let turns = 0; turns < 6; turns++) {
      expect(cell).toEqual(expected[turns]);
      cell = rotateHexCoord(cell, 1);
    }
    expect(cell).toEqual({ q: 1, r: 0 });
  });

  it("uses cube distance, giving a radius-two disk exactly nineteen cells", () => {
    let count = 0;
    for (let q = -2; q <= 2; q++) {
      for (let r = -2; r <= 2; r++) {
        if (hexDistance(0, 0, q, r) <= 2) count += 1;
      }
    }
    expect(count).toBe(19);
    expect(hexDistance(0, 0, 2, -1)).toBe(2);
  });

  it("keeps bounded axial parallelograms dense and row-major", () => {
    expect(hexInBounds(4, 3, 3, 2)).toBe(true);
    expect(hexInBounds(4, 3, 4, 2)).toBe(false);
    expect(hexInBounds(4, 3, 3, 3)).toBe(false);
    expect(hexIndex(4, 3, 2)).toBe(11);
  });

  it("keeps direction values closed at compile time", () => {
    const direction: HexDir = 5;
    expect(direction).toBe(5);
  });
});
