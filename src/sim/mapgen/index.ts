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
import { evaluate, initialState } from "../drug-graph";
import { makeRng } from "../rng";

export const MAX_MAP_CELLS = 65_536;
export const MAX_GENERATION_DIFFICULTY = 64;
export const MAX_GENERATION_CATALOG_ENTRIES = 256;
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
  const exponent = BigInt(difficulty);
  const numerator = 10n * 17n ** exponent;
  const denominator = 10n ** exponent;
  const difficultyPrice = (2n * numerator + denominator) / (2n * denominator);
  const basePrice = difficultyPrice + 3n * BigInt(refCost);
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
}

interface BuiltDisease {
  readonly id: DiseaseId;
  readonly map: MapIndex;
  readonly node: Vec2;
  readonly difficulty: number;
  readonly cost: number;
  readonly reference: Template;
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

function normalizedRadius(map: ScratchMap, x: number, y: number): number {
  const radius = Math.max(Math.abs(x - map.origin.x), Math.abs(y - map.origin.y));
  const base = Math.max(1, Math.floor((Math.min(map.width, map.height) - 1) / 2));
  return Math.floor((radius * 31) / base);
}

function chooseDistinctEntries(
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

function makeProgramCandidate(
  map: ScratchMap,
  catalog: readonly MachineCatalogEntry[],
  minDifficulty: number,
  maxDifficulty: number,
  disease: number,
  ordinal: number,
): ProgramCandidate | null {
  const span = maxDifficulty - minDifficulty + 1;
  const targetDifficulty = minDifficulty + ((ordinal + disease * 5) % span);
  if (targetDifficulty < 1) return null;
  let distinctTarget = targetDifficulty >= 5 && catalog.length >= 3 && ordinal % 3 === 0
    ? 3
    : targetDifficulty >= 3 && catalog.length >= 2
      ? 2
      : 1;
  let stepCount = targetDifficulty - (distinctTarget - 1);
  if (stepCount < distinctTarget) {
    distinctTarget = 1;
    stepCount = targetDifficulty;
  }
  if (stepCount < 1 || stepCount > MAX_TEMPLATE_STEPS) return null;
  const entries = chooseDistinctEntries(catalog, distinctTarget, ordinal * 5 + disease * 7);
  if (entries.length < distinctTarget) return null;
  const steps: Machine[] = [];
  let cost = 0;
  let totalPathLength = 0;
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    const entry = entries[(stepIndex + ordinal) % entries.length];
    if (entry === undefined) return null;
    steps.push(ownMachine(entry));
    totalPathLength += entry.path.length;
    cost += entry.cost;
  }
  const reference: Template = Object.freeze({ steps: Object.freeze(steps) });
  const difficulty = referenceDifficulty(reference);
  if (difficulty < minDifficulty || difficulty > maxDifficulty) return null;
  const endpoint = programEndpoint(map.start, reference, map.width, map.height);
  if (endpoint.x === map.start.x && endpoint.y === map.start.y) return null;
  const radius = normalizedRadius(map, endpoint.x, endpoint.y);
  const desiredRadius = Math.min(29, 7 + difficulty * 2);
  const quality =
    entries.length * 100_000 -
    Math.abs(radius - desiredRadius) * 2_000 +
    Math.min(totalPathLength, 99) * 20 -
    ordinal;
  return { ordinal, reference, endpoint, difficulty, cost, quality };
}

function constructDiseases(
  maps: readonly ScratchMap[],
  catalog: readonly MachineCatalogEntry[],
  diseaseCount: number,
  minDifficulty: number,
  maxDifficulty: number,
): BuiltDisease[] {
  const built: BuiltDisease[] = [];
  for (let disease = 0; disease < diseaseCount; disease++) {
    const mapIndex = disease % maps.length;
    const map = maps[mapIndex];
    if (map === undefined) continue;
    let best: ProgramCandidate | null = null;
    for (let ordinal = 0; ordinal < MAX_CONSTRUCTIVE_CANDIDATES; ordinal++) {
      const candidate = makeProgramCandidate(
        map,
        catalog,
        minDifficulty,
        maxDifficulty,
        disease,
        ordinal,
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
        `mapgen.generate: difficulty [${minDifficulty},${maxDifficulty}] cannot be constructed ` +
          `on ${map.width}x${map.height} from at most ${MAX_CONSTRUCTIVE_CANDIDATES} candidates`,
      );
    }
    built.push({
      id: disease,
      map: mapIndex,
      node: best.endpoint,
      difficulty: best.difficulty,
      cost: best.cost,
      reference: best.reference,
    });
  }
  return built;
}

function protectReference(map: ScratchMap, reference: Template): void {
  let position = map.start;
  map.protectedCells[idx(map.width, position.x, position.y)] = 1;
  for (const machine of reference.steps) {
    for (const delta of machine.path) {
      const nx = position.x + delta.x;
      const ny = position.y + delta.y;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      position = { x: nx, y: ny };
      map.protectedCells[idx(map.width, position.x, position.y)] = 1;
    }
  }
}

function placeCureRegion(rng: Rng, map: ScratchMap, disease: BuiltDisease): void {
  const start = idx(map.width, map.start.x, map.start.y);
  const seed = idx(map.width, disease.node.x, disease.node.y);
  if (seed === start || map.cell[seed] !== CellKind.Empty) {
    throw new Error(`mapgen.generate: disease ${disease.id} has no distinct empty endpoint`);
  }
  const target = Math.min(5 + rng.int(5), map.cell.length - 1);
  const queued = new Uint8Array(map.cell.length);
  const queue: number[] = [seed];
  queued[seed] = 1;
  let placed = 0;
  while (queue.length > 0 && placed < target) {
    const current = queue.shift();
    if (current === undefined) break;
    if (current !== start && map.cell[current] === CellKind.Empty) {
      map.cell[current] = CellKind.Cure;
      map.cureId[current] = disease.id;
      map.protectedCells[current] = 1;
      placed++;
    }
    const x = current % map.width;
    const y = Math.floor(current / map.width);
    const shift = (current + disease.id + target) & 3;
    for (let offset = 0; offset < CARDINALS.length; offset++) {
      const direction = CARDINALS[(offset + shift) & 3]!;
      const nx = x + direction.x;
      const ny = y + direction.y;
      if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
      const next = idx(map.width, nx, ny);
      if (queued[next] === 1 || next === start || map.cell[next] !== CellKind.Empty) continue;
      queued[next] = 1;
      queue.push(next);
    }
  }
  if (placed !== target) {
    throw new Error(`mapgen.generate: cure region for disease ${disease.id} could not reach ${target} cells`);
  }
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

function targetCount(total: number, low: number, high: number, rng: Rng): number {
  const innerLow = low + (high - low >= 2 ? 1 : 0);
  const innerHigh = high - (high - low >= 2 ? 1 : 0);
  const percent = innerLow + rng.int(innerHigh - innerLow + 1);
  return Math.round((total * percent) / 100);
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
  }
}

function decorateTerrain(rng: Rng, map: ScratchMap, sideEffectBase: number): void {
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
    const portalPairs = band.id === 0 ? rng.int(2) : band.id === 1 ? 1 + rng.int(2) : 2 + rng.int(2);
    placePortals(map, band, portalPairs, seedWord ^ 0xb1fa55);
  }
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
  if (opts.diseaseCount < 1 || opts.diseaseCount > opts.nMaps) {
    throw new Error("mapgen.generate: diseaseCount must be positive and not exceed nMaps");
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
  let built: BuiltDisease[];
  try {
    built = constructDiseases(
      maps,
      opts.catalog,
      opts.diseaseCount,
      opts.difficulty.min,
      opts.difficulty.max,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `mapgen.generate: no constructive level for seed=${seed}, difficulty ` +
        `[${opts.difficulty.min},${opts.difficulty.max}]: ${reason}`,
      { cause: error },
    );
  }
  for (const disease of built) {
    for (const map of maps) protectReference(map, disease.reference);
  }
  for (const disease of built) placeCureRegion(rng, maps[disease.map]!, disease);
  for (let mapIndex = 0; mapIndex < maps.length; mapIndex++) {
    decorateTerrain(rng, maps[mapIndex]!, mapIndex * opts.width * opts.height);
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
