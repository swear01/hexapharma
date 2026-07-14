import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  CardinalDelta,
  EffectMap,
  Machine,
  MultiMap,
  PathStamp,
  Template,
  Vec2,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
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

const indexOf = (map: EffectMap, x: number, y: number): number => y * map.width + x;

function emptyMap(
  width: number,
  height: number,
  start: Vec2,
  origin: Vec2 = { x: 0, y: 0 },
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
  x: number,
  y: number,
  kind: number,
  options: { readonly cureId?: number; readonly sideEffectId?: number; readonly portalTo?: Vec2 } = {},
): EffectMap {
  const cell = Uint8Array.from(map.cell);
  const cureId = Int16Array.from(map.cureId);
  const sideEffectId = Int32Array.from(map.sideEffectId);
  const portalTo = Int32Array.from(map.portalTo);
  const index = indexOf(map, x, y);
  cell[index] = kind;
  if (options.cureId !== undefined) cureId[index] = options.cureId;
  if (options.sideEffectId !== undefined) sideEffectId[index] = options.sideEffectId;
  if (options.portalTo !== undefined) {
    portalTo[index] = indexOf(map, options.portalTo.x, options.portalTo.y);
  }
  return { ...map, cell, cureId, sideEffectId, portalTo };
}

const machine = (path: PathStamp, stroke = path.length): Machine => ({
  typeId: "test-stamp",
  path,
  stroke,
});
const template = (...steps: Machine[]): Template => ({ steps });
const multiMap = (...maps: EffectMap[]): MultiMap => ({ maps });
const east = Object.freeze({ x: 1, y: 0 } as const);
const west = Object.freeze({ x: -1, y: 0 } as const);
const north = Object.freeze({ x: 0, y: -1 } as const);
const south = Object.freeze({ x: 0, y: 1 } as const);

