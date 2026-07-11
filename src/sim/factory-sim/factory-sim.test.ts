import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import type {
  Vec2,
  Dir,
  Rotation,
  EffectMap,
  MultiMap,
  DrugState,
  FactoryMachineDef,
  FactoryTile,
  FactoryLayout,
  FactoryState,
  PlacedMachine,
  MachineShape,
  Transform,
} from "../phase0_interfaces";
import {
  IDENTITY,
  MAX_FACTORY_CELLS,
  MAX_FACTORY_PORTS,
  MAX_FACTORY_REPLAY_TICKS,
  MAX_MACHINE_PORTS,
  SHAPE_1x1,
  SHAPE_2x1,
  SHAPE_L,
} from "../phase0_interfaces";
import { applyStep, initialState } from "../drug-graph";
import {
  __factorySimDebugCounts,
  __resetFactorySimDebugCounts,
  initFactory,
  stepFactory,
  snapshotFactory,
  restoreFactory,
  clearFactoryProductEvents,
  copyFactoryProductEvent,
  analyzeThroughput,
} from "./index";
import { hashFactory, replayFactory } from "../state";

// ───────────────────────────── fixtures ─────────────────────────────

const E: Dir = 0;
const S: Dir = 1;
const W: Dir = 2;
const N: Dir = 3;

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
    fog: new Uint8Array(len),
  };
}

/** Two big empty maps so translates never hit a wall. */
function twoMaps(): MultiMap {
  return {
    maps: [emptyMap(40, { x: 5, y: 5 }), emptyMap(40, { x: 8, y: 8 })],
  };
}

const PUSH_E: Transform = { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" };
const PULL_E: Transform = { kind: "translate", delta: { x: 1, y: 0 }, relation: "reverse" };

function machineDef(typeId: string, transform: Transform, speed: number): FactoryMachineDef {
  return { typeId, transform, orientation: IDENTITY, cost: 1, speed };
}

function placeMachine(
  id: number,
  def: FactoryMachineDef,
  shape: MachineShape,
  anchor: Vec2,
  footRot: Rotation = 0,
): PlacedMachine {
  return { id, def, anchor, footRot, shape };
}

interface LayoutBuilder {
  width: number;
  height: number;
  tiles: FactoryTile[];
}

function blank(width: number, height: number): LayoutBuilder {
  const tiles: FactoryTile[] = [];
  for (let i = 0; i < width * height; i++) tiles.push({ kind: "empty" });
  return { width, height, tiles };
}

function set(b: LayoutBuilder, x: number, y: number, t: FactoryTile): void {
  b.tiles[y * b.width + x] = t;
}

function finish(b: LayoutBuilder, machines: PlacedMachine[]): FactoryLayout {
  return { width: b.width, height: b.height, tiles: b.tiles, machines };
}

function run(layout: FactoryLayout, mm: MultiMap, start: DrugState, ticks: number): FactoryState[] {
  const runtime = initFactory(layout, mm, start);
  const states: FactoryState[] = [snapshotFactory(runtime)];
  for (let i = 0; i < ticks; i++) {
    stepFactory(layout, mm, runtime);
    states.push(snapshotFactory(runtime));
  }
  return states;
}

function products(states: readonly FactoryState[]) {
  return states.flatMap((state) => state.producedEvents);
}

// ───────────────────────────── basic line ─────────────────────────────

describe("factory-sim straight line", () => {
  it("runs a one-layer factory without requiring a phase-exchange layer", () => {
    const b = blank(3, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "belt", dir: E });
    set(b, 2, 0, { kind: "sink" });
    const mm: MultiMap = { maps: [emptyMap(40, { x: 20, y: 20 })] };
    const states = run(finish(b, []), mm, initialState(mm), 8);
    expect(states.at(-1)?.producedTotal).toBeGreaterThan(0);
  });

  it("source emits, belt carries, sink consumes", () => {
    // source(E)@(0,0) -> belts -> sink@(5,0).
    const b = blank(6, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    for (let x = 1; x <= 4; x++) set(b, x, 0, { kind: "belt", dir: E });
    set(b, 5, 0, { kind: "sink" });
    const layout = finish(b, []);
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 40);
    const last = states[states.length - 1]!;
    expect(last.producedTotal).toBeGreaterThan(0);
    expect(last.deadlocked).toBe(false);
    for (const product of products(states)) {
      expect(product.drug.pos).toEqual(start.pos);
      expect(product.drug.failed).toBe(false);
    }
  });

  it("a unit is emitted onto the source's output neighbour", () => {
    const b = blank(3, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 100 });
    set(b, 1, 0, { kind: "belt", dir: E });
    set(b, 2, 0, { kind: "sink" });
    const layout = finish(b, []);
    const mm = twoMaps();
    const start = initialState(mm);
    const runtime = initFactory(layout, mm, start);
    stepFactory(layout, mm, runtime);
    const s1 = snapshotFactory(runtime);
    expect(s1.units.length).toBe(1);
    expect(s1.units[0]!.pos).toEqual({ x: 1, y: 0 });
    expect(s1.units[0]!.machineId).toBeNull();
    expect(s1.nextUnitId).toBe(1);
  });

  it("sources copy the supplied start state instead of regenerating map defaults", () => {
    const b = blank(2, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "sink" });
    const layout = finish(b, []);
    const mm = twoMaps();
    const start: DrugState = {
      pos: [{ x: 12, y: 13 }, { x: 14, y: 15 }],
      failed: true,
    };
    const runtime = initFactory(layout, mm, start);
    stepFactory(layout, mm, runtime);
    expect(snapshotFactory(runtime).producedEvents[0]?.drug).toEqual(start);
  });
});

