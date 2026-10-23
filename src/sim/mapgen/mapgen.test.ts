import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type {
  EffectMap,
  GenOptions,
  GeneratedLevel,
  HexDir,
  MachineCatalogEntry,
  MultiMap,
  HexCoord,
} from "../phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  CellKind,
  DEFAULT_CATALOG,
} from "../phase0_interfaces";
import {
  HEX_DIRS,
  HEX_DQ,
  HEX_DR,
  hexDistance,
  rotateHexCoord,
} from "../hex";
import { evaluate } from "../drug-graph";
import { compileEntitledPrototype } from "../recipe";
import {
  HARD_REGION_SIZES,
  HARD_REGION_STARS,
  MAX_CONSTRUCTIVE_CANDIDATES,
  MAX_CONSTRUCTIVE_FALLBACK,
  MAX_GENERATION_DISEASES,
  MAX_GENERATION_CATALOG_ENTRIES,
  MAX_MAP_CELLS,
  MAX_PASS_STEPS,
  MAX_TERRAIN_ATTEMPTS,
  MIN_EASY_REGION,
  MOUNTAIN_LEVEL,
  START_DISK_RADIUS,
  VOID_DISTANCE,
  WATER_LEVEL,
  atlasContains,
  atlasRadius,
  diseaseCatalogCount,
  REGION_ABYSS_WEIGHT,
  REGION_DIFFICULTY_CAP,
  REGION_PASS_WEIGHT,
  REGION_PRICE_BASE,
  REGION_PRICE_PER_DIFFICULTY,
  generate as generateFresh,
  generateCached,
  generateWithDiagnostics,
  passTraversable,
  pricingOutOfOrder,
  regionPrice,
} from "./index";

const canonicalOptions = (seed: number, nMaps = 1): GenOptions => ({
  seed,
  nMaps,
  width: 49,
  height: 49,
  catalog: DEFAULT_CATALOG,
  diseaseCount: nMaps,
  difficulty: { min: 4, max: 12 },
});

const options = (seed: number, overrides: Partial<GenOptions> = {}): GenOptions => ({
  ...canonicalOptions(seed),
  ...overrides,
});

const oneAtlasOptions = (seed: number, diseaseCount = 4): GenOptions =>
  options(seed, { nMaps: 1, diseaseCount });

// Generation is pure, so tests share one result per distinct option set.
const generated = new Map<string, ReturnType<typeof generateWithDiagnostics>>();
function generateDetailed(opts: GenOptions): ReturnType<typeof generateWithDiagnostics> {
  if (opts.catalog !== DEFAULT_CATALOG) return generateWithDiagnostics(opts);
  const key = JSON.stringify({ ...opts, catalog: null });
  let result = generated.get(key);
  if (result === undefined) {
    result = generateWithDiagnostics(opts);
    generated.set(key, result);
  }
  return result;
}
const generate = (opts: GenOptions): GeneratedLevel => generateDetailed(opts).level;

function referenceSignature(level: GeneratedLevel): string {
  return level.diseases.map((disease) => disease.reference.steps.map((step) => step.typeId).join(",")).join("|");
}

function withoutRouteTerrain(level: GeneratedLevel): MultiMap {
  return {
    maps: level.mm.maps.map((map) => ({
      ...map,
      cell: Uint8Array.from(map.cell, (kind) =>
        kind === CellKind.Wall ||
        kind === CellKind.Abyss ||
        kind === CellKind.Swamp ||
        kind === CellKind.Portal
          ? CellKind.Empty
          : kind),
      portalTo: new Int32Array(map.portalTo.length).fill(-1),
      elevation: new Int16Array(map.portalTo.length),
    })),
  };
}

function fieldEqual(a: MultiMap, b: MultiMap): boolean {
  if (a.maps.length !== b.maps.length) return false;
  for (let mapIndex = 0; mapIndex < a.maps.length; mapIndex++) {
    const left = a.maps[mapIndex];
    const right = b.maps[mapIndex];
    if (left === undefined || right === undefined) return false;
    if (left.width !== right.width || left.height !== right.height) return false;
    if (left.start.q !== right.start.q || left.start.r !== right.start.r) return false;
    if (left.origin.q !== right.origin.q || left.origin.r !== right.origin.r) return false;
    for (const key of ["cell", "cureId", "cureTier", "sideEffectId", "portalTo", "elevation", "fog"] as const) {
      const aa = left[key];
      const bb = right[key];
      if (aa.length !== bb.length) return false;
      for (let index = 0; index < aa.length; index++) if (aa[index] !== bb[index]) return false;
    }
  }
  return true;
}

function cureSilhouette(cells: readonly HexCoord[], node: HexCoord): string {
  const relative = cells.map((cell) => ({ q: cell.q - node.q, r: cell.r - node.r }));
  const signatures: string[] = [];
  for (let reflected = 0; reflected <= 1; reflected++) {
    for (let rotation = 0; rotation < 6; rotation++) {
      const transformed = relative.map((cell) => {
        const point = reflected === 1
          ? { q: -cell.q - cell.r, r: cell.r }
          : cell;
        return rotateHexCoord(point, rotation as HexDir);
      }).sort((left, right) => left.q - right.q || left.r - right.r);
      signatures.push(transformed.map((cell) => `${cell.q},${cell.r}`).join(";"));
    }
  }
  return signatures.sort()[0]!;
}