describe("path contract validation", () => {
  it("accepts a non-empty cardinal-unit path and a stroke within its length", () => {
    const path = [east, south, west, north] as const;
    expect(() => validatePathStamp(path)).not.toThrow();
    expect(() => validateMachinePath(machine(path, 1))).not.toThrow();
    expect(() => validateMachinePath(machine(path, path.length))).not.toThrow();
  });

  it("rejects an empty path", () => {
    expect(() => validatePathStamp([])).toThrow(/non-empty/i);
  });

  it.each([
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 2, y: 0 },
    { x: 0, y: -2 },
    { x: 0.5, y: 0 },
  ])("rejects non-cardinal unit delta $x,$y", (delta) => {
    expect(() => validatePathStamp([delta] as unknown as PathStamp)).toThrow(/cardinal unit/i);
  });

  it.each([0, -1, 4, 1.5, Number.NaN])("rejects invalid stroke %s", (stroke) => {
    expect(() => validateMachinePath(machine([east, south, west], stroke))).toThrow(/stroke/i);
  });

  it("accepts all generated cardinal paths and legal strokes", () => {
    const delta = fc.constantFrom<CardinalDelta>(east, south, west, north);
    fc.assert(
      fc.property(fc.array(delta, { minLength: 1, maxLength: 64 }), fc.nat(), (path, n) => {
        const stroke = (n % path.length) + 1;
        expect(() => validateMachinePath(machine(path, stroke))).not.toThrow();
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
      expect(new Set(entry.path.map((delta) => `${delta.x},${delta.y}`)).size).toBeGreaterThan(1);
      serialized.add(JSON.stringify(entry.path));
    }

    expect(serialized.size).toBe(DEFAULT_CATALOG.length);
  });

  it("includes a self-intersecting loop, a reversal, and an alternating zigzag", () => {
    const visitsSamePositionTwice = (path: PathStamp): boolean => {
      let x = 0;
      let y = 0;
      const visited = new Set(["0,0"]);
      for (const delta of path) {
        x += delta.x;
        y += delta.y;
        const key = `${x},${y}`;
        if (visited.has(key)) return true;
        visited.add(key);
      }
      return false;
    };
    const containsOppositeDirections = (path: PathStamp): boolean =>
      path.some((left) =>
        path.some((right) => left.x === -right.x && left.y === -right.y),
      );
    const alternatesAxes = (path: PathStamp): boolean =>
      path.length >= 4 &&
      path.every((delta, index) =>
        index === 0 ? true : (delta.x === 0) !== (path[index - 1]?.x === 0),
      );

    expect(DEFAULT_CATALOG.some((entry) => visitsSamePositionTwice(entry.path))).toBe(true);
    expect(DEFAULT_CATALOG.some((entry) => containsOppositeDirections(entry.path))).toBe(true);
    expect(DEFAULT_CATALOG.some((entry) => alternatesAxes(entry.path))).toBe(true);
  });
});

describe("portal destination validation", () => {
  it("accepts an in-bounds same-map portal destination", () => {
    const map = withCell(emptyMap(5, 3, { x: 0, y: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { x: 4, y: 1 },
    });
    expect(() => validateEffectMap(map)).not.toThrow();
  });

  it("requires portalTo to be authoritative for every cell", () => {
    const base = emptyMap(3, 3, { x: 0, y: 0 });
    expect(() => validateEffectMap({ ...base, portalTo: new Int32Array(8) })).toThrow(
      /portalTo.*length/i,
    );

    const stray = Int32Array.from(base.portalTo);
    stray[0] = 1;
    expect(() => validateEffectMap({ ...base, portalTo: stray })).toThrow(/non-portal.*-1/i);
  });

  it.each([-1, 9, 100])("rejects illegal portal destination %s", (destination) => {
    const base = withCell(emptyMap(3, 3, { x: 0, y: 0 }), 1, 1, CellKind.Portal);
    const portalTo = Int32Array.from(base.portalTo);
    portalTo[4] = destination;
    expect(() => validateEffectMap({ ...base, portalTo })).toThrow(/portal destination/i);
  });
});

describe("path stepping", () => {
  it("applies the stroke prefix of the fixed path, one cardinal unit at a time", () => {
    const map = emptyMap(9, 9, { x: 4, y: 4 });
    const stamp = machine([east, east, south, west, north], 4);
    const result = previewStep(multiMap(map), initialState(multiMap(map)), stamp);

    expect(result.next).toEqual({ pos: [{ x: 5, y: 5 }], failed: false });
    expect(result.trails).toEqual([
      [
        { x: 5, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 5 },
        { x: 5, y: 5 },
      ],
    ]);
  });

  it("applies the same path independently from each map's current position", () => {
    const first = emptyMap(9, 9, { x: 1, y: 1 });
    const second = emptyMap(9, 9, { x: 5, y: 6 });
    const maps = multiMap(first, second);
    const result = applyStep(maps, initialState(maps), machine([east, south], 2));

    expect(result.pos).toEqual([
      { x: 2, y: 2 },
      { x: 6, y: 7 },
    ]);
  });

  it("cancels only a wall-blocked unit and continues the remaining stamp", () => {
    const base = emptyMap(7, 7, { x: 2, y: 2 });
    const map = withCell(base, 3, 2, CellKind.Wall);
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east, south, east], 3),
    );

    expect(result.next.pos).toEqual([{ x: 3, y: 3 }]);
    expect(result.trails).toEqual([[{ x: 2, y: 3 }, { x: 3, y: 3 }]]);
  });

  it("cancels only an out-of-bounds unit and continues the remaining stamp", () => {
    const map = emptyMap(4, 4, { x: 0, y: 1 });
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([west, south, east], 3),
    );

    expect(result.next.pos).toEqual([{ x: 1, y: 2 }]);
    expect(result.trails).toEqual([[{ x: 0, y: 2 }, { x: 1, y: 2 }]]);
  });

  it("enters abyss, records it, and fails sticky before later machines", () => {
    const base = emptyMap(8, 5, { x: 1, y: 2 });
    const map = withCell(base, 3, 2, CellKind.Abyss);
    const maps = multiMap(map);
    const first = machine([east, east, east], 3);
    const second = machine([south, south], 2);
    const preview = previewStep(maps, initialState(maps), first);

    expect(preview.next).toEqual({ pos: [{ x: 3, y: 2 }], failed: true });
    expect(preview.trails).toEqual([[{ x: 2, y: 2 }, { x: 3, y: 2 }]]);
    expect(applyTemplate(maps, initialState(maps), template(first, second))).toEqual(preview.next);
  });

  it("charges two energy to enter swamp and stops once stroke energy is insufficient", () => {
    const base = emptyMap(8, 5, { x: 1, y: 2 });
    const map = withCell(base, 2, 2, CellKind.Swamp);
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east, east, east], 3),
    );

    expect(result.next.pos).toEqual([{ x: 3, y: 2 }]);
    expect(result.trails).toEqual([[{ x: 2, y: 2 }, { x: 3, y: 2 }]]);
  });

  it("does not enter swamp when the remaining stroke energy is one", () => {
    const base = emptyMap(5, 5, { x: 1, y: 2 });
    const map = withCell(base, 2, 2, CellKind.Swamp);
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east], 1),
    );

    expect(result.next.pos).toEqual([{ x: 1, y: 2 }]);
    expect(result.trails).toEqual([[]]);
  });

  it("records portal entry and exit, then continues the same stamp from the exit", () => {
    const base = emptyMap(8, 3, { x: 0, y: 1 });
    const map = withCell(base, 1, 1, CellKind.Portal, { portalTo: { x: 5, y: 1 } });
    const result = previewStep(
      multiMap(map),
      initialState(multiMap(map)),
      machine([east, east], 2),
    );

    expect(result.next.pos).toEqual([{ x: 6, y: 1 }]);
    expect(result.trails).toEqual([
      [
        { x: 1, y: 1 },
        { x: 5, y: 1 },
        { x: 6, y: 1 },
      ],
    ]);
  });

  it("uses each map's own portal authority and never crosses or swaps maps", () => {
    const first = withCell(emptyMap(8, 3, { x: 0, y: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { x: 4, y: 1 },
    });
    const second = withCell(emptyMap(8, 3, { x: 0, y: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { x: 6, y: 1 },
    });
    const maps = multiMap(first, second);

    expect(applyStep(maps, initialState(maps), machine([east], 1)).pos).toEqual([
      { x: 4, y: 1 },
      { x: 6, y: 1 },
    ]);
  });

  it("rejects an exit configured as another activating portal", () => {
    let map = withCell(emptyMap(7, 3, { x: 0, y: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { x: 4, y: 1 },
    });
    map = withCell(map, 4, 1, CellKind.Portal, { portalTo: { x: 6, y: 1 } });

    expect(() => initialState(multiMap(map))).toThrow(/destination.*portal entry/i);
  });

  it("keeps the allocation-free walker result aligned with preview semantics", () => {
    let map = withCell(emptyMap(10, 3, { x: 0, y: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { x: 4, y: 1 },
    });
    map = withCell(map, 5, 1, CellKind.Swamp);
    map = withCell(map, 7, 1, CellKind.Abyss);
    const stamp = machine([east, east, east, east, east], 5);
    const out = new Int32Array(7).fill(-99);
    const prevalidatedOut = new Int32Array(3);

    walkPathInto(map, 0, 1, stamp, out, 2);
    validateEffectMap(map);
    validateMachinePath(stamp);
    walkValidatedPathInto(map, 0, 1, stamp, prevalidatedOut, 0);
    const preview = previewStep(multiMap(map), initialState(multiMap(map)), stamp);

    expect(Array.from(out)).toEqual([-99, -99, 7, 1, 1, -99, -99]);
    expect(Array.from(prevalidatedOut)).toEqual([7, 1, 1]);
    expect(preview.next).toEqual({ pos: [{ x: out[2], y: out[3] }], failed: out[4] === 1 });
  });

  it("is deterministic and does not mutate map, state, path, or typed arrays", () => {
    const map = withCell(emptyMap(7, 5, { x: 1, y: 2 }), 2, 2, CellKind.Swamp);
    const maps = multiMap(map);
    const path = [east, east, south] as const;
    const stamp = machine(path, 3);
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

  it("on an open map, generated paths end at the sum of the stroke prefix", () => {
    const delta = fc.constantFrom<CardinalDelta>(east, south, west, north);
    fc.assert(
      fc.property(fc.array(delta, { minLength: 1, maxLength: 24 }), fc.nat(), (path, n) => {
        const stroke = (n % path.length) + 1;
        const map = emptyMap(101, 101, { x: 50, y: 50 });
        const expected = path.slice(0, stroke).reduce(
          (position, step) => ({ x: position.x + step.x, y: position.y + step.y }),
          map.start,
        );
        const result = applyStep(multiMap(map), initialState(multiMap(map)), machine(path, stroke));
        expect(result.pos).toEqual([expected]);
      }),
    );
  });
});

describe("evaluation and reveal", () => {
  it("evaluates only final Cure and SideEffect cells", () => {
    const curedMap = withCell(emptyMap(5, 5, { x: 1, y: 2 }), 2, 2, CellKind.Cure, {
      cureId: 17,
    });
    const sideMap = withCell(emptyMap(5, 5, { x: 1, y: 2 }), 2, 2, CellKind.SideEffect, {
      sideEffectId: 29,
    });
    const maps = multiMap(curedMap, sideMap);

    expect(evaluate(maps, initialState(maps), template(machine([east], 1)))).toEqual({
      failed: false,
      final: [
        { x: 2, y: 2 },
        { x: 2, y: 2 },
      ],
      cured: [17],
      sideEffects: [29],
    });
  });

  it("a failed drug reports no cures or side effects", () => {
    let map = withCell(emptyMap(5, 5, { x: 1, y: 2 }), 2, 2, CellKind.Abyss);
    map = withCell(map, 3, 2, CellKind.Cure, { cureId: 17 });
    const maps = multiMap(map);

    expect(evaluate(maps, initialState(maps), template(machine([east, east], 2)))).toEqual({
      failed: true,
      final: [{ x: 2, y: 2 }],
      cured: [],
      sideEffects: [],
    });
  });

  it("reveals every entered path cell, including portal entry/exit and abyss", () => {
    let map = withCell(emptyMap(8, 3, { x: 0, y: 1 }), 1, 1, CellKind.Portal, {
      portalTo: { x: 5, y: 1 },
    });
    map = withCell(map, 6, 1, CellKind.Abyss);
    const maps = multiMap(map);
    const revealed = revealAlong(maps, initialState(maps), template(machine([east, east], 2)));
    const fog = revealed.maps[0]?.fog;

    expect(fog?.[indexOf(map, 1, 1)]).toBe(1);
    expect(fog?.[indexOf(map, 5, 1)]).toBe(1);
    expect(fog?.[indexOf(map, 6, 1)]).toBe(1);
    expect(map.fog.every((value) => value === 0)).toBe(true);
  });
});
