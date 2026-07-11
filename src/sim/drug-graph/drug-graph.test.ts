import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  Vec2,
  EffectMap,
  MultiMap,
  Machine,
  Template,
  Orientation,
  Rotation,
  TranslateRelation,
} from "../phase0_interfaces";
import { CellKind, IDENTITY } from "../phase0_interfaces";
import {
  orient,
  effectiveDelta,
  initialState,
  applyStep,
  applyTemplate,
  evaluate,
  revealAlong,
} from "./index";
import { sweep, sweepInto } from "./sweep";

// ───────────────────────────── fixture helpers ─────────────────────────────

const idx = (w: number, x: number, y: number): number => y * w + x;

/** An NxN map, all-Empty, fully fogged, with given start + origin. */
function emptyMap(n: number, start: Vec2, origin: Vec2 = { x: 0, y: 0 }): EffectMap {
  const len = n * n;
  return {
    width: n,
    height: n,
    origin,
    start,
    cell: new Uint8Array(len), // all Empty (0)
    cureId: new Int16Array(len).fill(-1),
    sideEffectId: new Int32Array(len).fill(-1),
    fog: new Uint8Array(len), // all fogged (0)
  };
}

/** Return a copy of `m` with cell (x,y) set to `kind` (+ optional cure/side ids). */
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

const wall = (m: EffectMap, x: number, y: number): EffectMap => withCell(m, x, y, CellKind.Wall);
const hazard = (m: EffectMap, x: number, y: number): EffectMap =>
  withCell(m, x, y, CellKind.Hazard);
const cure = (m: EffectMap, x: number, y: number, cureId: number): EffectMap =>
  withCell(m, x, y, CellKind.Cure, { cure: cureId });
const side = (m: EffectMap, x: number, y: number, sideId: number): EffectMap =>
  withCell(m, x, y, CellKind.SideEffect, { side: sideId });

const mm = (...maps: EffectMap[]): MultiMap => ({ maps });

const translate = (
  delta: Vec2,
  relation: TranslateRelation = "forward",
  orientation: Orientation = IDENTITY,
): Machine => ({ typeId: "t", transform: { kind: "translate", delta, relation }, orientation });

const scale = (num: number, den: number): Machine => ({
  typeId: "s",
  transform: { kind: "scale", num, den },
  orientation: IDENTITY,
});

const swap = (a: number, b: number): Machine => ({
  typeId: "w",
  transform: { kind: "swap", a, b },
  orientation: IDENTITY,
});

const tpl = (...steps: Machine[]): Template => ({ steps });

// ───────────────────────────── arbitraries ─────────────────────────────

const arbVec = fc.record({
  x: fc.integer({ min: -8, max: 8 }),
  y: fc.integer({ min: -8, max: 8 }),
});
const arbRot = fc.constantFrom<Rotation>(0, 1, 2, 3);
const arbOrient: fc.Arbitrary<Orientation> = fc.record({ rot: arbRot, flip: fc.boolean() });

// ───────────────────────────── INV-4 / INV-5: orient ─────────────────────────────

describe("orient (INV-4, INV-5)", () => {
  it("rotating any vector 4×90° returns the original", () => {
    fc.assert(
      fc.property(arbVec, (v) => {
        let r = v;
        for (let k = 0; k < 4; k++) r = orient(r, { rot: 1, flip: false });
        expect(r).toEqual(v);
      }),
    );
  });

  it("a rot=0 rotation is identity and full-turn (applied as one) is identity", () => {
    fc.assert(
      fc.property(arbVec, (v) => {
        expect(orient(v, { rot: 0, flip: false })).toEqual(v);
        // four discrete quarter turns equals identity regardless of start
        const a = orient(orient(orient(orient(v, { rot: 1, flip: false }), { rot: 1, flip: false }), { rot: 1, flip: false }), { rot: 1, flip: false });
        expect(a).toEqual(v);
      }),
    );
  });

  it("flipping any vector twice returns the original", () => {
    fc.assert(
      fc.property(arbVec, arbRot, (v, rot) => {
        const once = orient(v, { rot, flip: true });
        // applying the same flip (no extra rotation) twice cancels the mirror
        const twice = orient(once, { rot: 0, flip: true });
        // 'once' already rotated; undo nothing but re-mirror -> rotated-only vector
        const rotatedOnly = orient(v, { rot, flip: false });
        expect(twice).toEqual(rotatedOnly);
      }),
    );
  });

  it("90° clockwise in a y-down grid sends (1,0) -> (0,1)", () => {
    expect(orient({ x: 1, y: 0 }, { rot: 1, flip: false })).toEqual({ x: 0, y: 1 });
    expect(orient({ x: 0, y: 1 }, { rot: 1, flip: false })).toEqual({ x: -1, y: 0 });
    expect(orient({ x: 1, y: 0 }, { rot: 2, flip: false })).toEqual({ x: -1, y: 0 });
  });

  it("flip mirrors x after rotation", () => {
    // rot=0, flip: (3,1) -> (-3,1)
    expect(orient({ x: 3, y: 1 }, { rot: 0, flip: true })).toEqual({ x: -3, y: 1 });
    // rot=1 then flip: (1,0) -> rot ->(0,1) -> flip ->(0,1)  [x already 0]
    expect(orient({ x: 1, y: 0 }, { rot: 1, flip: true })).toEqual({ x: 0, y: 1 });
  });
});

