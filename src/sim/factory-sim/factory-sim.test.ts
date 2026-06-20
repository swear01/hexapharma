import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  Vec2,
  Dir,
  EffectMap,
  MultiMap,
  DrugState,
  FactoryMachineDef,
  FactoryTile,
  FactoryLayout,
  FactoryState,
  Transform,
} from "../phase0_interfaces";
import { IDENTITY } from "../phase0_interfaces";
import { applyStep, initialState } from "../drug-graph";
import { initFactory, stepFactory, analyzeThroughput } from "./index";
import { hashFactory } from "../state";

// ───────────────────────────── fixtures ─────────────────────────────

const E: Dir = 0;
const S: Dir = 1;
const W: Dir = 2;

/** An NxN all-Empty map (CellKind values are all 0) with start + origin. */
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

/** Two empty maps, big enough that translates never hit a wall. */
function twoMaps(): MultiMap {
  return {
    maps: [emptyMap(20, { x: 5, y: 5 }, { x: 0, y: 0 }), emptyMap(20, { x: 8, y: 8 }, { x: 0, y: 0 })],
  };
}

function machineDef(
  typeId: string,
  transform: Transform,
  speed: number,
): FactoryMachineDef {
  return { typeId, transform, orientation: IDENTITY, cost: 1, speed };
}

const PUSH_E: Transform = { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" };
const PULL_E: Transform = { kind: "translate", delta: { x: 1, y: 0 }, relation: "reverse" };

/** Build a layout from a 2D char grid + a tile factory map. */
function gridLayout(
  rows: readonly string[],
  legend: Record<string, FactoryTile>,
): FactoryLayout {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const tiles: FactoryTile[] = [];
  for (let y = 0; y < height; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ".";
      tiles.push(legend[ch] ?? { kind: "empty" });
    }
  }
  return { width, height, tiles };
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
    // source(E) at (0,0) → belts → sink. Source emits onto (1,0).
    const layout = gridLayout([">--------#"], {
      ">": { kind: "source", dir: E, period: 1 },
      "-": { kind: "belt", dir: E },
      "#": { kind: "sink" },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 40);
    const last = states[states.length - 1]!;
    expect(last.produced.length).toBeGreaterThan(0);
    expect(last.deadlocked).toBe(false);
    // Produced drug never went through a machine: equals start.
    for (const d of last.produced) {
      expect(d.pos).toEqual(start.pos);
      expect(d.failed).toBe(false);
    }
  });

  it("a unit is emitted onto the source's output neighbour", () => {
    const layout = gridLayout([">-#"], {
      ">": { kind: "source", dir: E, period: 100 },
      "-": { kind: "belt", dir: E },
      "#": { kind: "sink" },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    const s1 = stepFactory(layout, mm, initFactory(layout, mm, start));
    // tick 0 % 100 === 0 ⇒ emit. New unit on tile (1,0).
    expect(s1.units.length).toBe(1);
    expect(s1.units[0]!.pos).toEqual({ x: 1, y: 0 });
    expect(s1.nextUnitId).toBe(1);
  });
});

// ───────────────────────────── transform correctness ─────────────────────────────