// ───────────────────────────── transform correctness ─────────────────────────────

describe("transform correctness", () => {
  it("produced drug = fold of applyStep over the machine sequence [A,B]", () => {
    // source -> [A push speed2] -> belt -> [B push speed3] -> sink (1x1 machines).
    const a = machineDef("pushA", PUSH_E, 2);
    const bdef = machineDef("pushB", PUSH_E, 3);
    // grid: source@0, A@1, belt@2, B@3, sink@4
    const b = blank(5, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 100 });
    set(b, 2, 0, { kind: "belt", dir: E });
    set(b, 4, 0, { kind: "sink" });
    const machines = [
      placeMachine(0, a, SHAPE_1x1, { x: 1, y: 0 }),
      placeMachine(1, bdef, SHAPE_1x1, { x: 3, y: 0 }),
    ];
    const layout = finish(b, machines);
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 60);
    const last = states[states.length - 1]!;
    expect(last.producedTotal).toBeGreaterThan(0);

    let expected = start;
    expected = applyStep(mm, expected, { typeId: a.typeId, transform: a.transform, orientation: a.orientation });
    expected = applyStep(mm, expected, { typeId: bdef.typeId, transform: bdef.transform, orientation: bdef.orientation });

    for (const product of products(states)) {
      expect(product.drug.pos).toEqual(expected.pos);
      expect(product.drug.failed).toBe(expected.failed);
      expect(product.productionCost).toBe(a.cost + bdef.cost);
    }
  });

  it("transform applies exactly once (push then pull returns to start)", () => {
    const a = machineDef("push", PUSH_E, 2);
    const bdef = machineDef("pull", PULL_E, 2);
    const b = blank(5, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 100 });
    set(b, 2, 0, { kind: "belt", dir: E });
    set(b, 4, 0, { kind: "sink" });
    const machines = [
      placeMachine(0, a, SHAPE_1x1, { x: 1, y: 0 }),
      placeMachine(1, bdef, SHAPE_1x1, { x: 3, y: 0 }),
    ];
    const layout = finish(b, machines);
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 60);
    const last = states[states.length - 1]!;
    expect(last.producedTotal).toBeGreaterThan(0);
    for (const product of products(states)) {
      expect(product.drug.pos).toEqual(start.pos);
    }
  });
});

// ───────────────────────────── mass conservation ─────────────────────────────

describe("mass conservation", () => {
  it("nextUnitId === produced + in-transit at every tick, no id dup", () => {
    const a = machineDef("slow", PUSH_E, 4);
    const b = blank(6, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 2 });
    set(b, 1, 0, { kind: "belt", dir: E });
    set(b, 4, 0, { kind: "belt", dir: E });
    set(b, 5, 0, { kind: "sink" });
    const machines = [placeMachine(0, a, SHAPE_2x1, { x: 2, y: 0 })]; // occupies (2,0),(3,0)
    const layout = finish(b, machines);
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 80);

    for (const s of states) {
      expect(s.nextUnitId).toBe(s.producedTotal + s.units.length);
      const ids = s.units.map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toBeLessThan(s.nextUnitId);
    }
  });
});

// ───────────────────────────── REAL PARALLEL (headline) ─────────────────────────────

