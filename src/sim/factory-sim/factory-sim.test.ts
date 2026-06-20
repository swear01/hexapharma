import { describe, it, expect } from "vitest";
import fc from "fast-check";
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
import { IDENTITY, SHAPE_1x1, SHAPE_2x1, SHAPE_L } from "../phase0_interfaces";
import { applyStep, initialState } from "../drug-graph";
import { initFactory, stepFactory, analyzeThroughput } from "./index";
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
    sideEffectId: new Int16Array(len).fill(-1),
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
  const states: FactoryState[] = [initFactory(layout, mm, start)];
  for (let i = 0; i < ticks; i++) {
    states.push(stepFactory(layout, mm, states[states.length - 1]!));
  }
  return states;
}

// ───────────────────────────── basic line ─────────────────────────────

describe("factory-sim straight line", () => {
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
    expect(last.produced.length).toBeGreaterThan(0);
    expect(last.deadlocked).toBe(false);
    for (const d of last.produced) {
      expect(d.pos).toEqual(start.pos);
      expect(d.failed).toBe(false);
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
    const s1 = stepFactory(layout, mm, initFactory(layout, mm, start));
    expect(s1.units.length).toBe(1);
    expect(s1.units[0]!.pos).toEqual({ x: 1, y: 0 });
    expect(s1.units[0]!.machineId).toBeNull();
    expect(s1.nextUnitId).toBe(1);
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
    expect(last.produced.length).toBeGreaterThan(0);

    let expected = start;
    expected = applyStep(mm, expected, { typeId: a.typeId, transform: a.transform, orientation: a.orientation });
    expected = applyStep(mm, expected, { typeId: bdef.typeId, transform: bdef.transform, orientation: bdef.orientation });

    for (const d of last.produced) {
      expect(d.pos).toEqual(expected.pos);
      expect(d.failed).toBe(expected.failed);
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
    expect(last.produced.length).toBeGreaterThan(0);
    for (const d of last.produced) {
      expect(d.pos).toEqual(start.pos);
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
      expect(s.nextUnitId).toBe(s.produced.length + s.units.length);
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
    const obs1 = replayFactory(single, mm, start, 400).produced.length;
    const obs2 = replayFactory(par, mm, start, 400).produced.length;
    expect(obs2).toBeGreaterThan(obs1 * 1.5);

    // bottleneck reported is a real machine in both.
    expect(r1.bottleneck).toBe(0);
    expect(r2.bottleneck).not.toBeNull();
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
    expect(states[states.length - 1]!.produced.length).toBeGreaterThan(0);
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
    expect(states[states.length - 1]!.produced.length).toBeGreaterThan(0);
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
    expect(last.produced.length).toBeGreaterThan(0);
    // effect still applied: push +1 on x for both maps.
    for (const d of last.produced) {
      expect(d.pos[0]).toEqual({ x: 6, y: 5 });
      expect(d.pos[1]).toEqual({ x: 9, y: 8 });
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
    let s = initFactory(layout, mm, start);
    let deadlockedAt = -1;
    for (let i = 0; i < 200; i++) {
      s = stepFactory(layout, mm, s);
      if (s.deadlocked) {
        deadlockedAt = i;
        break;
      }
    }
    expect(deadlockedAt).toBeGreaterThanOrEqual(0);
    const after = stepFactory(layout, mm, s);
    expect(after.deadlocked).toBe(true);
  });

  it("blocked source with no sink eventually deadlocks", () => {
    const b = blank(2, 1);
    set(b, 0, 0, { kind: "source", dir: E, period: 1 });
    set(b, 1, 0, { kind: "belt", dir: E }); // E neighbor out of bounds
    const layout = finish(b, []);
    const mm = twoMaps();
    const start = initialState(mm);
    let s = initFactory(layout, mm, start);
    let deadlocked = false;
    for (let i = 0; i < 50; i++) {
      s = stepFactory(layout, mm, s);
      if (s.deadlocked) {
        deadlocked = true;
        break;
      }
    }
    expect(deadlocked).toBe(true);
  });
});

// ───────────────────────────── determinism / purity (INV-15) ─────────────────────────────

describe("determinism + purity (INV-15)", () => {
  it("stepFactory does not mutate its input state", () => {
    const { layout, mm } = parallelLayout();
    const start = initialState(mm);
    let s = initFactory(layout, mm, start);
    for (let i = 0; i < 15; i++) s = stepFactory(layout, mm, s);
    const before = hashFactory(s);
    const snapshotUnits = JSON.stringify(s.units);
    const snapshotProduced = JSON.stringify(s.produced);
    stepFactory(layout, mm, s);
    expect(hashFactory(s)).toBe(before);
    expect(JSON.stringify(s.units)).toBe(snapshotUnits);
    expect(JSON.stringify(s.produced)).toBe(snapshotProduced);
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

// ───────────────────────────── source-limited throughput ─────────────────────────────

describe("throughput edge cases", () => {
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
