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
import { IDENTITY, SHAPE_1x1 } from "./phase0_interfaces";
import { initialState } from "./drug-graph";
import { hashFactory, replayFactory } from "./state";
import { initFactory, stepFactory } from "./factory-sim";

const E: Dir = 0;

function emptyMap(n: number, start: Vec2): EffectMap {
  const len = n * n;
  return {
    width: n,
    height: n,
    origin: { x: 0, y: 0 },
    start,
    cell: new Uint8Array(len),
    cureId: new Int16Array(len).fill(-1),
    sideEffectId: new Int16Array(len).fill(-1),
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
    const s1 = stepFactory(layout, mm, s0);
    // After a tick the content differs ⇒ hash should differ.
    expect(hashFactory(s1)).not.toBe(hashFactory(s0));
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
    let s = initFactory(layout, mm, start);
    for (let i = 0; i < 37; i++) s = stepFactory(layout, mm, s);
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
});