// ───────────────────────────── effectiveDelta ─────────────────────────────

describe("effectiveDelta", () => {
  it("forward = orient(delta); reverse = orient(-delta); perpendicular = orient(perpCW(delta))", () => {
    // Coords are canonicalized (-0 -> 0), so build expected vectors the same way.
    const z = (n: number): number => n + 0;
    fc.assert(
      fc.property(arbVec, arbOrient, (d, o) => {
        expect(effectiveDelta(d, "forward", o)).toEqual(orient(d, o));
        expect(effectiveDelta(d, "reverse", o)).toEqual(orient({ x: z(-d.x), y: z(-d.y) }, o));
        expect(effectiveDelta(d, "perpendicular", o)).toEqual(
          orient({ x: z(-d.y), y: d.x }, o),
        );
      }),
    );
  });

  it("identity-oriented relations match hand values", () => {
    const d = { x: 2, y: 0 };
    expect(effectiveDelta(d, "forward", IDENTITY)).toEqual({ x: 2, y: 0 });
    expect(effectiveDelta(d, "reverse", IDENTITY)).toEqual({ x: -2, y: 0 });
    expect(effectiveDelta(d, "perpendicular", IDENTITY)).toEqual({ x: 0, y: 2 });
  });

  it("offset = orient(skew(delta)) where skew(x,y) = (x - y, x + y)", () => {
    const z = (n: number): number => n + 0;
    const skew = (v: Vec2): Vec2 => ({ x: z(v.x - v.y), y: z(v.x + v.y) });
    fc.assert(
      fc.property(arbVec, arbOrient, (d, o) => {
        expect(effectiveDelta(d, "offset", o)).toEqual(orient(skew(d), o));
      }),
    );
  });

  it("offset hand values: (1,0)->(1,1), (0,1)->(-1,1)", () => {
    expect(effectiveDelta({ x: 1, y: 0 }, "offset", IDENTITY)).toEqual({ x: 1, y: 1 });
    expect(effectiveDelta({ x: 0, y: 1 }, "offset", IDENTITY)).toEqual({ x: -1, y: 1 });
    expect(effectiveDelta({ x: 2, y: 0 }, "offset", IDENTITY)).toEqual({ x: 2, y: 2 });
    // rot=1 CW (y-down) of skew(1,0)=(1,1): (1,1)->(-1,1)
    expect(effectiveDelta({ x: 1, y: 0 }, "offset", { rot: 1, flip: false })).toEqual({
      x: -1,
      y: 1,
    });
    // rot=2 of (1,1) -> (-1,-1)
    expect(effectiveDelta({ x: 1, y: 0 }, "offset", { rot: 2, flip: false })).toEqual({
      x: -1,
      y: -1,
    });
    // flip mirrors x: skew(1,0)=(1,1) -> (-1,1)
    expect(effectiveDelta({ x: 1, y: 0 }, "offset", { rot: 0, flip: true })).toEqual({
      x: -1,
      y: 1,
    });
  });
});

// ───────────────────────────── initialState ─────────────────────────────

describe("initialState", () => {
  it("sets each map's pos to its start and failed=false", () => {
    const m0 = emptyMap(5, { x: 1, y: 2 });
    const m1 = emptyMap(5, { x: 4, y: 0 });
    const s = initialState(mm(m0, m1));
    expect(s.failed).toBe(false);
    expect(s.pos).toEqual([{ x: 1, y: 2 }, { x: 4, y: 0 }]);
  });
});

