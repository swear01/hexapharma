import { describe, expect, it } from "vitest";
import type { EffectMap } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";
import { labTerrainVisual, portalExitLookup } from "./labTerrain";

function map(): EffectMap {
  const width = 7;
  const height = 3;
  const length = width * height;
  return {
    width,
    height,
    origin: { x: 3, y: 1 },
    start: { x: 3, y: 1 },
    cell: new Uint8Array(length),
    cureId: new Int16Array(length).fill(-1),
    sideEffectId: new Int32Array(length).fill(-1),
    portalTo: new Int32Array(length).fill(-1),
    fog: new Uint8Array(length),
  };
}

describe("Lab terrain visual language", () => {
  it("keeps only walls readable before discovery", () => {
    const level = map();
    const terrain = [CellKind.Wall, CellKind.Abyss, CellKind.Swamp, CellKind.Portal] as const;
    for (let index = 0; index < terrain.length; index++) {
      level.cell[index] = terrain[index]!;
    }
    level.portalTo[3] = 6;

    expect(labTerrainVisual(level, 0, 0)).toMatchObject({
      kind: "wall",
      motif: "solid-masonry",
      opaque: true,
    });
    const empty = labTerrainVisual(level, 4, 0);
    expect(labTerrainVisual(level, 1, 0)).toEqual(empty);
    expect(labTerrainVisual(level, 2, 0)).toEqual(empty);
    expect(labTerrainVisual(level, 3, 0)).toEqual(empty);
    expect(labTerrainVisual(level, 6, 0)).toEqual(empty);

    level.fog[1] = 1;
    level.fog[2] = 1;
    level.fog[3] = 1;
    level.fog[6] = 1;
    expect(labTerrainVisual(level, 1, 0)).toMatchObject({
      kind: "abyss",
      motif: "void-rim",
      opaque: true,
    });
    expect(labTerrainVisual(level, 2, 0)).toMatchObject({
      kind: "swamp",
      motif: "viscous-drag",
      opaque: true,
    });
    expect(labTerrainVisual(level, 3, 0)).toMatchObject({
      kind: "portal",
      motif: "paired-directional",
      role: "entry",
      pairMarker: "P3-6",
      destination: { x: 6, y: 0 },
      direction: { x: 1, y: 0 },
    });
    expect(labTerrainVisual(level, 6, 0)).toMatchObject({
      kind: "portal",
      role: "exit",
      pairMarker: "P3-6",
      direction: { x: 1, y: 0 },
    });
  });

  it("gives undiscovered effects the same render plan as empty substrate", () => {
    const level = map();
    level.cell[1] = CellKind.Cure;
    level.cureId[1] = 4;
    level.cell[2] = CellKind.SideEffect;
    level.sideEffectId[2] = 9;

    const empty = labTerrainVisual(level, 0, 0);
    expect(labTerrainVisual(level, 1, 0)).toEqual(empty);
    expect(labTerrainVisual(level, 2, 0)).toEqual(empty);

    level.fog[1] = 1;
    level.fog[2] = 1;
    expect(labTerrainVisual(level, 1, 0)).toMatchObject({ kind: "cure", motif: "cure-receptor" });
    expect(labTerrainVisual(level, 2, 0)).toMatchObject({
      kind: "sideEffect",
      motif: "side-effect-colony",
    });
  });

  it("reveals portal pairing and direction only after discovering each endpoint", () => {
    const level = map();
    const left = 1 * level.width + 1;
    const right = 1 * level.width + 5;
    level.cell[left] = CellKind.Portal;
    level.portalTo[left] = right;

    const empty = labTerrainVisual(level, 0, 0);
    expect(labTerrainVisual(level, 1, 1)).toEqual(empty);
    expect(labTerrainVisual(level, 5, 1)).toEqual(empty);

    level.fog[left] = 1;
    const revealedEntry = labTerrainVisual(level, 1, 1);
    expect(labTerrainVisual(level, 5, 1)).toEqual(empty);
    level.fog[right] = 1;
    const revealedExit = labTerrainVisual(level, 5, 1);

    expect(revealedEntry).toMatchObject({
      kind: "portal",
      role: "entry",
      pairMarker: `P${left}-${right}`,
      destination: { x: 5, y: 1 },
      direction: { x: 1, y: 0 },
    });
    expect(revealedExit).toMatchObject({
      kind: "portal",
      role: "exit",
      pairMarker: `P${left}-${right}`,
      destination: { x: 5, y: 1 },
      direction: { x: 1, y: 0 },
    });
  });

  it("builds the portal exit index once per immutable portal table", () => {
    const level = map();
    level.portalTo[2] = 18;

    const first = portalExitLookup(level);
    const second = portalExitLookup({ ...level, fog: Uint8Array.from(level.fog) });

    expect(first).toBe(second);
    expect(first[18]).toBe(2);
    expect(first[2]).toBe(-1);
  });
});
