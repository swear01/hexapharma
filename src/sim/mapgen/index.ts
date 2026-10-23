import type {
  CureRegionSpec,
  DiseaseId,
  DiseaseSpec,
  EffectMap,
  GenerateFn,
  GeneratedLevel,
  GenOptions,
  Machine,
  MachineCatalogEntry,
  MapIndex,
  MultiMap,
  RegionPriceFn,
  Rng,
  Template,
  HexCoord,
  HexDir,
} from "../phase0_interfaces";
import { CellKind, MAX_TEMPLATE_STEPS } from "../phase0_interfaces";
import {
  initialState,
  PATH_OUT_STRIDE,
  walkPath,
  walkValidatedPath,
  turnHeading,
  validateMachineTurn,
  walkValidatedPathInto,
} from "../drug-graph";
import {
  HEX_DIRS,
  HEX_DQ,
  HEX_DR,
  hexDistance,
} from "../hex";
import { makeRng } from "../rng";
import {
  MIN_SKELETON_RADIUS,
  buildTerrain,
  mix32,
  atlasRadius,
  type Basin,
  type PassInfo,
} from "./terrain";
import {
  MIN_EASY_REGION,
  contaminateRegions,
  placeBlackAndFill,
  placeHardRegions,
  type AtlasRegion,
  type BlackGroup,
  type RegionKind,
} from "./features";

export {
  ELEVATION_ONE,
  MAX_PASS_STEPS,
  MOUNTAIN_LEVEL,
  START_DISK_RADIUS,
  WATER_LEVEL,
  atlasRadius,
  passTraversable,
  type Basin,
  type PassInfo,
} from "./terrain";
export {
  HARD_REGION_SIZES,
  HARD_REGION_STARS,
  MIN_EASY_REGION,
  VOID_DISTANCE,
  type AtlasRegion,
  type BlackGroup,
  type RegionKind,
} from "./features";

export const MAX_MAP_CELLS = 65_536;
export const MAX_GENERATION_DIFFICULTY = 64;
export const MAX_GENERATION_CATALOG_ENTRIES = 256;
export const MAX_GENERATION_DISEASES = 8;
export const MAX_CONSTRUCTIVE_CANDIDATES = 32;
export const MAX_CONSTRUCTIVE_FALLBACK = 128;
const MAX_SAFE_PRICE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PATH_LENGTH = 256;
const CURE_FRONTIER_SALT = 0xcb30e825;
const WALL_HUGGING_PENALTY = 400_000;
const ZONE_PENALTY = 600_000;

/**
 * Catalog prefix each disease's references may use: the initial (early) machines for the first
 * disease, then one more unlock tier per disease (mid, mid, late); later diseases use them all.
 */
export const DISEASE_CATALOG_TIERS: readonly number[] = Object.freeze([4, 5, 6, 8]);

export function diseaseCatalogCount(disease: number, catalogLength: number): number {
  const tier = DISEASE_CATALOG_TIERS[Math.min(disease, DISEASE_CATALOG_TIERS.length - 1)]!;
  return Math.min(catalogLength, tier);
}

// Region pricing by reach difficulty (docs/design.md §1.8):
//   difficulty = min(CAP, reachCost + PASS_WEIGHT × narrow passes + ABYSS_WEIGHT × Abyss beside route)
//   price      = BASE + PER_DIFFICULTY × difficulty
export const REGION_PASS_WEIGHT = 6;
export const REGION_ABYSS_WEIGHT = 2;
export const REGION_DIFFICULTY_CAP = 120;
/** Bounded reach search: routes costing more than this are not explored (region is then capped). */
export const REGION_REACH_COST_BOUND = 160;
export const REGION_PRICE_BASE = 60;
export const REGION_PRICE_PER_DIFFICULTY = 2;

export const regionPrice: RegionPriceFn = (difficulty) => {
  if (!Number.isSafeInteger(difficulty) || difficulty < 0 || difficulty > REGION_DIFFICULTY_CAP) {
    throw new Error(`mapgen.regionPrice: difficulty must be an integer in 0..${REGION_DIFFICULTY_CAP}`);
  }
  const price = BigInt(REGION_PRICE_BASE) + BigInt(REGION_PRICE_PER_DIFFICULTY) * BigInt(difficulty);
  if (price > MAX_SAFE_PRICE) throw new Error("mapgen.regionPrice: price exceeds the safe-integer range");
  return Number(price);
};

interface ScratchMap {
  readonly width: number;
  readonly height: number;
  readonly origin: HexCoord;
  readonly start: HexCoord;
  readonly cell: Uint8Array;
  readonly cureId: Int16Array;
  readonly cureTier: Uint8Array;
  readonly regionId: Uint16Array;
  readonly sideEffectId: Int32Array;
  readonly portalTo: Int32Array;
  readonly elevation: Int16Array;
  readonly protectedCells: Uint8Array;
  readonly pass: Uint8Array;
  readonly inside: Uint8Array;
}

interface ProgramCandidate {
  readonly ordinal: number;
  readonly reference: Template;
  readonly endpoint: HexCoord;
  readonly difficulty: number;
  readonly cost: number;
  readonly quality: number;
  readonly signature: string;
  readonly region: readonly number[];
  readonly strictPrefixCells: readonly ReadonlySet<number>[];
}

interface BuiltDisease {
  readonly id: DiseaseId;
  readonly map: MapIndex;
  readonly node: HexCoord;
  readonly difficulty: number;
  readonly cost: number;
  readonly reference: Template;
  readonly region: readonly number[];
  readonly strictPrefixCells: readonly ReadonlySet<number>[];
}

const idx = (width: number, q: number, r: number): number => r * width + q;

function directionScore(q: number, r: number, dir: HexDir): number {
  const dq = HEX_DQ[dir]!;
  const dr = HEX_DR[dir]!;
  return q * dq + r * dr + (-q - r) * (-dq - dr);
}

function closestDirection(q: number, r: number): HexDir {
  let best = HEX_DIRS[0]!;
  let bestScore = directionScore(q, r, best);
  for (let index = 1; index < HEX_DIRS.length; index++) {
    const dir = HEX_DIRS[index]!;
    const score = directionScore(q, r, dir);
    if (score > bestScore) {
      best = dir;
      bestScore = score;
    }
  }
  return best;
}

function centerOf(width: number, height: number): HexCoord {
  return { q: Math.floor(width / 2), r: Math.floor(height / 2) };
}

function makeScratch(width: number, height: number): ScratchMap {
  const center = centerOf(width, height);
  const length = width * height;
  const map: ScratchMap = {
    width,
    height,
    origin: center,
    start: center,
    cell: new Uint8Array(length),
    cureId: new Int16Array(length).fill(-1),
    cureTier: new Uint8Array(length),
    regionId: new Uint16Array(length),
    sideEffectId: new Int32Array(length).fill(-1),
    portalTo: new Int32Array(length).fill(-1),
    elevation: new Int16Array(length),
    protectedCells: new Uint8Array(length),
    pass: new Uint8Array(length),
    inside: new Uint8Array(length),
  };
  map.protectedCells[idx(width, center.q, center.r)] = 1;
  return map;
}

function freezeMap(map: ScratchMap): EffectMap {
  return {
    width: map.width,
    height: map.height,
    origin: { ...map.origin },
    start: { ...map.start },
    cell: map.cell,
    cureId: map.cureId,
    cureTier: map.cureTier,
    regionId: map.regionId,
    sideEffectId: map.sideEffectId,
    portalTo: map.portalTo,
    elevation: map.elevation,
    fog: new Uint8Array(map.cell.length),
  };
}

function freezeMaps(maps: readonly ScratchMap[]): MultiMap {
  return { maps: maps.map(freezeMap) };
}

function ownMachine(entry: MachineCatalogEntry): Machine {
  return Object.freeze({
    typeId: entry.typeId,
    path: Object.freeze(entry.path.slice()),
    turn: entry.turn,
  });
}

function pathSignature(entry: MachineCatalogEntry): string {
  return entry.path.join(",");
}

function referenceDifficulty(reference: Template): number {
  const signatures = new Set(reference.steps.map((step) =>
    step.path.join(","),
  ));
  return reference.steps.length + Math.max(0, signatures.size - 1);
}

/** Endpoint of `reference` on an empty board of the same size (heading-relative paths). */
function programEndpoint(start: HexCoord, reference: Template, width: number, height: number): HexCoord {
  let q = start.q;
  let r = start.r;
  let heading = 0;
  for (const machine of reference.steps) {
    for (const relative of machine.path) {
      const dir = (relative + heading) % 6;
      const nextQ = q + HEX_DQ[dir]!;
      const nextR = r + HEX_DR[dir]!;
      if (nextQ < 0 || nextR < 0 || nextQ >= width || nextR >= height) continue;
      q = nextQ;
      r = nextR;
    }
    heading = turnHeading(heading, machine.turn);
  }
  return { q, r };
}