// ───────────────────────────── INV-1: translate sweep ─────────────────────────────

describe("translate sweep (INV-1)", () => {
  it("advances to the vector end on a clear path", () => {
    const m = emptyMap(6, { x: 0, y: 0 });
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 3, y: 0 }));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 3, y: 0 });
  });

  it("stops one cell before a wall", () => {
    // wall at x=3; pushing right from 0 by 5 should rest at x=2.
    const m = wall(emptyMap(6, { x: 0, y: 0 }), 3, 0);
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 5, y: 0 }));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 2, y: 0 });
  });

  it("stops one cell before the grid edge", () => {
    const m = emptyMap(4, { x: 0, y: 0 }); // valid x: 0..3
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 10, y: 0 }));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 3, y: 0 });
  });

  it("fails when the path enters a hazard, resting on the hazard cell", () => {
    const m = hazard(emptyMap(6, { x: 0, y: 0 }), 2, 0);
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 5, y: 0 }));
    expect(s.failed).toBe(true);
    expect(s.pos[0]).toEqual({ x: 2, y: 0 });
  });

  it("a wall before a hazard stops cleanly (no fail)", () => {
    let m = emptyMap(8, { x: 0, y: 0 });
    m = wall(m, 2, 0);
    m = hazard(m, 4, 0);
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 7, y: 0 }));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 1, y: 0 });
  });

  it("respects orientation: a forward +x push, rotated 90° CW, moves +y (down)", () => {
    const m = emptyMap(6, { x: 0, y: 0 });
    const o: Orientation = { rot: 1, flip: false };
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 3, y: 0 }, "forward", o));
    expect(s.pos[0]).toEqual({ x: 0, y: 3 });
  });

  it("property: with no obstacles, an axis-aligned translate lands at start+effectiveDelta (clamped to grid)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 9 }),
        arbOrient,
        fc.integer({ min: -6, max: 6 }),
        (sx, sy, o, dx) => {
          const n = 10;
          const m = emptyMap(n, { x: sx, y: sy });
          // pure +x delta; effective delta is axis-aligned for any orientation.
          const s = applyStep(mm(m), initialState(mm(m)), translate({ x: dx, y: 0 }, "forward", o));
          const eff = effectiveDelta({ x: dx, y: 0 }, "forward", o);
          const expected = {
            x: Math.max(0, Math.min(n - 1, sx + eff.x)),
            y: Math.max(0, Math.min(n - 1, sy + eff.y)),
          };
          expect(s.failed).toBe(false);
          expect(s.pos[0]).toEqual(expected);
        },
      ),
    );
  });

  it("a spoiled drug ignores all further machines", () => {
    const m = hazard(emptyMap(6, { x: 0, y: 0 }), 1, 0);
    const failed = applyStep(mm(m), initialState(mm(m)), translate({ x: 4, y: 0 }));
    expect(failed.failed).toBe(true);
    const after = applyStep(mm(m), failed, translate({ x: -1, y: 0 }));
    expect(after).toBe(failed); // unchanged reference
  });
});

// ───────────────────────────── offset / diagonal supercover sweep ─────────────────────────────