function cureSilhouetteKind(cells: readonly HexCoord[]): "straight" | "bent" | "branch" {
  const indices = new Set(cells.map((cell) => `${cell.q},${cell.r}`));
  let maxDegree = 0;
  for (const cell of cells) {
    let degree = 0;
    for (const dir of HEX_DIRS) {
      if (indices.has(`${cell.q + HEX_DQ[dir]!},${cell.r + HEX_DR[dir]!}`)) degree++;
    }
    maxDegree = Math.max(maxDegree, degree);
  }
  if (maxDegree >= 3) return "branch";
  if (
    new Set(cells.map((cell) => cell.q)).size === 1 ||
    new Set(cells.map((cell) => cell.r)).size === 1 ||
    new Set(cells.map((cell) => cell.q + cell.r)).size === 1
  ) {
    return "straight";
  }
  return "bent";
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
  it("never imports the dev/test-only solver, randomness, or transcendental Math", () => {
    for (const file of ["./index.ts", "./terrain.ts", "./features.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/from\s+["'][^"']*solver[^"']*["']/);
      expect(source).not.toContain("Math.random");
      expect(source).not.toMatch(/Math\.(?:sin|cos|tan|atan2?|exp|log\w*|sqrt|cbrt|pow|hypot)\s*\(/);
    }
  });

  it("uses fixed bounded construction budgets", () => {
    expect(MAX_CONSTRUCTIVE_CANDIDATES).toBe(32);
    expect(MAX_CONSTRUCTIVE_FALLBACK).toBe(128);
    expect(MAX_TERRAIN_ATTEMPTS).toBe(4);
    expect(MAX_PASS_STEPS).toBe(10);
  });

  it("owns catalog-derived path data", () => {
    const catalog = DEFAULT_CATALOG.map((entry) => ({
      ...entry,
      path: entry.path.slice(),
    })) as MachineCatalogEntry[];
    const level = generate(options(12, { catalog }));
    const before = JSON.stringify(level.diseases[0]!.reference);
    for (const entry of catalog) {
      (entry.path as number[])[0] = 99;
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
    ["disease count", { diseaseCount: MAX_GENERATION_DISEASES + 1 }, /diseaseCount/],
    ["difficulty min", { difficulty: { min: -1, max: 4 } }, /difficulty/],
    ["difficulty order", { difficulty: { min: 9, max: 4 } }, /difficulty/],
    ["difficulty cap", { difficulty: { min: 4, max: 65 } }, /difficulty.max/],
  ] as const)("rejects invalid %s", (_name, override, message) => {
    expect(() => generate(options(1, override))).toThrow(message);
  });

  it("supports one to eight diseases on one Atlas", () => {
    for (let diseaseCount = 1; diseaseCount <= MAX_GENERATION_DISEASES; diseaseCount++) {
      const level = generate(oneAtlasOptions(14, diseaseCount));
      expect(level.mm.maps).toHaveLength(1);
      expect(level.diseases).toHaveLength(diseaseCount);
      assertReferences(level);
    }
  }, 30_000);

  it("rejects area and catalog bounds before allocating generation state", () => {
    expect(() => generate(options(1, { width: MAX_MAP_CELLS, height: 3 }))).toThrow(/area/);
    const catalog = Array.from({ length: MAX_GENERATION_CATALOG_ENTRIES + 1 }, (_, index) => ({
      typeId: `m${index}`,
      path: [0 as const],
      turn: 0,
      cost: 1,
      speed: 1,
    }));
    expect(() => generate(options(1, { catalog }))).toThrow(/catalog.*exceed/i);
  });

  it("rejects duplicate IDs and malformed path stamps", () => {
    const first = DEFAULT_CATALOG[0]!;
    expect(() => generate(options(1, { catalog: [first, first] }))).toThrow(/duplicate typeId/i);
    expect(() => generate(options(1, {
      catalog: [{ typeId: "bad", path: [6] as never, turn: 0, cost: 1, speed: 1 }],
    }))).toThrow(/hex direction/i);
    expect(() => generate(options(1, {
      catalog: [{ typeId: "bad-turn", path: [0], turn: 6, cost: 1, speed: 1 }],
    }))).toThrow(/turn/i);
    expect(() => generate(options(1, {
      catalog: [{ typeId: "empty", path: [], turn: 0, cost: 1, speed: 1 }],
    }))).toThrow(/path length/i);
  });
});

describe("mapgen centered deterministic atlas", () => {
  it("generates every supported board size, using flat terrain below the skeleton radius", () => {
    for (const size of [9, 17, 25, 31, 33]) {
      for (const seed of [0, 14]) {
        expect(() => generateFresh({ ...oneAtlasOptions(seed), width: size, height: size })).not.toThrow();
      }
    }
  }, 60_000);

  it("memoises equal options by content so Load and replay reuse one frozen level", () => {
    const options = oneAtlasOptions(77);
    const first = generateCached(options);
    expect(generateCached({ ...options, difficulty: { ...options.difficulty } })).toBe(first);
    expect(generateCached(oneAtlasOptions(78))).not.toBe(first);
    expect(first).toEqual(generateFresh(options));
  });

  it("is field-equal for the same seed, including relief, tiers and diagnostics", () => {
    for (const seed of [0, 1, 14, 184, 0xffffffff]) {
      for (const nMaps of [1, 4]) {
        const left = generateWithDiagnostics(canonicalOptions(seed, nMaps));
        const right = generateWithDiagnostics(canonicalOptions(seed, nMaps));
        expect(fieldEqual(left.level.mm, right.level.mm)).toBe(true);
        expect(left.level.diseases).toEqual(right.level.diseases);
        expect(left.diagnostics).toEqual(right.diagnostics);
      }
    }
  }, 30_000);

  it("uses the seed to vary canonical atlas fields", () => {
    const baseline = generate(canonicalOptions(0, 2));
    for (const seed of [1, 2, 14, 184]) {
      expect(fieldEqual(baseline.mm, generate(canonicalOptions(seed, 2)).mm)).toBe(false);
    }
  });

  it("starts every layer at the exact map center heading east", () => {
    const level = generate(canonicalOptions(14, 4));
    expect(level.start.pos).toEqual(Array.from({ length: 4 }, () => ({ q: 24, r: 24 })));
    expect(level.start.heading).toBe(0);
    for (const map of level.mm.maps) {
      expect(map.start).toEqual({ q: 24, r: 24 });
      expect(map.origin).toEqual({ q: 24, r: 24 });
    }
  });

  it("keeps the start disk plain: no relief, failure, portal or effect", () => {
    for (let seed = 0; seed < 40; seed++) {
      const map = generate(canonicalOptions(seed)).mm.maps[0]!;
      for (let index = 0; index < map.cell.length; index++) {
        if (hexDistance(map.start.q, map.start.r, index % map.width, Math.floor(index / map.width)) > START_DISK_RADIUS) continue;
        expect(map.cell[index]).toBe(CellKind.Empty);
      }
    }
  });

  it("emits authoritative fixed-length typed fields with initially hidden fog", () => {
    const level = generate(canonicalOptions(14, 4));
    for (const map of level.mm.maps) {
      const area = map.width * map.height;
      expect(map.cell).toBeInstanceOf(Uint8Array);
      expect(map.cureId).toBeInstanceOf(Int16Array);
      expect(map.cureTier).toBeInstanceOf(Uint8Array);
      expect(map.sideEffectId).toBeInstanceOf(Int32Array);
      expect(map.portalTo).toBeInstanceOf(Int32Array);
      expect(map.elevation).toBeInstanceOf(Int16Array);
      expect(map.fog).toBeInstanceOf(Uint8Array);
      for (const field of [map.cell, map.cureId, map.cureTier, map.sideEffectId, map.portalTo, map.elevation, map.fog]) {
        expect(field).toHaveLength(area);
      }
      expect(map.fog.every((value) => value === 0)).toBe(true);
      expect(map.cell.every((value) => value >= CellKind.Empty && value <= CellKind.Cure)).toBe(true);
    }
  });

  it("preserves centered deterministic generation on noncanonical legal sizes", () => {
    for (const size of [3, 5, 9, 16, 32, 64]) {
      for (const seed of [0, 1, 42]) {
        const opts = options(seed, { width: size, height: size });
        const level = generate(opts);
        expect(level.mm.maps[0]!.start).toEqual({ q: Math.floor(size / 2), r: Math.floor(size / 2) });
        expect(fieldEqual(level.mm, generateFresh(opts).mm)).toBe(true);
        expect(level.mm.maps[0]!.portalTo.every((destination) => destination === -1)).toBe(true);
        assertReferences(level);
      }
    }
  }, 30_000);

  it("keeps the minimum legal map size generatable across seeded cure-region sizes", () => {
    for (let seed = 0; seed < 64; seed++) {
      const level = generate(options(seed, { width: 3, height: 3 }));
      expect(level.mm.maps[0]!.start).toEqual({ q: 1, r: 1 });
      assertReferences(level);
    }
  });
});

function walkableReach(map: EffectMap): Uint8Array {
  const seen = new Uint8Array(map.cell.length);
  const start = map.start.r * map.width + map.start.q;
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    for (const dir of HEX_DIRS) {
      const q = (current % map.width) + HEX_DQ[dir]!;
      const r = Math.floor(current / map.width) + HEX_DR[dir]!;
      if (q < 0 || r < 0 || q >= map.width || r >= map.height) continue;
      const next = r * map.width + q;
      const kind = map.cell[next];
      if (seen[next] === 1 || kind === CellKind.Wall || kind === CellKind.Abyss) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return seen;
}

const atlasSeeds = Array.from({ length: 24 }, (_, index) => index + 1);
const startDistance = (map: EffectMap, index: number): number =>
  hexDistance(map.start.q, map.start.r, index % map.width, Math.floor(index / map.width));
const initialMachines = DEFAULT_CATALOG.slice(0, 4).map((entry) => ({ typeId: entry.typeId, path: entry.path, turn: entry.turn }));

describe("v2 Atlas relief", () => {
  it("is a hexagon closed by a thin mountain rim, with relief matching the terrain", () => {
    for (const seed of atlasSeeds) {
      const map = generate(oneAtlasOptions(seed)).mm.maps[0]!;
      const radius = atlasRadius(map.width, map.height);
      expect(radius).toBe(24);
      let inside = 0;
      let mountain = 0;
      for (let index = 0; index < map.cell.length; index++) {
        const q = index % map.width;
        const r = Math.floor(index / map.width);
        const distance = startDistance(map, index);
        expect(atlasContains(map, q, r)).toBe(distance <= radius);
        if (distance >= radius) {
          expect(map.cell[index]).toBe(CellKind.Wall);
          continue;
        }
        inside++;
        const kind = map.cell[index]!;
        const elevation = map.elevation[index]!;
        if (kind === CellKind.Wall) mountain++;
        expect(kind === CellKind.Wall).toBe(elevation >= MOUNTAIN_LEVEL);
        if (kind !== CellKind.Wall) expect(kind === CellKind.Swamp).toBe(elevation <= WATER_LEVEL);
        expect(kind).not.toBe(CellKind.Portal);
      }
      expect(mountain / inside).toBeGreaterThan(0.15);
      expect(mountain / inside).toBeLessThan(0.5);
      expect(map.portalTo.every((destination) => destination === -1)).toBe(true);
    }
  }, 60_000);

  it("leaves no sealed pocket: every walkable cell is reachable from the start", () => {
    for (const seed of atlasSeeds) {
      for (const level of [generate(oneAtlasOptions(seed)), generate(oneAtlasOptions(seed, 8))]) {
        const map = level.mm.maps[0]!;
        const reach = walkableReach(map);
        for (let index = 0; index < map.cell.length; index++) {
          const kind = map.cell[index];
          if (kind === CellKind.Wall || kind === CellKind.Abyss) continue;
          expect(reach[index], `seed ${seed} cell ${index}`).toBe(1);
        }
      }
    }
  }, 60_000);

  it("drops single-cell lakes", () => {
    for (const seed of atlasSeeds) {
      const map = generate(oneAtlasOptions(seed)).mm.maps[0]!;
      for (let index = 0; index < map.cell.length; index++) {
        if (map.cell[index] !== CellKind.Swamp) continue;
        const wet = HEX_DIRS.some((dir) => {
          const q = (index % map.width) + HEX_DQ[dir]!;
          const r = Math.floor(index / map.width) + HEX_DR[dir]!;
          return map.cell[r * map.width + q] === CellKind.Swamp;
        });
        expect(wet).toBe(true);
      }
    }
  }, 60_000);

  it("builds a thick inner ring range with 2–3 winding passes and one entry per basin", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      const atlas = diagnostics.maps[0]!;
      expect(atlas.skeleton).toBe(true);
      const ringPasses = atlas.passes.filter((pass) => pass.kind === "ring");
      expect(ringPasses.length).toBeGreaterThanOrEqual(2);
      expect(ringPasses.length).toBeLessThanOrEqual(3);
      expect(atlas.basins.length).toBeGreaterThanOrEqual(1);
      expect(atlas.basins.length).toBeLessThanOrEqual(3);
      expect(atlas.passes.filter((pass) => pass.kind === "basin")).toHaveLength(atlas.basins.length);
      const ring = Math.round((atlas.radius * 3) / 8);
      let band = 0;
      let mountain = 0;
      for (let index = 0; index < map.cell.length; index++) {
        if (startDistance(map, index) !== ring) continue;
        band++;
        if (map.cell[index] === CellKind.Wall) mountain++;
      }
      expect(mountain / band).toBeGreaterThan(0.6);
    }
  }, 60_000);

  it("carves each pass as a forced-walkable saddle with a long 1-cell core that machines can thread", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      for (const pass of diagnostics.maps[0]!.passes) {
        expect(pass.verified).toBe(true);
        expect(pass.narrow.length / pass.path.length).toBeGreaterThanOrEqual(0.38);
        expect(pass.narrow.length / pass.path.length).toBeLessThanOrEqual(0.62);
        for (const cell of pass.cells) {
          expect([CellKind.Empty, CellKind.Cure, CellKind.Swamp]).toContain(map.cell[cell]);
          expect(map.elevation[cell]).toBeLessThan(MOUNTAIN_LEVEL);
        }
        for (const cell of pass.narrow) {
          expect(map.cell[cell]).toBe(CellKind.Empty);
          expect(map.cureId[cell]).toBe(-1);
        }
        // The bounded generation-time BFS still finds a route on the finished Atlas.
        expect(passTraversable({ ...map, inside: new Uint8Array(0), pass: new Uint8Array(0) }, pass, initialMachines)).toBe(true);
      }
    }
  }, 60_000);
});

