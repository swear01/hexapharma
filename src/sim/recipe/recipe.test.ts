import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  Vec2,
  Dir,
  EffectMap,
  MultiMap,
  Machine,
  Template,
  Orientation,
  Rotation,
  TranslateRelation,
  FactoryTile,
  FactoryLayout,
  FactoryMachineDef,
  PlacedMachine,
} from "../phase0_interfaces";
import { CellKind, IDENTITY, DEFAULT_CATALOG, SHAPE_1x1 } from "../phase0_interfaces";
import { initialState, applyTemplate, evaluate } from "../drug-graph";
import { replayFactory } from "../state";
import { compileTemplate, factoryOutcome } from "./index";

// ───────────────────────────── fixture helpers ─────────────────────────────

const E: Dir = 0;
const idx = (w: number, x: number, y: number): number => y * w + x;

/** An NxN map, all-Empty, fully revealed, with given start + origin. */
function emptyMap(n: number, start: Vec2, origin: Vec2 = { x: 0, y: 0 }): EffectMap {
  const len = n * n;
  return {
    width: n,
    height: n,
    origin,
    start,
    cell: new Uint8Array(len),
    cureId: new Int16Array(len).fill(-1),
    sideEffectId: new Int16Array(len).fill(-1),
    fog: new Uint8Array(len).fill(1),
  };
}

function withCell(
  m: EffectMap,
  x: number,
  y: number,
  kind: number,
  ids?: { cure?: number; side?: number },
): EffectMap {
  const cell = Uint8Array.from(m.cell);
  const cureId = Int16Array.from(m.cureId);
  const sideEffectId = Int16Array.from(m.sideEffectId);
  const i = idx(m.width, x, y);
  cell[i] = kind;
  if (ids?.cure !== undefined) cureId[i] = ids.cure;
  if (ids?.side !== undefined) sideEffectId[i] = ids.side;
  return { ...m, cell, cureId, sideEffectId };
}

const cure = (m: EffectMap, x: number, y: number, cureId: number): EffectMap =>
  withCell(m, x, y, CellKind.Cure, { cure: cureId });
const side = (m: EffectMap, x: number, y: number, sideId: number): EffectMap =>
  withCell(m, x, y, CellKind.SideEffect, { side: sideId });

const mm = (...maps: EffectMap[]): MultiMap => ({ maps });

const translate = (
  delta: Vec2,
  relation: TranslateRelation = "forward",
  orientation: Orientation = IDENTITY,
  typeId = "t",
): Machine => ({ typeId, transform: { kind: "translate", delta, relation }, orientation });

const scale = (num: number, den: number, typeId = "dilute"): Machine => ({
  typeId,
  transform: { kind: "scale", num, den },
  orientation: IDENTITY,
});

const swap = (a: number, b: number, typeId = "swap01"): Machine => ({
  typeId,
  transform: { kind: "swap", a, b },
  orientation: IDENTITY,
});

const tpl = (...steps: Machine[]): Template => ({ steps });

/** A small 2-map fixture: map0 has a cure at (8,5); map1 has a side-effect at (8,8). */
function fixture(): { mm: MultiMap; start: ReturnType<typeof initialState> } {
  const m0 = cure(emptyMap(20, { x: 5, y: 5 }, { x: 0, y: 0 }), 8, 5, 7);
  const m1 = side(emptyMap(20, { x: 8, y: 8 }, { x: 0, y: 0 }), 8, 8, 3);
  const map = mm(m0, m1);
  return { mm: map, start: initialState(map) };
}

const ori = (rot: Rotation, flip = false): Orientation => ({ rot, flip });

// ───────────────────────── manual layout builder (for rearrange) ─────────────────────────
// New model: machines are 1×1 PlacedMachines in machines[]; their cell is an "empty"
// tile fed from the west and emitting east. `gap` controls how many belt tiles sit
// after each machine — a different belt routing that must NOT change the effect (INV-7).