function simulateReference(
  terrain: MultiMap,
  start: ReturnType<typeof initialState>,
  reference: Template,
): {
  readonly failed: boolean;
  readonly final: readonly HexCoord[];
  readonly strictPrefixCells: readonly ReadonlySet<number>[];
} {
  const stride = PATH_OUT_STRIDE;
  const walk = new Int32Array(terrain.maps.length * stride);
  const strictPrefixCells = terrain.maps.map(() => new Set<number>());
  for (let mapIndex = 0; mapIndex < terrain.maps.length; mapIndex++) {
    walk[mapIndex * stride] = start.pos[mapIndex]!.q;
    walk[mapIndex * stride + 1] = start.pos[mapIndex]!.r;
    walk[mapIndex * stride + 2] = start.offset[mapIndex]!.q;
    walk[mapIndex * stride + 3] = start.offset[mapIndex]!.r;
  }
  let heading: number = start.heading;
  let failed = false;
  for (let stepIndex = 0; stepIndex < reference.steps.length; stepIndex++) {
    const machine = reference.steps[stepIndex]!;
    for (let mapIndex = 0; mapIndex < terrain.maps.length; mapIndex++) {
      const map = terrain.maps[mapIndex]!;
      const base = mapIndex * stride;
      walkValidatedPathInto(
        map,
        walk[base]!,
        walk[base + 1]!,
        walk[base + 2]!,
        walk[base + 3]!,
        heading,
        machine,
        walk,
        base,
      );
      if (walk[base + 4] === 1) failed = true;
    }
    if (failed) break;
    heading = turnHeading(heading, machine.turn);
    if (stepIndex + 1 < reference.steps.length) {
      for (let mapIndex = 0; mapIndex < terrain.maps.length; mapIndex++) {
        const map = terrain.maps[mapIndex]!;
        strictPrefixCells[mapIndex]!.add(idx(
          map.width,
          walk[mapIndex * stride]!,
          walk[mapIndex * stride + 1]!,
        ));
      }
    }
  }
  const final = Array.from({ length: terrain.maps.length }, (_, mapIndex) => ({
    q: walk[mapIndex * stride]!,
    r: walk[mapIndex * stride + 1]!,
  }));
  return { failed, final, strictPrefixCells };
}

function normalizedRadius(map: ScratchMap, q: number, r: number): number {
  const radius = hexDistance(map.origin.q, map.origin.r, q, r);
  return Math.floor((radius * 31) / Math.max(1, atlasRadius(map.width, map.height)));
}

function chooseDistinctEntries(
  catalog: readonly MachineCatalogEntry[],
  count: number,
  seedWord: number,
): MachineCatalogEntry[] {
  const chosen: MachineCatalogEntry[] = [];
  const signatures = new Set<string>();
  const ranked = catalog
    .map((entry, index) => ({ entry, index, score: mix32(seedWord ^ Math.imul(index + 1, 0x9e3779b1)) }))
    .sort((left, right) => left.score - right.score || left.index - right.index);
  for (const candidate of ranked) {
    if (chosen.length >= count) break;
    const entry = candidate.entry;
    const signature = pathSignature(entry);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    chosen.push(entry);
  }
  if (chosen.length === 0 && catalog[0] !== undefined) chosen.push(catalog[0]);
  return chosen;
}

function chooseDistinctEntriesByOffset(
  catalog: readonly MachineCatalogEntry[],
  count: number,
  offset: number,
): MachineCatalogEntry[] {
  const chosen: MachineCatalogEntry[] = [];
  const signatures = new Set<string>();
  for (let scan = 0; scan < catalog.length && chosen.length < count; scan++) {
    const entry = catalog[(offset + scan) % catalog.length];
    if (entry === undefined) continue;
    const signature = pathSignature(entry);
    if (signatures.has(signature)) continue;
    signatures.add(signature);
    chosen.push(entry);
  }
  if (chosen.length === 0 && catalog[0] !== undefined) chosen.push(catalog[0]);
  return chosen;
}

function templateSignature(reference: Template): string {
  return reference.steps.map((step) => step.typeId).join(",");
}

function seededVisibleCureRegion(
  map: ScratchMap,
  reserved: readonly number[],
  seedWord: number,
): number[] {
  if (reserved.length <= 5) return reserved.slice();
  const seed = reserved[0]!;
  const allowed = new Uint8Array(map.cell.length);
  for (const cellIndex of reserved) allowed[cellIndex] = 1;
  const region = [seed];
  const visited = new Uint8Array(map.cell.length);
  const frontierSeen = new Uint8Array(map.cell.length);
  visited[seed] = 1;
  while (region.length < 5) {
    const frontier: number[] = [];
    for (const current of region) {
      const q = current % map.width;
      const r = Math.floor(current / map.width);
      for (const dir of HEX_DIRS) {
        const nextQ = q + HEX_DQ[dir]!;
        const nextR = r + HEX_DR[dir]!;
        if (nextQ < 0 || nextR < 0 || nextQ >= map.width || nextR >= map.height) continue;
        const next = idx(map.width, nextQ, nextR);
        if (
          visited[next] === 1 ||
          frontierSeen[next] === 1 ||
          allowed[next] === 0
        ) continue;
        frontierSeen[next] = 1;
        frontier.push(next);
      }
    }
    if (frontier.length === 0) return reserved.slice();
    frontier.sort((left, right) => {
      const leftScore = mix32(CURE_FRONTIER_SALT ^ seedWord ^ left ^ Math.imul(region.length, 0x85ebca6b));
      const rightScore = mix32(CURE_FRONTIER_SALT ^ seedWord ^ right ^ Math.imul(region.length, 0x85ebca6b));
      return leftScore - rightScore || left - right;
    });
    const selected = frontier[0]!;
    visited[selected] = 1;
    region.push(selected);
    frontierSeen.fill(0);
  }
  const visible = new Uint8Array(map.cell.length);
  for (const cellIndex of region) visible[cellIndex] = 1;
  for (const cellIndex of reserved) {
    if (visible[cellIndex] === 0) region.push(cellIndex);
  }
  return region;
}

function candidateCureRegion(
  map: ScratchMap,
  position: HexCoord,
  limit: number,
  forbidden: ReadonlySet<number>,
  occupied: ReadonlySet<number>,
  seedWord: number,
): number[] | null {
  const seed = idx(map.width, position.q, position.r);
  if (!availableForCure(map, seed) || forbidden.has(seed) || occupied.has(seed)) return null;
  const visited = new Uint8Array(map.cell.length);
  const queue = new Int32Array(map.cell.length);
  const region: number[] = [];
  let head = 0;
  let tail = 0;
  const radial = closestDirection(position.q - map.origin.q, position.r - map.origin.r);
  const tangent = ((radial + ((mix32(seedWord ^ seed) & 1) === 0 ? 2 : 4)) % 6) as HexDir;
  const preferredLength = 1 + (mix32(seedWord ^ seed ^ 0x8da6b343) % 5);
  const preferredOffsets = Math.min(map.width, map.height) >= 31 && limit >= 5
    ? [0, 1, 2, 3, 4].slice(0, preferredLength)
    : [0];
  const initialOffsets = preferredOffsets.every((offset) => {
    const q = position.q + HEX_DQ[tangent]! * offset;
    const r = position.r + HEX_DR[tangent]! * offset;
    if (q < 0 || r < 0 || q >= map.width || r >= map.height) return false;
    const cellIndex = idx(map.width, q, r);
    return availableForCure(map, cellIndex) && !forbidden.has(cellIndex) && !occupied.has(cellIndex);
  }) ? preferredOffsets : [0];
  for (const offset of initialOffsets) {
    const q = position.q + HEX_DQ[tangent]! * offset;
    const r = position.r + HEX_DR[tangent]! * offset;
    const cellIndex = idx(map.width, q, r);
    visited[cellIndex] = 1;
    queue[tail++] = cellIndex;
    region.push(cellIndex);
  }
  while (head < tail && region.length < limit) {
    const current = queue[head++]!;
    const q = current % map.width;
    const r = Math.floor(current / map.width);
    const neighbors = HEX_DIRS.map((dir, order) => ({
      q: q + HEX_DQ[dir]!,
      r: r + HEX_DR[dir]!,
      order,
    })).sort((left, right) => {
      const leftRadius = normalizedRadius(map, left.q, left.r);
      const rightRadius = normalizedRadius(map, right.q, right.r);
      if (leftRadius !== rightRadius) return rightRadius - leftRadius;
      return (mix32(seedWord ^ current ^ left.order) & 0xffff) -
        (mix32(seedWord ^ current ^ right.order) & 0xffff);
    });
    for (const neighbor of neighbors) {
      const nextQ = neighbor.q;
      const nextR = neighbor.r;
      if (nextQ < 0 || nextR < 0 || nextQ >= map.width || nextR >= map.height) continue;
      const next = idx(map.width, nextQ, nextR);
      if (
        visited[next] === 1 ||
        !availableForCure(map, next) ||
        forbidden.has(next) ||
        occupied.has(next)
      ) continue;
      visited[next] = 1;
      queue[tail++] = next;
      region.push(next);
      if (region.length === limit) break;
    }
  }
  return region.length === limit ? region : null;
}

