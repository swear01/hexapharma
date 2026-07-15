import { describe, expect, it } from "vitest";
import type {
  Dir,
  FactoryLayout,
  FactoryTile,
  PlacedMachine,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, SHAPE_1x1 } from "../sim/phase0_interfaces";
import {
  TRANSPORT_ANIMATION_PERIOD,
  buildFactoryTransportTopology,
  classifyTransportMask,
  transportAnimationPhase,
} from "./factoryTransportTopology";

const E: Dir = 0;
const S: Dir = 1;
const W: Dir = 2;
const N: Dir = 3;
const bit = (side: Dir): number => 1 << side;

function emptyLayout(width = 5, height = 5): FactoryLayout {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ kind: "empty" as const })),
    machines: [],
  };
}

function withTiles(
  entries: readonly (readonly [x: number, y: number, tile: FactoryTile])[],
): FactoryLayout {
  const layout = emptyLayout();
  const tiles = layout.tiles.slice();
  for (const [x, y, tile] of entries) tiles[y * layout.width + x] = tile;
  return { ...layout, tiles };
}

function cell(layout: FactoryLayout, x: number, y: number) {
  return buildFactoryTransportTopology(layout).cells[y * layout.width + x]!;
}

describe("factory directed transport topology", () => {
  it.each([
    [bit(E), "endpoint"],
    [bit(S), "endpoint"],
    [bit(W), "endpoint"],
    [bit(N), "endpoint"],
    [bit(E) | bit(W), "straight"],
    [bit(N) | bit(S), "straight"],
    [bit(E) | bit(S), "corner"],
    [bit(W) | bit(S), "corner"],
    [bit(W) | bit(N), "corner"],
    [bit(N) | bit(E), "corner"],
    [bit(E) | bit(S) | bit(W), "tee"],
    [bit(S) | bit(W) | bit(N), "tee"],
    [bit(W) | bit(N) | bit(E), "tee"],
    [bit(N) | bit(E) | bit(S), "tee"],
    [bit(E) | bit(S) | bit(W) | bit(N), "cross"],
    [0, "isolated"],
  ] as const)("classifies mask %s as %s", (mask, shape) => {
    expect(classifyTransportMask(mask)).toBe(shape);
  });

  it("derives endpoint, straight, corner, tee, and cross from real directed edges", () => {
    const cases = [
      {
        shape: "endpoint",
        entries: [[2, 2, { kind: "belt", dir: E }], [3, 2, { kind: "sink" }]],
        inMask: 0,
        outMask: bit(E),
      },
      {
        shape: "straight",
        entries: [[1, 2, { kind: "belt", dir: E }], [2, 2, { kind: "belt", dir: E }], [3, 2, { kind: "sink" }]],
        inMask: bit(W),
        outMask: bit(E),
      },
      {
        shape: "corner",
        entries: [[1, 2, { kind: "belt", dir: E }], [2, 2, { kind: "belt", dir: S }], [2, 3, { kind: "sink" }]],
        inMask: bit(W),
        outMask: bit(S),
      },
      {
        shape: "tee",
        entries: [
          [1, 2, { kind: "belt", dir: E }],
          [2, 1, { kind: "belt", dir: S }],
          [2, 2, { kind: "belt", dir: E }],
          [3, 2, { kind: "sink" }],
        ],
        inMask: bit(W) | bit(N),
        outMask: bit(E),
      },
      {
        shape: "cross",
        entries: [
          [1, 2, { kind: "belt", dir: E }],
          [2, 1, { kind: "belt", dir: S }],
          [2, 3, { kind: "belt", dir: N }],
          [2, 2, { kind: "belt", dir: E }],
          [3, 2, { kind: "sink" }],
        ],
        inMask: bit(W) | bit(N) | bit(S),
        outMask: bit(E),
      },
    ] as const;

    for (const fixture of cases) {
      const layout = withTiles(fixture.entries);
      const visual = cell(layout, 2, 2);
      expect(visual.shape).toBe(fixture.shape);
      expect(visual.inMask).toBe(fixture.inMask);
      expect(visual.outMask).toBe(fixture.outMask);
      expect(visual.incidentMask).toBe(fixture.inMask | fixture.outMask);
    }
  });

  it("does not invent a connection from adjacency when the directed sides disagree", () => {
    const layout = withTiles([
      [1, 2, { kind: "belt", dir: W }],
      [2, 2, { kind: "belt", dir: E }],
      [3, 2, { kind: "source", dir: E, period: 1 }],
    ]);

    expect(cell(layout, 2, 2)).toMatchObject({
      inMask: 0,
      outMask: 0,
      incidentMask: 0,
      shape: "isolated",
    });
  });

  it("uses declared splitter and merger sides instead of visual adjacency", () => {
    const splitter = withTiles([
      [1, 2, { kind: "source", dir: E, period: 1 }],
      [2, 1, { kind: "source", dir: S, period: 1 }],
      [2, 2, { kind: "splitter", inDir: W, outDirs: [E, S] }],
      [3, 2, { kind: "belt", dir: E }],
      [2, 3, { kind: "belt", dir: S }],
    ]);
    expect(cell(splitter, 2, 2)).toMatchObject({
      inMask: bit(W),
      outMask: bit(E) | bit(S),
      incidentMask: bit(W) | bit(E) | bit(S),
      shape: "tee",
    });

    const merger = withTiles([
      [1, 2, { kind: "source", dir: E, period: 1 }],
      [2, 1, { kind: "source", dir: S, period: 1 }],
      [2, 2, { kind: "merger", inDirs: [W, N], outDir: E }],
      [3, 2, { kind: "sink" }],
    ]);
    expect(cell(merger, 2, 2)).toMatchObject({
      inMask: bit(W) | bit(N),
      outMask: bit(E),
      incidentMask: bit(W) | bit(N) | bit(E),
      shape: "tee",
    });
  });

  it("connects source and sink through the same directed edge authority", () => {
    const layout = withTiles([
      [1, 2, { kind: "source", dir: E, period: 1 }],
      [2, 2, { kind: "sink" }],
    ]);
    const topology = buildFactoryTransportTopology(layout);

    expect(topology.edges).toEqual([
      { from: { x: 1, y: 2 }, to: { x: 2, y: 2 }, dir: E },
    ]);
    expect(cell(layout, 1, 2).outMask).toBe(bit(E));
    expect(cell(layout, 2, 2).inMask).toBe(bit(W));
  });

  it("uses rotated machine ports and leaves wrong-side adjacency disconnected", () => {
    const entry = DEFAULT_CATALOG[0]!;
    const machine: PlacedMachine = {
      id: 7,
      def: {
        typeId: entry.typeId,
        path: entry.path,
        cost: entry.cost,
        speed: entry.speed,
      },
      anchor: { x: 2, y: 2 },
      footRot: 1,
      shape: SHAPE_1x1,
    };
    const base = withTiles([
      [2, 1, { kind: "belt", dir: S }],
      [2, 3, { kind: "sink" }],
      [1, 2, { kind: "belt", dir: E }],
    ]);
    const layout = { ...base, machines: [machine] };
    const topology = buildFactoryTransportTopology(layout);
    const machineCell = topology.cells[2 * layout.width + 2]!;

    expect(machineCell).toMatchObject({
      kind: "machine",
      inMask: bit(N),
      outMask: bit(S),
      incidentMask: bit(N) | bit(S),
      shape: "straight",
    });
    expect(topology.machinePorts).toEqual([
      { machineId: 7, x: 2, y: 2, side: N, role: "input", connected: true },
      { machineId: 7, x: 2, y: 2, side: S, role: "output", connected: true },
    ]);
    expect(topology.edges).not.toContainEqual({
      from: { x: 1, y: 2 }, to: { x: 2, y: 2 }, dir: E,
    });
  });
});

describe("factory transport animation", () => {
  it("derives a deterministic phase only from sim tick and still advances in eight-tick batches", () => {
    expect(TRANSPORT_ANIMATION_PERIOD % 8).not.toBe(0);
    expect(transportAnimationPhase(0)).toBe(0);
    expect(transportAnimationPhase(8)).not.toBe(transportAnimationPhase(0));
    expect(transportAnimationPhase(16)).not.toBe(transportAnimationPhase(8));
    expect(transportAnimationPhase(TRANSPORT_ANIMATION_PERIOD)).toBe(0);
    expect(transportAnimationPhase(8)).toBe(transportAnimationPhase(8));
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid tick %s",
    (tick) => expect(() => transportAnimationPhase(tick)).toThrow(/tick/i),
  );
});
