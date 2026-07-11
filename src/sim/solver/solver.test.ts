import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  Vec2,
  EffectMap,
  MultiMap,
  DrugState,
  MachineCatalogEntry,
  SolveOptions,
  Solution,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
import { initialState, evaluate } from "../drug-graph";
import { solve } from "./index";

// ───────────────────────────── fixture helpers ─────────────────────────────

const idx = (w: number, x: number, y: number): number => y * w + x;

/** A W×H map, all-Empty, fully fogged, with given start + origin. */
function emptyMap(
  w: number,
  h: number,
  start: Vec2,
  origin: Vec2 = { x: 0, y: 0 },
): EffectMap {
  const len = w * h;
  return {
    width: w,
    height: h,
    origin,
    start,
    cell: new Uint8Array(len),
    cureId: new Int16Array(len).fill(-1),
    sideEffectId: new Int32Array(len).fill(-1),
    fog: new Uint8Array(len),
  };
}

/** Copy of `m` with cell (x,y) set to `kind` (+ optional cure/side ids). */
function withCell(
  m: EffectMap,
  x: number,
  y: number,
  kind: number,
  ids?: { cure?: number; side?: number },
): EffectMap {
  const cell = Uint8Array.from(m.cell);
  const cureId = Int16Array.from(m.cureId);
  const sideEffectId = Int32Array.from(m.sideEffectId);
  const i = idx(m.width, x, y);
  cell[i] = kind;
  if (ids?.cure !== undefined) cureId[i] = ids.cure;
  if (ids?.side !== undefined) sideEffectId[i] = ids.side;
  return { ...m, cell, cureId, sideEffectId };
}

const wall = (m: EffectMap, x: number, y: number): EffectMap =>
  withCell(m, x, y, CellKind.Wall);
const hazard = (m: EffectMap, x: number, y: number): EffectMap =>
  withCell(m, x, y, CellKind.Hazard);
const cure = (m: EffectMap, x: number, y: number, cureId: number): EffectMap =>
  withCell(m, x, y, CellKind.Cure, { cure: cureId });

const mm = (...maps: EffectMap[]): MultiMap => ({ maps });

// Minimal axis-aligned catalogs for hand-computed shortest paths.
const PUSH_ONLY: readonly MachineCatalogEntry[] = [
  {
    typeId: "push",
    transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" },
    cost: 1,
    speed: 1,
    orientable: true,
  },
];

const PUSH_AND_SWAP: readonly MachineCatalogEntry[] = [
  {
    typeId: "push",
    transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" },
    cost: 1,
    speed: 1,
    orientable: true,
  },
  {
    typeId: "swap01",
    transform: { kind: "swap", a: 0, b: 1 },
    cost: 5,
    speed: 1,
    orientable: false,
  },
];

const opts = (
  catalog: readonly MachineCatalogEntry[],
  maxDepth: number,
  targets: readonly number[],
): SolveOptions => ({ catalog, maxDepth, targets });

/** Assert a Solution genuinely cures all targets and never fails (INV-13). */
function assertCures(
  M: MultiMap,
  start: DrugState,
  sol: Solution,
  targets: readonly number[],
): void {
  const out = evaluate(M, start, sol.template);
  expect(out.failed).toBe(false);
  for (const t of targets) expect(out.cured).toContain(t);
}

// ───────────────────────────── soundness (INV-13) ─────────────────────────────

describe("solver soundness (INV-13)", () => {
  it("solves a single-target single-map level and the template actually cures it", () => {
    const m = cure(emptyMap(6, 6, { x: 0, y: 0 }), 3, 0, 42);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_ONLY, 10, [42]));
    expect(sol).not.toBeNull();
    assertCures(M, start, sol!, [42]);
  });

  it("solves a two-map level where one uniform push must satisfy BOTH cures", () => {
    // Both maps cure at (2,0) reachable by the same +x pushes.
    const m0 = cure(emptyMap(6, 6, { x: 0, y: 0 }), 2, 0, 1);
    const m1 = cure(emptyMap(6, 6, { x: 0, y: 0 }), 2, 0, 2);
    const M = mm(m0, m1);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_ONLY, 10, [1, 2]));
    expect(sol).not.toBeNull();
    assertCures(M, start, sol!, [1, 2]);
  });

  it("solves using the DEFAULT_CATALOG (orientation + multiple machine kinds)", () => {
    // Cure is up-and-right of start: needs rotation/perp or 2D movement.
    const m = cure(emptyMap(7, 7, { x: 0, y: 0 }), 3, 2, 7);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(DEFAULT_CATALOG, 12, [7]));
    expect(sol).not.toBeNull();
    assertCures(M, start, sol!, [7]);
  });

  it("a zero-step solution is returned when start already sits on the cure", () => {
    const m = cure(emptyMap(6, 6, { x: 2, y: 2 }), 2, 2, 9);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_ONLY, 5, [9]));
    expect(sol).not.toBeNull();
    expect(sol!.template.steps).toHaveLength(0);
    expect(sol!.difficulty).toBe(0);
    expect(sol!.cost).toBe(0);
    assertCures(M, start, sol!, [9]);
  });
});