function makeProgramCandidate(
  maps: readonly ScratchMap[],
  terrain: MultiMap,
  start: ReturnType<typeof initialState>,
  catalog: readonly MachineCatalogEntry[],
  fullCatalog: readonly MachineCatalogEntry[],
  minDifficulty: number,
  maxDifficulty: number,
  disease: number,
  ordinal: number,
  seedWord: number,
  built: readonly BuiltDisease[],
  usedSignatures: ReadonlySet<string>,
  forbiddenCures: ReadonlySet<number>,
): ProgramCandidate | null {
  const mapIndex = disease % maps.length;
  const map = maps[mapIndex];
  if (map === undefined) return null;
  const compactMap = Math.min(map.width, map.height) < 9;
  const candidateWord = mix32(seedWord ^ Math.imul(disease + 1, 0x85ebca6b) ^ Math.imul(ordinal + 1, 0xc2b2ae35));
  const wideNormalRange =
    minDifficulty < maxDifficulty &&
    minDifficulty >= 2 &&
    Math.min(map.width, map.height) >= 31;
  const desiredDirection = HEX_DIRS[
    mix32(seedWord ^ Math.imul(disease + 1, 0x51ed270b)) % HEX_DIRS.length
  ]!;
  const span = maxDifficulty - minDifficulty + 1;
  let targetDifficulty = minDifficulty + (compactMap ? (ordinal + disease * 5) % span : candidateWord % span);
  if (wideNormalRange && maxDifficulty > 8 && targetDifficulty < 8) targetDifficulty = 8;
  if (wideNormalRange && maxDifficulty === 8 && targetDifficulty < 7) targetDifficulty = 7;
  if (targetDifficulty < 1) return null;
  let distinctTarget: number;
  if (compactMap) {
    distinctTarget = targetDifficulty >= 5 && catalog.length >= 3 && ordinal % 3 === 0
      ? 3
      : targetDifficulty >= 3 && catalog.length >= 2
        ? 2
        : 1;
  } else {
    const distinctShapeCount = new Set(catalog.map(pathSignature)).size;
    const maxDistinct = Math.min(3, distinctShapeCount, Math.floor((targetDifficulty + 1) / 2));
    const useEverySmallCatalogShape = catalog.length >= 2 &&
      catalog.length <= 3 &&
      distinctShapeCount === catalog.length &&
      maxDistinct === catalog.length;
    distinctTarget = maxDistinct <= 1
      ? 1
      : useEverySmallCatalogShape ? maxDistinct : 2 + (candidateWord % (maxDistinct - 1));
  }
  if (targetDifficulty - (distinctTarget - 1) < distinctTarget) distinctTarget = 1;
  const stepCount = targetDifficulty - (distinctTarget - 1);
  if (stepCount < 1 || stepCount > MAX_TEMPLATE_STEPS) return null;
  if (wideNormalRange && maxDifficulty >= 8 && stepCount < 6) return null;
  if (disease === 0 && minDifficulty <= 8 && stepCount > 7) return null;
  const entries = compactMap
    ? chooseDistinctEntriesByOffset(catalog, distinctTarget, ordinal * 5 + disease * 7)
    : chooseDistinctEntries(catalog, distinctTarget, candidateWord ^ 0x7f4a7c15);
  if (entries.length < distinctTarget) return null;
  const frontier = disease > 0 && catalog.length > 4 ? catalog[catalog.length - 1] : undefined;
  if (frontier !== undefined && !entries.some((entry) => entry.typeId === frontier.typeId)) {
    entries[entries.length - 1] = frontier;
  }
  const steps: Machine[] = [];
  const entryUses = new Int32Array(entries.length);
  let heading = 0;
  let cost = 0;
  let totalPathLength = 0;
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    let entryIndex: number;
    if (compactMap) {
      entryIndex = (stepIndex + ordinal) % entries.length;
    } else if (stepIndex < entries.length) {
      entryIndex = stepIndex;
    } else {
      let leastUses = entryUses[0]!;
      for (let index = 1; index < entryUses.length; index++) {
        if (entryUses[index]! < leastUses) leastUses = entryUses[index]!;
      }
      entryIndex = 0;
      let bestForward = Number.MIN_SAFE_INTEGER;
      for (let index = 0; index < entries.length; index++) {
        if (entryUses[index] !== leastUses) continue;
        const entry = entries[index]!;
        let netQ = 0;
        let netR = 0;
        for (const relative of entry.path) {
          const dir = (relative + heading) % 6;
          netQ += HEX_DQ[dir]!;
          netR += HEX_DR[dir]!;
        }
        const entryForward = directionScore(netQ, netR, desiredDirection);
        if (entryForward > bestForward) {
          bestForward = entryForward;
          entryIndex = index;
        }
      }
      const fillerWord = mix32(candidateWord ^ Math.imul(stepIndex + 1, 0x165667b1));
      const fillerStrategy = ordinal % 4;
      if (fillerStrategy !== 0) {
        let choice = fillerWord % entryUses.reduce(
          (count, uses) => count + (uses === leastUses ? 1 : 0),
          0,
        );
        for (let index = 0; index < entries.length; index++) {
          if (entryUses[index] !== leastUses) continue;
          if (choice === 0) {
            entryIndex = index;
            break;
          }
          choice--;
        }
      }
    }
    const entry = entries[entryIndex];
    if (entry === undefined) return null;
    entryUses[entryIndex] = entryUses[entryIndex]! + 1;
    steps.push(ownMachine(entry));
    heading = turnHeading(heading, entry.turn);
    totalPathLength += entry.path.length;
    cost += entry.cost;
  }
  const reference: Template = Object.freeze({ steps: Object.freeze(steps) });
  const signature = templateSignature(reference);
  if (usedSignatures.has(signature)) return null;
  const difficulty = referenceDifficulty(reference);
  if (difficulty < minDifficulty || difficulty > maxDifficulty) return null;
  const outcome = simulateReference(terrain, start, reference);
  if (outcome.failed) return null;
  const endpoint = outcome.final[mapIndex];
  if (endpoint === undefined) return null;
  if (endpoint.q === map.start.q && endpoint.r === map.start.r) return null;
  if (!availableForCure(map, idx(map.width, endpoint.q, endpoint.r))) return null;
  const endpointDq = endpoint.q - map.origin.q;
  const endpointDr = endpoint.r - map.origin.r;
  const radius = normalizedRadius(map, endpoint.q, endpoint.r);
  for (let prefixMap = 0; prefixMap < maps.length; prefixMap++) {
    // A shorter prefix must never already cure anything (hard regions are placed first).
    for (const cellIndex of outcome.strictPrefixCells[prefixMap]!) {
      if (maps[prefixMap]!.cell[cellIndex] === CellKind.Cure) return null;
    }
  }
  const occupied = new Set<number>();
  for (const other of built) {
    const candidatePrefixes = outcome.strictPrefixCells[other.map]!;
    if (other.region.some((cellIndex) => candidatePrefixes.has(cellIndex))) return null;
    if (other.map === mapIndex) {
      for (const cellIndex of other.region) occupied.add(cellIndex);
    }
  }
  const candidateForbidden = new Set(forbiddenCures);
  for (const cellIndex of outcome.strictPrefixCells[mapIndex]!) {
    candidateForbidden.add(cellIndex);
  }
  for (const other of built) {
    for (const cellIndex of other.strictPrefixCells[mapIndex]!) {
      candidateForbidden.add(cellIndex);
    }
  }
  // Reserve room around the endpoint; past the scored budget accept the smallest visible region.
  let cureRegionLimit = Math.min(compactMap ? 9 : ordinal < MAX_CONSTRUCTIVE_CANDIDATES ? 6 : MIN_EASY_REGION, map.cell.length - 1);
  if (compactMap) {
    let availableCells = 0;
    for (let cellIndex = 0; cellIndex < map.cell.length; cellIndex++) {
      if (
        availableForCure(map, cellIndex) &&
        !candidateForbidden.has(cellIndex) &&
        !occupied.has(cellIndex)
      ) {
        availableCells++;
      }
    }
    cureRegionLimit = Math.min(cureRegionLimit, availableCells);
    if (cureRegionLimit < 5) return null;
  }
  const region = candidateCureRegion(
    map,
    endpoint,
    cureRegionLimit,
    candidateForbidden,
    occupied,
    candidateWord ^ 0xc0febabe,
  );
  if (region === null) return null;
  let nearest = Math.max(map.width, map.height);
  for (const other of built) {
    if (other.map !== mapIndex) continue;
    const distance = hexDistance(endpoint.q, endpoint.r, other.node.q, other.node.r);
    if (distance < 3) return null;
    nearest = Math.min(nearest, distance);
  }
  const emptyEndpoint = programEndpoint(map.start, reference, map.width, map.height);
  const terrainChanged = emptyEndpoint.q !== endpoint.q || emptyEndpoint.r !== endpoint.r;
  if (minDifficulty >= 2 && Math.min(map.width, map.height) >= 9 && !terrainChanged) return null;
  const desiredRadius = 6 + (
    mix32(seedWord ^ Math.imul(disease + 1, 0x6a09e667)) % 4
  ) * 5;
  const radiusWeight = 40_000;
  const forward = directionScore(endpointDq, endpointDr, desiredDirection);
  const lateral = Math.abs(
    endpointDq * HEX_DR[desiredDirection]! - endpointDr * HEX_DQ[desiredDirection]!,
  );
  const initialIds = new Set(fullCatalog.slice(0, 4).map((entry) => entry.typeId));
  const usesAdvancedMachine = disease > 0 && reference.steps.some((step) => !initialIds.has(step.typeId));
  // Endpoints pressed against relief are where many unrelated programs pile up (walls cancel
  // deltas), so prefer open ground for the reference cure.
  let blockedNear = 0;
  for (let dir = 0; dir < 6; dir++) {
    const q = endpoint.q + HEX_DQ[dir]!;
    const r = endpoint.r + HEX_DR[dir]!;
    if (q < 0 || r < 0 || q >= map.width || r >= map.height || map.cell[idx(map.width, q, r)] === CellKind.Wall) blockedNear++;
  }
  const quality =
    (usesAdvancedMachine ? 2_000_000 : 0) -
    blockedNear * WALL_HUGGING_PENALTY +
    entries.length * 100_000 -
    Math.abs(radius - desiredRadius) * radiusWeight +
    forward * 50_000 -
    lateral * 15_000 +
    Math.min(nearest, 31) * 100 +
    Math.min(totalPathLength, 99) * 20 -
    (candidateWord & 0xff) -
    ordinal;
  return {
    ordinal,
    reference,
    endpoint,
    difficulty,
    cost,
    quality,
    signature,
    region,
    strictPrefixCells: outcome.strictPrefixCells,
  };
}

