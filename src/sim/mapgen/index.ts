import type {
  CardinalDelta,
  DifficultyToBasePriceFn,
  DiseaseId,
  DiseaseSpec,
  EffectMap,
  GenerateFn,
  Machine,
  MachineCatalogEntry,
  MapIndex,
  MultiMap,
  Rng,
  Template,
  Vec2,
} from "../phase0_interfaces";
import { CellKind, MAX_TEMPLATE_STEPS } from "../phase0_interfaces";
import { evaluate, initialState, walkValidatedPathInto } from "../drug-graph";
import { makeRng } from "../rng";

export const MAX_MAP_CELLS = 65_536;
export const MAX_GENERATION_DIFFICULTY = 64;
export const MAX_GENERATION_CATALOG_ENTRIES = 256;
export const MAX_GENERATION_DISEASES = 8;
export const MAX_CONSTRUCTIVE_CANDIDATES = 32;
export const TERRAIN_MOTIF_NAMES = Object.freeze([
  "crescent",
  "ridge",
  "canyon",
  "basin",
  "swamp-fan",
  "portal-bypass",
  "pocket",
] as const);

const MAX_SAFE_PRICE = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PATH_LENGTH = 256;
const DIRECTIONS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];
const CARDINALS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const CURE_FRONTIER_SALT = 0xcb30e825;

export const difficultyToBasePrice: DifficultyToBasePriceFn = (difficulty, refCost) => {
  if (!Number.isSafeInteger(difficulty)) {
    throw new Error("mapgen.difficultyToBasePrice: difficulty must be a safe integer");
  }
  if (difficulty < 0) {
    throw new Error("mapgen.difficultyToBasePrice: difficulty must be non-negative");
  }
  if (difficulty > MAX_GENERATION_DIFFICULTY) {
    throw new Error(
      `mapgen.difficultyToBasePrice: difficulty must not exceed ${MAX_GENERATION_DIFFICULTY}`,
    );
  }
  if (!Number.isSafeInteger(refCost)) {
    throw new Error("mapgen.difficultyToBasePrice: refCost must be a safe integer");
  }
  if (refCost < 0) {
    throw new Error("mapgen.difficultyToBasePrice: refCost must be non-negative");
  }
  const basePrice = 12n + 4n * BigInt(difficulty) + 2n * BigInt(refCost);
  if (basePrice > MAX_SAFE_PRICE) {
    throw new Error("mapgen.difficultyToBasePrice: base price exceeds the safe-integer range");
  }
  return Number(basePrice);
};

interface ScratchMap {
  readonly width: number;
  readonly height: number;
  readonly origin: Vec2;
  readonly start: Vec2;
  readonly cell: Uint8Array;
  readonly cureId: Int16Array;
  readonly sideEffectId: Int32Array;
  readonly portalTo: Int32Array;
  readonly protectedCells: Uint8Array;
}

interface ProgramCandidate {
  readonly ordinal: number;
  readonly reference: Template;
  readonly endpoint: Vec2;
  readonly difficulty: number;
  readonly cost: number;
  readonly quality: number;
  readonly signature: string;
  readonly region: readonly number[];
}

interface BuiltDisease {
  readonly id: DiseaseId;
  readonly map: MapIndex;
  readonly node: Vec2;
  readonly difficulty: number;
  readonly cost: number;
  readonly reference: Template;
  readonly region: readonly number[];
}

type MotifName = (typeof TERRAIN_MOTIF_NAMES)[number];

interface MotifPlacement {
  readonly name: MotifName;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly size: number;
}

interface TerrainBand {
  readonly id: 0 | 1 | 2;
  readonly min: number;
  readonly max: number;
  readonly indices: readonly number[];
}

const idx = (width: number, x: number, y: number): number => y * width + x;