describe("transform correctness", () => {
  it("produced drug = fold of applyStep over the machine sequence [A,B]", () => {
    // source → machine A (push) → belt → machine B (push) → sink, all eastward.
    const a = machineDef("pushA", PUSH_E, 2);
    const b = machineDef("pushB", PUSH_E, 3);
    const layout = gridLayout([">A-B-#"], {
      ">": { kind: "source", dir: E, period: 100 },
      A: { kind: "machine", def: a, inDir: W, outDir: E },
      "-": { kind: "belt", dir: E },
      B: { kind: "machine", def: b, inDir: W, outDir: E },
      "#": { kind: "sink" },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 60);
    const last = states[states.length - 1]!;
    expect(last.produced.length).toBeGreaterThan(0);

    // Expected: applyStep(B) ∘ applyStep(A) from start.
    let expected = start;
    expected = applyStep(mm, expected, { typeId: a.typeId, transform: a.transform, orientation: a.orientation });
    expected = applyStep(mm, expected, { typeId: b.typeId, transform: b.transform, orientation: b.orientation });

    for (const d of last.produced) {
      expect(d.pos).toEqual(expected.pos);
      expect(d.failed).toBe(expected.failed);
    }
  });

  it("transform applies exactly once (push then pull returns to start)", () => {
    const a = machineDef("push", PUSH_E, 2);
    const b = machineDef("pull", PULL_E, 2);
    const layout = gridLayout([">A-B-#"], {
      ">": { kind: "source", dir: E, period: 100 },
      A: { kind: "machine", def: a, inDir: W, outDir: E },
      "-": { kind: "belt", dir: E },
      B: { kind: "machine", def: b, inDir: W, outDir: E },
      "#": { kind: "sink" },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 60);
    const last = states[states.length - 1]!;
    expect(last.produced.length).toBeGreaterThan(0);
    for (const d of last.produced) {
      expect(d.pos).toEqual(start.pos); // push +1 then pull -1
    }
  });
});

// ───────────────────────────── mass conservation ─────────────────────────────

describe("mass conservation", () => {
  it("emitted === produced + in-transit, at every tick, no id duplication", () => {
    const a = machineDef("slow", PUSH_E, 4);
    const layout = gridLayout([">--A--#"], {
      ">": { kind: "source", dir: E, period: 2 },
      "-": { kind: "belt", dir: E },
      A: { kind: "machine", def: a, inDir: W, outDir: E },
      "#": { kind: "sink" },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 80);

    for (const s of states) {
      // nextUnitId counts total emitted so far.
      const emitted = s.nextUnitId;
      expect(emitted).toBe(s.produced.length + s.units.length);
      // no id duplicated
      const ids = s.units.map((u) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
      // all ids < nextUnitId
      for (const id of ids) expect(id).toBeLessThan(s.nextUnitId);
    }
  });
});

// ───────────────────────────── throughput ─────────────────────────────

describe("throughput", () => {
  it("steady-state produced/tick matches analyzeThroughput (bottleneck rate)", () => {
    // Fast source (period 1), one slow machine speed 5 ⇒ rate 1/5, bottleneck "slow".
    const a = machineDef("slow", PUSH_E, 5);
    const layout = gridLayout([">--A--#"], {
      ">": { kind: "source", dir: E, period: 1 },
      "-": { kind: "belt", dir: E },
      A: { kind: "machine", def: a, inDir: W, outDir: E },
      "#": { kind: "sink" },
    });
    const report = analyzeThroughput(layout);
    expect(report.bottleneck).toBe("slow");
    expect(report.rateNum).toBe(1);
    expect(report.rateDen).toBe(5);

    const mm = twoMaps();
    const start = initialState(mm);
    // Run long enough to reach steady state, measure over a window.
    const states = run(layout, mm, start, 400);
    const warm = 80;
    const a0 = states[warm]!.produced.length;
    const a1 = states[states.length - 1]!.produced.length;
    const window = states.length - 1 - warm;
    const observed = (a1 - a0) / window;
    const expectedRate = report.rateNum / report.rateDen;
    expect(observed).toBeCloseTo(expectedRate, 2);
  });

  it("source limits ⇒ bottleneck null", () => {
    const a = machineDef("m", PUSH_E, 1);
    const layout = gridLayout([">A#"], {
      ">": { kind: "source", dir: E, period: 7 },
      A: { kind: "machine", def: a, inDir: W, outDir: E },
      "#": { kind: "sink" },
    });
    const report = analyzeThroughput(layout);
    expect(report.bottleneck).toBeNull();
    expect(report.rateNum).toBe(1);
    expect(report.rateDen).toBe(7);
  });

  it("parallelizing the slow stage increases throughput", () => {
    // Single slow machine vs two of them: rates 1/4 vs 2/4 = 1/2.
    const single = gridLayout([">A#"], {
      ">": { kind: "source", dir: E, period: 1 },
      A: { kind: "machine", def: machineDef("slow", PUSH_E, 4), inDir: W, outDir: E },
      "#": { kind: "sink" },
    });
    const r1 = analyzeThroughput(single);

    const par = gridLayout(
      [">A#", ".B."],
      {
        ">": { kind: "source", dir: E, period: 1 },
        A: { kind: "machine", def: machineDef("slow", PUSH_E, 4), inDir: W, outDir: E },
        B: { kind: "machine", def: machineDef("slow", PUSH_E, 4), inDir: W, outDir: E },
        "#": { kind: "sink" },
      },
    );
    const r2 = analyzeThroughput(par);
    // r2 (2/4) > r1 (1/4)
    expect(r2.rateNum * r1.rateDen).toBeGreaterThan(r1.rateNum * r2.rateDen);
    expect(r2.rateNum).toBe(1);
    expect(r2.rateDen).toBe(2);
  });
});

// ───────────────────────────── deadlock ─────────────────────────────

describe("deadlock detection", () => {
  it("two belts pointing into each other jam and flag deadlock", () => {
    // Head-on belt jam: a left source feeds an eastward belt and a right source
    // feeds a westward belt; the two belts target each other's tile and stall.
    const jam = gridLayout([">-<-<"], {
      ">": { kind: "source", dir: E, period: 1 },
      "-": { kind: "belt", dir: E },
      "<": { kind: "belt", dir: W },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    let s = initFactory(jam, mm, start);
    let deadlockedAt = -1;
    for (let i = 0; i < 200; i++) {
      s = stepFactory(jam, mm, s);
      if (s.deadlocked) {
        deadlockedAt = i;
        break;
      }
    }
    expect(deadlockedAt).toBeGreaterThanOrEqual(0);
    // Once deadlocked it stays deadlocked and never crashes / loops.
    const after = stepFactory(jam, mm, s);
    expect(after.deadlocked).toBe(true);
  });

  it("blocked source with no sink eventually deadlocks (bounded buffer)", () => {
    // source → 1 belt → wall (empty). Unit reaches belt, can't advance, source
    // is then permanently blocked.
    const layout = gridLayout([">-"], {
      ">": { kind: "source", dir: E, period: 1 },
      "-": { kind: "belt", dir: E }, // its E neighbour is empty/out of bounds
    });
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

// ───────────────────────────── determinism / purity ─────────────────────────────

describe("determinism + purity (INV-15)", () => {
  it("stepFactory does not mutate its input state", () => {
    const a = machineDef("push", PUSH_E, 2);
    const layout = gridLayout([">A-#"], {
      ">": { kind: "source", dir: E, period: 1 },
      A: { kind: "machine", def: a, inDir: W, outDir: E },
      "-": { kind: "belt", dir: E },
      "#": { kind: "sink" },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    let s = initFactory(layout, mm, start);
    for (let i = 0; i < 10; i++) s = stepFactory(layout, mm, s);
    const before = hashFactory(s);
    const snapshotUnits = JSON.stringify(s.units);
    const snapshotProduced = JSON.stringify(s.produced);
    stepFactory(layout, mm, s); // discard result
    expect(hashFactory(s)).toBe(before);
    expect(JSON.stringify(s.units)).toBe(snapshotUnits);
    expect(JSON.stringify(s.produced)).toBe(snapshotProduced);
  });

  it("two identical runs produce identical hashes at every tick", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 8 }), (period, speed) => {
        const a = machineDef("m", PUSH_E, speed);
        const layout = gridLayout([">--A--#"], {
          ">": { kind: "source", dir: E, period },
          "-": { kind: "belt", dir: E },
          A: { kind: "machine", def: a, inDir: W, outDir: E },
          "#": { kind: "sink" },
        });
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

// ───────────────────────────── extra direction coverage ─────────────────────────────

describe("multi-direction routing", () => {
  it("a southward then eastward L-bend delivers to the sink", () => {
    // (0,0) source-S → (0,1) belt-E → (1,1) sink
    const layout = gridLayout(["v.", "-#"], {
      v: { kind: "source", dir: S, period: 5 },
      "-": { kind: "belt", dir: E },
      "#": { kind: "sink" },
    });
    const mm = twoMaps();
    const start = initialState(mm);
    const states = run(layout, mm, start, 40);
    expect(states[states.length - 1]!.produced.length).toBeGreaterThan(0);
  });
});