// ───────────────────────────── minimality ─────────────────────────────

describe("solver minimality (BFS shortest path)", () => {
  it("returns exactly the known-shortest length (3 unit pushes to x=3)", () => {
    const m = cure(emptyMap(8, 8, { x: 0, y: 0 }), 3, 0, 42);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_ONLY, 10, [42]));
    expect(sol).not.toBeNull();
    expect(sol!.template.steps).toHaveLength(3);
    expect(sol!.difficulty).toBe(3);
    expect(sol!.cost).toBe(3); // 3 pushes × cost 1
  });

  it("difficulty equals step count and cost sums catalog costs", () => {
    // push2 (cost 2) reaches x=4 in 2 steps; push (cost1) would take 4 steps.
    const catalog: readonly MachineCatalogEntry[] = [
      ...PUSH_ONLY,
      {
        typeId: "push2",
        transform: { kind: "translate", delta: { x: 2, y: 0 }, relation: "forward" },
        cost: 2,
        speed: 1,
        orientable: true,
      },
    ];
    const m = cure(emptyMap(8, 8, { x: 0, y: 0 }), 4, 0, 5);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(catalog, 10, [5]));
    expect(sol).not.toBeNull();
    // Shortest by STEP count is two push2 steps.
    expect(sol!.template.steps).toHaveLength(2);
    expect(sol!.difficulty).toBe(2);
    expect(sol!.cost).toBe(4); // 2 × push2(cost 2)
  });

  it("prefers a single swap over many pushes when it is fewer steps", () => {
    // Map0 cure at (5,0); map0 starts at (0,0) but map1 already starts at (5,0).
    // A single swap puts map0's position at (5,0) in ONE step; 5 pushes are longer.
    const m0 = cure(emptyMap(6, 6, { x: 0, y: 0 }), 5, 0, 11);
    const m1 = emptyMap(6, 6, { x: 5, y: 0 });
    const M = mm(m0, m1);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_AND_SWAP, 10, [11]));
    expect(sol).not.toBeNull();
    expect(sol!.template.steps).toHaveLength(1);
    expect(sol!.template.steps[0]!.transform.kind).toBe("swap");
    assertCures(M, start, sol!, [11]);
  });
});

// ───────────────────────────── composite difficulty ─────────────────────────────

