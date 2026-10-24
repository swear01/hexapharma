import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, type MachineCatalogEntry } from "./phase0_interfaces";
import { HEX_DQ, HEX_DR, hexDistance } from "./hex";

/** Design tier: 0 = early, 1 = mid, 2 = late (design.md §1.2). */
const DESIGN_TIER: Readonly<Record<string, number>> = {
  hook: 0, elbow: 0, return: 0, wave: 0, zigzag: 1, loop: 1, straight: 2, crane: 2,
};

function unlockTier(typeId: string): number {
  const tier = DESIGN_TIER[typeId];
  if (tier === undefined) throw new Error(`machine "${typeId}" has no design tier`);
  return tier;
}

interface MachineStats {
  readonly typeId: string;
  readonly tier: number;
  /** Hex distance of the stamp's net displacement on an open board. */
  readonly displacement: number;
  readonly pathLength: number;
  readonly turn: number;
  /** Heading change in 60° steps, 0..3: smaller is more convenient (keeps the line). */
  readonly turnAngle: number;
  readonly cost: number;
}

function stats(entry: MachineCatalogEntry): MachineStats {
  let q = 0;
  let r = 0;
  for (const dir of entry.path) {
    q += HEX_DQ[dir]!;
    r += HEX_DR[dir]!;
  }
  const turn = ((entry.turn % 6) + 6) % 6;
  return {
    typeId: entry.typeId,
    tier: unlockTier(entry.typeId),
    displacement: hexDistance(0, 0, q, r),
    pathLength: entry.path.length,
    turn: entry.turn,
    turnAngle: Math.min(turn, 6 - turn),
    cost: entry.cost,
  };
}

const ALL = DEFAULT_CATALOG.map(stats);
const tier = (n: number) => ALL.filter((machine) => machine.tier === n);
// Rational comparisons stay integer: a/b > c/d ⇔ a·d > c·b.
const sum = (machines: readonly MachineStats[], key: (machine: MachineStats) => number) =>
  machines.reduce((total, machine) => total + key(machine), 0);

describe("map-independent machine set", () => {
  it("reports displacement, path length, turn, cost per hex and unlock tier", () => {
    expect(ALL.map(({ typeId, tier: t, displacement, pathLength, turn, cost }) =>
      `${typeId} t${t} d${displacement} p${pathLength} turn${turn} $${cost}/${displacement}hex`)).toEqual([
      "hook t0 d3 p3 turn1 $3/3hex",
      "elbow t0 d3 p3 turn-1 $3/3hex",
      "return t0 d3 p3 turn3 $2/3hex",
      "wave t0 d6 p7 turn0 $7/6hex",
      "zigzag t1 d4 p4 turn2 $6/4hex",
      "loop t1 d1 p7 turn0 $5/1hex",
      "straight t2 d4 p4 turn0 $12/4hex",
      "crane t2 d5 p5 turn-2 $11/5hex",
    ]);
  });

  it("has eight machines in early/mid/late tiers, none a pure or short turner", () => {
    expect(ALL).toHaveLength(8);
    expect([tier(0).length, tier(1).length, tier(2).length]).toEqual([4, 2, 2]);
    expect(DEFAULT_CATALOG.slice(0, 4).every((entry) => unlockTier(entry.typeId) === 0)).toBe(true);
    for (const machine of ALL) {
      expect(machine.pathLength, machine.typeId).toBeGreaterThan(2);
      expect(machine.displacement, machine.typeId).toBeGreaterThan(0);
    }
  });

  it("keeps every early machine awkward: it bends the heading or wiggles", () => {
    for (const entry of DEFAULT_CATALOG.filter((candidate) => unlockTier(candidate.typeId) === 0)) {
      expect(entry.turn !== 0 || new Set(entry.path).size >= 3, entry.typeId).toBe(true);
    }
  });

  it("costs more per tier on average", () => {
    for (let n = 1; n <= 2; n++) {
      expect(sum(tier(n), (m) => m.cost) * tier(n - 1).length)
        .toBeGreaterThanOrEqual(sum(tier(n - 1), (m) => m.cost) * tier(n).length);
    }
  });

  it("gives the late tier the best displacement per path step and per machine", () => {
    const late = tier(2);
    for (const other of [tier(0), tier(1)]) {
      expect(sum(late, (m) => m.displacement) * sum(other, (m) => m.pathLength))
        .toBeGreaterThan(sum(other, (m) => m.displacement) * sum(late, (m) => m.pathLength));
      expect(sum(late, (m) => m.displacement) * other.length)
        .toBeGreaterThan(sum(other, (m) => m.displacement) * late.length);
    }
  });

  it("lets no machine dominate another of its tier on both displacement per cost and heading convenience", () => {
    for (let n = 0; n <= 2; n++) {
      for (const a of tier(n)) {
        for (const b of tier(n)) {
          if (a === b) continue;
          const betterReach = a.displacement * b.cost > b.displacement * a.cost;
          const betterHeading = a.turnAngle < b.turnAngle;
          expect(betterReach && betterHeading, `${a.typeId} dominates ${b.typeId}`).toBe(false);
        }
      }
    }
  });
});

describe("production-scale machine catalog", () => {
  it("uses meaningful atlas travel rather than one-cell nudges", () => {
    const lengths = DEFAULT_CATALOG.map((entry) => entry.path.length);
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(3);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(7);
    for (const entry of DEFAULT_CATALOG) {
      expect(entry.path.every((direction) => Number.isSafeInteger(direction) && direction >= 0 && direction <= 5))
        .toBe(true);
    }
    expect(new Set(DEFAULT_CATALOG.flatMap((entry) => entry.path))).toEqual(new Set([0, 1, 2, 3, 4, 5]));
  });

  it("gives every machine a readable multi-cell physical silhouette", () => {
    for (const entry of DEFAULT_CATALOG) {
      const shape = DEFAULT_SHAPES[entry.typeId];
      expect(shape, entry.typeId).toBeDefined();
      expect(shape!.cells.length, entry.typeId).toBeGreaterThanOrEqual(3);
      expect(shape!.inPorts.length, entry.typeId).toBeGreaterThan(0);
      expect(shape!.outPorts.length, entry.typeId).toBeGreaterThan(0);
    }
    expect(DEFAULT_SHAPES.wave!.cells.length).toBeGreaterThanOrEqual(7);
    expect(DEFAULT_SHAPES.loop!.cells.length).toBeGreaterThanOrEqual(7);
    expect(DEFAULT_SHAPES.crane!.cells.length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(DEFAULT_SHAPES).sort()).toEqual(DEFAULT_CATALOG.map((entry) => entry.typeId).sort());
  });

  it("makes long-travel machinery slower and dearer than the starter pump", () => {
    const pump = DEFAULT_CATALOG.find((entry) => entry.typeId === "hook")!;
    const longBed = DEFAULT_CATALOG.find((entry) => entry.typeId === "wave")!;
    expect(longBed.speed).toBeGreaterThan(pump.speed);
    expect(longBed.cost).toBeGreaterThan(pump.cost);
  });
});