function regionConnected(map: EffectMap, cells: readonly number[]): boolean {
  const set = new Set(cells);
  const seen = new Set([cells[0]!]);
  const queue = [cells[0]!];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    for (const dir of HEX_DIRS) {
      const next = (Math.floor(current / map.width) + HEX_DR[dir]!) * map.width + (current % map.width) + HEX_DQ[dir]!;
      if (!set.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size === set.size;
}

describe("v2 tiered effect regions", () => {
  it("gives every disease an easy tier-1 region and a hard region with a 2–3 cell ★ core", () => {
    for (const seed of atlasSeeds) {
      for (const diseaseCount of [1, 4, 8]) {
        const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed, diseaseCount));
        const map = level.mm.maps[0]!;
        for (const disease of level.diseases) {
          const easy = diagnostics.regions.filter((region) => region.disease === disease.id && region.kind === "easy");
          const hard = diagnostics.regions.filter((region) => region.disease === disease.id && region.kind === "hard");
          expect(easy.length, `seed ${seed} disease ${disease.id}`).toBeGreaterThanOrEqual(1);
          expect(hard.length, `seed ${seed}/${diseaseCount} disease ${disease.id}`).toBeGreaterThanOrEqual(1);
          expect(easy.some((region) => region.cells.includes(disease.node.r * map.width + disease.node.q))).toBe(true);
        }
        for (const region of diagnostics.regions) {
          const [min, max] = region.kind === "hard" ? HARD_REGION_SIZES : [MIN_EASY_REGION, 5];
          expect(region.cells.length).toBeGreaterThanOrEqual(min);
          expect(region.cells.length).toBeLessThanOrEqual(max);
          expect(regionConnected(map, region.cells)).toBe(true);
          if (region.kind === "hard") {
            expect(region.stars.length).toBeGreaterThanOrEqual(HARD_REGION_STARS[0]);
            expect(region.stars.length).toBeLessThanOrEqual(HARD_REGION_STARS[1]);
          } else {
            expect(region.stars).toEqual([]);
          }
          const stars = new Set(region.stars);
          for (const cell of region.cells) {
            expect(map.cell[cell]).toBe(CellKind.Cure);
            expect(map.cureId[cell]).toBe(region.disease);
            expect(map.cureTier[cell]).toBe(stars.has(cell) ? 2 : 1);
            expect(startDistance(map, cell)).toBeGreaterThan(START_DISK_RADIUS);
            expect(map.portalTo[cell]).toBe(-1);
          }
        }
      }
    }
  }, 60_000);

  it("assigns every Cure cell to exactly one region; different diseases never overlap or touch", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed, 8));
      const map = level.mm.maps[0]!;
      const owner = new Map<number, number>();
      for (const region of diagnostics.regions) {
        for (const cell of region.cells) {
          expect(owner.has(cell)).toBe(false);
          owner.set(cell, region.disease);
        }
      }
      for (let index = 0; index < map.cell.length; index++) {
        expect(map.cell[index] === CellKind.Cure).toBe(owner.has(index));
        if (map.cell[index] !== CellKind.Cure) expect(map.cureTier[index]).toBe(0);
      }
      // Hard regions and void fills keep a gap to other diseases (reference regions may touch).
      for (const region of diagnostics.regions.filter((candidate) => candidate.kind !== "easy")) {
        for (const cell of region.cells) {
          for (const dir of HEX_DIRS) {
            const next = (Math.floor(cell / map.width) + HEX_DR[dir]!) * map.width + (cell % map.width) + HEX_DQ[dir]!;
            if (owner.has(next)) expect(owner.get(next)).toBe(region.disease);
          }
        }
      }
    }
  }, 60_000);

  it("puts hard regions in basins or past the inner ring", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      const ringOuter = Math.ceil((diagnostics.maps[0]!.radius * 3) / 8) + 2;
      for (const region of diagnostics.regions.filter((candidate) => candidate.kind === "hard")) {
        expect(startDistance(map, region.cells[0]!)).toBeGreaterThanOrEqual(ringOuter);
      }
    }
  }, 60_000);

  it("fills every void: open plain ground lies within reach of some feature", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      const pass = new Set(diagnostics.maps[0]!.passes.flatMap((candidate) => candidate.cells));
      const distance = new Int32Array(map.cell.length).fill(-1);
      const queue: number[] = [];
      for (let index = 0; index < map.cell.length; index++) {
        if (!atlasContains(map, index % map.width, Math.floor(index / map.width)) || map.cell[index] !== CellKind.Empty || pass.has(index)) {
          distance[index] = 0;
          queue.push(index);
        }
      }
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head]!;
        for (const dir of HEX_DIRS) {
          const q = (current % map.width) + HEX_DQ[dir]!;
          const r = Math.floor(current / map.width) + HEX_DR[dir]!;
          if (q < 0 || r < 0 || q >= map.width || r >= map.height) continue;
          const next = r * map.width + q;
          if (distance[next] !== -1) continue;
          distance[next] = distance[current]! + 1;
          queue.push(next);
        }
      }
      for (let index = 0; index < map.cell.length; index++) {
        if (startDistance(map, index) <= START_DISK_RADIUS) continue;
        expect(distance[index], `seed ${seed} cell ${index}`).toBeLessThan(VOID_DISTANCE);
      }
      expect(diagnostics.regions.some((region) => region.kind === "fill")).toBe(true);
    }
  }, 60_000);

  it("contaminates part of every region while reference endpoints and ★ cores stay clean", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      const ids = new Set<number>();
      for (const region of diagnostics.regions) {
        expect(region.cells.some((cell) => map.sideEffectId[cell]! >= 0)).toBe(true);
        expect(region.cells.some((cell) => map.sideEffectId[cell] === -1)).toBe(true);
        for (const cell of region.stars) expect(map.sideEffectId[cell]).toBe(-1);
      }
      for (const disease of level.diseases) {
        expect(map.sideEffectId[disease.node.r * map.width + disease.node.q]).toBe(-1);
      }
      for (let index = 0; index < map.cell.length; index++) {
        const id = map.sideEffectId[index]!;
        if (id < 0) continue;
        expect(map.cell[index]).toBe(CellKind.Cure);
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }
    }
  }, 60_000);
});

