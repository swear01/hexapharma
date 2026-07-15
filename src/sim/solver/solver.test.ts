import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  CardinalDelta,
  DrugState,
  EffectMap,
  MachineCatalogEntry,
  MultiMap,
  Solution,
  SolveOptions,
  Vec2,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { evaluate, initialState } from "../drug-graph";
import { solve } from ".";

const E: CardinalDelta = { x: 1, y: 0 };
const S: CardinalDelta = { x: 0, y: 1 };
const W: CardinalDelta = { x: -1, y: 0 };
const N: CardinalDelta = { x: 0, y: -1 };

function emptyMap(width: number, height: number, start: Vec2): EffectMap {
  const size = width * height;
  return {
    width,
    height,
    origin: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    start,
    cell: new Uint8Array(size),
    cureId: new Int16Array(size).fill(-1),
    sideEffectId: new Int32Array(size).fill(-1),
    portalTo: new Int32Array(size).fill(-1),
    fog: new Uint8Array(size),
  };
}

function setCell(
  map: EffectMap,
  x: number,
  y: number,
  kind: number,
  cureId = -1,
): EffectMap {
  const cell = Uint8Array.from(map.cell);
  const ids = Int16Array.from(map.cureId);
  const index = y * map.width + x;
  cell[index] = kind;
  ids[index] = cureId;
  return { ...map, cell, cureId: ids };
}

const cure = (map: EffectMap, x: number, y: number, id: number): EffectMap =>
  setCell(map, x, y, CellKind.Cure, id);
const wall = (map: EffectMap, x: number, y: number): EffectMap =>
  setCell(map, x, y, CellKind.Wall);
const abyss = (map: EffectMap, x: number, y: number): EffectMap =>
  setCell(map, x, y, CellKind.Abyss);
const swamp = (map: EffectMap, x: number, y: number): EffectMap =>
  setCell(map, x, y, CellKind.Swamp);
const maps = (...value: EffectMap[]): MultiMap => ({ maps: value });

function entry(typeId: string, path: readonly CardinalDelta[], cost = 1): MachineCatalogEntry {
  return { typeId, path, cost, speed: 1 };
}

const EAST = [entry("east", [E])];

function options(
  catalog: readonly MachineCatalogEntry[],
  maxDepth: number,
  targets: readonly number[],
): SolveOptions {
  return { catalog, maxDepth, targets };
}

function expectCures(
  mm: MultiMap,
  start: DrugState,
  solution: Solution,
  targets: readonly number[],
): void {
  const outcome = evaluate(mm, start, solution.template);
  expect(outcome.failed).toBe(false);
  for (const target of targets) expect(outcome.cured).toContain(target);
}