function defOf(step: Machine): FactoryMachineDef {
  return {
    typeId: step.typeId,
    transform: step.transform,
    orientation: step.orientation,
    cost: 0,
    speed: 1,
  };
}

function spacedLine(template: Template, gap: number): FactoryLayout {
  const tiles: FactoryTile[] = [{ kind: "source", dir: E, period: 1 }];
  const machines: PlacedMachine[] = [];
  template.steps.forEach((step, i) => {
    tiles.push({ kind: "belt", dir: E }); // feed belt (west of the machine)
    const machX = tiles.length;
    tiles.push({ kind: "empty" }); // machine cell
    machines.push({ id: i, def: defOf(step), anchor: { x: machX, y: 0 }, footRot: 0, shape: SHAPE_1x1 });
    const g = Math.max(1, gap); // ≥1 belt east of each machine so its output has somewhere to go
    for (let j = 0; j < g; j++) tiles.push({ kind: "belt", dir: E });
  });
  tiles.push({ kind: "sink" });
  return { width: tiles.length, height: 1, tiles, machines };
}

// ──────────────────────────────── tests ────────────────────────────────

describe("compileTemplate / factoryOutcome", () => {
  const samples: { name: string; t: Template }[] = [
    { name: "single push E", t: tpl(translate({ x: 1, y: 0 }, "forward", IDENTITY, "push")) },
    {
      name: "two forwards",
      t: tpl(
        translate({ x: 2, y: 0 }, "forward", IDENTITY, "push2"),
        translate({ x: 1, y: 0 }, "forward", IDENTITY, "push"),
      ),
    },
    { name: "offset (skew) machine", t: tpl(translate({ x: 1, y: 0 }, "offset", IDENTITY, "skew")) },
    {
      name: "perpendicular (shear) + rotation",
      t: tpl(translate({ x: 1, y: 0 }, "perpendicular", ori(1), "shear")),
    },
    { name: "scale (dilute)", t: tpl(scale(1, 2)) },
    { name: "swap then push", t: tpl(swap(0, 1), translate({ x: 1, y: 0 }, "forward")) },
    {
      name: "cure-landing line (map0 5,5 -> 8,5)",
      t: tpl(translate({ x: 3, y: 0 }, "forward", IDENTITY, "push")),
    },
  ];

  it("compiles a source->machines->sink line in order (machines in machines[])", () => {
    const t = samples[1]!.t;
    const layout = compileTemplate(t);
    expect(layout.height).toBe(1);
    expect(layout.width).toBe(2 * t.steps.length + 3);
    expect(layout.tiles[0]).toMatchObject({ kind: "source" });
    expect(layout.tiles[layout.width - 1]).toMatchObject({ kind: "sink" });
    expect(layout.machines.length).toBe(t.steps.length);
    for (let i = 0; i < t.steps.length; i++) {
      const pm = layout.machines[i]!;
      expect(pm.def.typeId).toBe(t.steps[i]!.typeId);
      expect(pm.def.speed).toBe(1);
      expect(pm.shape).toBe(SHAPE_1x1);
    }
  });

  it("derives cost from DEFAULT_CATALOG (fallback 0)", () => {
    const layout = compileTemplate(tpl(translate({ x: 1, y: 0 }, "forward", IDENTITY, "push")));
    const pushCost = DEFAULT_CATALOG.find((e) => e.typeId === "push")!.cost;
    expect(layout.machines[0]!.def.cost).toBe(pushCost);

    const unknown = compileTemplate(tpl(translate({ x: 1, y: 0 }, "forward", IDENTITY, "mystery")));
    expect(unknown.machines[0]!.def.cost).toBe(0);
  });

  for (const { name, t } of samples) {
    it(`realizes the template (${name}): final pos + Outcome match the pure engine`, () => {
      const { mm: map, start } = fixture();
      const layout = compileTemplate(t);

      const cap = (layout.width + 1) * 6 + 16;
      const ran = replayFactory(layout, map, start, cap);
      const produced = ran.produced[0];
      expect(produced).toBeDefined();

      const pure = applyTemplate(map, start, t);
      expect(produced!.pos).toEqual(pure.pos);
      expect(produced!.failed).toBe(pure.failed);

      expect(factoryOutcome(layout, map, start)).toEqual(evaluate(map, start, t));
    });
  }

  it("a cure-landing line actually reports the cure", () => {
    const { mm: map, start } = fixture();
    // map0: start (5,5) + push x3 -> (8,5) == cure id 7.
    const t = tpl(translate({ x: 3, y: 0 }, "forward", IDENTITY, "push"));
    const out = factoryOutcome(compileTemplate(t), map, start);
    expect(out.failed).toBe(false);
    expect(out.cured).toContain(7);
  });
});