describe("offset machine + diagonal supercover sweep", () => {
  it("an offset translate moves the drug diagonally to start + skew(delta) on a clear board", () => {
    // skew(3,0) = (3,3): from (1,1) -> (4,4) on a clear board.
    const m = emptyMap(8, { x: 1, y: 1 });
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 3, y: 0 }, "offset"));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 4, y: 4 });
  });

  it("offset respects orientation: skew(1,0)=(1,1) rotated 90° CW -> (-1,1)", () => {
    // from (4,1), effective delta (-1,1) -> (3,2).
    const m = emptyMap(8, { x: 4, y: 1 });
    const s = applyStep(
      mm(m),
      initialState(mm(m)),
      translate({ x: 1, y: 0 }, "offset", { rot: 1, flip: false }),
    );
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 3, y: 2 });
  });

  it("diagonal sweep enters both grazed corners then the diagonal cell, in order", () => {
    // from (0,0) to (2,2): per corner crossing visits x-neighbor, y-neighbor, diagonal.
    const m = emptyMap(6, { x: 0, y: 0 });
    const out = revealAlong(mm(m), initialState(mm(m)), tpl(translate({ x: 2, y: 0 }, "offset")));
    const fog = out.maps[0]!.fog;
    // grazed + diagonal cells for the (0,0)->(2,2) walk:
    expect(fog[idx(6, 1, 0)]).toBe(1); // x-step graze
    expect(fog[idx(6, 0, 1)]).toBe(1); // y-step graze
    expect(fog[idx(6, 1, 1)]).toBe(1); // diagonal
    expect(fog[idx(6, 2, 1)]).toBe(1); // x-step graze (second corner)
    expect(fog[idx(6, 1, 2)]).toBe(1); // y-step graze
    expect(fog[idx(6, 2, 2)]).toBe(1); // diagonal target
  });

  it("hazard on the diagonal cell fails the drug", () => {
    // diagonal path (0,0)->(2,2) passes through (1,1); hazard there fails.
    const m = hazard(emptyMap(6, { x: 0, y: 0 }), 1, 1);
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 2, y: 0 }, "offset"));
    expect(s.failed).toBe(true);
    expect(s.pos[0]).toEqual({ x: 1, y: 1 });
  });

  it("hazard on a grazed corner cell fails the drug before the diagonal", () => {
    // first corner crossing grazes (1,0) (x-step) before reaching diagonal (1,1).
    const m = hazard(emptyMap(6, { x: 0, y: 0 }), 1, 0);
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 2, y: 0 }, "offset"));
    expect(s.failed).toBe(true);
    expect(s.pos[0]).toEqual({ x: 1, y: 0 }); // rests on the grazed hazard
  });

  it("a wall on a grazed corner stops the sweep before the diagonal", () => {
    // wall at the x-step graze (1,0): cannot squeeze diagonally past it.
    const m = wall(emptyMap(6, { x: 0, y: 0 }), 1, 0);
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 2, y: 0 }, "offset"));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 0, y: 0 }); // stuck at start; corner blocked
  });

  it("a wall on the second grazed corner stops mid-diagonal", () => {
    // first corner clear -> reach diagonal (1,1); second corner x-graze (2,1) is a wall.
    const m = wall(emptyMap(6, { x: 0, y: 0 }), 2, 1);
    const s = applyStep(mm(m), initialState(mm(m)), translate({ x: 2, y: 0 }, "offset"));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 1, y: 1 }); // rests on the first diagonal
  });
});

// ───────────────────────────── axis-aligned regression ─────────────────────────────

describe("axis-aligned sweep regression (no corner duplicates)", () => {
  it("horizontal sweep enters exactly the straight cells, in order", () => {
    const m = emptyMap(6, { x: 0, y: 2 });
    const out = revealAlong(mm(m), initialState(mm(m)), tpl(translate({ x: 4, y: 0 })));
    const fog = out.maps[0]!.fog;
    for (let x = 1; x <= 4; x++) expect(fog[idx(6, x, 2)]).toBe(1);
    expect(fog[idx(6, 0, 2)]).toBe(0); // start not entered
    // no off-row cells revealed (no grazing)
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        if (y === 2 && x >= 1 && x <= 4) continue;
        expect(fog[idx(6, x, y)]).toBe(0);
      }
    }
  });

  it("vertical sweep enters exactly the straight cells, in order", () => {
    const m = emptyMap(6, { x: 3, y: 0 });
    const out = revealAlong(mm(m), initialState(mm(m)), tpl(translate({ x: 4, y: 0 }, "perpendicular")));
    const fog = out.maps[0]!.fog;
    for (let y = 1; y <= 4; y++) expect(fog[idx(6, 3, y)]).toBe(1);
    expect(fog[idx(6, 3, 0)]).toBe(0);
    for (let x = 0; x < 6; x++) {
      for (let y = 0; y < 6; y++) {
        if (x === 3 && y >= 1 && y <= 4) continue;
        expect(fog[idx(6, x, y)]).toBe(0);
      }
    }
  });

  it("property: any axis-aligned sweep reveals only same-row/col cells (no grazing)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 1, max: 8 }),
        fc.constantFrom<TranslateRelation>("forward", "reverse"),
        fc.boolean(),
        (sx, sy, mag, rel, horizontal) => {
          const n = 10;
          const m = emptyMap(n, { x: sx, y: sy });
          // horizontal: pure +x delta; vertical: pure +y delta. Both axis-aligned.
          const d = horizontal ? { x: mag, y: 0 } : { x: 0, y: mag };
          const out = revealAlong(mm(m), initialState(mm(m)), tpl(translate(d, rel)));
          const fog = out.maps[0]!.fog;
          for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
              if (fog[idx(n, x, y)] === 1) {
                // every revealed cell shares the row (horizontal eff) or column (vertical eff)
                expect(x === sx || y === sy).toBe(true);
              }
            }
          }
        },
      ),
    );
  });
});