describe("v2 failure (black) cells", () => {
  it("keeps black ground off passes, effects, the start area and reference trails", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      const pass = new Set(diagnostics.maps[0]!.passes.flatMap((candidate) => candidate.cells));
      const grouped = new Set(diagnostics.maps[0]!.black.flatMap((group) => group.cells));
      for (let index = 0; index < map.cell.length; index++) {
        if (map.cell[index] !== CellKind.Abyss) continue;
        expect(grouped.has(index)).toBe(true);
        expect(pass.has(index)).toBe(false);
        expect(startDistance(map, index)).toBeGreaterThan(3);
      }
      for (const disease of level.diseases) {
        const outcome = evaluate(level.mm, level.start, disease.reference);
        expect(outcome.failed).toBe(false);
      }
    }
  }, 60_000);

  it("rings ★ cores, traps narrow exits and scatters sneaky singles and strips", () => {
    for (const seed of atlasSeeds) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      const atlas = diagnostics.maps[0]!;
      const hard = diagnostics.regions.filter((region) => region.kind === "hard");
      const stars = atlas.black.filter((group) => group.kind === "star");
      expect(stars).toHaveLength(hard.length);
      stars.forEach((group, index) => {
        expect(group.cells.length).toBeGreaterThanOrEqual(3);
        expect(group.cells.length).toBeLessThanOrEqual(4);
        for (const cell of group.cells) {
          const near = Math.min(...hard[index]!.stars.map((star) => hexDistance(
            cell % map.width, Math.floor(cell / map.width), star % map.width, Math.floor(star / map.width),
          )));
          expect(near).toBeLessThanOrEqual(4);
        }
      });
      const traps = atlas.black.filter((group) => group.kind === "trap");
      expect(traps.length).toBeGreaterThanOrEqual(Math.min(2, atlas.passes.length));
      const singles = atlas.black.filter((group) => group.kind === "single");
      expect(singles).toHaveLength(1);
      expect(singles[0]!.cells.length).toBeGreaterThanOrEqual(8);
      expect(singles[0]!.cells.length).toBeLessThanOrEqual(12);
      const strips = atlas.black.filter((group) => group.kind === "strip");
      expect(strips.length).toBeGreaterThanOrEqual(2);
      expect(strips.length).toBeLessThanOrEqual(3);
      for (const strip of strips) {
        expect(strip.cells.length).toBeGreaterThanOrEqual(3);
        expect(strip.cells.length).toBeLessThanOrEqual(5);
      }
    }
  }, 60_000);
});