/** Single speed-3 machine line: source -> belt -> [A speed3] -> belt -> sink. */
function singleLineLayout(): { layout: FactoryLayout; mm: MultiMap } {
  const b = blank(6, 1);
  set(b, 0, 0, { kind: "source", dir: E, period: 1 });
  set(b, 1, 0, { kind: "belt", dir: E });
  set(b, 4, 0, { kind: "belt", dir: E });
  set(b, 5, 0, { kind: "sink" });
  const machines = [placeMachine(0, machineDef("p", PUSH_E, 3), SHAPE_1x1, { x: 2, y: 0 })];
  // machine occupies (2,0); belt at (1,0) feeds it from W; out E -> need an accepting cell at (3,0).
  set(b, 3, 0, { kind: "belt", dir: E });
  return { layout: finish(b, machines), mm: twoMaps() };
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
    if (to.x > from.x) return E;
    if (to.x < from.x) return W;
    if (to.y > from.y) return S;
    return N;
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

/**
 * Parallel: source -> splitter -> two speed-3 machines (top + bottom rows) -> merger -> sink.
 *
 *   row0:  >  S  A  m  M  #
 *   row1:  .  .  B  .  .  .
 *
 * splitter@(1,0) inDir W, outDirs [E (to A@(2,0)), S (to B@(2,1))].
 * A@(2,0) out E -> belt(3,0) -> merger@(4,0).
 * B@(2,1) out E -> belt(3,1) -> belt(3,1)... route B up to merger.
 */
function parallelLayout(): { layout: FactoryLayout; mm: MultiMap } {
  const b = blank(6, 2);
  set(b, 0, 0, { kind: "source", dir: E, period: 1 });
  // splitter sends to E (row0 machine A@(2,0)) and S (down to (1,1), then E to B@(2,1))
  set(b, 1, 0, { kind: "splitter", inDir: W, outDirs: [E, S] });
  set(b, 1, 1, { kind: "belt", dir: E }); // splitter S-output routes east into B
  // top machine A occupies (2,0); out E -> belt(3,0) -> merger(4,0)
  set(b, 3, 0, { kind: "belt", dir: E });
  // merger@(4,0) accepts from W (top) and S (bottom column up), outputs E -> sink(5,0)
  set(b, 4, 0, { kind: "merger", inDirs: [W, S], outDir: E });
  set(b, 5, 0, { kind: "sink" });
  // bottom machine B occupies (2,1); out E -> belt(3,1) -> belt north to (4,1) -> N into merger(4,0)
  set(b, 3, 1, { kind: "belt", dir: E });
  set(b, 4, 1, { kind: "belt", dir: N });
  const machines = [
    placeMachine(0, machineDef("p", PUSH_E, 3), SHAPE_1x1, { x: 2, y: 0 }),
    placeMachine(1, machineDef("p", PUSH_E, 3), SHAPE_1x1, { x: 2, y: 1 }),
  ];
  return { layout: finish(b, machines), mm: twoMaps() };
}

describe("REAL parallelism", () => {
  it("a splitter feeding two speed-3 machines into a merger yields ~2x a single line", () => {
    const { layout: single, mm } = singleLineLayout();
    const { layout: par } = parallelLayout();
    const start = initialState(mm);

    // MEASURED via analyzeThroughput.
    const r1 = analyzeThroughput(single, mm);
    const r2 = analyzeThroughput(par, mm);

    // single should be ~1/3; parallel ~2/3.
    const rate1 = r1.rateNum / r1.rateDen;
    const rate2 = r2.rateNum / r2.rateDen;

    expect(rate1).toBeCloseTo(1 / 3, 2);
    expect(rate2).toBeGreaterThan(rate1 * 1.5); // genuinely higher (≈2x)
    expect(rate2).toBeCloseTo(2 / 3, 2);

    // Observed produced-count from an actual replay confirms the sim, not the model.
    const obs1 = replayFactory(single, mm, start, 400).producedTotal;
    const obs2 = replayFactory(par, mm, start, 400).producedTotal;
    expect(obs2).toBeGreaterThan(obs1 * 1.5);

    // bottleneck reported is a real machine in both.
    expect(r1.bottleneck).toBe(0);
    expect(r2.bottleneck).not.toBeNull();
  });
});

describe("splitter and merger routing contracts", () => {
  it("rejects entry through undeclared splitter and merger input sides", () => {
    for (const carrier of [
      { kind: "splitter", inDir: W, outDirs: [E] },
      { kind: "merger", inDirs: [W], outDir: E },
    ] as const) {
      const b = blank(2, 2);
      set(b, 0, 0, carrier);
      set(b, 1, 0, { kind: "sink" });
      set(b, 0, 1, { kind: "source", dir: N, period: 1 });
      const states = run(finish(b, []), twoMaps(), initialState(twoMaps()), 4);
      expect(states.at(-1)?.producedTotal).toBe(0);
      expect(states.at(-1)?.nextUnitId).toBe(0);
    }
  });

  it("arbitrates simultaneous merger contenders by declared inDirs priority", () => {
    const b = blank(3, 3);
    set(b, 0, 1, { kind: "belt", dir: E });
    set(b, 1, 1, { kind: "merger", inDirs: [S, W], outDir: E });
    set(b, 2, 1, { kind: "sink" });
    set(b, 1, 2, { kind: "belt", dir: N });
    const layout = finish(b, []);
    const mm = twoMaps();
    const start = initialState(mm);
    const runtime = restoreFactory(layout, mm, start, {
      tick: 0,
      units: [
        { id: 0, pos: { x: 0, y: 1 }, drug: start, proc: 0, machineId: null, productionCost: 10 },
        { id: 1, pos: { x: 1, y: 2 }, drug: start, proc: 0, machineId: null, productionCost: 20 },
      ],
      nextUnitId: 2,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    });

    stepFactory(layout, mm, runtime);

    const state = snapshotFactory(runtime);
    expect(state.units.find((unit) => unit.pos.x === 1 && unit.pos.y === 1)?.id).toBe(1);
    expect(state.units.find((unit) => unit.id === 0)?.pos).toEqual({ x: 0, y: 1 });
  });

  it("applies merger priority consistently between active units and scheduled sources", () => {
    for (const [inDirs, expectedSourceWin] of [
      [[S, W], true],
      [[W, S], false],
    ] as const) {
      const b = blank(3, 3);
      set(b, 0, 1, { kind: "belt", dir: E });
      set(b, 1, 1, { kind: "merger", inDirs, outDir: E });
      set(b, 2, 1, { kind: "sink" });
      set(b, 1, 2, { kind: "source", dir: N, period: 1 });
      const layout = finish(b, []);
      const mm = twoMaps();
      const start = initialState(mm);
      const runtime = restoreFactory(layout, mm, start, {
        tick: 0,
        units: [
          { id: 0, pos: { x: 0, y: 1 }, drug: start, proc: 0, machineId: null, productionCost: 10 },
        ],
        nextUnitId: 1,
        producedTotal: 0,
        splitterCursors: [],
        producedEvents: [],
        deadlocked: false,
      });

      stepFactory(layout, mm, runtime);

      const state = snapshotFactory(runtime);
      if (expectedSourceWin) {
        expect(state.nextUnitId).toBe(2);
        expect(state.units.find((unit) => unit.id === 0)?.pos).toEqual({ x: 0, y: 1 });
        expect(state.units.find((unit) => unit.id === 1)?.pos).toEqual({ x: 1, y: 1 });
      } else {
        expect(state.nextUnitId).toBe(1);
        expect(state.units[0]?.pos).toEqual({ x: 1, y: 1 });
      }
    }
  });

  it("round-robins per splitter independent of unrelated global unit ids", () => {
    const b = blank(4, 2);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "splitter", inDir: W, outDirs: [E, S] });
    set(b, 3, 0, { kind: "sink" });
    set(b, 1, 1, { kind: "sink" });
    set(b, 2, 1, { kind: "source", dir: E, period: 1 });
    set(b, 3, 1, { kind: "sink" });
    const machine = placeMachine(0, machineDef("costly", PUSH_E, 1), SHAPE_1x1, { x: 2, y: 0 });
    const layout = finish(b, [machine]);
    const mm = twoMaps();
    const states = run(layout, mm, initialState(mm), 10);
    const branchCosts = products(states)
      .filter((product) => product.id % 2 === 0)
      .map((product) => product.productionCost);
    expect(branchCosts.slice(0, 4)).toEqual([1, 0, 1, 0]);
  });

  it("preserves splitter round-robin cursors across cold snapshot restore", () => {
    const b = blank(3, 2);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "splitter", inDir: W, outDirs: [E, S] });
    set(b, 2, 0, { kind: "sink" });
    set(b, 1, 1, { kind: "sink" });
    const layout = finish(b, []);
    const mm = twoMaps();
    const start = initialState(mm);
    const original = initFactory(layout, mm, start);
    for (let tick = 0; tick < 4; tick++) stepFactory(layout, mm, original);
    const snapshot = snapshotFactory(original);
    expect(snapshot.splitterCursors).toHaveLength(1);
    const restored = restoreFactory(layout, mm, start, snapshot);
    for (let tick = 0; tick < 8; tick++) {
      stepFactory(layout, mm, original);
      stepFactory(layout, mm, restored);
      expect(snapshotFactory(restored)).toEqual(snapshotFactory(original));
    }
  });
});