describe("fixed-path solver", () => {
  it("returns a sound shortest solution and sums machine costs", () => {
    const mm = maps(cure(emptyMap(7, 5, { x: 1, y: 2 }), 4, 2, 42));
    const start = initialState(mm);
    const solution = solve(mm, start, options([entry("east", [E], 3)], 5, [42]));

    expect(solution?.template.steps).toHaveLength(3);
    expect(solution?.cost).toBe(9);
    expect(solution?.difficulty).toBe(3);
    expectCures(mm, start, solution!, [42]);
  });

  it("returns a zero-step solution when the start is already cured", () => {
    const mm = maps(cure(emptyMap(5, 5, { x: 2, y: 2 }), 2, 2, 7));
    const solution = solve(mm, initialState(mm), options(EAST, 4, [7]));
    expect(solution).toMatchObject({ difficulty: 0, cost: 0, template: { steps: [] } });
  });

  it("searches only complete fixed paths without rotating or truncating the stamp", () => {
    const catalog = [entry("hook", [E, S, E])];
    const east = maps(cure(emptyMap(7, 7, { x: 2, y: 2 }), 3, 2, 1));
    const bend = maps(cure(emptyMap(7, 7, { x: 2, y: 2 }), 3, 3, 2));
    const north = maps(cure(emptyMap(7, 7, { x: 2, y: 2 }), 2, 1, 3));

    expect(solve(east, initialState(east), options(catalog, 1, [1]))).toBeNull();
    expect(solve(bend, initialState(bend), options(catalog, 1, [2]))).toBeNull();
    const full = maps(cure(emptyMap(7, 7, { x: 2, y: 2 }), 4, 3, 4));
    expect(solve(full, initialState(full), options(catalog, 1, [4]))?.template.steps[0])
      .toEqual({ typeId: "hook", path: [E, S, E] });
    expect(solve(north, initialState(north), options(catalog, 3, [3]))).toBeNull();
  });

  it("rewards machine diversity and scores a shaped path deterministically", () => {
    const catalog = [entry("east", [E]), entry("hook", [E, S])];
    const mm = maps(cure(emptyMap(7, 7, { x: 1, y: 1 }), 3, 2, 8));
    const start = initialState(mm);
    const solution = solve(mm, start, options(catalog, 2, [8]));

    expect(solution?.template.steps.map((step) => step.typeId)).toEqual(["east", "hook"]);
    expect(solution?.template.steps.map((step) => step.path.length)).toEqual([1, 2]);
    expect(solution?.difficulty).toBe(5);
    expectCures(mm, start, solution!, [8]);
  });

  it("can exploit wall cancellation while continuing the remaining stamp", () => {
    let map = wall(emptyMap(6, 6, { x: 0, y: 0 }), 1, 0);
    map = cure(map, 1, 1, 9);
    const mm = maps(map);
    const solution = solve(mm, initialState(mm), options([entry("wall-hook", [E, S, E])], 1, [9]));
    expect(solution?.template.steps[0]?.path).toEqual([E, S, E]);
    expectCures(mm, initialState(mm), solution!, [9]);
  });

  it("never expands an abyss-failed state", () => {
    let map = abyss(emptyMap(6, 3, { x: 0, y: 1 }), 1, 1);
    map = cure(map, 2, 1, 4);
    const mm = maps(map);
    expect(solve(mm, initialState(mm), options(EAST, 8, [4]))).toBeNull();
  });

  it("accounts for swamp energy while applying the complete path", () => {
    let map = swamp(emptyMap(7, 3, { x: 0, y: 1 }), 1, 1);
    map = cure(map, 2, 1, 5);
    const mm = maps(map);
    const solution = solve(mm, initialState(mm), options([entry("long", [E, E, E])], 1, [5]));
    expect(solution?.template.steps[0]?.path).toEqual([E, E, E]);
    expectCures(mm, initialState(mm), solution!, [5]);
  });

  it("enforces the joint same-path constraint without cross-layer swaps", () => {
    const map0 = cure(emptyMap(7, 5, { x: 1, y: 2 }), 3, 2, 1);
    const map1 = cure(emptyMap(7, 5, { x: 1, y: 2 }), 4, 2, 2);
    const mm = maps(map0, map1);
    expect(solve(mm, initialState(mm), options(EAST, 6, [1, 2]))).toBeNull();
  });

  it("rejects two different cure positions requested on one map", () => {
    let map = cure(emptyMap(6, 4, { x: 0, y: 1 }), 2, 1, 1);
    map = cure(map, 4, 1, 2);
    const mm = maps(map);
    expect(solve(mm, initialState(mm), options(EAST, 8, [1, 2]))).toBeNull();
  });

  it("returns null for a missing target or insufficient depth", () => {
    const mm = maps(cure(emptyMap(8, 3, { x: 0, y: 1 }), 6, 1, 1));
    const start = initialState(mm);
    expect(solve(mm, start, options(EAST, 4, [1]))).toBeNull();
    expect(solve(mm, start, options(EAST, 8, [999]))).toBeNull();
  });

  it("is deterministic for random reachable coordinates", () => {
    const catalog = [entry("hook", [E, S, W, S, E]), entry("rise", [N, E, N])];
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
      (x, y) => {
        const mm = maps(cure(emptyMap(7, 7, { x: 3, y: 3 }), x, y, 6));
        const start = initialState(mm);
        const first = solve(mm, start, options(catalog, 8, [6]));
        const second = solve(mm, start, options(catalog, 8, [6]));
        expect(first).toEqual(second);
        if (first !== null) expectCures(mm, start, first, [6]);
      },
    ), { numRuns: 40, seed: 0x50_1e });
  });
});