describe("solver composite difficulty (steps + diversity + decoupling)", () => {
  it("forward-only single-type stays at difficulty == steps (no bonuses)", () => {
    // 3 unit forward pushes, one machine type ⇒ diversity 0, decoupling 0.
    const m = cure(emptyMap(8, 8, { x: 0, y: 0 }), 3, 0, 42);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_ONLY, 10, [42]));
    expect(sol).not.toBeNull();
    expect(sol!.template.steps).toHaveLength(3);
    expect(sol!.difficulty).toBe(3); // 3 + 0 + 0
  });

  it("a swap step adds decouplingBonus (+2): difficulty == steps + 2", () => {
    // The 1-step swap solution from the minimality suite: steps 1, single type,
    // but swap is a decoupling move ⇒ difficulty = 1 + 0 + 2 = 3.
    const m0 = cure(emptyMap(6, 6, { x: 0, y: 0 }), 5, 0, 11);
    const m1 = emptyMap(6, 6, { x: 5, y: 0 });
    const M = mm(m0, m1);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_AND_SWAP, 10, [11]));
    expect(sol).not.toBeNull();
    expect(sol!.template.steps).toHaveLength(1);
    expect(sol!.template.steps[0]!.transform.kind).toBe("swap");
    expect(sol!.difficulty).toBe(3); // 1 step + 0 diversity + 2 decoupling
  });

  it("mixing two machine types adds diversityBonus", () => {
    // Cure at (3,0): forward push (cost1, +x) reaches it in 3 steps with ONE type.
    // Add a push3 (+3) so the shortest STEP path is push3 then... no, set target
    // to x=4: push3 (1 step to x=3) + push (1 step to x=4) = 2 steps, TWO types.
    // A single push would be 4 steps; a single push3 overshoots. So BFS picks the
    // 2-step mixed path: diversity = 1, both forward ⇒ decoupling 0.
    const catalog: readonly MachineCatalogEntry[] = [
      ...PUSH_ONLY,
      {
        typeId: "push3",
        transform: { kind: "translate", delta: { x: 3, y: 0 }, relation: "forward" },
        cost: 3,
        speed: 1,
        orientable: true,
      },
    ];
    const m = cure(emptyMap(8, 8, { x: 0, y: 0 }), 4, 0, 5);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(catalog, 10, [5]));
    expect(sol).not.toBeNull();
    expect(sol!.template.steps).toHaveLength(2);
    const types = new Set(sol!.template.steps.map((s) => s.typeId));
    expect(types.size).toBe(2);
    expect(sol!.difficulty).toBe(3); // 2 steps + 1 diversity + 0 decoupling
  });

  it("offset (diagonal) machine reaches an off-axis target in fewer steps, soundly", () => {
    // Target at (3,3). An offset machine with delta (1,0) skews to (1,1) — a
    // diagonal step — so 3 steps reach (3,3). Axis-only (push) would need 6 steps.
    const OFFSET_AND_PUSH: readonly MachineCatalogEntry[] = [
      ...PUSH_ONLY,
      {
        typeId: "skew",
        transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "offset" },
        cost: 2,
        speed: 1,
        orientable: true,
      },
    ];
    const m = cure(emptyMap(8, 8, { x: 0, y: 0 }), 3, 3, 7);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(OFFSET_AND_PUSH, 12, [7]));
    expect(sol).not.toBeNull();
    // Sound (INV-13): cures and never fails.
    assertCures(M, start, sol!, [7]);
    // Beats the axis-only lower bound of 6 unit pushes.
    expect(sol!.template.steps.length).toBeLessThan(6);
    // The diagonal route uses offset steps.
    const usesOffset = sol!.template.steps.some(
      (s) => s.transform.kind === "translate" && s.transform.relation === "offset",
    );
    expect(usesOffset).toBe(true);
    // 3 offset steps: 3 + 0 diversity + 2 decoupling = 5.
    expect(sol!.template.steps).toHaveLength(3);
    expect(sol!.difficulty).toBe(5);
  });

  it("difficulty is deterministic across repeated solves (incl. composite value)", () => {
    const OFFSET_AND_PUSH: readonly MachineCatalogEntry[] = [
      ...PUSH_ONLY,
      {
        typeId: "skew",
        transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "offset" },
        cost: 2,
        speed: 1,
        orientable: true,
      },
    ];
    const m = cure(emptyMap(8, 8, { x: 0, y: 0 }), 3, 3, 7);
    const M = mm(m);
    const start = initialState(M);
    const a = solve(M, start, opts(OFFSET_AND_PUSH, 12, [7]));
    const b = solve(M, start, opts(OFFSET_AND_PUSH, 12, [7]));
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    expect(a!.difficulty).toBe(b!.difficulty);
  });
});

// ───────────────────────────── null when unsolvable ─────────────────────────────

describe("solver returns null when no solution exists", () => {
  it("null when the target is walled off (unreachable)", () => {
    // Cure at (5,0) but a wall at (1,0) traps the drug at (0,0) on the x axis,
    // and a full wall column blocks every approach.
    let m = cure(emptyMap(6, 6, { x: 0, y: 0 }), 5, 0, 1);
    for (let y = 0; y < 6; y++) m = wall(m, 1, y); // full wall column at x=1
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(PUSH_ONLY, 20, [1]));
    expect(sol).toBeNull();
  });

  it("null when the cure is reachable but beyond maxDepth", () => {
    const m = cure(emptyMap(10, 10, { x: 0, y: 0 }), 7, 0, 1);
    const M = mm(m);
    const start = initialState(M);
    // Needs 7 unit pushes; cap at 5.
    expect(solve(M, start, opts(PUSH_ONLY, 5, [1]))).toBeNull();
    // With enough depth it is found.
    expect(solve(M, start, opts(PUSH_ONLY, 7, [1]))).not.toBeNull();
  });

  it("null when a requested target has no cure node on any map", () => {
    const m = cure(emptyMap(6, 6, { x: 0, y: 0 }), 3, 0, 1);
    const M = mm(m);
    const start = initialState(M);
    expect(solve(M, start, opts(PUSH_ONLY, 10, [999]))).toBeNull();
  });

  it("null when two targets sit on the SAME map at DIFFERENT cells", () => {
    // One drug holds one position per map → cannot be on (2,0) and (4,0) at once.
    let m = cure(emptyMap(6, 6, { x: 0, y: 0 }), 2, 0, 1);
    m = cure(m, 4, 0, 2);
    const M = mm(m);
    const start = initialState(M);
    expect(solve(M, start, opts(PUSH_ONLY, 10, [1, 2]))).toBeNull();
  });
});

// ───────────────────────────── determinism ─────────────────────────────

