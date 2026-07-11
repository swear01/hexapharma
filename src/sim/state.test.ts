import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  Vec2,
  Dir,
  EffectMap,
  MultiMap,
  FactoryMachineDef,
  FactoryTile,
  FactoryLayout,
  PlacedMachine,
  Transform,
} from "./phase0_interfaces";
import { IDENTITY, MAX_FACTORY_REPLAY_TICKS, SHAPE_1x1 } from "./phase0_interfaces";
import { initialState } from "./drug-graph";
import { hashFactory, replayFactory } from "./state";
import { initFactory, snapshotFactory, stepFactory } from "./factory-sim";

const E: Dir = 0;
const S: Dir = 1;
const W: Dir = 2;

function emptyMap(n: number, start: Vec2): EffectMap {
  const len = n * n;
  return {
    width: n,
    height: n,
    origin: { x: 0, y: 0 },
    start,
    cell: new Uint8Array(len),
    cureId: new Int16Array(len).fill(-1),
    sideEffectId: new Int32Array(len).fill(-1),
    fog: new Uint8Array(len),
  };
}

function twoMaps(): MultiMap {
  return { maps: [emptyMap(20, { x: 5, y: 5 }), emptyMap(20, { x: 8, y: 8 })] };
}

const PUSH_E: Transform = { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" };

function machineDef(typeId: string, speed: number): FactoryMachineDef {
  return { typeId, transform: PUSH_E, orientation: IDENTITY, cost: 1, speed };
}

function lineLayout(period: number, speed: number): FactoryLayout {
  // source(0)E -> belt(1)E -> machine@(2,0) -> belt(3)E -> sink(4).
  // The machine lives in machines[] (not a tile); its cell (2,0) is "empty" in tiles.
  const tiles: FactoryTile[] = [
    { kind: "source", dir: E, period },
    { kind: "belt", dir: E },
    { kind: "empty" },
    { kind: "belt", dir: E },
    { kind: "sink" },
  ];
  const machines: PlacedMachine[] = [
    { id: 0, def: machineDef("m", speed), anchor: { x: 2, y: 0 }, footRot: 0, shape: SHAPE_1x1 },
  ];
  return { width: 5, height: 1, tiles, machines };
}

describe("hashFactory", () => {
  it("is stable for the initial state and depends on content", () => {
    const layout = lineLayout(2, 3);
    const mm = twoMaps();
    const start = initialState(mm);
    const s0 = initFactory(layout, mm, start);
    expect(hashFactory(s0)).toBe(hashFactory(initFactory(layout, mm, start)));
    const initialHash = hashFactory(s0);
    stepFactory(layout, mm, s0);
    expect(hashFactory(s0)).not.toBe(initialHash);
    expect(hashFactory(snapshotFactory(s0))).toBe(hashFactory(s0));
  });

  it("hashes behavior-affecting splitter round-robin cursors", () => {
    const layout: FactoryLayout = {
      width: 3,
      height: 2,
      tiles: [
        { kind: "source", dir: E, period: 1 },
        { kind: "splitter", inDir: W, outDirs: [E, S] },
        { kind: "sink" },
        { kind: "empty" },
        { kind: "sink" },
        { kind: "empty" },
      ],
      machines: [],
    };
    const snapshot = snapshotFactory(initFactory(layout, twoMaps(), initialState(twoMaps())));
    const alternate = { ...snapshot, splitterCursors: [1] };
    expect(hashFactory(alternate)).not.toBe(hashFactory(snapshot));
  });
});

describe("replayFactory (INV-15)", () => {
  it("two replays of the same inputs yield identical hashes", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 80 }),
        (period, speed, ticks) => {
          const layout = lineLayout(period, speed);
          const mm = twoMaps();
          const start = initialState(mm);
          const a = replayFactory(layout, mm, start, ticks);
          const b = replayFactory(layout, mm, start, ticks);
          expect(hashFactory(a)).toBe(hashFactory(b));
        },
      ),
      { numRuns: 50 },
    );
  });

  it("replay(ticks) equals stepping ticks times by hand", () => {
    const layout = lineLayout(2, 3);
    const mm = twoMaps();
    const start = initialState(mm);
    const s = initFactory(layout, mm, start);
    for (let i = 0; i < 37; i++) stepFactory(layout, mm, s);
    const replayed = replayFactory(layout, mm, start, 37);
    expect(hashFactory(replayed)).toBe(hashFactory(s));
    expect(replayed.tick).toBe(37);
  });

  it("different tick counts generally differ", () => {
    const layout = lineLayout(1, 2);
    const mm = twoMaps();
    const start = initialState(mm);
    const a = replayFactory(layout, mm, start, 20);
    const b = replayFactory(layout, mm, start, 25);
    expect(hashFactory(a)).not.toBe(hashFactory(b));
  });

  it("rejects fractional, negative, and non-finite replay lengths", () => {
    const layout = lineLayout(1, 2);
    const mm = twoMaps();
    const start = initialState(mm);
    for (const ticks of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => replayFactory(layout, mm, start, ticks)).toThrow(/ticks|integer/i);
    }
    expect(() => replayFactory(layout, mm, start, MAX_FACTORY_REPLAY_TICKS + 1)).toThrow(
      new RegExp(`ticks|${MAX_FACTORY_REPLAY_TICKS}`),
    );
  });
});