describe("mapgen seeded disease diversity", () => {
  it("constructs the late-sweep regression seed within the bounded candidate budget", () => {
    const level = generate(oneAtlasOptions(864));
    expect(level.diseases).toHaveLength(4);
    assertReferences(level);
  });

  it("constructs the dense eight-disease regression seed within the same budget", () => {
    const level = generate(oneAtlasOptions(199, 8));
    expect(level.diseases).toHaveLength(8);
    assertReferences(level);
  });

  it("constructs the shipped four-disease Atlas across a broad deterministic seed sample", () => {
    for (let seed = 1; seed <= 128; seed++) {
      const level = generate(oneAtlasOptions(seed));
      expect(level.diseases).toHaveLength(4);
      assertReferences(level);
    }
  }, 30_000);

  it("keeps every normal Cure region outside the fresh start-centered radius-two hex", () => {
    // Structural (construction excludes the disk); 200 seeds share the cached diversity samples.
    for (let seed = 1; seed <= 200; seed++) {
      const level = generate(oneAtlasOptions(seed));
      for (const map of level.mm.maps) {
        for (let index = 0; index < map.cell.length; index++) {
          if (map.cell[index] !== CellKind.Cure) continue;
          const q = index % map.width;
          const r = Math.floor(index / map.width);
          expect(hexDistance(map.start.q, map.start.r, q, r)).toBeGreaterThan(2);
        }
      }
    }
  }, 60_000);

  it("distributes seeded Cure regions across varied bent and branching silhouettes", () => {
    const silhouettes = new Map<string, number>();
    const bent = new Set<string>();
    const branches = new Set<string>();
    let straight = 0;
    let total = 0;
    for (let seed = 0; seed < 200; seed++) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      for (const disease of level.diseases) {
        const map = level.mm.maps[disease.map]!;
        const node = disease.node.r * map.width + disease.node.q;
        const cells = diagnostics.regions
          .find((region) => region.kind === "easy" && region.cells.includes(node))!.cells
          .map((index) => ({ q: index % map.width, r: Math.floor(index / map.width) }));
        const signature = cureSilhouette(cells, disease.node);
        const kind = cureSilhouetteKind(cells);
        silhouettes.set(signature, (silhouettes.get(signature) ?? 0) + 1);
        if (kind === "straight") straight++;
        else if (kind === "bent") bent.add(signature);
        else branches.add(signature);
        total++;
      }
    }
    const largest = Math.max(...silhouettes.values());
    expect(total).toBe(800);
    expect(largest).toBeLessThanOrEqual(Math.floor(total * 0.25));
    expect(straight).toBeLessThanOrEqual(Math.floor(total * 0.2));
    expect(silhouettes.size).toBeGreaterThanOrEqual(10);
    expect(bent.size).toBeGreaterThanOrEqual(5);
    expect(branches.size).toBeGreaterThanOrEqual(4);
  }, 60_000);

  it("materially varies references and cure nodes between one-Atlas seeds", () => {
    const references = new Set<string>();
    const cureSets = new Set<string>();
    const difficulties = new Set<number>();
    for (let seed = 1; seed <= 24; seed++) {
      const level = generate(oneAtlasOptions(seed));
      references.add(referenceSignature(level));
      cureSets.add(level.diseases.map((disease) => `${disease.node.q},${disease.node.r}`).join("|"));
      for (const disease of level.diseases) difficulties.add(disease.difficulty);
    }
    expect(references.size).toBeGreaterThanOrEqual(18);
    expect(cureSets.size).toBeGreaterThanOrEqual(18);
    expect(difficulties.size).toBeGreaterThanOrEqual(5);
  });

  it("constructs references whose actual endpoints depend on generated route terrain", () => {
    for (const seed of [1, 2, 14, 31, 77, 184]) {
      const level = generate(oneAtlasOptions(seed));
      const neutral = withoutRouteTerrain(level);
      for (const disease of level.diseases) {
        const withTerrain = evaluate(level.mm, level.start, disease.reference);
        const withoutTerrain = evaluate(neutral, level.start, disease.reference);
        expect(withTerrain.final[disease.map]).not.toEqual(withoutTerrain.final[disease.map]);
      }
    }
  });

  it("keeps the first disease constructible from the initially available four machines", () => {
    const initialIds = new Set(DEFAULT_CATALOG.slice(0, 4).map((entry) => entry.typeId));
    for (const seed of [1, 2, 14, 31, 77, 184]) {
      const first = generate(oneAtlasOptions(seed)).diseases[0]!;
      expect(first.reference.steps.every((step) => initialIds.has(step.typeId))).toBe(true);
    }
  });

  it("tiers later canonical diseases through each tier's frontier patent machine", () => {
    for (const seed of [1, 14, 77, 184]) {
      const level = generate(oneAtlasOptions(seed));
      for (let disease = 1; disease <= 3; disease++) {
        const patent = DEFAULT_CATALOG[diseaseCatalogCount(disease, DEFAULT_CATALOG.length) - 1]!;
        expect(level.diseases[disease]!.reference.steps.some((step) => step.typeId === patent.typeId)).toBe(true);
      }
    }
  });

  it("keeps disease-zero references packable on the entitled 24×12 floor", () => {
    for (const seed of [212, 231, 274, 414, 559, 727, 732, 733, 737, 833, 842, 968]) {
      const first = generate(oneAtlasOptions(seed)).diseases[0]!;
      const compiled = compileEntitledPrototype(
        first.reference,
        BASE_GAME_FACTORY_WIDTH,
        BASE_GAME_FACTORY_HEIGHT,
      );
      expect(compiled.layout.width).toBe(BASE_GAME_FACTORY_WIDTH);
      expect(compiled.layout.height).toBe(BASE_GAME_FACTORY_HEIGHT);
    }
  });
});