function centerOf(width: number, height: number): Vec2 {
  return { x: Math.floor(width / 2), y: Math.floor(height / 2) };
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
    sideEffectId: new Int32Array(length).fill(-1),
    portalTo: new Int32Array(length).fill(-1),
    protectedCells: new Uint8Array(length),
  };
  map.protectedCells[idx(width, center.x, center.y)] = 1;
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
    sideEffectId: map.sideEffectId,
    portalTo: map.portalTo,
    fog: new Uint8Array(map.cell.length),
  };
}

function freezeMaps(maps: readonly ScratchMap[]): MultiMap {
  return { maps: maps.map(freezeMap) };
}

function ownMachine(entry: MachineCatalogEntry): Machine {
  const path = entry.path.map((delta): CardinalDelta => {
    if (delta.x === -1) return Object.freeze({ x: -1, y: 0 });
    if (delta.x === 1) return Object.freeze({ x: 1, y: 0 });
    if (delta.y === -1) return Object.freeze({ x: 0, y: -1 });
    return Object.freeze({ x: 0, y: 1 });
  });
  return Object.freeze({
    typeId: entry.typeId,
    path: Object.freeze(path),
  });
}

function pathSignature(entry: MachineCatalogEntry): string {
  return entry.path.map((delta) => `${delta.x},${delta.y}`).join(";");
}

function referenceDifficulty(reference: Template): number {
  const signatures = new Set(reference.steps.map((step) =>
    step.path.map((delta) => `${delta.x},${delta.y}`).join(";"),
  ));
  return reference.steps.length + Math.max(0, signatures.size - 1);
}

function stepEndpoint(position: Vec2, machine: Machine, width: number, height: number): Vec2 {
  let x = position.x;
  let y = position.y;
  for (const delta of machine.path) {
    const nx = x + delta.x;
    const ny = y + delta.y;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    x = nx;
    y = ny;
  }
  return { x, y };
}

function programEndpoint(start: Vec2, reference: Template, width: number, height: number): Vec2 {
  let position = start;
  for (const machine of reference.steps) position = stepEndpoint(position, machine, width, height);
  return position;
}

function simulateReference(
  terrain: MultiMap,
  start: ReturnType<typeof initialState>,
  reference: Template,
): { readonly failed: boolean; readonly final: readonly Vec2[] } {
  const positions = new Int32Array(terrain.maps.length * 2);
  const walk = new Int32Array(terrain.maps.length * 3);
  for (let mapIndex = 0; mapIndex < terrain.maps.length; mapIndex++) {
    positions[mapIndex * 2] = start.pos[mapIndex]!.x;
    positions[mapIndex * 2 + 1] = start.pos[mapIndex]!.y;
  }
  let failed = false;
  for (const machine of reference.steps) {
    for (let mapIndex = 0; mapIndex < terrain.maps.length; mapIndex++) {
      const map = terrain.maps[mapIndex]!;
      walkValidatedPathInto(
        map,
        positions[mapIndex * 2]!,
        positions[mapIndex * 2 + 1]!,
        machine,
        walk,
        mapIndex * 3,
      );
    }
    for (let mapIndex = 0; mapIndex < terrain.maps.length; mapIndex++) {
      positions[mapIndex * 2] = walk[mapIndex * 3]!;
      positions[mapIndex * 2 + 1] = walk[mapIndex * 3 + 1]!;
      if (walk[mapIndex * 3 + 2] === 1) failed = true;
    }
    if (failed) break;
  }
  const final = Array.from({ length: terrain.maps.length }, (_, mapIndex) => ({
    x: positions[mapIndex * 2]!,
    y: positions[mapIndex * 2 + 1]!,
  }));
  return { failed, final };
}

