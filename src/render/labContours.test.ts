import { describe, expect, it } from "vitest";
import type { EffectMap } from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { hexToPixel } from "./hexProjection";
import { contourField, elevationAt } from "./labContours";

const SIZE = 20;

function level(): EffectMap {
  return generate({
    seed: 14,
    nMaps: 1,
    width: 49,
    height: 49,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 4,
    difficulty: { min: 4, max: 12 },
  }).mm.maps[0]!;
}

describe("Lab relief contours", () => {
  it("draw a mountain and an equally deep lake identically (sign-free field)", () => {
    const map = level();
    const negated = { ...map, elevation: Int16Array.from(map.elevation, (value) => -value) };
    const centre = hexToPixel(24, 24, SIZE);
    for (let step = 0; step < 200; step++) {
      const x = centre.x - 450 + ((step * 97) % 900);
      const y = centre.y - 400 + ((step * 61) % 800);
      expect(contourField(negated, x, y, SIZE)).toBeCloseTo(contourField(map, x, y, SIZE), 12);
    }
  });

  it("never reads fog, cells or effects: only the relief", () => {
    const map = level();
    const fogged = { ...map, fog: new Uint8Array(map.fog.length).fill(1), cell: new Uint8Array(map.cell.length) };
    expect(contourField(fogged, 500, 400, SIZE)).toBe(contourField(map, 500, 400, SIZE));
  });

  it("interpolates smoothly between cell centres", () => {
    const map = level();
    const a = hexToPixel(24, 24, SIZE);
    const b = hexToPixel(25, 24, SIZE);
    let previous = elevationAt(map, a.x, a.y, SIZE);
    for (let step = 1; step <= 20; step++) {
      const t = step / 20;
      const value = elevationAt(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, SIZE);
      expect(Math.abs(value - previous)).toBeLessThan(0.25);
      previous = value;
    }
  });
});