const MAX_TREE_DEPTH = 9;
const MAX_TREE_VALIDATIONS = 48;

/**
 * Constructive reference by breadth-first search over drug states (cell, swamp offset, heading)
 * from the start with the disease's catalog tier, so each reached state comes with a shortest
 * program and references can thread the generated passes into the middle zone instead of piling
 * up against the inner ring. A later tier appends its newest (frontier) machine as the last step.
 * Single-Atlas skeleton boards only; otherwise, or when nothing fits, the sampled construction
 * is used.
 */
function treeCandidate(
  maps: readonly ScratchMap[],
  terrain: MultiMap,
  start: ReturnType<typeof initialState>,
  catalog: readonly MachineCatalogEntry[],
  minDifficulty: number,
  maxDifficulty: number,
  disease: number,
  seedWord: number,
  built: readonly BuiltDisease[],
  usedSignatures: ReadonlySet<string>,
  forbiddenCures: ReadonlySet<number>,
  transitions: Map<number, Int32Array>,
): ProgramCandidate | null {
  const map = maps[0];
  const effect = terrain.maps[0];
  if (maps.length !== 1 || map === undefined || effect === undefined) return null;
  if (atlasRadius(map.width, map.height) < MIN_SKELETON_RADIUS) return null;
  const frontier = disease > 0 && catalog.length > 4 ? catalog.length - 1 : -1;
  const ownedCatalog = catalog.map(ownMachine);
  const machines = frontier >= 0 ? ownedCatalog.slice(0, frontier) : ownedCatalog;
  const shapeIds = new Map<string, number>();
  const shapeOf = catalog.map((entry) => {
    const signature = pathSignature(entry);
    if (!shapeIds.has(signature)) shapeIds.set(signature, shapeIds.size);
    return shapeIds.get(signature)!;
  });
  const area = map.width * map.height;
  // state = (cell · 7 + offset slot) · 6 + heading
  const stateCount = area * 42;
  const parent = new Int32Array(stateCount).fill(-1);
  const via = new Int8Array(stateCount).fill(-1);
  const depth = new Uint8Array(stateCount).fill(255);
  const shapes = new Uint16Array(stateCount);
  const order: number[] = [];
  const root = idx(map.width, map.start.q, map.start.r) * 42;
  depth[root] = 0;
  let layer = [root];
  const out = new Int32Array(PATH_OUT_STRIDE);
  // Transitions are shared by every tier (same terrain, same catalog index ⇒ same next state).
  const step = (state: number, machineIndex: number): number => {
    let table = transitions.get(machineIndex);
    if (table === undefined) {
      table = new Int32Array(stateCount).fill(-2);
      transitions.set(machineIndex, table);
    }
    const cached = table[state]!;
    if (cached !== -2) return cached;
    const next = walkState(state, ownedCatalog[machineIndex]!);
    table[state] = next;
    return next;
  };
  const walkState = (state: number, machine: Machine): number => {
    const heading = state % 6;
    const slot = Math.floor(state / 6) % 7;
    const cell = Math.floor(state / 42);
    const q = cell % map.width;
    walkValidatedPathInto(
      effect,
      q,
      (cell - q) / map.width,
      slot === 0 ? 0 : HEX_DQ[slot - 1]!,
      slot === 0 ? 0 : HEX_DR[slot - 1]!,
      heading,
      machine,
      out,
      0,
    );
    if (out[4] === 1) return -1;
    let nslot = 0;
    for (let dir = 0; dir < 6; dir++) {
      if (HEX_DQ[dir] === out[2] && HEX_DR[dir] === out[3]) nslot = dir + 1;
    }
    return (idx(map.width, out[0]!, out[1]!) * 7 + nslot) * 6 + turnHeading(heading, machine.turn);
  };
  const maxDepth = Math.min(
    maxDifficulty,
    MAX_TREE_DEPTH,
    disease === 0 && minDifficulty <= 8 ? 7 : MAX_TREE_DEPTH,
  ) - (frontier >= 0 ? 1 : 0);
  for (let level = 0; level < maxDepth && layer.length > 0; level++) {
    const next: number[] = [];
    for (const state of layer) {
      for (let m = 0; m < machines.length; m++) {
        const nstate = step(state, m);
        if (nstate < 0 || depth[nstate] !== 255) continue;
        depth[nstate] = level + 1;
        parent[nstate] = state;
        via[nstate] = m;
        shapes[nstate] = shapes[state]! | (1 << shapeOf[m]!);
        next.push(nstate);
        order.push(nstate);
      }
    }
    layer = next;
  }

  const span = maxDifficulty - minDifficulty + 1;
  let targetDifficulty = minDifficulty + (mix32(seedWord ^ Math.imul(disease + 1, 0x2545f491)) % span);
  // As in the sampled construction, a wide band keeps references at difficulty ≥ 8.
  if (minDifficulty >= 2 && maxDifficulty > 8 && targetDifficulty < 8) targetDifficulty = 8;
  const desiredDirection = HEX_DIRS[mix32(seedWord ^ Math.imul(disease + 1, 0x51ed270b)) % HEX_DIRS.length]!;
  // The first disease's easy region sits inside the ring; later ones past a ring pass.
  const desiredRadius = disease === 0 ? 7 : 11 + (mix32(seedWord ^ Math.imul(disease + 1, 0x6a09e667)) % 3) * 5;
  const frontierMachine = frontier >= 0 ? ownedCatalog[frontier]! : null;
  // Inside the inner ring range (its centre line is at 3/8 of the Atlas radius).
  const innerRadius = Math.floor((atlasRadius(map.width, map.height) * 3) / 8) - 1;
  const popcount = (mask: number): number => {
    let count = 0;
    for (let bits = mask; bits !== 0; bits &= bits - 1) count++;
    return count;
  };
  const scored: { readonly state: number; readonly end: number; readonly score: number }[] = [];
  for (const state of order) {
    const end = frontierMachine === null ? state : step(state, frontier);
    if (end < 0) continue;
    const cell = Math.floor(end / 42);
    if (!availableForCure(map, cell) || forbiddenCures.has(cell)) continue;
    const stepCount = depth[state]! + (frontierMachine === null ? 0 : 1);
    const distinct = popcount(shapes[state]! | (frontier >= 0 ? 1 << shapeOf[frontier]! : 0));
    const difficulty = stepCount + distinct - 1;
    if (difficulty < minDifficulty || difficulty > maxDifficulty) continue;
    if (distinct < 2 && shapeIds.size >= 2 && maxDifficulty >= 3) continue;
    if (disease === 0 && minDifficulty <= 8 && stepCount > 7) continue;
    const q = cell % map.width;
    const r = (cell - q) / map.width;
    const dq = q - map.origin.q;
    const dr = r - map.origin.r;
    let blockedNear = 0;
    for (let dir = 0; dir < 6; dir++) {
      const nq = q + HEX_DQ[dir]!;
      const nr = r + HEX_DR[dir]!;
      if (nq < 0 || nr < 0 || nq >= map.width || nr >= map.height || map.cell[idx(map.width, nq, nr)] === CellKind.Wall) blockedNear++;
    }
    const score =
      distinct * 100_000 -
      Math.abs(difficulty - targetDifficulty) * 200_000 -
      Math.abs(normalizedRadius(map, q, r) - desiredRadius) * 15_000 +
      directionScore(dq, dr, desiredDirection) * 30_000 -
      Math.abs(dq * HEX_DR[desiredDirection]! - dr * HEX_DQ[desiredDirection]!) * 10_000 -
      blockedNear * WALL_HUGGING_PENALTY -
      ((disease === 0) === (hexDistance(map.origin.q, map.origin.r, q, r) > innerRadius) ? ZONE_PENALTY : 0) -
      (mix32(seedWord ^ end) & 0xff);
    scored.push({ state, end, score });
  }
  scored.sort((left, right) => right.score - left.score || left.end - right.end || left.state - right.state);

  for (let rank = 0; rank < scored.length && rank < MAX_TREE_VALIDATIONS; rank++) {
    const { state, score } = scored[rank]!;
    const steps: Machine[] = [];
    for (let cursor = state; cursor !== root; cursor = parent[cursor]!) steps.push(machines[via[cursor]!]!);
    steps.reverse();
    if (frontierMachine !== null) steps.push(frontierMachine);
    const reference: Template = Object.freeze({ steps: Object.freeze(steps) });
    const signature = templateSignature(reference);
    if (usedSignatures.has(signature)) continue;
    const outcome = simulateReference(terrain, start, reference);
    const endpoint = outcome.final[0];
    if (outcome.failed || endpoint === undefined) continue;
    if (endpoint.q === map.start.q && endpoint.r === map.start.r) continue;
    const prefixes = outcome.strictPrefixCells[0]!;
    if ([...prefixes].some((cell) => map.cell[cell] === CellKind.Cure)) continue;
    if (built.some((other) => other.region.some((cell) => prefixes.has(cell)))) continue;
    const candidateForbidden = new Set(forbiddenCures);
    for (const cell of prefixes) candidateForbidden.add(cell);
    const occupied = new Set<number>();
    for (const other of built) {
      for (const cell of other.strictPrefixCells[0]!) candidateForbidden.add(cell);
      for (const cell of other.region) occupied.add(cell);
    }
    const word = mix32(seedWord ^ Math.imul(disease + 1, 0x85ebca6b) ^ Math.imul(rank + 1, 0x27d4eb2f));
    const region = candidateCureRegion(map, endpoint, 6, candidateForbidden, occupied, word ^ 0xc0febabe);
    if (region === null) continue;
    if (built.some((other) => hexDistance(endpoint.q, endpoint.r, other.node.q, other.node.r) < 3)) continue;
    const emptyEndpoint = programEndpoint(map.start, reference, map.width, map.height);
    if (minDifficulty >= 2 && emptyEndpoint.q === endpoint.q && emptyEndpoint.r === endpoint.r) continue;
    let cost = 0;
    for (const machine of steps) cost += catalog.find((entry) => entry.typeId === machine.typeId)!.cost;
    return {
      ordinal: rank,
      reference,
      endpoint,
      difficulty: referenceDifficulty(reference),
      cost,
      quality: score,
      signature,
      region,
      strictPrefixCells: outcome.strictPrefixCells,
    };
  }
  return null;
}

