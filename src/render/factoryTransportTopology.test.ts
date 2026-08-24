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
  transportAnimationPhase,
} from "./factoryTransportTopology";

const E: Dir = 0;
const SE: Dir = 1;
const W: Dir = 3;
const NW: Dir = 4;
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
  entries: readonly (readonly [q: number, r: number, tile: FactoryTile])[],
): FactoryLayout {
  const layout = emptyLayout();
  const tiles = layout.tiles.slice();
  for (const [q, r, tile] of entries) tiles[r * layout.width + q] = tile;
  return { ...layout, tiles };
}

function cell(layout: FactoryLayout, q: number, r: number) {
  return buildFactoryTransportTopology(layout).cells[r * layout.width + q]!;
}

describe("factory directed transport topology", () => {
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
    });
  });

  it("uses declared splitter and merger sides instead of visual adjacency", () => {
    const splitter = withTiles([
      [1, 2, { kind: "source", dir: E, period: 1 }],
      [2, 1, { kind: "source", dir: SE, period: 1 }],
      [2, 2, { kind: "splitter", inDir: W, outDirs: [E, SE] }],
      [3, 2, { kind: "belt", dir: E }],
      [2, 3, { kind: "belt", dir: SE }],
    ]);
    expect(cell(splitter, 2, 2)).toMatchObject({
      inMask: bit(W),
      outMask: bit(E) | bit(SE),
      incidentMask: bit(W) | bit(E) | bit(SE),
    });

    const merger = withTiles([
      [1, 2, { kind: "source", dir: E, period: 1 }],
      [2, 1, { kind: "source", dir: SE, period: 1 }],
      [2, 2, { kind: "merger", inDirs: [W, NW], outDir: E }],
      [3, 2, { kind: "sink" }],
    ]);
    expect(cell(merger, 2, 2)).toMatchObject({
      inMask: bit(W) | bit(NW),
      outMask: bit(E),
      incidentMask: bit(W) | bit(NW) | bit(E),
    });
  });

  it("connects source and sink through the same directed edge authority", () => {
    const layout = withTiles([
      [1, 2, { kind: "source", dir: E, period: 1 }],
      [2, 2, { kind: "sink" }],
    ]);
    const topology = buildFactoryTransportTopology(layout);

    expect(topology.edges).toEqual([
      { from: { q: 1, r: 2 }, to: { q: 2, r: 2 }, dir: E },
    ]);
    expect(cell(layout, 1, 2).outMask).toBe(bit(E));
    expect(cell(layout, 2, 2).inMask).toBe(bit(W));
  });

  it.each([
    [0, 3, 2],
    [1, 2, 3],
    [2, 1, 3],
    [3, 1, 2],
    [4, 2, 1],
    [5, 3, 1],
  ] as const)("connects direction %i to its axial neighbor", (rawDir, toQ, toR) => {
    const dir = rawDir as Dir;
    const layout = withTiles([
      [2, 2, { kind: "source", dir, period: 1 }],
      [toQ, toR, { kind: "sink" }],
    ]);

    expect(buildFactoryTransportTopology(layout).edges).toEqual([
      { from: { q: 2, r: 2 }, to: { q: toQ, r: toR }, dir },
    ]);
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
      anchor: { q: 2, r: 2 },
      footRot: 1,
      shape: SHAPE_1x1,
    };
    const base = withTiles([
      [2, 1, { kind: "belt", dir: SE }],
      [2, 3, { kind: "sink" }],
      [1, 2, { kind: "belt", dir: E }],
    ]);
    const layout = { ...base, machines: [machine] };
    const topology = buildFactoryTransportTopology(layout);
    const machineCell = topology.cells[2 * layout.width + 2]!;

    expect(machineCell).toMatchObject({
      kind: "machine",
      inMask: bit(NW),
      outMask: bit(SE),
      incidentMask: bit(NW) | bit(SE),
    });
    expect(topology.machinePorts).toEqual([
      { machineId: 7, q: 2, r: 2, side: NW, role: "input", connected: true },
      { machineId: 7, q: 2, r: 2, side: SE, role: "output", connected: true },
    ]);
    expect(topology.edges).not.toContainEqual({
      from: { q: 1, r: 2 }, to: { q: 2, r: 2 }, dir: E,
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
