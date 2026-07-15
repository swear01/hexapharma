import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type {
  EffectMap,
  FactoryLayout,
  FactoryMachineDef,
  FactoryTile,
  Machine,
  MultiMap,
  PlacedMachine,
  Template,
  Vec2,
} from "../phase0_interfaces";
import {
  CellKind,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  MAX_FACTORY_REPLAY_TICKS,
  MAX_TEMPLATE_STEPS,
  SHAPE_1x1,
} from "../phase0_interfaces";
import { applyTemplate, evaluate, initialState } from "../drug-graph";
import { worldCells } from "../factory-geom";
import { initFactory, snapshotProducedEvents, stepFactory } from "../factory-sim";
import { compileTemplate, factoryOutcome } from ".";

const E = 0 as const;

function emptyMap(size: number, start: Vec2): EffectMap {
  const area = size * size;
  return {
    width: size,
    height: size,
    origin: { x: Math.floor(size / 2), y: Math.floor(size / 2) },
    start,
    cell: new Uint8Array(area),
    cureId: new Int16Array(area).fill(-1),
    sideEffectId: new Int32Array(area).fill(-1),
    portalTo: new Int32Array(area).fill(-1),
    fog: new Uint8Array(area).fill(1),
  };
}

function machine(typeId: string): Machine {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`missing test machine ${typeId}`);
  return { typeId, path: entry.path };
}

const template = (...steps: Machine[]): Template => ({ steps });
const multimaps = (...maps: EffectMap[]): MultiMap => ({ maps });

function firstProduct(layout: FactoryLayout, mm: MultiMap, ticks: number) {
  const runtime = initFactory(layout, mm, initialState(mm));
  for (let tick = 0; tick < ticks; tick++) {
    stepFactory(layout, mm, runtime);
    if (runtime.producedEvents.count > 0) return snapshotProducedEvents(runtime)[0];
  }
  return undefined;
}

function defOf(step: Machine): FactoryMachineDef {
  return { typeId: step.typeId, path: step.path, cost: 0, speed: 1 };
}

function spacedLine(value: Template, gap: number): FactoryLayout {
  const tiles: FactoryTile[] = [{ kind: "source", dir: E, period: 1 }];
  const machines: PlacedMachine[] = [];
  value.steps.forEach((step, id) => {
    tiles.push({ kind: "belt", dir: E });
    const x = tiles.length;
    tiles.push({ kind: "empty" });
    machines.push({ id, def: defOf(step), anchor: { x, y: 0 }, footRot: 0, shape: SHAPE_1x1 });
    for (let index = 0; index < Math.max(1, gap); index++) tiles.push({ kind: "belt", dir: E });
  });
  tiles.push({ kind: "sink" });
  return { width: tiles.length, height: 1, tiles, machines };
}

function serpentineLayout(size: number): FactoryLayout {
  const path: Vec2[] = [];
  for (let y = 0; y < size; y++) {
    if (y % 2 === 0) for (let x = 0; x < size; x++) path.push({ x, y });
    else for (let x = size - 1; x >= 0; x--) path.push({ x, y });
  }
  const direction = (from: Vec2, to: Vec2) => (
    to.x > from.x ? 0 : to.x < from.x ? 2 : to.y > from.y ? 1 : 3
  ) as 0 | 1 | 2 | 3;
  const tiles = Array.from<unknown, FactoryTile>({ length: size * size }, () => ({ kind: "empty" }));
  tiles[0] = { kind: "source", dir: direction(path[0]!, path[1]!), period: 1 };
  for (let index = 1; index < path.length - 1; index++) {
    const cell = path[index]!;
    tiles[cell.y * size + cell.x] = { kind: "belt", dir: direction(cell, path[index + 1]!) };
  }
  const sink = path.at(-1)!;
  tiles[sink.y * size + sink.x] = { kind: "sink" };
  return { width: size, height: size, tiles, machines: [] };
}

const samples: readonly Template[] = [
  template(machine("push")),
  template(machine("push2")),
  template(machine("dilute")),
  template(machine("skew"), machine("pull")),
  template(machine("push"), machine("shear"), machine("settle")),
];