function normalizedRadius(map: ScratchMap, x: number, y: number): number {
  const radius = Math.max(Math.abs(x - map.origin.x), Math.abs(y - map.origin.y));
  const base = Math.max(1, Math.floor((Math.min(map.width, map.height) - 1) / 2));
  return Math.floor((radius * 31) / base);
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
      const x = current % map.width;
      const y = Math.floor(current / map.width);
      for (const direction of CARDINALS) {
        const nx = x + direction.x;
        const ny = y + direction.y;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
        const next = idx(map.width, nx, ny);
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
  position: Vec2,
  limit: number,
  forbidden: ReadonlySet<number>,
  occupied: ReadonlySet<number>,
  seedWord: number,
): number[] | null {
  const seed = idx(map.width, position.x, position.y);
  if (!availableForCure(map, seed) || forbidden.has(seed) || occupied.has(seed)) return null;
  const visited = new Uint8Array(map.cell.length);
  const queue = new Int32Array(map.cell.length);
  const region: number[] = [];
  let head = 0;
  let tail = 0;
  const tangent = Math.abs(position.x - map.origin.x) >= Math.abs(position.y - map.origin.y)
    ? { x: 0, y: 1 }
    : { x: 1, y: 0 };
  const tangentSign = (mix32(seedWord ^ seed) & 1) === 0 ? 1 : -1;
  const preferredOffsets = Math.min(map.width, map.height) >= 31 && limit >= 5
    ? [0, tangentSign, tangentSign * 2, tangentSign * 3, tangentSign * 4]
    : [0];
  const initialOffsets = preferredOffsets.every((offset) => {
    const x = position.x + tangent.x * offset;
    const y = position.y + tangent.y * offset;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
    const cellIndex = idx(map.width, x, y);
    return availableForCure(map, cellIndex) && !forbidden.has(cellIndex) && !occupied.has(cellIndex);
  }) ? preferredOffsets : [0];
  for (const offset of initialOffsets) {
    const x = position.x + tangent.x * offset;
    const y = position.y + tangent.y * offset;
    const cellIndex = idx(map.width, x, y);
    visited[cellIndex] = 1;
    queue[tail++] = cellIndex;
    region.push(cellIndex);
  }
  while (head < tail && region.length < limit) {
    const current = queue[head++]!;
    const x = current % map.width;
    const y = Math.floor(current / map.width);
    const neighbors = CARDINALS.map((direction, order) => ({
      x: x + direction.x,
      y: y + direction.y,
      order,
    })).sort((left, right) => {
      const leftRadius = normalizedRadius(map, left.x, left.y);
      const rightRadius = normalizedRadius(map, right.x, right.y);
      if (leftRadius !== rightRadius) return rightRadius - leftRadius;
      return (mix32(seedWord ^ current ^ left.order) & 0xffff) -
        (mix32(seedWord ^ current ^ right.order) & 0xffff);
    });
    for (const neighbor of neighbors) {
      const nx = neighbor.x;
      const ny = neighbor.y;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const next = idx(map.width, nx, ny);
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
  const desiredDirection = DIRECTIONS[
    mix32(seedWord ^ Math.imul(disease + 1, 0x51ed270b)) & 7
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
        let netX = 0;
        let netY = 0;
        for (const delta of entry.path) {
          netX += delta.x;
          netY += delta.y;
        }
        const entryForward = netX * desiredDirection.x + netY * desiredDirection.y;
        if (entryForward > bestForward) {
          bestForward = entryForward;
          entryIndex = index;
        }
      }
      const fillerWord = mix32(candidateWord ^ Math.imul(stepIndex + 1, 0x165667b1));
      const fillerStrategy = ordinal & 3;
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
  if (endpoint.x === map.start.x && endpoint.y === map.start.y) return null;
  if (!availableForCure(map, idx(map.width, endpoint.x, endpoint.y))) return null;
  const endpointDx = endpoint.x - map.origin.x;
  const endpointDy = endpoint.y - map.origin.y;
  const radius = normalizedRadius(map, endpoint.x, endpoint.y);
  const occupied = new Set<number>();
  for (const other of built) {
    if (other.map !== mapIndex) continue;
    for (const cellIndex of other.region) occupied.add(cellIndex);
  }
  const region = candidateCureRegion(
    map,
    endpoint,
    Math.min(9, map.cell.length - 1),
    forbiddenCures,
    occupied,
    candidateWord ^ 0xc0febabe,
  );
  if (region === null) return null;
  let nearest = Math.max(map.width, map.height);
  for (const other of built) {
    if (other.map !== mapIndex) continue;
    const distance = Math.max(Math.abs(endpoint.x - other.node.x), Math.abs(endpoint.y - other.node.y));
    if (distance < 3) return null;
    nearest = Math.min(nearest, distance);
  }
  const emptyEndpoint = programEndpoint(map.start, reference, map.width, map.height);
  const terrainChanged = emptyEndpoint.x !== endpoint.x || emptyEndpoint.y !== endpoint.y;
  if (minDifficulty >= 2 && Math.min(map.width, map.height) >= 9 && !terrainChanged) return null;
  const desiredRadius = 6 + (
    mix32(seedWord ^ Math.imul(disease + 1, 0x6a09e667)) % 4
  ) * 5;
  const radiusWeight = 40_000;
  const dx = endpointDx;
  const dy = endpointDy;
  const forward = dx * desiredDirection.x + dy * desiredDirection.y;
  const lateral = Math.abs(dx * desiredDirection.y - dy * desiredDirection.x);
  const initialIds = new Set(fullCatalog.slice(0, 4).map((entry) => entry.typeId));
  const usesAdvancedMachine = disease > 0 && reference.steps.some((step) => !initialIds.has(step.typeId));
  const quality =
    (usesAdvancedMachine ? 2_000_000 : 0) +
    entries.length * 100_000 -
    Math.abs(radius - desiredRadius) * radiusWeight +
    forward * 50_000 -
    lateral * 15_000 +
    Math.min(nearest, 31) * 100 +
    Math.min(totalPathLength, 99) * 20 -
    (candidateWord & 0xff) -
    ordinal;
  return { ordinal, reference, endpoint, difficulty, cost, quality, signature, region };
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
    excluded.add(idx(map.width, position.x, position.y));
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
  for (let disease = 0; disease < diseaseCount; disease++) {
    const mapIndex = disease % maps.length;
    const map = maps[mapIndex];
    if (map === undefined) continue;
    const availableCount = disease === 0 ? Math.min(4, catalog.length) : Math.min(catalog.length, 4 + disease);
    const availableCatalog = catalog.slice(0, availableCount);
    const forbiddenCures = new Set<number>();
    if (minDifficulty >= 2 && Math.min(map.width, map.height) >= 9) {
      for (const cellIndex of singleStepCureExclusions(terrain, start, availableCatalog, mapIndex)) {
        forbiddenCures.add(cellIndex);
      }
      const protectedRadius = 2;
      for (let y = map.start.y - protectedRadius; y <= map.start.y + protectedRadius; y++) {
        for (let x = map.start.x - protectedRadius; x <= map.start.x + protectedRadius; x++) {
          if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
          forbiddenCures.add(idx(map.width, x, y));
        }
      }
    }
    let best: ProgramCandidate | null = null;
    for (let ordinal = 0; ordinal < MAX_CONSTRUCTIVE_CANDIDATES; ordinal++) {
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
      throw new Error(
        `mapgen.generate: disease ${disease} difficulty [${minDifficulty},${maxDifficulty}] cannot be constructed ` +
          `on ${map.width}x${map.height} from at most ${MAX_CONSTRUCTIVE_CANDIDATES} candidates`,
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
    });
    usedSignatures.add(best.signature);
  }
  return built;
}

function placeCureRegions(
  rng: Rng,
  map: ScratchMap,
  diseases: readonly BuiltDisease[],
  sideEffectBase: number,
): number {
  const start = idx(map.width, map.start.x, map.start.y);
  for (const disease of diseases) {
    const seed = idx(map.width, disease.node.x, disease.node.y);
    if (seed === start || !availableForCure(map, seed)) {
      throw new Error(`mapgen.generate: disease ${disease.id} has no distinct empty endpoint`);
    }
    map.cell[seed] = CellKind.Cure;
    map.cureId[seed] = disease.id;
  }

  let nextSideEffect = sideEffectBase;
  for (const disease of diseases) {
    const seed = idx(map.width, disease.node.x, disease.node.y);
    const target = Math.min(5, disease.region.length);
    const region = disease.region.slice(0, target);
    for (const cellIndex of region) {
      if (cellIndex === seed) continue;
      if (!availableForCure(map, cellIndex)) {
        throw new Error(`mapgen.generate: reserved cure region for disease ${disease.id} was occupied`);
      }
      map.cell[cellIndex] = CellKind.Cure;
      map.cureId[cellIndex] = disease.id;
    }
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

function makeBands(map: ScratchMap): readonly TerrainBand[] {
  const indices: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const radius = normalizedRadius(map, x, y);
      const cellIndex = idx(map.width, x, y);
      if (radius >= 7 && radius <= 14) indices[0].push(cellIndex);
      else if (radius >= 15 && radius <= 22) indices[1].push(cellIndex);
      else if (radius >= 23) indices[2].push(cellIndex);
    }
  }
  return [
    { id: 0, min: 7, max: 14, indices: indices[0] },
    { id: 1, min: 15, max: 22, indices: indices[1] },
    { id: 2, min: 23, max: 31, indices: indices[2] },
  ];
}

function rotateLocal(x: number, y: number, rotation: number): Vec2 {
  switch (rotation & 3) {
    case 1: return { x: -y, y: x };
    case 2: return { x: -x, y: -y };
    case 3: return { x: y, y: -x };
    default: return { x, y };
  }
}

function motifDistance(placement: MotifPlacement, x: number, y: number): number {
  const rotated = rotateLocal(x - placement.x, y - placement.y, (4 - placement.rotation) & 3);
  const ax = Math.abs(rotated.x);
  const ay = Math.abs(rotated.y);
  const size = Math.max(2, placement.size);
  switch (placement.name) {
    case "ridge":
      return ay * 3 + Math.max(0, ax - size) * 7;
    case "canyon": {
      const bend = ((ax % 7) - 3) * (rotated.x < 0 ? -1 : 1);
      return Math.abs(rotated.y - bend) * 3 + Math.max(0, ax - size) * 8;
    }
    case "crescent":
      return Math.abs(Math.max(ax, ay) - Math.max(2, Math.floor(size / 2))) * 4 +
        (rotated.x < -Math.floor(size / 3) ? size * 3 : 0);
    case "basin":
      return ax * 2 + ay * 3;
    case "swamp-fan": {
      const behind = rotated.x < 0 ? size * 6 : 0;
      const ray = Math.min(Math.abs(rotated.y * 2 - rotated.x), Math.abs(rotated.y * 2 + rotated.x));
      return behind + ray + Math.max(0, ax - size) * 7;
    }
    case "pocket":
      return Math.abs(Math.max(ax, ay) - Math.max(2, Math.floor(size / 3))) * 5;
    case "portal-bypass":
      return ax + ay * 2;
  }
}

function placementsFor(
  map: ScratchMap,
  band: TerrainBand,
  names: readonly MotifName[],
  seedWord: number,
): readonly MotifPlacement[] {
  const base = Math.max(1, Math.floor((Math.min(map.width, map.height) - 1) / 2));
  const normalizedMid = Math.floor((band.min + band.max) / 2);
  const radius = Math.max(1, Math.floor((normalizedMid * base) / 31));
  const size = Math.max(3, Math.floor(((band.max - band.min + 2) * base) / 31));
  const placements: MotifPlacement[] = [];
  const count = Math.max(4, names.length + band.id + 2);
  for (let index = 0; index < count; index++) {
    const direction = DIRECTIONS[(index * 3 + seedWord + band.id) & 7]!;
    placements.push({
      name: names[index % names.length]!,
      x: map.origin.x + direction.x * radius,
      y: map.origin.y + direction.y * radius,
      rotation: (seedWord + index + band.id) & 3,
      size: size + ((seedWord >>> (index & 7)) & 1),
    });
  }
  return placements;
}

function mix32(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function availableForTerrain(map: ScratchMap, cellIndex: number): boolean {
  return map.cell[cellIndex] === CellKind.Empty && map.protectedCells[cellIndex] === 0;
}

function availableForCure(map: ScratchMap, cellIndex: number): boolean {
  return map.cell[cellIndex] === CellKind.Empty && map.protectedCells[cellIndex] === 0;
}

function targetCount(total: number, low: number, high: number, rng: Rng): number {
  const innerLow = low + (high - low >= 2 ? 1 : 0);
  const innerHigh = high - (high - low >= 2 ? 1 : 0);
  const percent = innerLow + rng.int(innerHigh - innerLow + 1);
  return Math.round((total * percent) / 100);
}

function placeInnerRouteTerrain(rng: Rng, map: ScratchMap): void {
  if (map.width < 5 || map.height < 5) return;
  const ring = [
    { x: -2, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: -2 },
    { x: 1, y: -1 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 2 },
    { x: -1, y: 1 },
  ] as const;
  const firstGap = rng.int(ring.length);
  const secondGap = (firstGap + 3 + rng.int(3)) % ring.length;
  for (let index = 0; index < ring.length; index++) {
    if (index === firstGap || index === secondGap) continue;
    const delta = ring[index]!;
    const x = map.start.x + delta.x;
    const y = map.start.y + delta.y;
    const cellIndex = idx(map.width, x, y);
    if (availableForTerrain(map, cellIndex)) map.cell[cellIndex] = CellKind.Swamp;
  }
}

function paintTerrain(
  map: ScratchMap,
  band: TerrainBand,
  kind: CellKind,
  target: number,
  placements: readonly MotifPlacement[],
  seedWord: number,
): void {
  let placed = 0;
  for (let motifIndex = 0; motifIndex < Math.min(2, placements.length) && placed < target; motifIndex++) {
    const motif = placements[motifIndex]!;
    const candidates = band.indices
      .filter((cellIndex) => availableForTerrain(map, cellIndex))
      .map((cellIndex) => {
        const x = cellIndex % map.width;
        const y = Math.floor(cellIndex / map.width);
        return { cellIndex, distance: motifDistance(motif, x, y) };
      })
      .sort((a, b) => a.distance - b.distance || a.cellIndex - b.cellIndex);
    for (const candidate of candidates.slice(0, 3)) {
      if (!availableForTerrain(map, candidate.cellIndex) || placed >= target) continue;
      map.cell[candidate.cellIndex] = kind;
      placed++;
    }
  }
  const ranked = band.indices
    .filter((cellIndex) => availableForTerrain(map, cellIndex))
    .map((cellIndex) => {
      const x = cellIndex % map.width;
      const y = Math.floor(cellIndex / map.width);
      let distance = Number.MAX_SAFE_INTEGER;
      for (const placement of placements) {
        distance = Math.min(distance, motifDistance(placement, x, y));
      }
      return {
        cellIndex,
        score: distance * 65_536 + (mix32(seedWord ^ cellIndex ^ (kind << 24)) & 0xffff),
      };
    })
    .sort((a, b) => a.score - b.score || a.cellIndex - b.cellIndex);
  for (const candidate of ranked) {
    if (placed >= target) break;
    if (!availableForTerrain(map, candidate.cellIndex)) continue;
    map.cell[candidate.cellIndex] = kind;
    placed++;
  }
}

function placeSideEffects(
  map: ScratchMap,
  band: TerrainBand,
  count: number,
  sideEffectBase: number,
  seedWord: number,
): number {
  const placements = placementsFor(map, band, ["pocket", "crescent"], seedWord);
  const ranked = band.indices
    .filter((cellIndex) => availableForTerrain(map, cellIndex))
    .map((cellIndex) => {
      const x = cellIndex % map.width;
      const y = Math.floor(cellIndex / map.width);
      let distance = Number.MAX_SAFE_INTEGER;
      for (const placement of placements) distance = Math.min(distance, motifDistance(placement, x, y));
      return { cellIndex, score: distance * 65_536 + (mix32(seedWord ^ cellIndex) & 0xffff) };
    })
    .sort((a, b) => a.score - b.score || a.cellIndex - b.cellIndex);
  let placed = 0;
  for (const candidate of ranked) {
    if (placed >= count) break;
    if (!availableForTerrain(map, candidate.cellIndex)) continue;
    map.cell[candidate.cellIndex] = CellKind.SideEffect;
    map.sideEffectId[candidate.cellIndex] = sideEffectBase + placed;
    placed++;
  }
  return placed;
}

function bestPortalCell(
  map: ScratchMap,
  band: TerrainBand,
  placement: MotifPlacement,
  excluded: ReadonlySet<number>,
): number | null {
  let best: { readonly index: number; readonly score: number } | null = null;
  for (const cellIndex of band.indices) {
    if (excluded.has(cellIndex) || !availableForTerrain(map, cellIndex)) continue;
    const x = cellIndex % map.width;
    const y = Math.floor(cellIndex / map.width);
    const score = motifDistance(placement, x, y);
    if (best === null || score < best.score || (score === best.score && cellIndex < best.index)) {
      best = { index: cellIndex, score };
    }
  }
  return best?.index ?? null;
}

function placePortals(
  map: ScratchMap,
  band: TerrainBand,
  pairs: number,
  seedWord: number,
): void {
  const placements = placementsFor(map, band, ["portal-bypass"], seedWord);
  const used = new Set<number>();
  for (let pair = 0; pair < pairs; pair++) {
    const entryPlacement = placements[pair % placements.length];
    const exitPlacement = placements[(pair + Math.floor(placements.length / 2)) % placements.length];
    if (entryPlacement === undefined || exitPlacement === undefined) break;
    const entry = bestPortalCell(map, band, entryPlacement, used);
    if (entry === null) break;
    used.add(entry);
    const destination = bestPortalCell(map, band, exitPlacement, used);
    if (destination === null) break;
    used.add(destination);
    map.cell[entry] = CellKind.Portal;
    map.portalTo[entry] = destination;
    map.protectedCells[destination] = 1;
  }
}

function decorateTerrain(
  rng: Rng,
  map: ScratchMap,
  sideEffectBase: number,
  includeInnerRouteTerrain: boolean,
): number {
  if (Math.min(map.width, map.height) < 9) return sideEffectBase;
  if (includeInnerRouteTerrain) placeInnerRouteTerrain(rng, map);
  if (Math.min(map.width, map.height) < 31) return sideEffectBase;
  const bands = makeBands(map);
  let nextSideEffect = sideEffectBase;
  for (const band of bands) {
    const seedWord = rng.u32();
    const wallRanges = [[8, 12], [12, 18], [18, 25]] as const;
    const abyssRanges = [[1, 3], [4, 7], [7, 11]] as const;
    const swampRanges = [[6, 10], [10, 15], [12, 20]] as const;
    const wallRange = wallRanges[band.id];
    const abyssRange = abyssRanges[band.id];
    const swampRange = swampRanges[band.id];
    const abyssTarget = targetCount(band.indices.length, abyssRange[0], abyssRange[1], rng);
    const wallTarget = targetCount(band.indices.length, wallRange[0], wallRange[1], rng);
    const swampTarget = targetCount(band.indices.length, swampRange[0], swampRange[1], rng);
    paintTerrain(
      map,
      band,
      CellKind.Abyss,
      abyssTarget,
      placementsFor(map, band, ["canyon", "basin", "pocket"], seedWord ^ 0xa81),
      seedWord ^ 0xa81,
    );
    paintTerrain(
      map,
      band,
      CellKind.Wall,
      wallTarget,
      placementsFor(map, band, ["ridge", "crescent", "pocket"], seedWord ^ 0x7a11),
      seedWord ^ 0x7a11,
    );
    paintTerrain(
      map,
      band,
      CellKind.Swamp,
      swampTarget,
      placementsFor(map, band, ["swamp-fan", "basin", "crescent"], seedWord ^ 0x5a4f),
      seedWord ^ 0x5a4f,
    );
    nextSideEffect += placeSideEffects(
      map,
      band,
      Math.round((band.indices.length * 3) / 100),
      nextSideEffect,
      seedWord ^ 0x51de,
    );
    const portalPairs = band.id === 0 ? 1 : band.id === 1 ? 1 + rng.int(2) : 2 + rng.int(2);
    placePortals(map, band, portalPairs, seedWord ^ 0xb1fa55);
  }
  return nextSideEffect;
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
      const delta = entry.path[pathIndex];
      if (
        delta === undefined ||
        !Number.isSafeInteger(delta.x) ||
        !Number.isSafeInteger(delta.y) ||
        Math.abs(delta.x) + Math.abs(delta.y) !== 1
      ) {
        throw new Error(`mapgen.generate: ${path}.path[${pathIndex}] must be a cardinal unit delta`);
      }
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

export const generate: GenerateFn = (opts) => {
  validateOptions(opts);
  const seed = opts.seed >>> 0;
  const rng = makeRng(seed);
  const maps = Array.from({ length: opts.nMaps }, () => makeScratch(opts.width, opts.height));
  const nextSideEffect: number[] = [];
  for (let mapIndex = 0; mapIndex < maps.length; mapIndex++) {
    nextSideEffect[mapIndex] = decorateTerrain(
      rng,
      maps[mapIndex]!,
      mapIndex * opts.width * opts.height,
      opts.difficulty.min >= 2 || opts.catalog.length > 1,
    );
  }
  const terrain = freezeMaps(maps);
  let built: BuiltDisease[];
  try {
    built = constructDiseases(
      maps,
      terrain,
      opts.catalog,
      opts.diseaseCount,
      opts.difficulty.min,
      opts.difficulty.max,
      rng.u32(),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `mapgen.generate: no constructive level for seed=${seed}, difficulty ` +
        `[${opts.difficulty.min},${opts.difficulty.max}]: ${reason}`,
      { cause: error },
    );
  }
  for (let mapIndex = 0; mapIndex < maps.length; mapIndex++) {
    placeCureRegions(
      rng,
      maps[mapIndex]!,
      built.filter((disease) => disease.map === mapIndex),
      nextSideEffect[mapIndex]!,
    );
  }
  const mm = freezeMaps(maps);
  const start = initialState(mm);
  const diseases: DiseaseSpec[] = built.map((disease) => {
    const outcome = evaluate(mm, start, disease.reference);
    if (outcome.failed || !outcome.cured.includes(disease.id)) {
      throw new Error(`mapgen invariant violation: reference does not cure disease ${disease.id}`);
    }
    if (
      outcome.final[disease.map]?.x !== disease.node.x ||
      outcome.final[disease.map]?.y !== disease.node.y
    ) {
      throw new Error(`mapgen invariant violation: disease ${disease.id} endpoint drifted`);
    }
    return {
      id: disease.id,
      map: disease.map,
      node: disease.node,
      difficulty: disease.difficulty,
      basePrice: difficultyToBasePrice(disease.difficulty, disease.cost),
      reference: disease.reference,
    };
  });
  return { seed, mm, start, diseases };
};
