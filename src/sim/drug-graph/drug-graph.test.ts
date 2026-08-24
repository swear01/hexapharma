import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  EffectMap,
  HexCoord,
  HexDir,
  Machine,
  MultiMap,
  PathStamp,
  Template,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
import { HEX_DIRS, HEX_DQ, HEX_DR, oppositeHexDir } from "../hex";
import {
  applyStep,
  applyTemplate,
  evaluate,
  initialState,
  previewStep,
  revealAlong,
  validateEffectMap,
  validateMachinePath,
  validatePathStamp,
  walkPathInto,
  walkValidatedPathInto,
} from "./index";

const indexOf = (map: EffectMap, q: number, r: number): number => r * map.width + q;

function emptyMap(
  width: number,
  height: number,
  start: HexCoord,
  origin: HexCoord = { q: 0, r: 0 },
): EffectMap {
  const length = width * height;
  return {
    width,
    height,
    origin,
    start,
    cell: new Uint8Array(length),
    cureId: new Int16Array(length).fill(-1),
    sideEffectId: new Int32Array(length).fill(-1),
    portalTo: new Int32Array(length).fill(-1),
    fog: new Uint8Array(length),
  };
}

function withCell(
  map: EffectMap,
  q: number,
  r: number,
  kind: number,
  options: { readonly cureId?: number; readonly sideEffectId?: number; readonly portalTo?: HexCoord } = {},
): EffectMap {
  const cell = Uint8Array.from(map.cell);
  const cureId = Int16Array.from(map.cureId);
  const sideEffectId = Int32Array.from(map.sideEffectId);
  const portalTo = Int32Array.from(map.portalTo);
  const index = indexOf(map, q, r);
  cell[index] = kind;
  if (options.cureId !== undefined) cureId[index] = options.cureId;
  if (options.sideEffectId !== undefined) sideEffectId[index] = options.sideEffectId;
  if (options.portalTo !== undefined) {
    portalTo[index] = indexOf(map, options.portalTo.q, options.portalTo.r);
  }
  return { ...map, cell, cureId, sideEffectId, portalTo };
}

const machine = (path: PathStamp): Machine => ({
  typeId: "test-stamp",
  path,
});
const template = (...steps: Machine[]): Template => ({ steps });
const multiMap = (...maps: EffectMap[]): MultiMap => ({ maps });
const east: HexDir = 0;
const south: HexDir = 1;
const west: HexDir = 3;
const north: HexDir = 4;

describe("path contract validation", () => {
  it("accepts a non-empty six-neighbor full path", () => {
    const path = [east, south, west, north] as const;
    expect(() => validatePathStamp(path)).not.toThrow();
    expect(() => validateMachinePath(machine(path))).not.toThrow();
  });

  it("rejects an empty path", () => {
    expect(() => validatePathStamp([])).toThrow(/non-empty/i);
  });

  it.each([-1, 6, 1.5])("rejects invalid HexDir %s", (dir) => {
    expect(() => validatePathStamp([dir] as unknown as PathStamp)).toThrow(/hex direction/i);
  });

  it("accepts all generated six-neighbor full paths", () => {
    const direction = fc.constantFrom(...HEX_DIRS);
    fc.assert(
      fc.property(fc.array(direction, { minLength: 1, maxLength: 64 }), (path) => {
        expect(() => validateMachinePath(machine(path))).not.toThrow();
      }),
    );
  });

  it("ships seven distinct, immutable, non-straight catalog stamps", () => {
    const serialized = new Set<string>();
    expect(DEFAULT_CATALOG).toHaveLength(7);
    expect(Object.isFrozen(DEFAULT_CATALOG)).toBe(true);

    for (const entry of DEFAULT_CATALOG) {
      expect(() => validatePathStamp(entry.path)).not.toThrow();
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.path)).toBe(true);
      expect(new Set(entry.path).size).toBeGreaterThan(1);
      serialized.add(JSON.stringify(entry.path));
    }

    expect(serialized.size).toBe(DEFAULT_CATALOG.length);
  });

  it("includes a self-intersecting loop, a reversal, and an alternating zigzag", () => {
    const visitsSamePositionTwice = (path: PathStamp): boolean => {
      let q = 0;
      let r = 0;
      const visited = new Set(["0,0"]);
      for (const dir of path) {
        q += HEX_DQ[dir]!;
        r += HEX_DR[dir]!;
        const key = `${q},${r}`;
        if (visited.has(key)) return true;
        visited.add(key);
      }
      return false;
    };
    const containsOppositeDirections = (path: PathStamp): boolean =>
      path.some((left) => path.includes(oppositeHexDir(left)));
    const changesDirectionEveryStep = (path: PathStamp): boolean =>
      path.length >= 4 &&
      path.every((dir, index) => index === 0 || dir !== path[index - 1]);

    expect(DEFAULT_CATALOG.some((entry) => visitsSamePositionTwice(entry.path))).toBe(true);
    expect(DEFAULT_CATALOG.some((entry) => containsOppositeDirections(entry.path))).toBe(true);
    expect(DEFAULT_CATALOG.some((entry) => changesDirectionEveryStep(entry.path))).toBe(true);
  });
});