describe("allocation-free sweep endpoint", () => {
  it("matches the canonical sweep for arbitrary walls, hazards, and vectors", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: CellKind.Empty, max: CellKind.Hazard }), {
          minLength: 49,
          maxLength: 49,
        }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: 0, max: 6 }),
        fc.integer({ min: -3, max: 9 }),
        fc.integer({ min: -3, max: 9 }),
        (cells, fromX, fromY, targetX, targetY) => {
          const map = emptyMap(7, { x: fromX, y: fromY });
          map.cell.set(cells);
          const expected = sweep(map, { x: fromX, y: fromY }, { x: targetX, y: targetY });
          const out = new Int32Array(3);
          sweepInto(map, fromX, fromY, targetX, targetY, out, 0);
          expect([out[0], out[1], out[2]]).toEqual([
            expected.pos.x,
            expected.pos.y,
            expected.failed ? 1 : 0,
          ]);
        },
      ),
      { numRuns: 250 },
    );
  });
});

// ───────────────────────────── INV-2: scale ─────────────────────────────

describe("scale (INV-2)", () => {
  it("pulls toward origin by the exact rational, truncating toward zero", () => {
    // origin at (0,0), start at (10, 6), scale 1/2 -> trunc(-10/2)=-5, trunc(-6/2)=-3 -> (5,3)
    const m = emptyMap(12, { x: 10, y: 6 }, { x: 0, y: 0 });
    const s = applyStep(mm(m), initialState(mm(m)), scale(1, 2));
    expect(s.pos[0]).toEqual({ x: 5, y: 3 });
    expect(s.failed).toBe(false);
  });

  it("truncates toward zero on odd distances (no float drift)", () => {
    // origin (0,0), start (7,5), 1/2: trunc(-7/2)=-3, trunc(-5/2)=-2 -> (4,3)
    const m = emptyMap(12, { x: 7, y: 5 }, { x: 0, y: 0 });
    const s = applyStep(mm(m), initialState(mm(m)), scale(1, 2));
    expect(s.pos[0]).toEqual({ x: 4, y: 3 });
  });

  it("works with a non-origin target and 1/3 ratio", () => {
    // origin (1,1), start (10,7): delta=(-9,-6)*1/3=(-3,-2) -> (7,5)
    const m = emptyMap(12, { x: 10, y: 7 }, { x: 1, y: 1 });
    const s = applyStep(mm(m), initialState(mm(m)), scale(1, 3));
    expect(s.pos[0]).toEqual({ x: 7, y: 5 });
  });

  it("scale toward origin past a wall stops one cell before it", () => {
    // origin (0,0), start (10,0), 1/2 -> target (5,0). Put a wall at x=7.
    const m = wall(emptyMap(12, { x: 10, y: 0 }, { x: 0, y: 0 }), 7, 0);
    const s = applyStep(mm(m), initialState(mm(m)), scale(1, 2));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 8, y: 0 });
  });

  it("scale through a hazard fails", () => {
    const m = hazard(emptyMap(12, { x: 10, y: 0 }, { x: 0, y: 0 }), 7, 0);
    const s = applyStep(mm(m), initialState(mm(m)), scale(1, 2));
    expect(s.failed).toBe(true);
    expect(s.pos[0]).toEqual({ x: 7, y: 0 });
  });

  it("property: scale target equals pos + trunc((origin-pos)*num/den) component-wise", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 0, max: 15 }),
        fc.integer({ min: 1, max: 5 }),
        fc.integer({ min: 1, max: 6 }),
        (px, py, ox, oy, num, den0) => {
          fc.pre(num < den0); // require 0 < num < den
          const den = den0;
          const n = 16;
          const m = emptyMap(n, { x: px, y: py }, { x: ox, y: oy });
          const s = applyStep(mm(m), initialState(mm(m)), scale(num, den));
          const expected = {
            x: px + Math.trunc(((ox - px) * num) / den),
            y: py + Math.trunc(((oy - py) * num) / den),
          };
          // On an empty grid (no walls/hazards) the sweep reaches the target.
          expect(s.failed).toBe(false);
          expect(s.pos[0]).toEqual(expected);
        },
      ),
    );
  });
});