describe("mapgen constructive programs", () => {
  it("keeps every constructed reference nonterminal until its final machine", () => {
    const levels = [
      generate(options(0, { width: 3, height: 3 })),
      generate(options(14, { width: 32, height: 32 })),
      ...[0, 14, 77, 184].map((seed) => generate(canonicalOptions(seed, 4))),
    ];
    for (const level of levels) {
      for (const disease of level.diseases) {
        for (let length = 1; length < disease.reference.steps.length; length++) {
          const prefix = { steps: disease.reference.steps.slice(0, length) };
          expect(evaluate(level.mm, level.start, prefix).cured).toEqual([]);
        }
        expect(evaluate(level.mm, level.start, disease.reference).cured).toContain(disease.id);
      }
    }
  }, 10_000);

  it("cures every reference at its program endpoint across seeds and map counts", () => {
    for (let nMaps = 1; nMaps <= 4; nMaps++) {
      for (const seed of [0, 1, 14, 31, 99, 184]) assertReferences(generate(canonicalOptions(seed, nMaps)));
    }
  }, 10_000);

  it("uses multiple fixed machine path shapes in every canonical reference", () => {
    for (const seed of [0, 2, 14, 31, 99]) {
      const level = generate(canonicalOptions(seed, 4));
      for (const disease of level.diseases) {
        const signatures = new Set(disease.reference.steps.map((step) =>
          step.path.join(","),
        ));
        expect(signatures.size).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("grows each reference cure into a connected 3–5 cell tier-1 region containing its node", () => {
    for (const seed of [0, 14, 77, 184]) {
      for (const nMaps of [1, 4]) {
        const { level, diagnostics } = generateDetailed(canonicalOptions(seed, nMaps));
        for (const disease of level.diseases) {
          const map = level.mm.maps[disease.map]!;
          const nodeIndex = disease.node.r * map.width + disease.node.q;
          expect(map.cell[nodeIndex]).toBe(CellKind.Cure);
          expect(map.cureId[nodeIndex]).toBe(disease.id);
          expect(map.cureTier[nodeIndex]).toBe(1);
          const region = diagnostics.regions.find((candidate) =>
            candidate.map === disease.map && candidate.kind === "easy" && candidate.cells.includes(nodeIndex))!;
          expect(region.cells.length).toBeGreaterThanOrEqual(MIN_EASY_REGION);
          expect(region.cells.length).toBeLessThanOrEqual(5);
          expect(regionConnected(map, region.cells)).toBe(true);
        }
      }
    }
  });

  it("gives every cure region a clean reference node and contaminated alternate cells", () => {
    for (const seed of [1, 14, 77, 184]) {
      const level = generate(oneAtlasOptions(seed));
      const overlayIds = new Set<number>();
      for (const disease of level.diseases) {
        const map = level.mm.maps[disease.map]!;
        const nodeIndex = disease.node.r * map.width + disease.node.q;
        expect(map.sideEffectId[nodeIndex]).toBe(-1);
        const region: number[] = [];
        for (let index = 0; index < map.cell.length; index++) {
          if (map.cell[index] === CellKind.Cure && map.cureId[index] === disease.id) region.push(index);
        }
        expect(region.some((index) => map.sideEffectId[index] === -1)).toBe(true);
        expect(region.some((index) => map.sideEffectId[index]! >= 0)).toBe(true);
        for (const index of region) {
          const overlay = map.sideEffectId[index]!;
          if (overlay < 0) continue;
          expect(overlayIds.has(overlay)).toBe(false);
          overlayIds.add(overlay);
        }
      }
    }
  });

  it("reserves noncompeting cure regions for known dense-generation seeds", () => {
    for (const seed of [52, 247]) {
      const level = generate(oneAtlasOptions(seed));
      expect(level.diseases).toHaveLength(4);
      assertReferences(level);
    }
  });

  it("never places a cure on a portal entry or its reserved destination", () => {
    for (const seed of [1, 2, 14, 31, 77, 184]) {
      const level = generate(oneAtlasOptions(seed));
      for (const map of level.mm.maps) {
        const destinations = new Set(Array.from(map.portalTo).filter((destination) => destination >= 0));
        for (let index = 0; index < map.cell.length; index++) {
          if (map.cell[index] !== CellKind.Cure) continue;
          expect(map.portalTo[index]).toBe(-1);
          expect(destinations.has(index)).toBe(false);
        }
      }
    }
  });

  it("honors exact feasible difficulty tiers and quotes the cheapest region as the base price", () => {
    for (const difficulty of [4, 6, 9, 12]) {
      const level = generate(options(14, { difficulty: { min: difficulty, max: difficulty } }));
      const disease = level.diseases[0]!;
      expect(disease.difficulty).toBe(difficulty);
      expect(disease.regions.length).toBeGreaterThan(0);
      expect(disease.basePrice).toBe(Math.min(...disease.regions.map((region) => region.price)));
    }
  });

  it("keeps the legal exact-difficulty-one contract on a noncanonical Atlas", () => {
    const level = generate(options(14, {
      width: 32,
      height: 32,
      catalog: [DEFAULT_CATALOG[0]!],
      difficulty: { min: 1, max: 1 },
    }));
    const disease = level.diseases[0]!;
    expect(disease.difficulty).toBe(1);
    expect(disease.reference.steps).toHaveLength(1);
    const outcome = evaluate(level.mm, level.start, disease.reference);
    expect(outcome.failed).toBe(false);
    expect(outcome.cured).toContain(disease.id);
    expect(outcome.final[disease.map]).toEqual(disease.node);
  });

  it("constructs with three distinct catalog shapes even when catalog length is divisible by three", () => {
    const catalog = DEFAULT_CATALOG.slice(0, 3);
    const level = generate(options(1, {
      catalog,
      difficulty: { min: 6, max: 6 },
    }));
    const signatures = new Set(level.diseases[0]!.reference.steps.map((step) =>
      step.path.join(","),
    ));
    expect(signatures.size).toBe(3);
    assertReferences(level);
  });
});

describe("mapgen pricing", () => {
  const PINNED_SEEDS = [...Array.from({ length: 32 }, (_, seed) => seed), 42, 100];

  it("prices a region linearly in its reach difficulty across the supported range", () => {
    let previous = 0;
    for (let difficulty = 0; difficulty <= REGION_DIFFICULTY_CAP; difficulty++) {
      const price = regionPrice(difficulty);
      expect(price).toBe(REGION_PRICE_BASE + REGION_PRICE_PER_DIFFICULTY * difficulty);
      expect(price).toBeGreaterThanOrEqual(previous);
      previous = price;
    }
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Math\.pow\s*\(/);
  });

  it("rejects malformed difficulties", () => {
    for (const difficulty of [NaN, Infinity, 1.5, -1, REGION_DIFFICULTY_CAP + 1]) {
      expect(() => regionPrice(difficulty)).toThrow(/integer in 0\.\./);
    }
  });

  it("stamps one priced region id on every Cure cell and prices it from its reach", () => {
    for (const seed of [1, 14]) {
      const { level, diagnostics } = generateDetailed(oneAtlasOptions(seed));
      const map = level.mm.maps[0]!;
      expect(diagnostics.pricing).toHaveLength(diagnostics.regions.length);
      for (let cell = 0; cell < map.cell.length; cell++) {
        expect(map.regionId[cell] !== 0).toBe(map.cell[cell] === CellKind.Cure);
      }
      for (const [index, region] of diagnostics.regions.entries()) {
        const pricing = diagnostics.pricing[index]!;
        expect(pricing.id).toBe(index + 1);
        for (const cell of region.cells) expect(map.regionId[cell]).toBe(index + 1);
        expect(pricing.capped).toBe(pricing.reachCost === null);
        const expected = pricing.reachCost === null
          ? REGION_DIFFICULTY_CAP
          : Math.min(
            REGION_DIFFICULTY_CAP,
            pricing.reachCost + REGION_PASS_WEIGHT * pricing.passes + REGION_ABYSS_WEIGHT * pricing.abyss,
          );
        expect(pricing.difficulty).toBe(expected);
        expect(pricing.price).toBe(regionPrice(expected));
        const spec = level.diseases.find((disease) => disease.id === region.disease)!;
        expect(spec.regions.find((candidate) => candidate.id === pricing.id)).toEqual({
          id: pricing.id,
          difficulty: pricing.difficulty,
          price: pricing.price,
          capped: pricing.capped,
        });
      }
      for (const disease of level.diseases) {
        const outcome = evaluate(level.mm, level.start, disease.reference);
        const region = outcome.regions[outcome.cured.indexOf(disease.id)];
        expect(map.regionId[disease.node.r * map.width + disease.node.q]).toBe(region);
      }
    }
  });

  it("keeps every disease's deep hard region pricier than its easy region on the pinned seeds", () => {
    for (const seed of PINNED_SEEDS) {
      const { diagnostics } = generateDetailed(oneAtlasOptions(seed));
      expect(pricingOutOfOrder(diagnostics.pricing), `seed ${seed}`).toBeNull();
      for (let disease = 0; disease < 4; disease++) {
        const prices = (kind: string) => diagnostics.pricing
          .filter((region) => region.disease === disease && region.kind === kind)
          .map((region) => region.price);
        expect(Math.max(...prices("hard")), `seed ${seed} disease ${disease}`)
          .toBeGreaterThan(Math.max(...prices("easy")));
      }
    }
  }, 120_000);
});