// ───────────────────────────── multi-cell + footRot ─────────────────────────────

describe("multi-cell + footRot routing", () => {
  it("a 2x1 machine routes a unit in->out", () => {
    // source(0,0) -> [2x1 machine @ (1,0),(2,0)] -> sink(3,0)
    const b = blank(4, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 100 });
    set(b, 3, 0, { kind: "sink" });
    const machines = [placeMachine(0, machineDef("p", PUSH_E, 1), SHAPE_2x1, { x: 1, y: 0 })];
    const layout = finish(b, machines);
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 20);
    expect(states[states.length - 1]!.producedTotal).toBeGreaterThan(0);
  });

  it("an L machine routes a unit in (W of (0,0)) -> out (S of (1,1))", () => {
    // SHAPE_L cells (0,0),(1,0),(1,1); in W of (0,0); out S of (1,1).
    // place anchor at (1,1): cells (1,1),(2,1),(2,2); in W -> from (0,1); out S -> (2,3).
    const b = blank(4, 4);
    set(b, 0, 1, { kind: "source", dir: E, period: 100 });
    set(b, 2, 3, { kind: "sink" });
    const machines = [placeMachine(0, machineDef("p", PUSH_E, 1), SHAPE_L, { x: 1, y: 1 })];
    const layout = finish(b, machines);
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 20);
    expect(states[states.length - 1]!.producedTotal).toBeGreaterThan(0);
  });

  it("a footRot=1 machine has rotated ports and still routes", () => {
    // SHAPE_2x1 footRot=1: local (0,0)->(0,0); (1,0)->(0,1). in W(side2)->worldSide (2+1)&3=3=N.
    // out E(side0)->worldSide 1=S. So in-port cell (anchor) accepts from N; out-port cell
    // (anchor+(0,1)) emits S.
    // anchor (1,1): cells (1,1),(1,2). in at (1,1) from N => source above at (1,0) facing S.
    // out at (1,2) facing S => neighbor (1,3) sink.
    const b = blank(3, 4);
    set(b, 1, 0, { kind: "source", dir: S, period: 100 });
    set(b, 1, 3, { kind: "sink" });
    const machines = [placeMachine(0, machineDef("p", PUSH_E, 1), SHAPE_2x1, { x: 1, y: 1 }, 1)];
    const layout = finish(b, machines);
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 20);
    const last = states[states.length - 1]!;
    expect(last.producedTotal).toBeGreaterThan(0);
    // effect still applied: push +1 on x for both maps.
    for (const product of products(states)) {
      expect(product.drug.pos[0]).toEqual({ x: 6, y: 5 });
      expect(product.drug.pos[1]).toEqual({ x: 9, y: 8 });
    }
  });
});