// ───────────────────────────── INV-3: swap ─────────────────────────────

describe("swap (INV-3)", () => {
  it("rejects same-map and out-of-range indices instead of silently doing nothing", () => {
    const M = mm(emptyMap(5, { x: 1, y: 1 }), emptyMap(5, { x: 3, y: 3 }));
    expect(() => applyStep(M, initialState(M), swap(0, 0))).toThrow(/swap.*distinct/i);
    expect(() => applyStep(M, initialState(M), swap(0, 2))).toThrow(/swap.*range/i);
  });

  it("exchanges two maps' positions and never fails", () => {
    const m0 = emptyMap(5, { x: 1, y: 1 });
    const m1 = emptyMap(5, { x: 4, y: 3 });
    const M = mm(m0, m1);
    const s = applyStep(M, initialState(M), swap(0, 1));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 4, y: 3 });
    expect(s.pos[1]).toEqual({ x: 1, y: 1 });
  });

  it("applying the same swap twice restores the original positions", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (ax, ay, bx, by) => {
          const m0 = emptyMap(5, { x: ax, y: ay });
          const m1 = emptyMap(5, { x: bx, y: by });
          const M = mm(m0, m1);
          const start = initialState(M);
          const once = applyStep(M, start, swap(0, 1));
          const twice = applyStep(M, once, swap(0, 1));
          expect(twice.pos).toEqual(start.pos);
          expect(twice.failed).toBe(false);
        },
      ),
    );
  });

  it("swap ignores hazards entirely (never fails even atop a hazard cell)", () => {
    const m0 = hazard(emptyMap(5, { x: 1, y: 1 }), 4, 3);
    const m1 = hazard(emptyMap(5, { x: 4, y: 3 }), 1, 1);
    const M = mm(m0, m1);
    const s = applyStep(M, initialState(M), swap(0, 1));
    expect(s.failed).toBe(false);
    expect(s.pos[0]).toEqual({ x: 4, y: 3 });
    expect(s.pos[1]).toEqual({ x: 1, y: 1 });
  });
});

// ───────────────────────────── INV-6 / INV-7: evaluate ─────────────────────────────