function singleStepCureExclusions(
  terrain: MultiMap,
  start: ReturnType<typeof initialState>,
  catalog: readonly MachineCatalogEntry[],
  mapIndex: number,
): ReadonlySet<number> {
  const map = terrain.maps[mapIndex]!;
  const excluded = new Set<number>();
  for (const entry of catalog) {
    const reference: Template = { steps: [ownMachine(entry)] };
    const outcome = simulateReference(terrain, start, reference);
    if (outcome.failed) continue;
    const position = outcome.final[mapIndex]!;
    excluded.add(idx(map.width, position.q, position.r));
  }
  return excluded;
}

function constructDiseases(
  maps: readonly ScratchMap[],
  terrain: MultiMap,
  catalog: readonly MachineCatalogEntry[],
  diseaseCount: number,
  minDifficulty: number,
  maxDifficulty: number,
  seedWord: number,
): BuiltDisease[] {
  const built: BuiltDisease[] = [];
  const usedSignatures = new Set<string>();
  const start = initialState(terrain);
  const transitions = new Map<number, Int32Array>();
  for (let disease = 0; disease < diseaseCount; disease++) {
    const mapIndex = disease % maps.length;
    const map = maps[mapIndex];
    if (map === undefined) continue;
    const availableCount = diseaseCatalogCount(disease, catalog.length);
    const availableCatalog = catalog.slice(0, availableCount);
    const forbiddenCures = new Set<number>();
    if (minDifficulty >= 2 && Math.min(map.width, map.height) >= 9) {
      for (const cellIndex of singleStepCureExclusions(terrain, start, availableCatalog, mapIndex)) {
        forbiddenCures.add(cellIndex);
      }
      const protectedRadius = 2;
      for (let r = map.start.r - protectedRadius; r <= map.start.r + protectedRadius; r++) {
        for (let q = map.start.q - protectedRadius; q <= map.start.q + protectedRadius; q++) {
          if (q < 0 || r < 0 || q >= map.width || r >= map.height) continue;
          if (hexDistance(map.start.q, map.start.r, q, r) > protectedRadius) continue;
          forbiddenCures.add(idx(map.width, q, r));
        }
      }
    }
    // Reference regions keep a gap to the hard regions placed before them.
    for (let cellIndex = 0; cellIndex < map.cell.length; cellIndex++) {
      if (map.cell[cellIndex] !== CellKind.Cure) continue;
      const q = cellIndex % map.width;
      const r = (cellIndex - q) / map.width;
      for (const dir of HEX_DIRS) {
        const nq = q + HEX_DQ[dir]!;
        const nr = r + HEX_DR[dir]!;
        if (nq >= 0 && nr >= 0 && nq < map.width && nr < map.height) forbiddenCures.add(idx(map.width, nq, nr));
      }
    }
    let best = treeCandidate(
      maps,
      terrain,
      start,
      availableCatalog,
      minDifficulty,
      maxDifficulty,
      disease,
      seedWord,
      built,
      usedSignatures,
      forbiddenCures,
      transitions,
    );
    // Score the first MAX_CONSTRUCTIVE_CANDIDATES ordinals; only if none fits the terrain, take the
    // first fitting one up to MAX_CONSTRUCTIVE_FALLBACK.
    const sampled = best === null;
    for (
      let ordinal = 0;
      sampled && ordinal < MAX_CONSTRUCTIVE_FALLBACK && (best === null || ordinal < MAX_CONSTRUCTIVE_CANDIDATES);
      ordinal++
    ) {
      const candidate = makeProgramCandidate(
        maps,
        terrain,
        start,
        availableCatalog,
        catalog,
        minDifficulty,
        maxDifficulty,
        disease,
        ordinal,
        seedWord,
        built,
        usedSignatures,
        forbiddenCures,
      );
      if (candidate === null) continue;
      if (
        best === null ||
        candidate.quality > best.quality ||
        (candidate.quality === best.quality && candidate.ordinal < best.ordinal)
      ) {
        best = candidate;
      }
    }
    if (best === null) {
      throw new ConstructionError(
        `mapgen.generate: disease ${disease} difficulty [${minDifficulty},${maxDifficulty}] cannot be constructed ` +
          `on ${map.width}x${map.height} from at most ${MAX_CONSTRUCTIVE_FALLBACK} candidates`,
      );
    }
    const shapeWord = mix32(
      seedWord ^
      Math.imul(disease + 1, 0x85ebca6b) ^
      Math.imul(best.ordinal + 1, 0xc2b2ae35),
    ) ^ 0xc0febabe;
    built.push({
      id: disease,
      map: mapIndex,
      node: best.endpoint,
      difficulty: best.difficulty,
      cost: best.cost,
      reference: best.reference,
      region: seededVisibleCureRegion(map, best.region, shapeWord),
      strictPrefixCells: best.strictPrefixCells,
    });
    usedSignatures.add(best.signature);
  }
  return built;
}

