import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import fc from "fast-check";
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
import { evaluate, walkValidatedPathInto } from "../drug-graph";
import { compileEntitledPrototype } from "../recipe";
import {
  MAX_CONSTRUCTIVE_CANDIDATES,
  MAX_GENERATION_DISEASES,
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

const oneAtlasOptions = (seed: number, diseaseCount = 4): GenOptions =>
  options(seed, { nMaps: 1, diseaseCount });

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
    })),
  };
}

const radius = (map: EffectMap, index: number): number => {
  const q = index % map.width;
  const r = Math.floor(index / map.width);
  const raw = hexDistance(map.origin.q, map.origin.r, q, r);
  const base = Math.max(
    1,
    hexDistance(map.origin.q, map.origin.r, 0, 0),
    hexDistance(map.origin.q, map.origin.r, map.width - 1, 0),
    hexDistance(map.origin.q, map.origin.r, 0, map.height - 1),
    hexDistance(map.origin.q, map.origin.r, map.width - 1, map.height - 1),
  );
  return Math.floor((raw * 31) / base);
};

function fieldEqual(a: MultiMap, b: MultiMap): boolean {
  if (a.maps.length !== b.maps.length) return false;
  for (let mapIndex = 0; mapIndex < a.maps.length; mapIndex++) {
    const left = a.maps[mapIndex];
    const right = b.maps[mapIndex];
    if (left === undefined || right === undefined) return false;
    if (left.width !== right.width || left.height !== right.height) return false;
    if (left.start.q !== right.start.q || left.start.r !== right.start.r) return false;
    if (left.origin.q !== right.origin.q || left.origin.r !== right.origin.r) return false;
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
      const q = current % map.width;
      const r = Math.floor(current / map.width);
      for (const dir of HEX_DIRS) {
        const nextQ = q + HEX_DQ[dir]!;
        const nextR = r + HEX_DR[dir]!;
        if (nextQ < 0 || nextR < 0 || nextQ >= map.width || nextR >= map.height) continue;
        const next = nextR * map.width + nextQ;
        if (visited[next] === 1 || !matches(next)) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    result.push(size);
  }
  return result.sort((a, b) => b - a);
}

function cureRegionCells(map: EffectMap, cureId: number): HexCoord[] {
  const cells: HexCoord[] = [];
  for (let index = 0; index < map.cell.length; index++) {
    if (map.cell[index] !== CellKind.Cure || map.cureId[index] !== cureId) continue;
    cells.push({ q: index % map.width, r: Math.floor(index / map.width) });
  }
  return cells;
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

function generatedReferenceCures(
  level: GeneratedLevel,
  reference: GeneratedLevel["diseases"][number]["reference"],
): boolean {
  const map = level.mm.maps[0]!;
  const start = level.start.pos[0]!;
  const output = new Int32Array(3);
  let q = start.q;
  let r = start.r;
  for (const machine of reference.steps) {
    walkValidatedPathInto(map, q, r, machine, output, 0);
    if (output[2] === 1) return false;
    q = output[0]!;
    r = output[1]!;
  }
  const index = r * map.width + q;
  return map.cell[index] === CellKind.Cure && map.cureId[index]! >= 0;
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

  it("supports multiple diseases on one Atlas up to a bounded maximum", () => {
    const level = generate(oneAtlasOptions(14));
    expect(level.mm.maps).toHaveLength(1);
    expect(level.diseases).toHaveLength(4);
    expect(() => generate(oneAtlasOptions(14, MAX_GENERATION_DISEASES))).not.toThrow();
  });

  it("rejects area and catalog bounds before allocating generation state", () => {
    expect(() => generate(options(1, { width: MAX_MAP_CELLS, height: 3 }))).toThrow(/area/);
    const catalog = Array.from({ length: MAX_GENERATION_CATALOG_ENTRIES + 1 }, (_, index) => ({
      typeId: `m${index}`,
      path: [0 as const],
      cost: 1,
      speed: 1,
    }));
    expect(() => generate(options(1, { catalog }))).toThrow(/catalog.*exceed/i);
  });

  it("rejects duplicate IDs and malformed path stamps", () => {
    const first = DEFAULT_CATALOG[0]!;
    expect(() => generate(options(1, { catalog: [first, first] }))).toThrow(/duplicate typeId/i);
    expect(() => generate(options(1, {
      catalog: [{ typeId: "bad", path: [6] as never, cost: 1, speed: 1 }],
    }))).toThrow(/hex direction/i);
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
    expect(level.start.pos).toEqual(Array.from({ length: 4 }, () => ({ q: 31, r: 31 })));
    for (const map of level.mm.maps) {
      expect(map.start).toEqual({ q: 31, r: 31 });
      expect(map.origin).toEqual({ q: 31, r: 31 });
    }
  });

  it("keeps the protected radius-six center free of wall, abyss, and portal", () => {
    for (const seed of [0, 14, 77, 184]) {
      const map = generate(canonicalOptions(seed)).mm.maps[0]!;
      for (let index = 0; index < map.cell.length; index++) {
        if (radius(map, index) > 6) continue;
        expect([CellKind.Wall, CellKind.Abyss, CellKind.Portal]).not.toContain(map.cell[index]);
      }
      expect(map.cell[map.start.r * map.width + map.start.q]).toBe(CellKind.Empty);
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
        expect(level.mm.maps[0]!.start).toEqual({ q: Math.floor(size / 2), r: Math.floor(size / 2) });
        expect(fieldEqual(level.mm, generate(opts).mm)).toBe(true);
        assertPortalValidity(level.mm.maps[0]!);
        assertReferences(level);
      }
    }
  });

  it("keeps the minimum legal map size generatable across seeded cure-region sizes", () => {
    for (let seed = 0; seed < 64; seed++) {
      const level = generate(options(seed, { width: 3, height: 3 }));
      expect(level.mm.maps[0]!.start).toEqual({ q: 1, r: 1 });
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
        } else if (map.cell[index] !== CellKind.Cure) {
          expect(map.sideEffectId[index]).toBe(-1);
        }
        if (map.cell[index] !== CellKind.Cure) expect(map.cureId[index]).toBe(-1);
      }
    }
  });
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
    for (let seed = 1; seed <= 500; seed++) {
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
      const level = generate(oneAtlasOptions(seed));
      for (const disease of level.diseases) {
        const map = level.mm.maps[disease.map]!;
        const cells = cureRegionCells(map, disease.id);
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

  it("does not let one seed's reference blueprints cure a broad unrelated sample", () => {
    const baseline = generate(oneAtlasOptions(1));
    let crossSeedCures = 0;
    let comparisons = 0;
    for (let seed = 2; seed <= 40; seed++) {
      const level = generate(oneAtlasOptions(seed));
      for (const disease of baseline.diseases) {
        comparisons++;
        if (evaluate(level.mm, level.start, disease.reference).cured.length > 0) crossSeedCures++;
      }
    }
    expect(crossSeedCures).toBeLessThanOrEqual(Math.floor(comparisons / 4));
  }, 10_000);

  it("bounds the worst individual reference across an all-pairs seed sample", () => {
    const levels = Array.from({ length: 100 }, (_, index) => generate(oneAtlasOptions(index + 1)));
    let worstHits = 0;
    for (let source = 0; source < levels.length; source++) {
      for (const disease of levels[source]!.diseases) {
        let hits = 0;
        for (let target = 0; target < levels.length; target++) {
          if (target === source) continue;
          if (generatedReferenceCures(levels[target]!, disease.reference)) hits++;
        }
        worstHits = Math.max(worstHits, hits);
      }
    }
    expect(worstHits).toBeLessThanOrEqual(Math.floor((levels.length - 1) * 0.15));
  }, 60_000);

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

  it("tiers later canonical diseases through the three patent machine entries", () => {
    for (const seed of [1, 14, 77, 184]) {
      const level = generate(oneAtlasOptions(seed));
      for (let disease = 1; disease <= 3; disease++) {
        const patent = DEFAULT_CATALOG[disease + 3]!;
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

  it("grows each cure into a connected five-cell region containing its node", () => {
    for (const seed of [0, 14, 77, 184]) {
      const level = generate(canonicalOptions(seed, 4));
      for (const disease of level.diseases) {
        const map = level.mm.maps[disease.map]!;
        const nodeIndex = disease.node.r * map.width + disease.node.q;
        expect(map.cell[nodeIndex]).toBe(CellKind.Cure);
        expect(map.cureId[nodeIndex]).toBe(disease.id);
        expect(componentSizes(map, CellKind.Cure, disease.id)).toEqual([5]);
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
    const level = generate(options(14, {
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
  const exactPrice = (difficulty: number, refCost: number): bigint =>
    12n + 4n * BigInt(difficulty) + 2n * BigInt(refCost);

  it("uses a sane linear difficulty and production-cost price across the supported range", () => {
    for (let difficulty = 0; difficulty <= MAX_GENERATION_DIFFICULTY; difficulty++) {
      for (const refCost of [0, 1, 7, 200, 1_000_000_000]) {
        expect(difficultyToBasePrice(difficulty, refCost)).toBe(Number(exactPrice(difficulty, refCost)));
      }
    }
  });

  it("keeps active-range unit prices proportional instead of exploding exponentially", () => {
    for (let difficulty = 0; difficulty <= 30; difficulty++) {
      const expected = Number(exactPrice(difficulty, 7));
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
    expect(difficultyToBasePrice(10, 30)).toBe(112);
    const difficultyPrice = exactPrice(MAX_GENERATION_DIFFICULTY, 0);
    const maxRefCost = Number((BigInt(Number.MAX_SAFE_INTEGER) - difficultyPrice) / 2n);
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