describe("evaluate (INV-6, INV-7)", () => {
  it("final position alone determines cure/side-effect (two maps land on cures)", () => {
    // A single uniform +x push of 3 lands BOTH maps on their cure cell at (3,0).
    const m0 = cure(emptyMap(6, { x: 0, y: 0 }), 3, 0, 42);
    const m1 = cure(emptyMap(6, { x: 0, y: 0 }), 3, 0, 9);
    const M = mm(m0, m1);
    const out = evaluate(M, initialState(M), tpl(translate({ x: 3, y: 0 })));
    expect(out.failed).toBe(false);
    expect(out.final).toEqual([{ x: 3, y: 0 }, { x: 3, y: 0 }]);
    expect(out.cured).toEqual([42, 9]); // ascending MAP order, not id order
    expect(out.sideEffects).toEqual([]);
  });

  it("final position alone determines outcome: stopping short of a cure cures nothing", () => {
    // Cure at (3,0) but a wall at (2,0) stops the drug at (1,0): no cure.
    const m = wall(cure(emptyMap(6, { x: 0, y: 0 }), 3, 0, 42), 2, 0);
    const M = mm(m);
    const out = evaluate(M, initialState(M), tpl(translate({ x: 3, y: 0 })));
    expect(out.failed).toBe(false);
    expect(out.final).toEqual([{ x: 1, y: 0 }]);
    expect(out.cured).toEqual([]);
  });

  it("collects cure and side-effect ids in ascending map order", () => {
    const m0 = cure(emptyMap(6, { x: 0, y: 0 }), 2, 0, 100);
    const m1 = side(emptyMap(6, { x: 0, y: 0 }), 2, 0, 200);
    const M = mm(m0, m1);
    const out = evaluate(M, initialState(M), tpl(translate({ x: 2, y: 0 })));
    expect(out.cured).toEqual([100]);
    expect(out.sideEffects).toEqual([200]);
  });

  it("a spoiled drug cures nothing but still reports final position", () => {
    let m = cure(emptyMap(6, { x: 0, y: 0 }), 5, 0, 1);
    m = hazard(m, 2, 0);
    const M = mm(m);
    const out = evaluate(M, initialState(M), tpl(translate({ x: 5, y: 0 })));
    expect(out.failed).toBe(true);
    expect(out.cured).toEqual([]);
    expect(out.sideEffects).toEqual([]);
    expect(out.final).toEqual([{ x: 2, y: 0 }]);
  });

  it("is deterministic: evaluating twice yields an identical Outcome", () => {
    const m0 = cure(side(emptyMap(7, { x: 0, y: 0 }), 6, 6, 3), 3, 0, 1);
    const m1 = emptyMap(7, { x: 6, y: 0 }, { x: 0, y: 0 });
    const M = mm(m0, m1);
    const t = tpl(translate({ x: 3, y: 0 }), scale(1, 2), swap(0, 1));
    const a = evaluate(M, initialState(M), t);
    const b = evaluate(M, initialState(M), t);
    expect(a).toEqual(b);
  });

  it("INV-7 property: evaluate is a pure function of (mm, start, template)", () => {
    const arbStep: fc.Arbitrary<Machine> = fc.oneof(
      fc.record({ d: arbVec, r: fc.constantFrom<TranslateRelation>("forward", "reverse", "perpendicular"), o: arbOrient }).map(
        ({ d, r, o }) => translate(d, r, o),
      ),
      fc.record({ num: fc.integer({ min: 1, max: 3 }), den: fc.integer({ min: 2, max: 4 }) })
        .filter(({ num, den }) => num < den)
        .map(({ num, den }) => scale(num, den)),
      fc.constant(swap(0, 1)),
    );
    fc.assert(
      fc.property(fc.array(arbStep, { maxLength: 6 }), (steps) => {
        const m0 = cure(emptyMap(8, { x: 2, y: 3 }, { x: 0, y: 0 }), 5, 5, 11);
        const m1 = side(emptyMap(8, { x: 5, y: 1 }, { x: 7, y: 7 }), 1, 1, 22);
        const M = mm(m0, m1);
        const t = tpl(...steps);
        const a = evaluate(M, initialState(M), t);
        const b = evaluate(M, initialState(M), t);
        const c = evaluate(M, initialState(M), t);
        expect(b).toEqual(a);
        expect(c).toEqual(a);
        // applyTemplate must agree with evaluate's reported finals
        const st = applyTemplate(M, initialState(M), t);
        expect(a.final).toEqual(st.pos);
        expect(a.failed).toBe(st.failed);
      }),
    );
  });
});

// ───────────────────────────── INV-8: anti-copy ─────────────────────────────

/** Rotate every translate step's orientation by +90° (rot+1 mod 4); leave others. */
function rotateTemplate(t: Template): Template {
  return {
    steps: t.steps.map((m) => {
      if (m.transform.kind !== "translate") return m;
      const rot = ((m.orientation.rot + 1) % 4) as Rotation;
      return { ...m, orientation: { rot, flip: m.orientation.flip } };
    }),
  };
}

describe("anti-copy (INV-8)", () => {
  it("constructed: rotating a push template +90° changes the final positions", () => {
    // Open 11x11 map, start near center; a forward +x push and a +x push2.
    const m = emptyMap(11, { x: 5, y: 5 });
    const M = mm(m);
    const t = tpl(translate({ x: 3, y: 0 }, "forward"), translate({ x: 2, y: 0 }, "forward"));
    const base = evaluate(M, initialState(M), t);
    const rot = evaluate(M, initialState(M), rotateTemplate(t));
    expect(base.final).not.toEqual(rot.final); // (10,5) vs (5,10)
  });

  it("samples many open-map templates; rotation changes the outcome in the overwhelming majority", () => {
    const arbTranslate: fc.Arbitrary<Machine> = fc
      .record({
        d: fc.record({ x: fc.integer({ min: -3, max: 3 }), y: fc.integer({ min: -3, max: 3 }) }),
        r: fc.constantFrom<TranslateRelation>("forward", "reverse", "perpendicular"),
        o: arbOrient,
      })
      // skip zero deltas (degenerate: rotation of (0,0) is still (0,0))
      .filter(({ d }) => d.x !== 0 || d.y !== 0)
      .map(({ d, r, o }) => translate(d, r, o));

    let total = 0;
    let changed = 0;
    fc.assert(
      fc.property(
        fc.array(arbTranslate, { minLength: 1, maxLength: 4 }),
        fc.record({ x: fc.integer({ min: 8, max: 12 }), y: fc.integer({ min: 8, max: 12 }) }),
        (steps, start) => {
          // Large open map so edges rarely clip and rotation genuinely matters.
          const n = 21;
          const clamp = (v: number): number => Math.max(0, Math.min(n - 1, v));
          const m = emptyMap(n, { x: clamp(start.x), y: clamp(start.y) });
          const M = mm(m);
          const t = tpl(...steps);
          const base = applyTemplate(M, initialState(M), t);
          const rot = applyTemplate(M, initialState(M), rotateTemplate(t));
          total++;
          if (base.pos[0]?.x !== rot.pos[0]?.x || base.pos[0]?.y !== rot.pos[0]?.y) changed++;
        },
      ),
      { numRuns: 400 },
    );
    // Robust, non-flaky: the vast majority must differ. (Some net-zero or
    // rotation-symmetric sequences legitimately coincide.)
    expect(changed / total).toBeGreaterThan(0.8);
  });
});

