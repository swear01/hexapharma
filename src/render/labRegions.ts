import type { EffectMap } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";
import { HEX_DQ, HEX_DR, hexInBounds, hexIndex } from "../sim/hex";
import { portalExitLookup } from "./labTerrain";

export type RegionEdges = readonly [boolean, boolean, boolean, boolean, boolean, boolean];

function sameRegion(map: EffectMap, q: number, r: number, nq: number, nr: number): boolean {
  if (!hexInBounds(map.width, map.height, nq, nr)) return false;
  const index = hexIndex(map.width, q, r);
  const neighbor = hexIndex(map.width, nq, nr);
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

export function revealedRegionEdges(map: EffectMap, q: number, r: number): RegionEdges {
  return HEX_DQ.map((dq, direction) => (
    !sameRegion(map, q, r, q + dq, r + (HEX_DR[direction] ?? 0))
  )) as unknown as RegionEdges;
}
