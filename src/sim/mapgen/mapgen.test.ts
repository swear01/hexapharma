import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import fc from "fast-check";
import type {
  EffectMap,
  GenOptions,
  GeneratedLevel,
  MachineCatalogEntry,
  MultiMap,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
import { evaluate } from "../drug-graph";
import {
  MAX_CONSTRUCTIVE_CANDIDATES,
  MAX_GENERATION_CATALOG_ENTRIES,
  MAX_GENERATION_DIFFICULTY,
  MAX_MAP_CELLS,
  TERRAIN_MOTIF_NAMES,
  difficultyToBasePrice,
  generate,
} from "./index";

const canonicalOptions = (seed: number, nMaps = 1): GenOptions => ({
  seed,
  nMaps,
  width: 63,
  height: 63,
  catalog: DEFAULT_CATALOG,
  diseaseCount: nMaps,
  difficulty: { min: 4, max: 12 },
});

const options = (seed: number, overrides: Partial<GenOptions> = {}): GenOptions => ({
  ...canonicalOptions(seed),
  ...overrides,
});

const radius = (map: EffectMap, index: number): number => {
  const x = index % map.width;
  const y = Math.floor(index / map.width);
  const raw = Math.max(Math.abs(x - map.origin.x), Math.abs(y - map.origin.y));
  const base = Math.max(1, Math.floor((Math.min(map.width, map.height) - 1) / 2));
  return Math.floor((raw * 31) / base);
};

function fieldEqual(a: MultiMap, b: MultiMap): boolean {
  if (a.maps.length !== b.maps.length) return false;
  for (let mapIndex = 0; mapIndex < a.maps.length; mapIndex++) {
    const left = a.maps[mapIndex];
    const right = b.maps[mapIndex];
    if (left === undefined || right === undefined) return false;
    if (left.width !== right.width || left.height !== right.height) return false;
    if (left.start.x !== right.start.x || left.start.y !== right.start.y) return false;
    if (left.origin.x !== right.origin.x || left.origin.y !== right.origin.y) return false;
    for (const key of ["cell", "cureId", "sideEffectId", "portalTo", "fog"] as const) {
      const aa = left[key];
      const bb = right[key];
      if (aa.length !== bb.length) return false;
      for (let index = 0; index < aa.length; index++) if (aa[index] !== bb[index]) return false;
    }
  }
  return true;
}

function density(map: EffectMap, kind: CellKind, min: number, max: number): number {
  let total = 0;
  let matches = 0;
  for (let index = 0; index < map.cell.length; index++) {
    const r = radius(map, index);
    if (r < min || r > max) continue;
    total++;
    if (map.cell[index] === kind) matches++;
  }
  return matches * 100 / total;
}

function componentSizes(map: EffectMap, kind: CellKind, cureId?: number): number[] {
  const visited = new Uint8Array(map.cell.length);
  const queue = new Int32Array(map.cell.length);
  const result: number[] = [];
  const matches = (index: number): boolean =>
    map.cell[index] === kind && (cureId === undefined || map.cureId[index] === cureId);
  for (let seed = 0; seed < map.cell.length; seed++) {
    if (visited[seed] === 1 || !matches(seed)) continue;
    let head = 0;
    let tail = 0;
    let size = 0;
    queue[tail++] = seed;
    visited[seed] = 1;
    while (head < tail) {
      const current = queue[head++]!;
      size++;
      const x = current % map.width;
      const y = Math.floor(current / map.width);
      const neighbors = [
        x + 1 < map.width ? current + 1 : -1,
        y + 1 < map.height ? current + map.width : -1,
        x > 0 ? current - 1 : -1,
        y > 0 ? current - map.width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || visited[next] === 1 || !matches(next)) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    result.push(size);
  }
  return result.sort((a, b) => b - a);
}

function assertPortalValidity(map: EffectMap): void {
  expect(map.portalTo).toBeInstanceOf(Int32Array);
  expect(map.portalTo).toHaveLength(map.cell.length);
  const destinations = new Set<number>();
  for (let index = 0; index < map.cell.length; index++) {
    if (map.cell[index] !== CellKind.Portal) {
      expect(map.portalTo[index]).toBe(-1);
      continue;
    }
    const destination = map.portalTo[index]!;
    expect(destination).toBeGreaterThanOrEqual(0);
    expect(destination).toBeLessThan(map.cell.length);
    expect(destination).not.toBe(index);
    expect([CellKind.Wall, CellKind.Abyss, CellKind.Portal]).not.toContain(map.cell[destination]);
    expect(map.portalTo[destination]).toBe(-1);
    expect(destinations.has(destination)).toBe(false);
    destinations.add(destination);
  }
}

function assertReferences(level: GeneratedLevel): void {
  for (const disease of level.diseases) {
    const outcome = evaluate(level.mm, level.start, disease.reference);
    expect(outcome.failed).toBe(false);
    expect(outcome.cured).toContain(disease.id);
    expect(outcome.final[disease.map]).toEqual(disease.node);
    expect(disease.difficulty).toBeGreaterThanOrEqual(4);
    expect(disease.difficulty).toBeLessThanOrEqual(12);
    for (const step of disease.reference.steps) expect(step.path.length).toBeGreaterThan(0);
  }
}

describe("mapgen production boundary", () => {
  it("never imports the dev/test-only solver or nondeterministic randomness", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*solver[^"']*["']/);
    expect(source).not.toContain("Math.random");
  });

  it("uses a fixed bounded candidate budget and code-as-data macro motifs", () => {
    expect(MAX_CONSTRUCTIVE_CANDIDATES).toBe(32);
    expect(TERRAIN_MOTIF_NAMES).toEqual([
      "crescent",
      "ridge",
      "canyon",
      "basin",
      "swamp-fan",
      "portal-bypass",
      "pocket",
    ]);
  });

  it("owns catalog-derived path data", () => {
    const catalog = DEFAULT_CATALOG.map((entry) => ({
      ...entry,
      path: entry.path.map((delta) => ({ ...delta })),
    })) as MachineCatalogEntry[];
    const level = generate(options(12, { catalog }));
    const before = JSON.stringify(level.diseases[0]!.reference);
    for (const entry of catalog) {
      (entry.path[0] as { x: number; y: number }).x = 99;
    }
    expect(JSON.stringify(level.diseases[0]!.reference)).toBe(before);
  });
});

describe("mapgen option validation", () => {
  it.each([
    ["seed", { seed: -1 }, /seed must be a uint32/],
    ["nMaps", { nMaps: 0 }, /nMaps must be between 1 and 4/],
    ["width", { width: 2 }, /width must be at least 3/],
    ["height", { height: 2 }, /height must be at least 3/],
    ["disease count", { diseaseCount: 2 }, /diseaseCount/],
    ["difficulty min", { difficulty: { min: -1, max: 4 } }, /difficulty/],
    ["difficulty order", { difficulty: { min: 9, max: 4 } }, /difficulty/],
    ["difficulty cap", { difficulty: { min: 4, max: 65 } }, /difficulty.max/],
  ] as const)("rejects invalid %s", (_name, override, message) => {
    expect(() => generate(options(1, override))).toThrow(message);
  });

  it("rejects area and catalog bounds before allocating generation state", () => {
    expect(() => generate(options(1, { width: MAX_MAP_CELLS, height: 3 }))).toThrow(/area/);
    const catalog = Array.from({ length: MAX_GENERATION_CATALOG_ENTRIES + 1 }, (_, index) => ({
      typeId: `m${index}`,
      path: [{ x: 1 as const, y: 0 as const }],
      cost: 1,
      speed: 1,
    }));
    expect(() => generate(options(1, { catalog }))).toThrow(/catalog.*exceed/i);
  });

  it("rejects duplicate IDs and malformed path stamps", () => {
    const first = DEFAULT_CATALOG[0]!;
    expect(() => generate(options(1, { catalog: [first, first] }))).toThrow(/duplicate typeId/i);
    expect(() => generate(options(1, {
      catalog: [{ typeId: "bad", path: [{ x: 1, y: 1 }] as never, cost: 1, speed: 1 }],
    }))).toThrow(/cardinal unit delta/i);
    expect(() => generate(options(1, {
      catalog: [{ typeId: "empty", path: [], cost: 1, speed: 1 }],
    }))).toThrow(/path length/i);
  });
});

describe("mapgen centered deterministic atlas", () => {
  it("is field-equal for the same seed, including portal destinations", () => {
    for (const seed of [0, 1, 14, 184, 0xffffffff]) {
      const left = generate(canonicalOptions(seed, 4));
      const right = generate(canonicalOptions(seed, 4));
      expect(fieldEqual(left.mm, right.mm)).toBe(true);
      expect(left.diseases).toEqual(right.diseases);
    }
  });

  it("uses the seed to vary canonical atlas fields", () => {
    const baseline = generate(canonicalOptions(0, 2));
    for (const seed of [1, 2, 14, 184]) {
      expect(fieldEqual(baseline.mm, generate(canonicalOptions(seed, 2)).mm)).toBe(false);
    }
  });

  it("starts every layer at the exact map center without cross-layer offsets", () => {
    const level = generate(canonicalOptions(14, 4));
    expect(level.start.pos).toEqual(Array.from({ length: 4 }, () => ({ x: 31, y: 31 })));
    for (const map of level.mm.maps) {
      expect(map.start).toEqual({ x: 31, y: 31 });
      expect(map.origin).toEqual({ x: 31, y: 31 });
    }
  });

  it("keeps the protected radius-six center free of wall, abyss, and portal", () => {
    for (const seed of [0, 14, 77, 184]) {
      const map = generate(canonicalOptions(seed)).mm.maps[0]!;
      for (let index = 0; index < map.cell.length; index++) {
        if (radius(map, index) > 6) continue;
        expect([CellKind.Wall, CellKind.Abyss, CellKind.Portal]).not.toContain(map.cell[index]);
      }
      expect(map.cell[map.start.y * map.width + map.start.x]).toBe(CellKind.Empty);
    }
  });

  it("emits authoritative fixed-length typed fields with initially hidden fog", () => {
    const level = generate(canonicalOptions(14, 4));
    for (const map of level.mm.maps) {
      const area = map.width * map.height;
      expect(map.cell).toBeInstanceOf(Uint8Array);
      expect(map.cureId).toBeInstanceOf(Int16Array);
      expect(map.sideEffectId).toBeInstanceOf(Int32Array);
      expect(map.portalTo).toBeInstanceOf(Int32Array);
      expect(map.fog).toBeInstanceOf(Uint8Array);
      for (const field of [map.cell, map.cureId, map.sideEffectId, map.portalTo, map.fog]) {
        expect(field).toHaveLength(area);
      }
      expect(map.fog.every((value) => value === 0)).toBe(true);
      expect(map.cell.every((value) => value >= CellKind.Empty && value <= CellKind.Cure)).toBe(true);
    }
  });

  it("preserves centered deterministic generation on noncanonical legal sizes", () => {
    for (const size of [3, 5, 9, 16, 64]) {
      for (const seed of [0, 1, 42]) {
        const opts = options(seed, { width: size, height: size });
        const level = generate(opts);
        expect(level.mm.maps[0]!.start).toEqual({ x: Math.floor(size / 2), y: Math.floor(size / 2) });
        expect(fieldEqual(level.mm, generate(opts).mm)).toBe(true);
        assertPortalValidity(level.mm.maps[0]!);
        assertReferences(level);
      }
    }
  });

  it("keeps the minimum legal map size generatable across seeded cure-region sizes", () => {
    for (let seed = 0; seed < 64; seed++) {
      const level = generate(options(seed, { width: 3, height: 3 }));
      expect(level.mm.maps[0]!.start).toEqual({ x: 1, y: 1 });
      assertReferences(level);
    }
  });
});

describe("mapgen radial macro terrain", () => {
  const bands = [
    { min: 7, max: 14, wall: [8, 12], abyss: [1, 3], swamp: [6, 10], portals: [0, 1] },
    { min: 15, max: 22, wall: [12, 18], abyss: [4, 7], swamp: [10, 15], portals: [1, 2] },
    { min: 23, max: 31, wall: [18, 25], abyss: [7, 11], swamp: [12, 20], portals: [2, 3] },
  ] as const;

  it("meets every canonical radial-band density and portal-pair target", () => {
    for (const seed of [0, 1, 2, 14, 31, 77, 184, 90210]) {
      for (const map of generate(canonicalOptions(seed, 2)).mm.maps) {
        for (const band of bands) {
          const wall = density(map, CellKind.Wall, band.min, band.max);
          const abyss = density(map, CellKind.Abyss, band.min, band.max);
          const swamp = density(map, CellKind.Swamp, band.min, band.max);
          const portals = map.cell.reduce((count, kind, index) =>
            count + (kind === CellKind.Portal && radius(map, index) >= band.min && radius(map, index) <= band.max ? 1 : 0), 0);
          expect(wall).toBeGreaterThanOrEqual(band.wall[0]);
          expect(wall).toBeLessThanOrEqual(band.wall[1]);
          expect(abyss).toBeGreaterThanOrEqual(band.abyss[0]);
          expect(abyss).toBeLessThanOrEqual(band.abyss[1]);
          expect(swamp).toBeGreaterThanOrEqual(band.swamp[0]);
          expect(swamp).toBeLessThanOrEqual(band.swamp[1]);
          expect(portals).toBeGreaterThanOrEqual(band.portals[0]);
          expect(portals).toBeLessThanOrEqual(band.portals[1]);
        }
      }
    }
  });

  it("creates valid directed same-map portals", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        for (const map of generate(canonicalOptions(seed, 2)).mm.maps) assertPortalValidity(map);
      }),
      { numRuns: 8 },
    );
  });

  it("forms multiple nontrivial motif components instead of one random blob", () => {
    for (const seed of [14, 184, 90210]) {
      const map = generate(canonicalOptions(seed)).mm.maps[0]!;
      for (const kind of [CellKind.Wall, CellKind.Abyss, CellKind.Swamp]) {
        const sizes = componentSizes(map, kind);
        expect(sizes[0]).toBeGreaterThanOrEqual(kind === CellKind.Abyss ? 4 : 8);
        expect(sizes.filter((size) => size >= 3).length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("uses globally unique side-effect IDs and keeps metadata authoritative", () => {
    const level = generate(canonicalOptions(14, 4));
    const ids = new Set<number>();
    for (const map of level.mm.maps) {
      for (let index = 0; index < map.cell.length; index++) {
        if (map.cell[index] === CellKind.SideEffect) {
          expect(map.sideEffectId[index]).toBeGreaterThanOrEqual(0);
          expect(ids.has(map.sideEffectId[index]!)).toBe(false);
          ids.add(map.sideEffectId[index]!);
        } else {
          expect(map.sideEffectId[index]).toBe(-1);
        }
        if (map.cell[index] !== CellKind.Cure) expect(map.cureId[index]).toBe(-1);
      }
    }
  });
});

describe("mapgen constructive programs", () => {
  it("cures every reference at its program endpoint across seeds and map counts", () => {
    for (let nMaps = 1; nMaps <= 4; nMaps++) {
      for (const seed of [0, 1, 14, 31, 99, 184]) assertReferences(generate(canonicalOptions(seed, nMaps)));
    }
  });

  it("uses multiple fixed machine path shapes in every canonical reference", () => {
    for (const seed of [0, 2, 14, 31, 99]) {
      const level = generate(canonicalOptions(seed, 4));
      for (const disease of level.diseases) {
        const signatures = new Set(disease.reference.steps.map((step) =>
          step.path.map((delta) => `${delta.x},${delta.y}`).join(";"),
        ));
        expect(signatures.size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("grows each cure into a connected five-to-nine-cell region containing its node", () => {
    for (const seed of [0, 14, 77, 184]) {
      const level = generate(canonicalOptions(seed, 4));
      for (const disease of level.diseases) {
        const map = level.mm.maps[disease.map]!;
        const nodeIndex = disease.node.y * map.width + disease.node.x;
        expect(map.cell[nodeIndex]).toBe(CellKind.Cure);
        expect(map.cureId[nodeIndex]).toBe(disease.id);
        expect(componentSizes(map, CellKind.Cure, disease.id)).toEqual([
          expect.toBeOneOf([5, 6, 7, 8, 9]),
        ]);
      }
    }
  });

  it("honors exact feasible difficulty tiers and derives price from reference cost", () => {
    for (const difficulty of [4, 6, 9, 12]) {
      const level = generate(options(14, { difficulty: { min: difficulty, max: difficulty } }));
      const disease = level.diseases[0]!;
      expect(disease.difficulty).toBe(difficulty);
      const cost = disease.reference.steps.reduce((sum, step) => {
        const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === step.typeId)!;
        return sum + entry.cost;
      }, 0);
      expect(disease.basePrice).toBe(difficultyToBasePrice(difficulty, cost));
    }
  });

  it("constructs with three distinct catalog shapes even when catalog length is divisible by three", () => {
    const catalog = DEFAULT_CATALOG.slice(0, 3);
    const level = generate(options(14, {
      catalog,
      difficulty: { min: 6, max: 6 },
    }));
    const signatures = new Set(level.diseases[0]!.reference.steps.map((step) =>
      step.path.map((delta) => `${delta.x},${delta.y}`).join(";"),
    ));
    expect(signatures.size).toBe(3);
    assertReferences(level);
  });
});

describe("mapgen pricing", () => {
  const exactPrice = (difficulty: number, refCost: number): bigint => {
    const exponent = BigInt(difficulty);
    const numerator = 10n * 17n ** exponent;
    const denominator = 10n ** exponent;
    return (2n * numerator + denominator) / (2n * denominator) + 3n * BigInt(refCost);
  };

  it("uses exact integer 17/10 growth across the entire supported range", () => {
    for (let difficulty = 0; difficulty <= MAX_GENERATION_DIFFICULTY; difficulty++) {
      for (const refCost of [0, 1, 7, 200, 1_000_000_000]) {
        expect(difficultyToBasePrice(difficulty, refCost)).toBe(Number(exactPrice(difficulty, refCost)));
      }
    }
  });

  it("keeps the active-range outputs compatible without using floating-point exponentiation", () => {
    for (let difficulty = 0; difficulty <= 30; difficulty++) {
      const exponent = BigInt(difficulty);
      const numerator = 10n * 17n ** exponent;
      const denominator = 10n ** exponent;
      const expected = Number((2n * numerator + denominator) / (2n * denominator) + 21n);
      expect(difficultyToBasePrice(difficulty, 7)).toBe(expected);
    }
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Math\.pow\s*\(/);
    expect(source).not.toMatch(/\b1\.7\b/);
  });

  it("rejects malformed inputs and unsafe output", () => {
    for (const difficulty of [NaN, Infinity, 1.5]) {
      expect(() => difficultyToBasePrice(difficulty, 0)).toThrow(/safe integer/);
    }
    expect(() => difficultyToBasePrice(-1, 0)).toThrow(/non-negative/);
    expect(() => difficultyToBasePrice(MAX_GENERATION_DIFFICULTY + 1, 0)).toThrow(/must not exceed/);
    for (const refCost of [NaN, Infinity, 1.5]) {
      expect(() => difficultyToBasePrice(1, refCost)).toThrow(/safe integer/);
    }
    expect(() => difficultyToBasePrice(1, -1)).toThrow(/non-negative/);
    const difficultyPrice = exactPrice(MAX_GENERATION_DIFFICULTY, 0);
    const maxRefCost = Number((BigInt(Number.MAX_SAFE_INTEGER) - difficultyPrice) / 3n);
    expect(difficultyToBasePrice(MAX_GENERATION_DIFFICULTY, maxRefCost)).toBe(
      Number(exactPrice(MAX_GENERATION_DIFFICULTY, maxRefCost)),
    );
    expect(() => difficultyToBasePrice(MAX_GENERATION_DIFFICULTY, maxRefCost + 1)).toThrow(
      /safe-integer range/,
    );
  });

  it("is jointly monotone in difficulty and reference cost", () => {
    let previous = 0;
    for (let difficulty = 0; difficulty <= MAX_GENERATION_DIFFICULTY; difficulty++) {
      const current = difficultyToBasePrice(difficulty, difficulty * 2);
      expect(Number.isSafeInteger(current)).toBe(true);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});