describe("solver determinism", () => {
  it("returns a deep-equal Solution across repeated runs", () => {
    const m = cure(emptyMap(7, 7, { x: 0, y: 0 }), 4, 3, 1);
    const M = mm(m);
    const start = initialState(M);
    const a = solve(M, start, opts(DEFAULT_CATALOG, 12, [1]));
    const b = solve(M, start, opts(DEFAULT_CATALOG, 12, [1]));
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
  });

  it("property: identical inputs ⇒ identical Solution (random small fixtures)", () => {
    fc.assert(
      fc.property(
        fc.record({
          cx: fc.integer({ min: 0, max: 5 }),
          cy: fc.integer({ min: 0, max: 5 }),
        }),
        ({ cx, cy }) => {
          const m = cure(emptyMap(6, 6, { x: 0, y: 0 }), cx, cy, 3);
          const M = mm(m);
          const start = initialState(M);
          const a = solve(M, start, opts(DEFAULT_CATALOG, 14, [3]));
          const b = solve(M, start, opts(DEFAULT_CATALOG, 14, [3]));
          expect(a).toEqual(b);
          if (a !== null) assertCures(M, start, a, [3]);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// ───────────────────────────── cross-map joint search ─────────────────────────────

describe("solver cross-map joint constraint", () => {
  it("finds a longer SAFE joint path when the short path spoils another map", () => {
    // Map 0: cure at (3,0); start (0,0). The naive route is push,push,push.
    // Map 1: start (0,3). A +x push from x=0 immediately enters a hazard at (1,3),
    //   so the 3-push route SPOILS the drug on map 1.
    // Safe joint route: go DOWN one (perp/rotated push) so map1 leaves the hazard
    //   row, but that also moves map0 off row 0 — so the solver must weave a path
    //   that lands map0 back on (3,0). We assert ONLY that a safe curing solution
    //   is found and that the naive 3-step route is NOT what is returned.
    const m0 = cure(emptyMap(7, 7, { x: 0, y: 0 }), 3, 0, 100);
    let m1 = emptyMap(7, 7, { x: 0, y: 3 });
    // Hazards across row 3 on map1 (x=1..6) so any +x sweep on row 3 dies.
    // Target is only disease 100 (on map0); map1 just must stay ALIVE.
    for (let x = 1; x < 7; x++) m1 = hazard(m1, x, 3);
    const M = mm(m0, m1);
    const start = initialState(M);

    const sol = solve(M, start, opts(DEFAULT_CATALOG, 16, [100]));
    expect(sol).not.toBeNull();
    // It must be SAFE and actually cure target 100.
    assertCures(M, start, sol!, [100]);
    // And it must NOT be the 3 straight +x pushes (that route fails on map1).
    const out = evaluate(M, start, sol!.template);
    expect(out.failed).toBe(false);
    // Map1 must have avoided the hazard row at its final resting cell.
    expect(out.final[1]!.y).not.toBe(3);
  });

  it("returns null when the joint constraint is truly impossible", () => {
    // Map0 cure at (3,0). Map1: the ENTIRE grid except the start cell is hazard,
    // so ANY movement spoils the drug, yet the cure needs movement ⇒ impossible.
    let m1 = emptyMap(5, 5, { x: 0, y: 0 });
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        if (x === 0 && y === 0) continue;
        m1 = hazard(m1, x, y);
      }
    }
    const m0 = cure(emptyMap(5, 5, { x: 0, y: 0 }), 3, 0, 1);
    const M = mm(m0, m1);
    const start = initialState(M);
    // Swap would move map1 off (0,0) too; only swap01 in catalog also relabels —
    // but a swap puts map1 at map0's pos which is non-(0,0) after pushes... here
    // with PUSH_ONLY there is no escape: every push drives map1 into a hazard.
    expect(solve(M, start, opts(PUSH_ONLY, 12, [1]))).toBeNull();
  });
});

// ───────────────────────────── termination / perf ─────────────────────────────

describe("solver termination & perf", () => {
  it("explores a full small grid quickly and still returns minimal", () => {
    // 8×8 open, cure far corner; DEFAULT_CATALOG. Bounded by reachable states.
    const m = cure(emptyMap(8, 8, { x: 0, y: 0 }), 7, 7, 1);
    const M = mm(m);
    const start = initialState(M);
    const sol = solve(M, start, opts(DEFAULT_CATALOG, 20, [1]));
    expect(sol).not.toBeNull();
    assertCures(M, start, sol!, [1]);
  });

  it("terminates (returns null) on an unsolvable level without blowing up depth", () => {
    // Fully hazard-ringed target with no safe approach on a small grid.
    let m = cure(emptyMap(7, 7, { x: 0, y: 0 }), 6, 6, 1);
    // Hazard wall around the cure so no sweep can rest ON it without dying.
    m = hazard(m, 5, 6);
    m = hazard(m, 6, 5);
    m = hazard(m, 5, 5);
    const M = mm(m);
    const start = initialState(M);
    // High maxDepth: the visited set must bound the search by reachable states.
    expect(solve(M, start, opts(PUSH_ONLY, 50, [1]))).toBeNull();
  });
});