describe("rearrange-invariance (INV-7 at the factory level)", () => {
  const rearrangeable: { name: string; t: Template }[] = [
    {
      name: "mixed translate/scale/swap",
      t: tpl(
        translate({ x: 2, y: 0 }, "forward", IDENTITY, "push2"),
        scale(1, 2),
        swap(0, 1),
        translate({ x: 1, y: 0 }, "perpendicular", ori(1), "shear"),
      ),
    },
    {
      name: "offset chain",
      t: tpl(
        translate({ x: 1, y: 0 }, "offset", IDENTITY, "skew"),
        translate({ x: 1, y: 0 }, "offset", ori(2), "skew"),
      ),
    },
  ];

  for (const { name, t } of rearrangeable) {
    it(`belt spacing does not change the effect (${name})`, () => {
      const { mm: map, start } = fixture();

      const compact = compileTemplate(t); // back-to-back (1 belt between)
      const spaced = spacedLine(t, 3); // more belts between machines

      const outCompact = factoryOutcome(compact, map, start);
      const outSpaced = factoryOutcome(spaced, map, start);
      const pure = evaluate(map, start, t);

      expect(outCompact).toEqual(pure);
      expect(outSpaced).toEqual(pure);
      expect(outSpaced).toEqual(outCompact);

      const dCompact = replayFactory(compact, map, start, (compact.width + 1) * 6 + 16).produced[0];
      const dSpaced = replayFactory(spaced, map, start, (spaced.width + 1) * 6 + 16).produced[0];
      expect(dSpaced!.pos).toEqual(dCompact!.pos);
      expect(dSpaced!.failed).toEqual(dCompact!.failed);
    });
  }

  it("a routed detour (extra belts) preserves the effect", () => {
    const { mm: map, start } = fixture();
    const t = tpl(
      translate({ x: 1, y: 0 }, "forward", IDENTITY, "push"),
      scale(1, 2),
      translate({ x: 2, y: 0 }, "forward", IDENTITY, "push2"),
    );
    expect(factoryOutcome(spacedLine(t, 1), map, start)).toEqual(
      factoryOutcome(spacedLine(t, 5), map, start),
    );
    expect(factoryOutcome(spacedLine(t, 5), map, start)).toEqual(evaluate(map, start, t));
  });
});

describe("determinism", () => {
  it("compiling + running twice yields identical results", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dx: fc.integer({ min: -2, max: 2 }),
            dy: fc.integer({ min: -2, max: 2 }),
            rel: fc.constantFrom<TranslateRelation>("forward", "reverse", "perpendicular", "offset"),
            rot: fc.constantFrom<Rotation>(0, 1, 2, 3),
            flip: fc.boolean(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        (specs) => {
          const steps: Machine[] = specs.map((sp) =>
            translate({ x: sp.dx, y: sp.dy }, sp.rel, ori(sp.rot, sp.flip), "push"),
          );
          const t = tpl(...steps);
          const { mm: map, start } = fixture();

          const a = compileTemplate(t);
          const b = compileTemplate(t);
          expect(a).toEqual(b);

          const oa = factoryOutcome(a, map, start);
          const ob = factoryOutcome(b, map, start);
          expect(oa).toEqual(ob);
          expect(oa).toEqual(evaluate(map, start, t));
        },
      ),
      { numRuns: 60 },
    );
  });
});