function placeCureRegions(
  rng: Rng,
  map: ScratchMap,
  mapIndex: number,
  diseases: readonly BuiltDisease[],
  sideEffectBase: number,
  regions: AtlasRegion[],
): number {
  const start = idx(map.width, map.start.q, map.start.r);
  for (const disease of diseases) {
    const seed = idx(map.width, disease.node.q, disease.node.r);
    if (seed === start || !availableForCure(map, seed)) {
      throw new Error(`mapgen.generate: disease ${disease.id} has no distinct empty endpoint`);
    }
    map.cell[seed] = CellKind.Cure;
    map.cureId[seed] = disease.id;
    map.cureTier[seed] = 1;
  }

  let nextSideEffect = sideEffectBase;
  for (const disease of diseases) {
    const seed = idx(map.width, disease.node.q, disease.node.r);
    const target = Math.min(MIN_EASY_REGION + (mix32(seed ^ Math.imul(disease.id + 1, 0x27d4eb2d)) % 3), disease.region.length);
    const region = disease.region.slice(0, target);
    for (const cellIndex of region) {
      if (cellIndex === seed) continue;
      if (!availableForCure(map, cellIndex)) {
        throw new Error(`mapgen.generate: reserved cure region for disease ${disease.id} was occupied`);
      }
      map.cell[cellIndex] = CellKind.Cure;
      map.cureId[cellIndex] = disease.id;
      map.cureTier[cellIndex] = 1;
    }
    regions.push({ map: mapIndex, disease: disease.id, kind: "easy", cells: region.slice(), stars: [] });
    const alternatives = region.slice(1);
    const contaminated = Math.max(1, Math.floor(alternatives.length / 2));
    const offset = rng.int(alternatives.length);
    for (let index = 0; index < contaminated; index++) {
      const cellIndex = alternatives[(offset + index) % alternatives.length]!;
      map.sideEffectId[cellIndex] = nextSideEffect++;
    }
  }
  return nextSideEffect;
}

function availableForCure(map: ScratchMap, cellIndex: number): boolean {
  return map.cell[cellIndex] === CellKind.Empty &&
    map.protectedCells[cellIndex] === 0 &&
    map.pass[cellIndex] === 0 &&
    map.inside[cellIndex] === 1;
}

function requireSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`mapgen.generate: ${name} must be a safe integer, got ${String(value)}`);
  }
}

function validateCatalog(catalog: readonly MachineCatalogEntry[]): void {
  if (!Array.isArray(catalog)) throw new Error("mapgen.generate: catalog must be an array");
  if (catalog.length === 0) throw new Error("mapgen.generate: catalog must not be empty");
  if (catalog.length > MAX_GENERATION_CATALOG_ENTRIES) {
    throw new Error(`mapgen.generate: catalog must not exceed ${MAX_GENERATION_CATALOG_ENTRIES} entries`);
  }
  const ids = new Set<string>();
  for (let index = 0; index < catalog.length; index++) {
    const entry = catalog[index];
    const path = `catalog[${index}]`;
    if (entry === undefined || typeof entry.typeId !== "string" || entry.typeId.length === 0) {
      throw new Error(`mapgen.generate: ${path}.typeId must be a non-empty string`);
    }
    if (ids.has(entry.typeId)) throw new Error(`mapgen.generate: duplicate typeId "${entry.typeId}"`);
    ids.add(entry.typeId);
    if (!Number.isSafeInteger(entry.cost) || entry.cost < 0 || entry.cost > 0x7fffffff) {
      throw new Error(`mapgen.generate: ${path}.cost must be a non-negative safe integer within int32`);
    }
    if (!Number.isSafeInteger(entry.speed) || entry.speed < 1 || entry.speed > 0x7fffffff) {
      throw new Error(`mapgen.generate: ${path}.speed must be a positive safe integer within int32`);
    }
    if (!Array.isArray(entry.path) || entry.path.length < 1 || entry.path.length > MAX_PATH_LENGTH) {
      throw new Error(`mapgen.generate: ${path}.path length must be in 1..${MAX_PATH_LENGTH}`);
    }
    for (let pathIndex = 0; pathIndex < entry.path.length; pathIndex++) {
      const dir = entry.path[pathIndex];
      if (
        dir === undefined ||
        !Number.isSafeInteger(dir) ||
        dir < 0 ||
        dir > 5
      ) {
        throw new Error(`mapgen.generate: ${path}.path[${pathIndex}] must be a hex direction in 0..5`);
      }
    }
    try {
      validateMachineTurn(entry.turn);
    } catch {
      throw new Error(`mapgen.generate: ${path}.turn must be an integer in -5..5`);
    }
  }
}

function validateOptions(opts: Parameters<GenerateFn>[0]): void {
  requireSafeInteger("seed", opts.seed);
  if (opts.seed < 0 || opts.seed > 0xffffffff) {
    throw new Error(`mapgen.generate: seed must be a uint32, got ${opts.seed}`);
  }
  requireSafeInteger("nMaps", opts.nMaps);
  if (opts.nMaps < 1 || opts.nMaps > 4) {
    throw new Error(`mapgen.generate: nMaps must be between 1 and 4, got ${opts.nMaps}`);
  }
  requireSafeInteger("width", opts.width);
  if (opts.width < 3) throw new Error(`mapgen.generate: width must be at least 3, got ${opts.width}`);
  requireSafeInteger("height", opts.height);
  if (opts.height < 3) throw new Error(`mapgen.generate: height must be at least 3, got ${opts.height}`);
  const area = opts.width * opts.height;
  if (!Number.isSafeInteger(area) || area > MAX_MAP_CELLS) {
    throw new Error(`mapgen.generate: map area must not exceed ${MAX_MAP_CELLS} cells`);
  }
  requireSafeInteger("diseaseCount", opts.diseaseCount);
  if (opts.diseaseCount < 1 || opts.diseaseCount > MAX_GENERATION_DISEASES) {
    throw new Error(
      `mapgen.generate: diseaseCount must be between 1 and ${MAX_GENERATION_DISEASES}`,
    );
  }
  requireSafeInteger("difficulty.min", opts.difficulty.min);
  requireSafeInteger("difficulty.max", opts.difficulty.max);
  if (opts.difficulty.min < 0 || opts.difficulty.max < opts.difficulty.min) {
    throw new Error("mapgen.generate: difficulty must be a non-negative ordered range");
  }
  if (opts.difficulty.max > MAX_GENERATION_DIFFICULTY) {
    throw new Error(`mapgen.generate: difficulty.max must not exceed ${MAX_GENERATION_DIFFICULTY}`);
  }
  validateCatalog(opts.catalog);
}

export interface AtlasMapDiagnostics {
  readonly radius: number;
  readonly skeleton: boolean;
  readonly passes: readonly PassInfo[];
  readonly basins: readonly Basin[];
  readonly black: readonly BlackGroup[];
}

export interface GenerationDiagnostics {
  readonly maps: readonly AtlasMapDiagnostics[];
  /** Region `i` has id `i + 1` (EffectMap.regionId). */
  readonly regions: readonly AtlasRegion[];
  /** One entry per region, in the same order. */
  readonly pricing: readonly RegionPricing[];
}

/** Per-map cells a reference enters (trail) and the cells it rests on between machines. */
function referenceFootprint(
  mm: MultiMap,
  reference: Template,
  trail: readonly Uint8Array[],
  prefix: readonly Uint8Array[],
): void {
  let drug = initialState(mm);
  for (let stepIndex = 0; stepIndex < reference.steps.length; stepIndex++) {
    const machine = reference.steps[stepIndex]!;
    const pos: HexCoord[] = [];
    const offset: HexCoord[] = [];
    for (let mapIndex = 0; mapIndex < mm.maps.length; mapIndex++) {
      const map = mm.maps[mapIndex]!;
      const walked = walkPath(map, drug.pos[mapIndex]!, machine, drug.heading, drug.offset[mapIndex]!);
      trail[mapIndex]![idx(map.width, drug.pos[mapIndex]!.q, drug.pos[mapIndex]!.r)] = 1;
      for (const cell of walked.entered) trail[mapIndex]![idx(map.width, cell.q, cell.r)] = 1;
      if (stepIndex + 1 < reference.steps.length) prefix[mapIndex]![idx(map.width, walked.pos.q, walked.pos.r)] = 1;
      pos.push(walked.pos);
      offset.push(walked.offset);
    }
    drug = { pos, offset, heading: turnHeading(drug.heading, machine.turn), failed: false };
  }
}

/** Cells where a single catalog machine from the start comes to rest (never a Cure). */
function oneStepEndpoints(terrain: MultiMap, catalog: readonly MachineCatalogEntry[]): Uint8Array[] {
  const start = initialState(terrain);
  const excluded = terrain.maps.map((map) => new Uint8Array(map.cell.length));
  for (const entry of catalog) {
    const outcome = simulateReference(terrain, start, { steps: [ownMachine(entry)] });
    for (let mapIndex = 0; mapIndex < terrain.maps.length; mapIndex++) {
      const map = terrain.maps[mapIndex]!;
      const position = outcome.final[mapIndex]!;
      excluded[mapIndex]![idx(map.width, position.q, position.r)] = 1;
    }
  }
  return excluded;
}

/**
 * Region `i` of `regions` has id `i + 1`; stamp ids on the cells of the regions placed since `from`
 * (right after placing them, so every intermediate map stays valid).
 */