// ───────────────────────────── deadlock ─────────────────────────────

describe("deadlock detection", () => {
  it("two belts pointing into each other jam and flag deadlock", () => {
    // source@(0,0)E feeds belt(1,0)E; belt(2,0)W feeds back; (1,0) and (2,0) target each other.
    const b = blank(4, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "belt", dir: E });
    set(b, 2, 0, { kind: "belt", dir: W });
    const layout = finish(b, []);
    const mm = twoMaps();
    const start = initialState(mm);
    const s = initFactory(layout, mm, start);
    let deadlockedAt = -1;
    for (let i = 0; i < 200; i++) {
      stepFactory(layout, mm, s);
      if (s.deadlocked) {
        deadlockedAt = i;
        break;
      }
    }
    expect(deadlockedAt).toBeGreaterThanOrEqual(0);
    stepFactory(layout, mm, s);
    expect(s.deadlocked).toBe(true);
  });

  it("blocked source with no sink eventually deadlocks", () => {
    const b = blank(2, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "belt", dir: E }); // E neighbor out of bounds
    const layout = finish(b, []);
    const mm = twoMaps();
    const start = initialState(mm);
    const s = initFactory(layout, mm, start);
    let deadlocked = false;
    for (let i = 0; i < 50; i++) {
      stepFactory(layout, mm, s);
      if (s.deadlocked) {
        deadlocked = true;
        break;
      }
    }
    expect(deadlocked).toBe(true);
  });
});

// ───────────────────────────── determinism / purity (INV-15) ─────────────────────────────

describe("deterministic mutable runtime (INV-15)", () => {
  it("cold snapshot restores to an identical runtime state", () => {
    const { layout, mm } = parallelLayout();
    const start = initialState(mm);
    const runtime = initFactory(layout, mm, start);
    for (let i = 0; i < 15; i++) stepFactory(layout, mm, runtime);
    const snapshot = snapshotFactory(runtime);
    const restored = restoreFactory(layout, mm, start, snapshot);
    expect(restored).toEqual(runtime);
    expect(snapshotFactory(restored)).toEqual(snapshot);
    stepFactory(layout, mm, runtime);
    stepFactory(layout, mm, restored);
    expect(snapshotFactory(restored)).toEqual(snapshotFactory(runtime));
  });

  it("binds initialized and restored runtimes to their exact map authority", () => {
    const { layout, mm } = singleLineLayout();
    const runtime = initFactory(layout, mm, initialState(mm));
    expect(() => stepFactory(layout, mm, runtime)).not.toThrow();
    expect(() => stepFactory(layout, twoMaps(), runtime)).toThrow(/map.*(?:authority|mismatch)/i);

    for (let tick = 1; tick < 5; tick++) stepFactory(layout, mm, runtime);
    const regenerated = twoMaps();
    const restored = restoreFactory(
      layout,
      regenerated,
      initialState(regenerated),
      snapshotFactory(runtime),
    );
    expect(() => stepFactory(layout, regenerated, restored)).not.toThrow();
    expect(() => stepFactory(layout, twoMaps(), restored)).toThrow(/map.*(?:authority|mismatch)/i);
  });

  it("replayFactory twice => equal hashFactory at every tick", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 8 }), (period, speed) => {
        const a = machineDef("m", PUSH_E, speed);
        const b = blank(6, 1);
        set(b, 0, 0, { kind: "source", dir: E, period });
        set(b, 1, 0, { kind: "belt", dir: E });
        set(b, 4, 0, { kind: "belt", dir: E });
        set(b, 5, 0, { kind: "sink" });
        const machines = [placeMachine(0, a, SHAPE_2x1, { x: 2, y: 0 })];
        const layout = finish(b, machines);
        const mm = twoMaps();
        const start = initialState(mm);
        const run1 = run(layout, mm, start, 60);
        const run2 = run(layout, mm, start, 60);
        for (let t = 0; t < run1.length; t++) {
          expect(hashFactory(run2[t]!)).toBe(hashFactory(run1[t]!));
        }
      }),
      { numRuns: 30 },
    );
  });
});

