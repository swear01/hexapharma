import { describe, expect, it } from "vitest";
import {
  hexBoardBounds,
  hexLine,
  hexPolygon,
  hexToPixel,
  pixelToHex,
} from "./hexProjection";
import { hexDistance } from "../sim/hex";

describe("pointy-top hex projection", () => {
  it("round-trips every center in a bounded axial board", () => {
    for (let r = 0; r < 8; r++) {
      for (let q = 0; q < 12; q++) {
        const point = hexToPixel(q, r, 24);
        expect(pixelToHex(point.x, point.y, 24)).toEqual({ q, r });
      }
    }
  });

  it("places E horizontally and SE down-right", () => {
    const origin = hexToPixel(0, 0, 20);
    const east = hexToPixel(1, 0, 20);
    const southEast = hexToPixel(0, 1, 20);
    expect(east.y).toBeCloseTo(origin.y);
    expect(east.x).toBeGreaterThan(origin.x);
    expect(southEast.x).toBeGreaterThan(origin.x);
    expect(southEast.y).toBeGreaterThan(origin.y);
  });

  it("returns six pointy-top polygon vertices", () => {
    const vertices = hexPolygon(10, 20, 8);
    expect(vertices).toHaveLength(6);
    expect(vertices[0]).toEqual({ x: 10, y: 12 });
    expect(vertices[3]).toEqual({ x: 10, y: 28 });
  });

  it("bounds every complete cell in an axial parallelogram", () => {
    const bounds = hexBoardBounds(4, 3, 10);
    for (let r = 0; r < 3; r++) {
      for (let q = 0; q < 4; q++) {
        for (const vertex of hexPolygon(...Object.values(hexToPixel(q, r, 10)) as [number, number], 10)) {
          expect(vertex.x).toBeGreaterThanOrEqual(bounds.minX);
          expect(vertex.x).toBeLessThanOrEqual(bounds.maxX);
          expect(vertex.y).toBeGreaterThanOrEqual(bounds.minY);
          expect(vertex.y).toBeLessThanOrEqual(bounds.maxY);
        }
      }
    }
  });

  it("fills fast pointer samples with a contiguous deterministic hex line", () => {
    const line = hexLine({ q: 0, r: 0 }, { q: 5, r: 3 });
    expect(line[0]).toEqual({ q: 0, r: 0 });
    expect(line.at(-1)).toEqual({ q: 5, r: 3 });
    for (let index = 1; index < line.length; index++) {
      const before = line[index - 1]!;
      const after = line[index]!;
      expect(hexDistance(before.q, before.r, after.q, after.r)).toBe(1);
    }
    expect(new Set(line.map(({ q, r }) => `${q},${r}`)).size).toBe(line.length);
  });
});