function assignRegionIds(maps: readonly ScratchMap[], regions: readonly AtlasRegion[], from: number): void {
  if (regions.length > 0xffff) throw new Error("mapgen invariant violation: too many cure regions");
  for (let index = from; index < regions.length; index++) {
    const region = regions[index]!;
    const map = maps[region.map]!;
    for (const cell of region.cells) {
      if (map.cell[cell] !== CellKind.Cure || map.cureId[cell] !== region.disease || map.regionId[cell] !== 0) {
        throw new Error(`mapgen invariant violation: region ${index + 1} cell ${cell} is not its own Cure`);
      }
      map.regionId[cell] = index + 1;
    }
  }
}

function requireRegionIds(maps: readonly ScratchMap[]): void {
  for (const map of maps) {
    for (let cell = 0; cell < map.cell.length; cell++) {
      if (map.cell[cell] === CellKind.Cure && map.regionId[cell] === 0) {
        throw new Error(`mapgen invariant violation: Cure cell ${cell} belongs to no region`);
      }
    }
  }
}

export interface RegionPricing {
  readonly id: number;
  readonly map: number;
  readonly disease: number;
  readonly kind: RegionKind;
  /** Cheapest Σ machine cost landing on the region with the disease's catalog tier, or null. */
  readonly reachCost: number | null;
  /** Narrow pass cores the cheapest route enters. */
  readonly passes: number;
  /** Distinct Abyss cells beside the cheapest route. */
  readonly abyss: number;
  readonly difficulty: number;
  readonly price: number;
  readonly capped: boolean;
}

/**
 * Cheapest-cost search (bucketed Dijkstra, generation-time only) over (cell, swamp offset, heading)
 * from the start on one map, with costs bounded by REGION_REACH_COST_BOUND. `target` numbers each
 * priced region's cells 1..`targets`; the search stops after the cost bucket that reaches the last
 * of them, so every region's cheapest states are settled. Like the pass verifier it uses the real traversal;
 * it is not the solver and its routes never reach the runtime.
 */
function cheapestRoutes(
  map: EffectMap,
  machines: readonly Machine[],
  costs: readonly number[],
  transitions: (Int32Array | undefined)[],
  target: Int32Array,
  targets: number,
): { readonly dist: Int32Array; readonly parent: Int32Array; readonly via: Int8Array } {
  const stateCount = map.width * map.height * 42;
  const dist = new Int32Array(stateCount).fill(-1);
  const parent = new Int32Array(stateCount).fill(-1);
  const via = new Int8Array(stateCount).fill(-1);
  const out = new Int32Array(PATH_OUT_STRIDE);
  for (let machineIndex = 0; machineIndex < machines.length; machineIndex++) {
    transitions[machineIndex] ??= new Int32Array(stateCount).fill(-2);
  }
  let remaining = targets;
  const settled = new Uint8Array(targets + 1);
  const buckets: number[][] = Array.from({ length: REGION_REACH_COST_BOUND + 1 }, () => []);
  const root = idx(map.width, map.start.q, map.start.r) * 42;
  dist[root] = 0;
  buckets[0]!.push(root);
  for (let cost = 0; cost <= REGION_REACH_COST_BOUND && remaining > 0; cost++) {
    const bucket = buckets[cost]!;
    for (let index = 0; index < bucket.length; index++) {
      const state = bucket[index]!;
      if (dist[state] !== cost) continue;
      const cell = Math.floor(state / 42);
      const region = target[cell]!;
      if (region > 0 && settled[region] === 0) {
        settled[region] = 1;
        remaining--;
      }
      for (let machineIndex = 0; machineIndex < machines.length; machineIndex++) {
        const table = transitions[machineIndex]!;
        let reached = table[state]!;
        if (reached === -2) {
          const heading = state % 6;
          const slot = Math.floor(state / 6) % 7;
          const q = cell % map.width;
          const machine = machines[machineIndex]!;
          walkValidatedPathInto(
            map,
            q,
            (cell - q) / map.width,
            slot === 0 ? 0 : HEX_DQ[slot - 1]!,
            slot === 0 ? 0 : HEX_DR[slot - 1]!,
            heading,
            machine,
            out,
            0,
          );
          reached = -1;
          if (out[4] !== 1) {
            let nslot = 0;
            for (let dir = 0; dir < 6; dir++) {
              if (HEX_DQ[dir] === out[2] && HEX_DR[dir] === out[3]) nslot = dir + 1;
            }
            reached = (idx(map.width, out[0]!, out[1]!) * 7 + nslot) * 6 + turnHeading(heading, machine.turn);
          }
          table[state] = reached;
        }
        const total = cost + costs[machineIndex]!;
        if (reached < 0 || total > REGION_REACH_COST_BOUND) continue;
        if (dist[reached] !== -1 && dist[reached]! <= total) continue;
        dist[reached] = total;
        parent[reached] = state;
        via[reached] = machineIndex;
        buckets[total]!.push(reached);
      }
    }
  }
  return { dist, parent, via };
}

/** Price every region by how hard its disease's catalog tier makes it to reach (docs/design.md §1.8). */
function priceRegions(
  mm: MultiMap,
  start: ReturnType<typeof initialState>,
  catalog: readonly MachineCatalogEntry[],
  regions: readonly AtlasRegion[],
  passes: readonly (readonly PassInfo[])[],
): RegionPricing[] {
  const machines = catalog.map(ownMachine);
  const costs = catalog.map((entry) => entry.cost);
  const transitions = mm.maps.map((): (Int32Array | undefined)[] => []);
  const searches = new Map<string, ReturnType<typeof cheapestRoutes>>();
  return regions.map((region, index) => {
    const map = mm.maps[region.map]!;
    const count = diseaseCatalogCount(region.disease, catalog.length);
    const key = `${region.map}:${count}`;
    let search = searches.get(key);
    if (search === undefined) {
      // One search per (map, catalog tier), targeting every region that tier prices.
      const target = new Int32Array(map.cell.length);
      let targets = 0;
      for (const other of regions) {
        if (other.map !== region.map || diseaseCatalogCount(other.disease, catalog.length) !== count) continue;
        targets++;
        for (const cell of other.cells) target[cell] = targets;
      }
      search = cheapestRoutes(map, machines.slice(0, count), costs.slice(0, count), transitions[region.map]!, target, targets);
      searches.set(key, search);
    }
    let best = -1;
    for (const cell of region.cells) {
      for (let variant = 0; variant < 42; variant++) {
        const state = cell * 42 + variant;
        const cost = search.dist[state]!;
        if (cost < 0) continue;
        if (best < 0 || cost < search.dist[best]! || (cost === search.dist[best]! && state < best)) best = state;
      }
    }
    let reachCost: number | null = null;
    let passCount = 0;
    let abyss = 0;
    let difficulty = REGION_DIFFICULTY_CAP;
    if (best >= 0) {
      reachCost = search.dist[best]!;
      const route: Machine[] = [];
      for (let state = best; search.parent[state]! >= 0; state = search.parent[state]!) {
        route.push(machines[search.via[state]!]!);
      }
      route.reverse();
      const entered = new Uint8Array(map.cell.length);
      let pos = start.pos[region.map]!;
      let offset = start.offset[region.map]!;
      let heading = start.heading;
      entered[idx(map.width, pos.q, pos.r)] = 1;
      for (const machine of route) {
        const walked = walkValidatedPath(map, pos, machine, heading, offset);
        for (const cell of walked.entered) entered[idx(map.width, cell.q, cell.r)] = 1;
        pos = walked.pos;
        offset = walked.offset;
        heading = turnHeading(heading, machine.turn);
      }
      for (const pass of passes[region.map] ?? []) {
        if (pass.narrow.some((cell) => entered[cell] === 1)) passCount++;
      }
      const beside = new Uint8Array(map.cell.length);
      for (let cell = 0; cell < map.cell.length; cell++) {
        if (entered[cell] === 0) continue;
        const q = cell % map.width;
        const r = (cell - q) / map.width;
        for (let dir = 0; dir < 6; dir++) {
          const nq = q + HEX_DQ[dir]!;
          const nr = r + HEX_DR[dir]!;
          if (nq < 0 || nr < 0 || nq >= map.width || nr >= map.height) continue;
          const neighbor = idx(map.width, nq, nr);
          if (map.cell[neighbor] === CellKind.Abyss && beside[neighbor] === 0) {
            beside[neighbor] = 1;
            abyss++;
          }
        }
      }
      difficulty = Math.min(
        REGION_DIFFICULTY_CAP,
        reachCost + REGION_PASS_WEIGHT * passCount + REGION_ABYSS_WEIGHT * abyss,
      );
    }
    return {
      id: index + 1,
      map: region.map,
      disease: region.disease,
      kind: region.kind,
      reachCost,
      passes: passCount,
      abyss,
      difficulty,
      price: regionPrice(difficulty),
      capped: best < 0,
    };
  });
}

