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
import {
  CellKind,
  IDENTITY,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  MAX_FACTORY_REPLAY_TICKS,
  MAX_TEMPLATE_STEPS,
  SHAPE_1x1,
} from "../phase0_interfaces";
import { initialState, applyTemplate, evaluate } from "../drug-graph";
import { worldCells } from "../factory-geom";
import { initFactory, snapshotProducedEvents, stepFactory } from "../factory-sim";
import { compileTemplate, factoryOutcome } from "./index";

// ───────────────────────────── fixture helpers ─────────────────────────────

const E: Dir = 0;
const idx = (w: number, x: number, y: number): number => y * w + x;

function firstProduct(layout: FactoryLayout, mm: MultiMap, start: ReturnType<typeof initialState>, ticks: number) {
  const runtime = initFactory(layout, mm, start);
  for (let tick = 0; tick < ticks; tick++) {
    stepFactory(layout, mm, runtime);
    if (runtime.producedEvents.count > 0) return snapshotProducedEvents(runtime)[0];
  }
  return undefined;
}

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
    sideEffectId: new Int32Array(len).fill(-1),
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
  const sideEffectId = Int32Array.from(m.sideEffectId);
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
  typeId = "push",
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

function serpentineLayout(size: number): FactoryLayout {
  const path: Vec2[] = [];
  for (let y = 0; y < size; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < size; x++) path.push({ x, y });
    } else {
      for (let x = size - 1; x >= 0; x--) path.push({ x, y });
    }
  }
  const tiles = new Array<FactoryTile>(size * size).fill({ kind: "empty" });
  const direction = (from: Vec2, to: Vec2): Dir => {
    if (to.x > from.x) return 0;
    if (to.x < from.x) return 2;
    if (to.y > from.y) return 1;
    return 3;
  };
  tiles[0] = { kind: "source", dir: direction(path[0]!, path[1]!), period: 1 };
  for (let index = 1; index < path.length - 1; index++) {
    const cell = path[index]!;
    tiles[cell.y * size + cell.x] = {
      kind: "belt",
      dir: direction(cell, path[index + 1]!),
    };
  }
  const sink = path.at(-1)!;
  tiles[sink.y * size + sink.x] = { kind: "sink" };
  return { width: size, height: size, tiles, machines: [] };
}

// ──────────────────────────────── tests ────────────────────────────────

