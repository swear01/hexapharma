import { describe, expect, it } from "vitest";
import { CellKind, type EffectMap } from "../sim/phase0_interfaces";
import { revealedRegionEdges } from "./labRegions";

function map(): EffectMap {
  return {
    width: 4,
    height: 3,
    origin: { q: 1, r: 1 },
    start: { q: 1, r: 1 },
    cell: new Uint8Array(12),
    cureId: new Int16Array(12).fill(-1),
    sideEffectId: new Int32Array(12).fill(-1),
    portalTo: new Int32Array(12).fill(-1),
    fog: new Uint8Array(12),
  };
}

describe("Lab hex-region edges", () => {
  it("tests all six axial neighbours in canonical direction order", () => {
    const level = map();
    const center = 1 * level.width + 1;
    const southEast = 2 * level.width + 1;
    level.cell[center] = CellKind.Cure;
    level.cell[southEast] = CellKind.Cure;
    level.cureId[center] = 2;
    level.cureId[southEast] = 2;
    level.fog[center] = 1;
    level.fog[southEast] = 1;

    expect(revealedRegionEdges(level, 1, 1)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
    ]);
  });
});