/** First disease whose priciest hard region does not out-price its priciest easy region, or null. */
export function pricingOutOfOrder(pricing: readonly RegionPricing[]): number | null {
  const easy = new Map<number, number>();
  const hard = new Map<number, number>();
  for (const region of pricing) {
    const table = region.kind === "easy" ? easy : region.kind === "hard" ? hard : null;
    if (table !== null) table.set(region.disease, Math.max(table.get(region.disease) ?? 0, region.price));
  }
  for (const [disease, easyMax] of [...easy].sort((left, right) => left[0] - right[0])) {
    const hardMax = hard.get(disease);
    if (hardMax !== undefined && hardMax <= easyMax) return disease;
  }
  return null;
}

export const MAX_TERRAIN_ATTEMPTS = 4;

interface GenerationResult {
  readonly level: GeneratedLevel;
  readonly diagnostics: GenerationDiagnostics;
}

class ConstructionError extends Error {}

export function generateWithDiagnostics(opts: GenOptions): GenerationResult {
  validateOptions(opts);
  // A terrain that leaves no constructive reference for some disease is redrawn from a derived
  // stream (bounded, deterministic); attempt 0 is the seed itself.
  let failure: unknown = null;
  for (let attempt = 0; attempt < MAX_TERRAIN_ATTEMPTS; attempt++) {
    try {
      return generateAttempt(opts, attempt);
    } catch (error) {
      if (!(error instanceof ConstructionError)) throw error;
      failure = error;
    }
  }
  const reason = failure instanceof Error ? failure.message : String(failure);
  throw new Error(
    `mapgen.generate: no constructive level for seed=${opts.seed >>> 0}, difficulty ` +
      `[${opts.difficulty.min},${opts.difficulty.max}] after ${MAX_TERRAIN_ATTEMPTS} terrains: ${reason}`,
    { cause: failure },
  );
}

function generateAttempt(opts: GenOptions, attempt: number): GenerationResult {
  const seed = opts.seed >>> 0;
  const rng = makeRng(attempt === 0 ? seed : mix32(seed ^ Math.imul(attempt, 0x9e3779b1)));
  const area = opts.width * opts.height;
  const maps = Array.from({ length: opts.nMaps }, () => makeScratch(opts.width, opts.height));
  const initialMachines = opts.catalog.slice(0, Math.min(4, opts.catalog.length)).map(ownMachine);
  const terrainSeeds = maps.map(() => rng.u32());
  const terrainInfo = maps.map((map, mapIndex) => buildTerrain(map, terrainSeeds[mapIndex]!, initialMachines));
  const diseasesOn = (mapIndex: number): number[] => {
    const ids: number[] = [];
    for (let disease = 0; disease < opts.diseaseCount; disease++) {
      if (disease % maps.length === mapIndex) ids.push(disease);
    }
    return ids;
  };
  const noCure = oneStepEndpoints(freezeMaps(maps), opts.catalog);
  const regions: AtlasRegion[] = [];
  const hardByMap = maps.map((map, mapIndex) => {
    const hard = placeHardRegions(map, mapIndex, terrainInfo[mapIndex]!, diseasesOn(mapIndex), terrainSeeds[mapIndex]!, noCure[mapIndex]!);
    regions.push(...hard);
    return hard;
  });
  assignRegionIds(maps, regions, 0);
  const terrain = freezeMaps(maps);
  const built = constructDiseases(
    maps,
    terrain,
    opts.catalog,
    opts.diseaseCount,
    opts.difficulty.min,
    opts.difficulty.max,
    rng.u32(),
  );
  const nextSideEffect: number[] = [];
  const easyFrom = regions.length;
  for (let mapIndex = 0; mapIndex < maps.length; mapIndex++) {
    nextSideEffect[mapIndex] = placeCureRegions(
      rng,
      maps[mapIndex]!,
      mapIndex,
      built.filter((disease) => disease.map === mapIndex),
      mapIndex * area,
      regions,
    );
  }
  assignRegionIds(maps, regions, easyFrom);
  const trail = maps.map(() => new Uint8Array(area));
  const prefix = maps.map(() => new Uint8Array(area));
  const placed = freezeMaps(maps);
  for (const disease of built) referenceFootprint(placed, disease.reference, trail, prefix);
  const black: BlackGroup[][] = [];
  for (let mapIndex = 0; mapIndex < maps.length; mapIndex++) {
    const map = maps[mapIndex]!;
    const features = placeBlackAndFill(
      map,
      mapIndex,
      terrainInfo[mapIndex]!,
      hardByMap[mapIndex]!,
      diseasesOn(mapIndex),
      terrainSeeds[mapIndex]!,
      noCure[mapIndex]!,
      prefix[mapIndex]!,
      trail[mapIndex]!,
      initialMachines,
    );
    const filledFrom = regions.length;
    regions.push(...features.fills);
    assignRegionIds(maps, regions, filledFrom);
    black.push(features.groups);
    nextSideEffect[mapIndex] = contaminateRegions(
      map,
      regions.filter((region) => region.map === mapIndex),
      terrainSeeds[mapIndex]!,
      nextSideEffect[mapIndex]!,
    );
  }
  requireRegionIds(maps);
  const mm = freezeMaps(maps);
  const start = initialState(mm);
  const pricing = priceRegions(mm, start, opts.catalog, regions, terrainInfo.map((info) => info.passes));
  // Placement must respect reach: a disease's hard (basin) region has to out-price its easy ones.
  // Otherwise redraw like an unconstructible terrain; the last attempt keeps what it has.
  const unordered = pricingOutOfOrder(pricing);
  if (unordered !== null && attempt + 1 < MAX_TERRAIN_ATTEMPTS) {
    throw new ConstructionError(`mapgen.generate: disease ${unordered} hard regions are not harder to reach than its easy region`);
  }
  const diseases: DiseaseSpec[] = built.map((disease) => {
    const outcome = simulateReference(mm, start, disease.reference);
    const endpoint = outcome.final[disease.map];
    const map = mm.maps[disease.map]!;
    if (
      outcome.failed ||
      endpoint === undefined ||
      map.cureId[idx(map.width, endpoint.q, endpoint.r)] !== disease.id
    ) {
      throw new Error(`mapgen invariant violation: reference does not cure disease ${disease.id}`);
    }
    if (
      endpoint.q !== disease.node.q ||
      endpoint.r !== disease.node.r
    ) {
      throw new Error(`mapgen invariant violation: disease ${disease.id} endpoint drifted`);
    }
    const diseaseRegions: CureRegionSpec[] = [];
    let basePrice = Number.MAX_SAFE_INTEGER;
    for (const region of pricing) {
      if (region.disease !== disease.id) continue;
      diseaseRegions.push(Object.freeze({
        id: region.id,
        difficulty: region.difficulty,
        price: region.price,
        capped: region.capped,
      }));
      if (region.price < basePrice) basePrice = region.price;
    }
    return {
      id: disease.id,
      map: disease.map,
      node: disease.node,
      difficulty: disease.difficulty,
      basePrice,
      regions: Object.freeze(diseaseRegions),
      reference: disease.reference,
    };
  });
  return {
    level: { seed, mm, start, diseases },
    diagnostics: {
      maps: terrainInfo.map((info, mapIndex) => ({
        radius: info.radius,
        skeleton: info.skeleton,
        passes: info.passes,
        basins: info.basins,
        black: black[mapIndex]!,
      })),
      regions,
      pricing,
    },
  };
}

export const generate: GenerateFn = (opts) => generateWithDiagnostics(opts).level;

/** Whether (q, r) lies on the playable Atlas hexagon (flat test boards are wholly playable). */
export function atlasContains(map: Pick<EffectMap, "width" | "height" | "origin">, q: number, r: number): boolean {
  if (q < 0 || r < 0 || q >= map.width || r >= map.height) return false;
  const radius = atlasRadius(map.width, map.height);
  return radius < MIN_SKELETON_RADIUS || hexDistance(map.origin.q, map.origin.r, q, r) <= radius;
}

// Loaded snapshots carry equal-but-new GenOptions objects; this small content-keyed cache keeps
// Load, rewind and replay from regenerating the same pure, frozen level. ponytail: 4 entries is
// enough for the active game plus Load/rewind/New; raise it if more option sets live at once.
const GENERATED_LEVEL_CACHE_SIZE = 4;
const generatedLevels = new Map<string, GeneratedLevel>();

/** `generate` memoised by option contents (deterministic, so sharing the frozen result is safe). */
export function generateCached(opts: GenOptions): GeneratedLevel {
  const key = JSON.stringify(opts);
  const cached = generatedLevels.get(key);
  if (cached !== undefined) {
    // Re-insert so eviction drops the least recently used level.
    generatedLevels.delete(key);
    generatedLevels.set(key, cached);
    return cached;
  }
  const level = generate(opts);
  generatedLevels.set(key, level);
  if (generatedLevels.size > GENERATED_LEVEL_CACHE_SIZE) {
    generatedLevels.delete(generatedLevels.keys().next().value!);
  }
  return level;
}