describe("compileTemplate / factoryOutcome", () => {
  it("waits for a product across a legal long routing path", () => {
    const map = mm(emptyMap(40, { x: 5, y: 5 }), emptyMap(40, { x: 8, y: 8 }));
    const start = initialState(map);
    const outcome = factoryOutcome(serpentineLayout(20), map, start);
    expect(outcome).toEqual({
      failed: false,
      final: start.pos,
      cured: [],
      sideEffects: [],
    });
  });

  it("rejects a first-product diagnostic above the layout-weighted work budget", () => {
    const map = mm(emptyMap(40, { x: 5, y: 5 }), emptyMap(40, { x: 8, y: 8 }));
    const start = initialState(map);
    expect(() => factoryOutcome(serpentineLayout(22), map, start)).toThrow(
      /analysis work budget/i,
    );
  });

  it("rejects oversized templates before sizing factory geometry", () => {
    const step = translate({ x: 1, y: 0 });
    expect(() => compileTemplate({
      steps: new Array(MAX_TEMPLATE_STEPS + 1).fill(step),
    })).toThrow(/steps|256/i);
  });

  it("does not alias mutable empty tiles in a compiled layout", () => {
    const layout = compileTemplate({ steps: [] });
    const emptyIndexes = layout.tiles
      .map((tile, index) => tile.kind === "empty" ? index : -1)
      .filter((index) => index >= 0);
    expect(emptyIndexes.length).toBeGreaterThanOrEqual(2);
    const first = emptyIndexes[0]!;
    const second = emptyIndexes[1]!;
    (layout.tiles[first] as { kind: string }).kind = "sink";
    expect(layout.tiles[second]).toEqual({ kind: "empty" });
  });

  it("throws instead of reporting a false failure when first-product replay exhausts its budget", () => {
    const map = mm(emptyMap(40, { x: 5, y: 5 }), emptyMap(40, { x: 8, y: 8 }));
    const start = initialState(map);
    const b: FactoryLayout = {
      width: 3,
      height: 1,
      tiles: [
        { kind: "source", dir: E, period: 1 },
        { kind: "empty" },
        { kind: "sink" },
      ],
      machines: [
        {
          id: 0,
          def: {
            typeId: "slow",
            transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" },
            orientation: IDENTITY,
            cost: 1,
            speed: MAX_FACTORY_REPLAY_TICKS,
          },
          anchor: { x: 1, y: 0 },
          footRot: 0,
          shape: SHAPE_1x1,
        },
      ],
    };
    expect(() => factoryOutcome(b, map, start)).toThrow(/budget/i);
  });

  it("owns compiled machine transforms and orientations without freezing caller inputs", () => {
    const step = structuredClone(DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!);
    const machine: Machine = {
      typeId: step.typeId,
      transform: step.transform,
      orientation: { rot: 0, flip: false },
    };
    const layout = compileTemplate({ steps: [machine] });
    if (machine.transform.kind !== "translate") throw new Error("push fixture must translate");
    const mutableDelta = machine.transform.delta as { x: number };
    const mutableOrientation = machine.orientation as { rot: Rotation };
    mutableDelta.x = 7;
    mutableOrientation.rot = 2;
    expect(layout.machines[0]?.def.transform).toMatchObject({ delta: { x: 1, y: 0 } });
    expect(layout.machines[0]?.def.orientation).toEqual({ rot: 0, flip: false });

    const testLevel = fixture();
    initFactory(layout, testLevel.mm, testLevel.start);
    expect(() => {
      mutableDelta.x = 8;
      mutableOrientation.rot = 3;
    }).not.toThrow();
  });
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
    { name: "scale (dilute, 2×2)", t: tpl(scale(1, 2)) },
    { name: "shear (L) machine", t: tpl(translate({ x: 1, y: 0 }, "perpendicular", IDENTITY, "shear")) },
    { name: "swap01 (offset 2×1)", t: tpl(swap(0, 1)) },
    { name: "swap then push", t: tpl(swap(0, 1), translate({ x: 1, y: 0 }, "forward")) },
    {
      name: "mixed: push2 → dilute → swap → shear",
      t: tpl(
        translate({ x: 2, y: 0 }, "forward", IDENTITY, "push2"),
        scale(1, 2),
        swap(0, 1),
        translate({ x: 1, y: 0 }, "perpendicular", ori(1), "shear"),
      ),
    },
    {
      name: "cure-landing line (map0 5,5 -> 8,5)",
      t: tpl(translate({ x: 3, y: 0 }, "forward", IDENTITY, "push")),
    },
  ];

  it("compiles a belt-routed source→machines→sink layout (machines in machines[])", () => {
    const t = samples[1]!.t;
    const layout = compileTemplate(t);
    // A real (possibly multi-row) canvas with a source, a sink and one machine per step.
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    expect(layout.tiles.length).toBe(layout.width * layout.height);
    expect(layout.tiles.some((tile) => tile.kind === "source")).toBe(true);
    expect(layout.tiles.some((tile) => tile.kind === "sink")).toBe(true);
    expect(layout.machines.length).toBe(t.steps.length);
    for (let i = 0; i < t.steps.length; i++) {
      const pm = layout.machines[i]!;
      const typeId = t.steps[i]!.typeId;
      expect(pm.def.typeId).toBe(typeId);
      expect(pm.def.speed).toBe(DEFAULT_CATALOG.find((entry) => entry.typeId === typeId)?.speed ?? 1);
      // REAL shape used — the type's canonical footprint, not a flattened 1×1.
      expect(pm.shape).toBe(DEFAULT_SHAPES[typeId] ?? SHAPE_1x1);
    }
  });

  for (const { name, t } of samples) {
    it(`uses the real footprint shape per step + no overlapping cells (${name})`, () => {
      const layout = compileTemplate(t);

      // Every machine carries its type's canonical footprint.
      layout.machines.forEach((pm, i) => {
        const typeId = t.steps[i]!.typeId;
        expect(pm.shape).toBe(DEFAULT_SHAPES[typeId] ?? SHAPE_1x1);
      });

      // No overlaps: machine world-cells and every non-empty tile cell are pairwise disjoint.
      const seen = new Set<number>();
      const claim = (x: number, y: number): void => {
        const key = y * layout.width + x;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      };
      for (const pm of layout.machines) {
        for (const c of worldCells(pm)) claim(c.x, c.y);
      }
      for (let y = 0; y < layout.height; y++) {
        for (let x = 0; x < layout.width; x++) {
          const tile = layout.tiles[y * layout.width + x]!;
          if (tile.kind === "empty") continue;
          claim(x, y); // belt / splitter / merger / source / sink
        }
      }
    });

    it(`produces a unit within a bounded replay, no deadlock (${name})`, () => {
      const { mm: map, start } = fixture();
      const layout = compileTemplate(t);
      const cap = (layout.width + layout.height) * 6 + 16;
      const produced = firstProduct(layout, map, start, cap);
      expect(produced).toBeDefined();
    });

    it(`compiles deterministically (${name})`, () => {
      expect(compileTemplate(t)).toEqual(compileTemplate(t));
    });
  }

  it("derives cost from DEFAULT_CATALOG and rejects unknown machine types", () => {
    const layout = compileTemplate(tpl(translate({ x: 1, y: 0 }, "forward", IDENTITY, "push")));
    const pushCost = DEFAULT_CATALOG.find((e) => e.typeId === "push")!.cost;
    expect(layout.machines[0]!.def.cost).toBe(pushCost);

    expect(() =>
      compileTemplate(tpl(translate({ x: 1, y: 0 }, "forward", IDENTITY, "mystery"))),
    ).toThrow(/unknown machine/i);
  });

  for (const { name, t } of samples) {
    it(`realizes the template (${name}): final pos + Outcome match the pure engine`, () => {
      const { mm: map, start } = fixture();
      const layout = compileTemplate(t);

      const cap = (layout.width + layout.height) * 6 + 16;
      const produced = firstProduct(layout, map, start, cap);
      expect(produced).toBeDefined();

      const pure = applyTemplate(map, start, t);
      expect(produced!.drug.pos).toEqual(pure.pos);
      expect(produced!.drug.failed).toBe(pure.failed);

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

      const dCompact = firstProduct(compact, map, start, (compact.width + 1) * 6 + 16);
      const dSpaced = firstProduct(spaced, map, start, (spaced.width + 1) * 6 + 16);
      expect(dSpaced!.drug.pos).toEqual(dCompact!.drug.pos);
      expect(dSpaced!.drug.failed).toEqual(dCompact!.drug.failed);
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