// ───────────────────────────── revealAlong ─────────────────────────────

describe("revealAlong", () => {
  it("reveals every entered cell along the sweep and copies fog (no input mutation)", () => {
    const m = emptyMap(6, { x: 0, y: 0 });
    const M = mm(m);
    const out = revealAlong(M, initialState(M), tpl(translate({ x: 3, y: 0 })));
    const fog = out.maps[0]!.fog;
    // start (0,0) NOT entered; (1,0),(2,0),(3,0) entered.
    expect(fog[idx(6, 0, 0)]).toBe(0);
    expect(fog[idx(6, 1, 0)]).toBe(1);
    expect(fog[idx(6, 2, 0)]).toBe(1);
    expect(fog[idx(6, 3, 0)]).toBe(1);
    expect(fog[idx(6, 4, 0)]).toBe(0);
    // input untouched
    expect(M.maps[0]!.fog.every((v) => v === 0)).toBe(true);
    // it is a NEW MultiMap / fog buffer
    expect(out.maps[0]!.fog).not.toBe(M.maps[0]!.fog);
  });

  it("reveals up to and including the hazard cell that fails the drug", () => {
    const m = hazard(emptyMap(6, { x: 0, y: 0 }), 2, 0);
    const M = mm(m);
    const out = revealAlong(M, initialState(M), tpl(translate({ x: 5, y: 0 })));
    const fog = out.maps[0]!.fog;
    expect(fog[idx(6, 1, 0)]).toBe(1);
    expect(fog[idx(6, 2, 0)]).toBe(1); // the hazard cell IS entered
    expect(fog[idx(6, 3, 0)]).toBe(0); // nothing beyond
  });

  it("does not reveal the wall cell that merely stops the sweep", () => {
    const m = wall(emptyMap(6, { x: 0, y: 0 }), 3, 0);
    const M = mm(m);
    const out = revealAlong(M, initialState(M), tpl(translate({ x: 5, y: 0 })));
    const fog = out.maps[0]!.fog;
    expect(fog[idx(6, 2, 0)]).toBe(1);
    expect(fog[idx(6, 3, 0)]).toBe(0); // the wall itself stays fogged
  });

  it("once the drug fails, later steps reveal nothing further", () => {
    const m = hazard(emptyMap(8, { x: 0, y: 0 }), 1, 0);
    const M = mm(m);
    // Step 1 fails at (1,0). Step 2 would otherwise sweep far.
    const out = revealAlong(M, initialState(M), tpl(translate({ x: 1, y: 0 }), translate({ x: 5, y: 0 })));
    const fog = out.maps[0]!.fog;
    expect(fog[idx(8, 1, 0)]).toBe(1);
    for (let x = 2; x < 8; x++) expect(fog[idx(8, x, 0)]).toBe(0);
  });
});

// ───────────────────────────── purity / immutability ─────────────────────────────

describe("purity", () => {
  it("applyStep returns a new state and never mutates inputs", () => {
    const m = emptyMap(6, { x: 0, y: 0 });
    const M = mm(m);
    const start = initialState(M);
    const snapshotPos = start.pos.map((p) => ({ ...p }));
    const next = applyStep(M, start, translate({ x: 2, y: 0 }));
    expect(next).not.toBe(start);
    expect(start.pos).toEqual(snapshotPos); // start unchanged
    expect(next.pos[0]).toEqual({ x: 2, y: 0 });
  });
});
