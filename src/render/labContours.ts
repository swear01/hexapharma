import type { EffectMap } from "../sim/phase0_interfaces";
import { ELEVATION_ONE } from "../sim/mapgen";
import { hexToPixel, pixelToHex } from "./hexProjection";

/**
 * Fog contours (docs/design.md, Visual language): the generated relief, made sign-free and
 * compressed, `1 − exp(−k·|e|)`, plus low seeded decoys, so mountains and water draw the same
 * rings. One ink, no index lines. Renderer-only floats; the sim field is integer.
 */
export const CONTOUR_COMPRESSION = 1.25;
export const CONTOUR_DECOY_STRENGTH = 1;
export const CONTOUR_LEVELS: readonly number[] = Object.freeze([0.16, 0.34, 0.52, 0.7, 0.88]);
/** Relief assumed past the board edge (the mountain rim continues). */
const OFF_BOARD_ELEVATION = 1.4;
const KERNEL_REACH = 2;
const KERNEL_RADIUS = 1.5;

const decoySeeds = new WeakMap<Int16Array, number>();

/** Decoys are seeded from |relief| so the drawing stays sign-free like the field itself. */
function decoySeed(map: EffectMap): number {
  let seed = decoySeeds.get(map.elevation);
  if (seed === undefined) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < map.elevation.length; index += 7) {
      hash = Math.imul(hash ^ Math.abs(map.elevation[index]!), 0x01000193) >>> 0;
    }
    seed = hash;
    decoySeeds.set(map.elevation, seed);
  }
  return seed;
}

function cellElevation(map: EffectMap, q: number, r: number): number {
  if (q < 0 || r < 0 || q >= map.width || r >= map.height) return OFF_BOARD_ELEVATION;
  return (map.elevation[r * map.width + q] ?? 0) / ELEVATION_ONE;
}

/** Smoothly interpolated elevation at world pixel (x, y) for hexes of `size` (C1 kernel over 19 cells). */
export function elevationAt(map: EffectMap, x: number, y: number, size: number): number {
  const centre = pixelToHex(x, y, size);
  const spacing = Math.sqrt(3) * size;
  const radius2 = (KERNEL_RADIUS * spacing) ** 2;
  let sum = 0;
  let weight = 0;
  for (let dr = -KERNEL_REACH; dr <= KERNEL_REACH; dr++) {
    for (let dq = -KERNEL_REACH; dq <= KERNEL_REACH; dq++) {
      if (Math.abs(dq + dr) > KERNEL_REACH) continue;
      const q = centre.q + dq;
      const r = centre.r + dr;
      const p = hexToPixel(q, r, size);
      const d2 = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d2 >= radius2) continue;
      const w = (1 - d2 / radius2) ** 2;
      sum += w * cellElevation(map, q, r);
      weight += w;
    }
  }
  return weight === 0 ? 0 : sum / weight;
}

/** Display field drawn as contours: compressed |relief| plus seeded decoy swells. */
export function contourField(map: EffectMap, x: number, y: number, size: number): number {
  const seed = decoySeed(map);
  const a = ((seed & 0xff) / 255) * Math.PI * 2;
  const b = (((seed >>> 8) & 0xff) / 255) * Math.PI * 2;
  const c = (((seed >>> 16) & 0xff) / 255) * Math.PI * 2;
  const u = x / size;
  const v = y / size;
  const decoy = 0.22 * Math.sin(u * 0.42 + a) * Math.sin(v * 0.37 + b) + 0.14 * Math.sin((u + 2 * v) * 0.29 + c);
  const e = elevationAt(map, x, y, size);
  return 1 - Math.exp(-CONTOUR_COMPRESSION * Math.abs(e)) + CONTOUR_DECOY_STRENGTH * decoy;
}