// ───────────────────────────── hot-loop allocation guard ─────────────────────────────

describe("factory hot-loop caches", () => {
  it("reuses a fixed event buffer without losing multi-tick production", () => {
    const b = blank(2, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "sink" });
    const layout = finish(b, []);
    const mm = twoMaps();
    const runtime = initFactory(layout, mm, initialState(mm));
    const eventIds = runtime.producedEvents.ids;
    const copied = new Int32Array(3 + runtime.mapCount * 2);
    let consumed = 0;
    for (let tick = 0; tick < 200; tick++) {
      stepFactory(layout, mm, runtime);
      expect(runtime.producedEvents.ids).toBe(eventIds);
      expect(runtime.producedEvents.count).toBe(1);
      expect(runtime.producedEvents.ids[0]).toBe(tick);
      copyFactoryProductEvent(runtime, 0, copied, 0);
      expect(copied[0]).toBe(tick);
      consumed += runtime.producedEvents.count;
      clearFactoryProductEvents(runtime);
      expect(runtime.producedEvents.count).toBe(0);
    }
    expect(consumed).toBe(200);
    expect(runtime.producedTotal).toBe(200);
    expect(runtime.nextUnitId).toBe(runtime.unitCount + runtime.producedTotal);
    const restored = restoreFactory(layout, mm, initialState(mm), snapshotFactory(runtime));
    expect(restored.producedEvents.count).toBe(0);
    stepFactory(layout, mm, restored);
    expect(restored.producedEvents.ids[0]).toBe(200);
  });

  it("keeps allocating syntax and collection builders outside the tick call graph", () => {
    const factorySource = readFileSync("src/sim/factory-sim/index.ts", "utf8");
    const sweepSource = readFileSync("src/sim/drug-graph/sweep.ts", "utf8");
    expect(factorySource).not.toContain("applyStep");
    const section = (source: string, start: string, end: string): string => {
      const from = source.indexOf(start);
      const to = source.indexOf(end, from + start.length);
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThan(from);
      return source.slice(from, to);
    };
    const sections = [
      section(
        factorySource,
        "function acceptanceAt(",
        "interface ImportMetaEnvironment",
      ),
      section(
        factorySource,
        "function assertRuntime(",
        "export const initFactory",
      ),
      section(
        factorySource,
        "export const stepFactory",
        "export const snapshotProducedEvents",
      ),
      section(
        sweepSource,
        "function enterStatus(",
        "type EnterStatus",
      ),
    ];
    for (const source of sections) {
      expect(source).not.toMatch(/new (?!Error)/);
      expect(source).not.toMatch(/\.(?:map|flatMap|filter|reduce|slice|sort|push|from)\(/);
      expect(source).not.toMatch(/for\s*\([^;)]*\sof\s/);
      expect(source).not.toMatch(/(?:const|let)\s+\w+\s*=\s*(?:\{|\[)/);
      expect(source).not.toMatch(/return\s+(?:\{|\[)/);
    }
  });

  it("reports zero hot-path allocations after warm-up", () => {
    const { layout, mm } = parallelLayout();
    const start = initialState(mm);
    __resetFactorySimDebugCounts();
    const state = initFactory(layout, mm, start);

    for (let tick = 0; tick < 80; tick++) stepFactory(layout, mm, state);

    expect(__factorySimDebugCounts()).toMatchObject({ hotAllocations: 0 });
  });

  it("compiles immutable layout geometry and allocates fixed scratch only once", () => {
    const { layout, mm } = parallelLayout();
    const start = initialState(mm);
    __resetFactorySimDebugCounts();
    const state = initFactory(layout, mm, start);

    for (let tick = 0; tick < 80; tick++) stepFactory(layout, mm, state);

    expect(state.tick).toBe(80);
    expect(__factorySimDebugCounts()).toMatchObject({
      layoutCompiles: 1,
      runtimeAllocations: 1,
      hotAllocations: 0,
      hotTicks: 80,
    });
  });
});

// ───────────────────────────── debug invariant assertions ─────────────────────────────

describe("cold factory layout authority", () => {
  const start = initialState(twoMaps());

  it("rejects unknown tiles and empty splitter/merger fan lists", () => {
    const invalidTiles = [
      { kind: "wormhole" },
      { kind: "splitter", inDir: W, outDirs: [] },
      { kind: "merger", inDirs: [], outDir: E },
    ] as unknown as FactoryTile[];
    for (const tile of invalidTiles) {
      const layout: FactoryLayout = { width: 1, height: 1, tiles: [tile], machines: [] };
      expect(() => initFactory(layout, twoMaps(), start)).toThrow(/tile|splitter|merger/i);
    }
  });

  it("rejects source periods that cannot be represented by the runtime Int32Array", () => {
    const layout: FactoryLayout = {
      width: 2,
      height: 1,
      tiles: [
        { kind: "source", dir: E, period: 0x80000000 },
        { kind: "sink" },
      ],
      machines: [],
    };
    expect(() => initFactory(layout, twoMaps(), start)).toThrow(/source/i);
  });

  it("freezes an accepted immutable layout so its compiled cache cannot go stale", () => {
    const source = { kind: "source" as const, dir: E, period: 1 };
    const layout: FactoryLayout = {
      width: 2,
      height: 1,
      tiles: [source, { kind: "sink" }],
      machines: [],
    };
    initFactory(layout, twoMaps(), start);
    expect(() => {
      source.period = 2;
    }).toThrow();
    expect(layout.tiles[0]).toEqual({ kind: "source", dir: E, period: 1 });
  });

  it("rejects swap transforms whose indices exceed the initialized map count", () => {
    const b = blank(3, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 2, 0, { kind: "sink" });
    const layout = finish(b, [
      placeMachine(
        0,
        machineDef("bad-swap", { kind: "swap", a: 0, b: 2 }, 1),
        SHAPE_1x1,
        { x: 1, y: 0 },
      ),
    ]);
    expect(() => initFactory(layout, twoMaps(), start)).toThrow(/swap.*map count/i);
  });

  it("rejects oversized sparse grids before allocating runtime-sized buffers", () => {
    const layout = {
      width: MAX_FACTORY_CELLS,
      height: 2,
      tiles: new Array(MAX_FACTORY_CELLS * 2),
      machines: [],
    } as unknown as FactoryLayout;
    expect(() => initFactory(layout, twoMaps(), start)).toThrow(/tile count|bound|dimension/i);
  });

  it("rejects excessive aggregate machine ports before allocating port indices", () => {
    const machineCount = Math.floor(MAX_FACTORY_PORTS / MAX_MACHINE_PORTS) + 1;
    const ports = new Array(MAX_MACHINE_PORTS).fill({ cell: { x: 0, y: 0 }, side: E });
    const shape: MachineShape = {
      cells: [{ x: 0, y: 0 }],
      inPorts: ports,
      outPorts: [],
    };
    const layout: FactoryLayout = {
      width: machineCount,
      height: 1,
      tiles: new Array(machineCount).fill({ kind: "empty" }),
      machines: Array.from({ length: machineCount }, (_, id) =>
        placeMachine(id, machineDef("many-ports", PUSH_E, 1), shape, { x: id, y: 0 })),
    };
    expect(() => initFactory(layout, twoMaps(), start)).toThrow(/port count|geometry.*bound/i);
  });
});

describe("cold restore factory invariants", () => {
  function baseUnit(start: DrugState, id: number) {
    return {
      id,
      pos: { x: 1, y: 0 },
      drug: start,
      proc: 0,
      machineId: null,
      productionCost: 0,
    };
  }

  it("rejects duplicate physical unit ids", () => {
    const { layout, mm } = singleLineLayout();
    const start = initialState(mm);
    const bad: FactoryState = {
      tick: 0,
      units: [baseUnit(start, 0), baseUnit(start, 0)],
      nextUnitId: 2,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    };
    expect(() => restoreFactory(layout, mm, start, bad)).toThrow(/duplicate or unsorted unit id 0/);
  });

  it("rejects broken mass conservation", () => {
    const { layout, mm } = singleLineLayout();
    const start = initialState(mm);
    const bad: FactoryState = {
      tick: 0,
      units: [baseUnit(start, 0)],
      nextUnitId: 2,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    };
    expect(() => restoreFactory(layout, mm, start, bad)).toThrow(/mass conservation/);
  });

  it("rejects negative processing progress and production cost", () => {
    const { layout, mm } = singleLineLayout();
    const start = initialState(mm);
    const negativeProc: FactoryState = {
      tick: 0,
      units: [{ ...baseUnit(start, 0), proc: -1 }],
      nextUnitId: 1,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    };
    const negativeCost: FactoryState = {
      tick: 0,
      units: [{ ...baseUnit(start, 0), productionCost: -1 }],
      nextUnitId: 1,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    };
    expect(() => restoreFactory(layout, mm, start, negativeProc)).toThrow(/invalid unit/);
    expect(() => restoreFactory(layout, mm, start, negativeCost)).toThrow(/invalid unit/);
  });

  it("rejects fractional snapshot fields before TypedArray coercion", () => {
    const { layout, mm } = singleLineLayout();
    const start = initialState(mm);
    const bad = {
      tick: 0,
      units: [{ ...baseUnit(start, 0), id: 0.5 }],
      nextUnitId: 1,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    } as FactoryState;
    expect(() => restoreFactory(layout, mm, start, bad)).toThrow(/invalid unit drug state/);
  });

  it("rejects two units held by one capacity-one machine", () => {
    const { layout, mm } = singleLineLayout();
    const start = initialState(mm);
    const bad: FactoryState = {
      tick: 0,
      units: [
        { ...baseUnit(start, 0), pos: { x: 2, y: 0 }, machineId: 0 },
        { ...baseUnit(start, 1), pos: { x: 2, y: 0 }, machineId: 0 },
      ],
      nextUnitId: 2,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    };
    expect(() => restoreFactory(layout, mm, start, bad)).toThrow(/machine 0 capacity exceeded/);
  });

  it("rejects a machine-held unit whose position is not one of that machine's input ports", () => {
    const { layout, mm } = singleLineLayout();
    const start = initialState(mm);
    const bad: FactoryState = {
      tick: 0,
      units: [{ ...baseUnit(start, 0), pos: { x: 3, y: 0 }, machineId: 0 }],
      nextUnitId: 1,
      producedTotal: 0,
      splitterCursors: [],
      producedEvents: [],
      deadlocked: false,
    };
    expect(() => restoreFactory(layout, mm, start, bad)).toThrow(/input port|held position/i);
  });
});

// ───────────────────────────── source-limited throughput ─────────────────────────────

describe("throughput edge cases", () => {
  it("reports a true deadlock as zero throughput without a fake machine bottleneck", () => {
    const b = blank(3, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    const machines = [
      placeMachine(7, machineDef("push", PUSH_E, 1), SHAPE_1x1, { x: 1, y: 0 }),
    ];

    expect(analyzeThroughput(finish(b, machines), twoMaps())).toEqual({
      rateNum: 0,
      rateDen: 1,
      bottleneck: null,
      bottleneckType: null,
    });
  });

  it("warms up across a legal long routing path before measuring the tail", () => {
    const report = analyzeThroughput(serpentineLayout(20), twoMaps());
    expect(report).toMatchObject({ rateNum: 1, rateDen: 1, bottleneck: null });
  });

  it("rejects a diagnostic whose layout-weighted simulation would block the UI", () => {
    __resetFactorySimDebugCounts();
    expect(() => analyzeThroughput(serpentineLayout(21), twoMaps())).toThrow(
      /analysis work budget/i,
    );
    expect(__factorySimDebugCounts().runtimeAllocations).toBe(0);
  });

  it("measures all 200 ticks in the steady-state tail", () => {
    const b = blank(2, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "sink" });
    const report = analyzeThroughput(finish(b, []), twoMaps());
    expect(report).toMatchObject({ rateNum: 1, rateDen: 1 });
  });

  it("sizes the steady-state window for a source with period 1000", () => {
    const b = blank(2, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1_000 });
    set(b, 1, 0, { kind: "sink" });
    const report = analyzeThroughput(finish(b, []), twoMaps());
    expect(report).toMatchObject({ rateNum: 1, rateDen: 1_000, bottleneck: null });
  });

  it("rejects an analysis whose steady-state window exceeds the replay budget", () => {
    const b = blank(3, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 2, 0, { kind: "sink" });
    const machines = [
      placeMachine(
        0,
        machineDef("slow", PUSH_E, MAX_FACTORY_REPLAY_TICKS),
        SHAPE_1x1,
        { x: 1, y: 0 },
      ),
    ];
    expect(() => analyzeThroughput(finish(b, machines), twoMaps())).toThrow(/budget/i);
  });

  it("source-limited line => bottleneck null", () => {
    // slow source (period 7), fast machine speed1 => bottleneck null (source limits).
    const b = blank(4, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 7 });
    set(b, 3, 0, { kind: "sink" });
    const machines = [placeMachine(0, machineDef("m", PUSH_E, 1), SHAPE_2x1, { x: 1, y: 0 })];
    const layout = finish(b, machines);
    const mm = twoMaps();
    const report = analyzeThroughput(layout, mm);
    expect(report.bottleneck).toBeNull();
    // measured rate ≈ 1/7 (a window average, not an exact analytic value).
    expect(report.rateNum / report.rateDen).toBeCloseTo(1 / 7, 2);
  });
});
