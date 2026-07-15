import type { EffectMap } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";
import { portalExitLookup } from "./labTerrain";

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
  const kind = visibleKind(map, index);
  const neighborKind = visibleKind(map, neighbor);
  if (kind !== neighborKind) return false;
  if (kind === CellKind.Cure) return map.cureId[index] === map.cureId[neighbor];
  if (kind === CellKind.Portal) return false;
  return true;
}

function visibleKind(map: EffectMap, index: number): CellKind {
  if ((portalExitLookup(map)[index] ?? -1) >= 0) {
    return map.fog[index] === 1 ? CellKind.Portal : CellKind.Empty;
  }
  const kind = map.cell[index] ?? CellKind.Empty;
  if (map.fog[index] !== 1 && kind !== CellKind.Wall) {
    return CellKind.Empty;
  }
  return kind as CellKind;
}

export function revealedRegionEdges(map: EffectMap, x: number, y: number): RegionEdges {
  return {
    top: !sameRegion(map, x, y, x, y - 1),
    right: !sameRegion(map, x, y, x + 1, y),
    bottom: !sameRegion(map, x, y, x, y + 1),
    left: !sameRegion(map, x, y, x - 1, y),
  };
}