describe("portal destination validation", () => {
  it("accepts an in-bounds same-map portal destination", () => {
    const map = withCell(emptyMap(5, 3, { q: 0, r: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { q: 4, r: 1 },
    });
    expect(() => validateEffectMap(map)).not.toThrow();
  });

  it("requires portalTo to be authoritative for every cell", () => {
    const base = emptyMap(3, 3, { q: 0, r: 0 });
    expect(() => validateEffectMap({ ...base, portalTo: new Int32Array(8) })).toThrow(
      /portalTo.*length/i,
    );

    const stray = Int32Array.from(base.portalTo);
    stray[0] = 1;
    expect(() => validateEffectMap({ ...base, portalTo: stray })).toThrow(/non-portal.*-1/i);
  });

  it.each([-1, 9, 100])("rejects illegal portal destination %s", (destination) => {
    const base = withCell(emptyMap(3, 3, { q: 0, r: 0 }), 1, 1, CellKind.Portal);
    const portalTo = Int32Array.from(base.portalTo);
    portalTo[4] = destination;
    expect(() => validateEffectMap({ ...base, portalTo })).toThrow(/portal destination/i);
  });
});

describe("path stepping", () => {
  it("applies the entire fixed path, one hex neighbor at a time", () => {
    const map = emptyMap(9, 9, { q: 4, r: 4 });
    const stamp = machine([east, east, south, west, north]);
    const result = previewStep(multiMap(map), initialState(multiMap(map)), stamp);

    expect(result.next).toEqual({ pos: [{ q: 5, r: 4 }], failed: false });
    expect(result.trails).toEqual([
      [
        { q: 5, r: 4 },
        { q: 6, r: 4 },
        { q: 6, r: 5 },
        { q: 5, r: 5 },
        { q: 5, r: 4 },
      ],
    ]);
  });

  it("applies the same path independently from each map's current position", () => {
    const first = emptyMap(9, 9, { q: 1, r: 1 });
    const second = emptyMap(9, 9, { q: 5, r: 6 });
    const maps = multiMap(first, second);
    const result = applyStep(maps, initialState(maps), machine([east, south]));

    expect(result.pos).toEqual([
      { q: 2, r: 2 },
      { q: 6, r: 7 },
    ]);
  });

  it("cancels only a wall-blocked unit and continues the remaining stamp", () => {
    const base = emptyMap(7, 7, { q: 2, r: 2 });
    const map = withCell(base, 3, 2, CellKind.Wall);
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east, south, east]),
    );

    expect(result.next.pos).toEqual([{ q: 3, r: 3 }]);
    expect(result.trails).toEqual([[{ q: 2, r: 3 }, { q: 3, r: 3 }]]);
  });

  it("cancels only an out-of-bounds unit and continues the remaining stamp", () => {
    const map = emptyMap(4, 4, { q: 0, r: 1 });
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([west, south, east]),
    );

    expect(result.next.pos).toEqual([{ q: 1, r: 2 }]);
    expect(result.trails).toEqual([[{ q: 0, r: 2 }, { q: 1, r: 2 }]]);
  });

  it("enters abyss, records it, and fails sticky before later machines", () => {
    const base = emptyMap(8, 5, { q: 1, r: 2 });
    const map = withCell(base, 3, 2, CellKind.Abyss);
    const maps = multiMap(map);
    const first = machine([east, east, east]);
    const second = machine([south, south]);
    const preview = previewStep(maps, initialState(maps), first);

    expect(preview.next).toEqual({ pos: [{ q: 3, r: 2 }], failed: true });
    expect(preview.trails).toEqual([[{ q: 2, r: 2 }, { q: 3, r: 2 }]]);
    expect(applyTemplate(maps, initialState(maps), template(first, second))).toEqual(preview.next);
  });

  it("charges two energy to enter swamp and stops once path energy is insufficient", () => {
    const base = emptyMap(8, 5, { q: 1, r: 2 });
    const map = withCell(base, 2, 2, CellKind.Swamp);
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east, east, east]),
    );

    expect(result.next.pos).toEqual([{ q: 3, r: 2 }]);
    expect(result.trails).toEqual([[{ q: 2, r: 2 }, { q: 3, r: 2 }]]);
  });

  it("does not enter swamp when the remaining path energy is one", () => {
    const base = emptyMap(5, 5, { q: 1, r: 2 });
    const map = withCell(base, 2, 2, CellKind.Swamp);
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east]),
    );

    expect(result.next.pos).toEqual([{ q: 1, r: 2 }]);
    expect(result.trails).toEqual([[]]);
  });

  it("records portal entry and exit, then continues the same stamp from the exit", () => {
    const base = emptyMap(8, 3, { q: 0, r: 1 });
    const map = withCell(base, 1, 1, CellKind.Portal, { portalTo: { q: 5, r: 1 } });
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east, east]),
    );

    expect(result.next.pos).toEqual([{ q: 6, r: 1 }]);
    expect(result.trails).toEqual([
      [
        { q: 1, r: 1 },
        { q: 5, r: 1 },
        { q: 6, r: 1 },
      ],
    ]);
  });

  it("uses each map's own portal authority and never crosses or swaps maps", () => {
    const first = withCell(emptyMap(8, 3, { q: 0, r: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { q: 4, r: 1 },
    });
    const second = withCell(emptyMap(8, 3, { q: 0, r: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { q: 6, r: 1 },
    });
    const maps = multiMap(first, second);

    expect(applyStep(maps, initialState(maps), machine([east])).pos).toEqual([
      { q: 4, r: 1 },
      { q: 6, r: 1 },
    ]);
  });

  it("rejects an exit configured as another activating portal", () => {
    let map = withCell(emptyMap(7, 3, { q: 0, r: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { q: 4, r: 1 },
    });
    map = withCell(map, 4, 1, CellKind.Portal, { portalTo: { q: 6, r: 1 } });

    expect(() => initialState(multiMap(map))).toThrow(/destination.*portal entry/i);
  });

  it("keeps the allocation-free walker result aligned with preview semantics", () => {
    let map = withCell(emptyMap(10, 3, { q: 0, r: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { q: 4, r: 1 },
    });
    map = withCell(map, 5, 1, CellKind.Swamp);
    map = withCell(map, 7, 1, CellKind.Abyss);
    const stamp = machine([east, east, east, east, east]);
    const out = new Int32Array(7).fill(-99);
    const prevalidatedOut = new Int32Array(3);

    walkPathInto(map, 0, 1, stamp, out, 2);
    validateEffectMap(map);
    validateMachinePath(stamp);
    walkValidatedPathInto(map, 0, 1, stamp, prevalidatedOut, 0);
    const preview = previewStep(multiMap(map), initialState(multiMap(map)), stamp);

    expect(Array.from(out)).toEqual([-99, -99, 7, 1, 1, -99, -99]);
    expect(Array.from(prevalidatedOut)).toEqual([7, 1, 1]);
    expect(preview.next).toEqual({ pos: [{ q: out[2], r: out[3] }], failed: out[4] === 1 });
  });

  it("is deterministic and does not mutate map, state, path, or typed arrays", () => {
    const map = withCell(emptyMap(7, 5, { q: 1, r: 2 }), 2, 2, CellKind.Swamp);
    const maps = multiMap(map);
    const path = [east, east, south] as const;
    const stamp = machine(path);
    const state = initialState(maps);
    const before = {
      cell: Uint8Array.from(map.cell),
      portalTo: Int32Array.from(map.portalTo),
      state: structuredClone(state),
      path: structuredClone(path),
    };

    const first = previewStep(maps, state, stamp);
    const second = previewStep(maps, state, stamp);

    expect(first).toEqual(second);
    expect(map.cell).toEqual(before.cell);
    expect(map.portalTo).toEqual(before.portalTo);
    expect(state).toEqual(before.state);
    expect(path).toEqual(before.path);
  });

  it("on an open map, generated paths end at the axial sum of the complete path", () => {
    const direction = fc.constantFrom(...HEX_DIRS);
    fc.assert(
      fc.property(fc.array(direction, { minLength: 1, maxLength: 24 }), (path) => {
        const map = emptyMap(101, 101, { q: 50, r: 50 });
        const expected = path.reduce(
          (position, dir) => ({
            q: position.q + HEX_DQ[dir]!,
            r: position.r + HEX_DR[dir]!,
          }),
          map.start,
        );
        const result = applyStep(multiMap(map), initialState(multiMap(map)), machine(path));
        expect(result.pos).toEqual([expected]);
      }),
    );
  });
});

describe("evaluation and reveal", () => {
  it("reports a side-effect overlay on a Cure cell", () => {
    const map = withCell(emptyMap(5, 5, { q: 1, r: 2 }), 2, 2, CellKind.Cure, {
      cureId: 17,
      sideEffectId: 29,
    });
    const maps = multiMap(map);

    expect(evaluate(maps, initialState(maps), template(machine([east])))).toEqual({
      failed: false,
      final: [{ q: 2, r: 2 }],
      cured: [17],
      sideEffects: [29],
    });
  });

  it("evaluates only final Cure and SideEffect cells", () => {
    const curedMap = withCell(emptyMap(5, 5, { q: 1, r: 2 }), 2, 2, CellKind.Cure, {
      cureId: 17,
    });
    const sideMap = withCell(emptyMap(5, 5, { q: 1, r: 2 }), 2, 2, CellKind.SideEffect, {
      sideEffectId: 29,
    });
    const maps = multiMap(curedMap, sideMap);

    expect(evaluate(maps, initialState(maps), template(machine([east])))).toEqual({
      failed: false,
      final: [
        { q: 2, r: 2 },
        { q: 2, r: 2 },
      ],
      cured: [17],
      sideEffects: [29],
    });
  });

  it("a failed drug reports no cures or side effects", () => {
    let map = withCell(emptyMap(5, 5, { q: 1, r: 2 }), 2, 2, CellKind.Abyss);
    map = withCell(map, 3, 2, CellKind.Cure, { cureId: 17 });
    const maps = multiMap(map);

    expect(evaluate(maps, initialState(maps), template(machine([east, east])))).toEqual({
      failed: true,
      final: [{ q: 2, r: 2 }],
      cured: [],
      sideEffects: [],
    });
  });

  it("reveals every entered path cell, including portal entry/exit and abyss", () => {
    let map = withCell(emptyMap(8, 3, { q: 0, r: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { q: 5, r: 1 },
    });
    map = withCell(map, 6, 1, CellKind.Abyss);
    const maps = multiMap(map);
    const revealed = revealAlong(maps, initialState(maps), template(machine([east, east])));
    const fog = revealed.maps[0]?.fog;

    expect(fog?.[indexOf(map, 1, 1)]).toBe(1);
    expect(fog?.[indexOf(map, 5, 1)]).toBe(1);
    expect(fog?.[indexOf(map, 6, 1)]).toBe(1);
    expect(map.fog.every((value) => value === 0)).toBe(true);
  });
});
