import type { EffectMap } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";

export interface RegionEdges {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

function sameRegion(map: EffectMap, x: number, y: number, nx: number, ny: number): boolean {
  if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return false;
  const index = y * map.width + x;
  const neighbor = ny * map.width + nx;
  if (map.fog[index] !== 1 || map.fog[neighbor] !== 1 || map.cell[index] !== map.cell[neighbor]) {
    return false;
  }
  if (map.cell[index] === CellKind.Cure) return map.cureId[index] === map.cureId[neighbor];
  if (map.cell[index] === CellKind.SideEffect) return true;
  return true;
}

export function revealedRegionEdges(map: EffectMap, x: number, y: number): RegionEdges {
  return {
    top: !sameRegion(map, x, y, x, y - 1),
    right: !sameRegion(map, x, y, x + 1, y),
    bottom: !sameRegion(map, x, y, x, y + 1),
    left: !sameRegion(map, x, y, x - 1, y),
  };
}