describe("compileTemplate and factoryOutcome", () => {
  it("waits for a product across a legal long routing path", () => {
    const mm = multimaps(emptyMap(41, { x: 20, y: 20 }));
    expect(factoryOutcome(serpentineLayout(20), mm, initialState(mm))).toEqual({
      failed: false,
      final: [{ x: 20, y: 20 }],
      cured: [],
      sideEffects: [],
    });
  });

  it("rejects diagnostics above the layout-weighted work budget", () => {
    const mm = multimaps(emptyMap(41, { x: 20, y: 20 }));
    expect(() => factoryOutcome(serpentineLayout(22), mm, initialState(mm))).toThrow(
      /analysis work budget/i,
    );
  });

  it("rejects oversized templates before sizing geometry", () => {
    const step = machine("push");
    expect(() => compileTemplate({ steps: new Array(MAX_TEMPLATE_STEPS + 1).fill(step) }))
      .toThrow(/steps|256/i);
  });

  it("does not alias mutable empty tiles", () => {
    const layout = compileTemplate({ steps: [] });
    const indexes = layout.tiles
      .map((tile, index) => tile.kind === "empty" ? index : -1)
      .filter((index) => index >= 0);
    (layout.tiles[indexes[0]!] as { kind: string }).kind = "sink";
    expect(layout.tiles[indexes[1]!]).toEqual({ kind: "empty" });
  });

  it("owns a caller's mutable path without freezing it", () => {
    const catalog = structuredClone(DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!);
    const step: Machine = { typeId: catalog.typeId, path: catalog.path };
    const layout = compileTemplate(template(step));
    (catalog.path[0] as { x: number }).x = -1;

    expect(layout.machines[0]?.def.path[0]).toEqual({ x: 1, y: 0 });
    expect(() => initFactory(layout, multimaps(emptyMap(31, { x: 15, y: 15 })), {
      pos: [{ x: 15, y: 15 }],
      failed: false,
    })).not.toThrow();
    expect(() => ((catalog.path[0] as { x: number }).x = 1)).not.toThrow();
  });

  it("reports budget exhaustion rather than a false outcome", () => {
    const mm = multimaps(emptyMap(31, { x: 15, y: 15 }));
    const layout: FactoryLayout = {
      width: 3,
      height: 1,
      tiles: [{ kind: "source", dir: E, period: 1 }, { kind: "empty" }, { kind: "sink" }],
      machines: [{
        id: 0,
        def: { typeId: "slow", path: [{ x: 1, y: 0 }], cost: 1, speed: MAX_FACTORY_REPLAY_TICKS },
        anchor: { x: 1, y: 0 },
        footRot: 0,
        shape: SHAPE_1x1,
      }],
    };
    expect(() => factoryOutcome(layout, mm, initialState(mm))).toThrow(/budget/i);
  });

  for (const [sampleIndex, value] of samples.entries()) {
    it(`uses canonical footprints without overlap for sample ${sampleIndex}`, () => {
      const layout = compileTemplate(value);
      expect(layout.machines).toHaveLength(value.steps.length);
      const occupied = new Set<number>();
      for (let index = 0; index < layout.machines.length; index++) {
        const placed = layout.machines[index]!;
        expect(placed.shape).toBe(DEFAULT_SHAPES[value.steps[index]!.typeId]);
        for (const cell of worldCells(placed)) {
          const key = cell.y * layout.width + cell.x;
          expect(occupied.has(key)).toBe(false);
          occupied.add(key);
        }
      }
      for (let index = 0; index < layout.tiles.length; index++) {
        if (layout.tiles[index]?.kind === "empty") continue;
        expect(occupied.has(index)).toBe(false);
        occupied.add(index);
      }
    });

    it(`matches the pure fixed-path engine for sample ${sampleIndex}`, () => {
      const mm = multimaps(
        emptyMap(63, { x: 31, y: 31 }),
        emptyMap(63, { x: 30, y: 30 }),
      );
      const layout = compileTemplate(value);
      const expected = evaluate(mm, initialState(mm), value);
      expect(factoryOutcome(layout, mm, initialState(mm))).toEqual(expected);
      const product = firstProduct(layout, mm, (layout.width + layout.height) * 12 + 100);
      expect(product?.drug).toEqual(applyTemplate(mm, initialState(mm), value));
      expect(compileTemplate(value)).toEqual(compileTemplate(value));
    });
  }

  it("lands on and reports a cure reached by an irregular path", () => {
    const value = template(machine("push"), machine("shear"));
    const open = multimaps(emptyMap(41, { x: 20, y: 20 }));
    const final = applyTemplate(open, initialState(open), value).pos[0]!;
    const map = emptyMap(41, { x: 20, y: 20 });
    const index = final.y * map.width + final.x;
    map.cell[index] = CellKind.Cure;
    map.cureId[index] = 77;
    const mm = multimaps(map);
    expect(factoryOutcome(compileTemplate(value), mm, initialState(mm)).cured).toContain(77);
  });

  it("rejects unknown machine types", () => {
    expect(() => compileTemplate(template({ typeId: "missing", path: [{ x: 1, y: 0 }] })))
      .toThrow(/unknown machine/i);
    expect(() => compileTemplate(template({
      typeId: "push",
      path: [{ x: -1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }],
    }))).toThrow(/path does not match/i);
  });
});

describe("factory rearrange invariance", () => {
  it("belt spacing and physical packing do not alter chemical paths", () => {
    const value = template(machine("push"), machine("skew"), machine("pull"));
    const mm = multimaps(emptyMap(63, { x: 31, y: 31 }));
    const pure = evaluate(mm, initialState(mm), value);
    expect(factoryOutcome(spacedLine(value, 1), mm, initialState(mm))).toEqual(pure);
    expect(factoryOutcome(spacedLine(value, 6), mm, initialState(mm))).toEqual(pure);
  });

  it("compiles and runs deterministically for random full catalog paths", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        type: fc.integer({ min: 0, max: DEFAULT_CATALOG.length - 1 }),
      }), { minLength: 1, maxLength: 5 }),
      (specs) => {
        const value: Template = {
          steps: specs.map(({ type }) => {
            const catalog = DEFAULT_CATALOG[type]!;
            return {
              typeId: catalog.typeId,
              path: catalog.path,
            };
          }),
        };
        const mm = multimaps(emptyMap(63, { x: 31, y: 31 }));
        const first = compileTemplate(value);
        const second = compileTemplate(value);
        expect(first).toEqual(second);
        expect(factoryOutcome(first, mm, initialState(mm)))
          .toEqual(factoryOutcome(second, mm, initialState(mm)));
        expect(factoryOutcome(first, mm, initialState(mm))).toEqual(evaluate(mm, initialState(mm), value));
      },
    ), { numRuns: 30, seed: 0x5ec1 });
  });
});
