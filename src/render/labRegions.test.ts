import { describe, expect, it } from "vitest";
import type { EffectMap } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";
import { revealedRegionEdges } from "./labRegions";

function map(): EffectMap {
  return {
    width: 4,
    height: 3,
    origin: { x: 1, y: 1 },
    start: { x: 1, y: 1 },
    cell: new Uint8Array(12),
    cureId: new Int16Array(12).fill(-1),
    sideEffectId: new Int32Array(12).fill(-1),
    portalTo: new Int32Array(12).fill(-1),
    fog: new Uint8Array(12),
  };
}

describe("Lab connected region visuals", () => {
  it("removes internal borders only between revealed cells of the same cure", () => {
    const level = map();
    level.cell[5] = CellKind.Cure;
    level.cell[6] = CellKind.Cure;
    level.cureId[5] = 3;
    level.cureId[6] = 3;
    level.fog[5] = 1;
    level.fog[6] = 1;
    expect(revealedRegionEdges(level, 1, 1).right).toBe(false);
    level.fog[6] = 0;
    expect(revealedRegionEdges(level, 1, 1).right).toBe(true);
  });

  it("does not let hidden cell contents change a revealed region boundary", () => {
    const hiddenCure = map();
    hiddenCure.cell[5] = CellKind.Cure;
    hiddenCure.cell[6] = CellKind.Cure;
    hiddenCure.cureId[5] = 7;
    hiddenCure.cureId[6] = 7;
    hiddenCure.fog[5] = 1;
    const hiddenEmpty = map();
    hiddenEmpty.cell[5] = CellKind.Cure;
    hiddenEmpty.cureId[5] = 7;
    hiddenEmpty.fog[5] = 1;
    expect(revealedRegionEdges(hiddenCure, 1, 1)).toEqual(
      revealedRegionEdges(hiddenEmpty, 1, 1),
    );
  });

  it("joins revealed wall, abyss, swamp, and side-effect biome cells by terrain kind", () => {
    for (const kind of [CellKind.Wall, CellKind.Abyss, CellKind.Swamp, CellKind.SideEffect]) {
      const level = map();
      level.cell[5] = kind;
      level.cell[6] = kind;
      level.fog[5] = 1;
      level.fog[6] = 1;
      expect(revealedRegionEdges(level, 1, 1).right).toBe(false);
    }
  });

  it("keeps adjacent directed portal entries visually discrete", () => {
    const level = map();
    level.cell[5] = CellKind.Portal;
    level.cell[6] = CellKind.Portal;
    level.portalTo[5] = 2;
    level.portalTo[6] = 3;
    level.fog[5] = 1;
    level.fog[6] = 1;
    expect(revealedRegionEdges(level, 1, 1).right).toBe(true);
  });
});
