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
  it("assigns unmistakable, non-interchangeable motifs to blocking terrain", () => {
    const level = map();
    const terrain = [CellKind.Wall, CellKind.Abyss, CellKind.Swamp] as const;
    for (let index = 0; index < terrain.length; index++) {
      level.cell[index] = terrain[index]!;
      level.fog[index] = 1;
    }

    expect(labTerrainVisual(level, 0, 0)).toMatchObject({
      kind: "wall",
      motif: "solid-masonry",
      opaque: true,
    });
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
  });

  it("returns only opaque fog for hidden terrain regardless of its true kind", () => {
    const wall = map();
    wall.cell[0] = CellKind.Wall;
    const portal = map();
    portal.cell[0] = CellKind.Portal;
    portal.portalTo[0] = 6;

    expect(labTerrainVisual(wall, 0, 0)).toEqual({ kind: "fog", opaque: true });
    expect(labTerrainVisual(portal, 0, 0)).toEqual({ kind: "fog", opaque: true });
  });

  it("renders a directed entry and reverse-looked-up exit without leaking a fogged pair", () => {
    const level = map();
    const left = 1 * level.width + 1;
    const right = 1 * level.width + 5;
    level.cell[left] = CellKind.Portal;
    level.portalTo[left] = right;
    level.fog[left] = 1;

    expect(labTerrainVisual(level, 1, 1)).toMatchObject({
      kind: "portal",
      motif: "paired-directional",
      role: "entry",
      pairMarker: null,
      destination: null,
      direction: null,
    });
    expect(labTerrainVisual(level, 5, 1)).toEqual({ kind: "fog", opaque: true });

    level.fog[right] = 1;
    const entry = labTerrainVisual(level, 1, 1);
    const exit = labTerrainVisual(level, 5, 1);
    expect(entry).toMatchObject({
      role: "entry",
      pairMarker: `P${left}-${right}`,
      destination: { x: 5, y: 1 },
      direction: { x: 1, y: 0 },
    });
    expect(exit).toMatchObject({
      kind: "portal",
      role: "exit",
      pairMarker: `P${left}-${right}`,
      destination: { x: 5, y: 1 },
      direction: { x: 1, y: 0 },
    });
    expect(entry.kind === "portal" && exit.kind === "portal" && entry.pairMarker).toBe(
      exit.kind === "portal" ? exit.pairMarker : "",
    );
  });

  it("does not disclose pair identity or direction until both endpoints are revealed", () => {
    const level = map();
    const entryIndex = 1 * level.width + 1;
    const exitIndex = 1 * level.width + 5;
    level.cell[entryIndex] = CellKind.Portal;
    level.portalTo[entryIndex] = exitIndex;
    level.fog[exitIndex] = 1;

    expect(labTerrainVisual(level, 5, 1)).toMatchObject({
      kind: "portal",
      role: "exit",
      pairMarker: null,
      destination: null,
      direction: null,
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
