/**
 * HexaPharma — deterministic constructive map generation.
 *
 * Layer A starts from the exact map center; later phase layers use deterministic
 * nearby offsets so a phase exchange changes state instead of being a no-op.
 * The cure is placed at the constructed endpoint. Only after every reference
 * path has been replayed and protected do walls, hazards, and side effects grow
 * around it. Solvability therefore follows from construction; the dev/test-only
 * solver is not part of the production dependency graph.
 */
import type {
  Vec2,
  EffectMap,
  MultiMap,
  Orientation,
  Rotation,
  Machine,
  MachineCatalogEntry,
  DiseaseSpec,
  GenerateFn,
  DifficultyToBasePriceFn,
  MapIndex,
  DiseaseId,
  Template,
  Rng,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import {
  applyTemplate,
  effectiveDelta,
  evaluate,
  initialState,
  revealAlong,
} from "../drug-graph";
import { makeRng } from "../rng";

export const MAX_MAP_CELLS = 65_536;
export const MAX_GENERATION_DIFFICULTY = 64;
export const MAX_GENERATION_CATALOG_ENTRIES = 256;

const MAX_SAFE_PRICE = BigInt(Number.MAX_SAFE_INTEGER);

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

const ALL_ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];
const IDENTITY: Orientation = { rot: 0, flip: false };

const idx = (w: number, x: number, y: number): number => y * w + x;

interface AxisMover {
  readonly axis: "x" | "y";
  readonly step: number;
  readonly machine: Machine;
  readonly cost: number;
}

interface ScratchMap {
  readonly width: number;
  readonly height: number;
  readonly origin: Vec2;
  readonly start: Vec2;
  readonly cell: Uint8Array;
  readonly cureId: Int16Array;
  readonly sideEffectId: Int32Array;
  readonly protectedCells: Uint8Array;
}

interface BuiltDisease {
  readonly id: DiseaseId;
  readonly map: MapIndex;
  readonly node: Vec2;
  readonly difficulty: number;
  readonly cost: number;
  readonly reference: Template;
}

interface PlannedDisease {
  readonly id: DiseaseId;
  readonly map: MapIndex;
  readonly difficulty: number;
  readonly cost: number;
  readonly reference: Template;
}

function ownMachine(machine: Machine): Machine {
  const transform = machine.transform.kind === "translate"
    ? Object.freeze({
        kind: "translate" as const,
        delta: Object.freeze({ x: machine.transform.delta.x, y: machine.transform.delta.y }),
        relation: machine.transform.relation,
      })
    : machine.transform.kind === "scale"
      ? Object.freeze({
          kind: "scale" as const,
          num: machine.transform.num,
          den: machine.transform.den,
        })
      : Object.freeze({
          kind: "swap" as const,
          a: machine.transform.a,
          b: machine.transform.b,
        });
  return Object.freeze({
    typeId: machine.typeId,
    transform,
    orientation: Object.freeze({
      rot: machine.orientation.rot,
      flip: machine.orientation.flip,
    }),
  });
}

function makeScratch(width: number, height: number, start: Vec2, origin: Vec2): ScratchMap {
  const len = width * height;
  const map: ScratchMap = {
    width,
    height,
    origin: { x: origin.x, y: origin.y },
    start: { x: start.x, y: start.y },
    cell: new Uint8Array(len),
    cureId: new Int16Array(len).fill(-1),
    sideEffectId: new Int32Array(len).fill(-1),
    protectedCells: new Uint8Array(len),
  };
  map.protectedCells[idx(width, start.x, start.y)] = 1;
  return map;
}

function freezeMap(map: ScratchMap): EffectMap {
  return {
    width: map.width,
    height: map.height,
    origin: map.origin,
    start: map.start,
    cell: map.cell,
    cureId: map.cureId,
    sideEffectId: map.sideEffectId,
    fog: new Uint8Array(map.width * map.height),
  };
}

function freezeMaps(maps: readonly ScratchMap[]): MultiMap {
  return { maps: maps.map(freezeMap) };
}

function mapCenter(width: number, height: number): Vec2 {
  return { x: Math.floor(width / 2), y: Math.floor(height / 2) };
}

function phaseStart(center: Vec2, width: number, height: number, map: number): Vec2 {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 8));
  if (map === 1) return { x: center.x + step, y: center.y };
  if (map === 2) return { x: center.x, y: center.y + step };
  if (map === 3) return { x: center.x - step, y: center.y };
  return center;
}

function axisMovers(catalog: readonly MachineCatalogEntry[]): AxisMover[] {
  const movers: AxisMover[] = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    if (entry.transform.kind !== "translate") continue;
    const orientations: Orientation[] = entry.orientable
      ? ALL_ROTATIONS.flatMap((rot) => [
          { rot, flip: false },
          { rot, flip: true },
        ])
      : [IDENTITY];
    for (const orientation of orientations) {
      const delta = effectiveDelta(
        entry.transform.delta,
        entry.transform.relation,
        orientation,
      );
      const axis = delta.x !== 0 && delta.y === 0 ? "x" : delta.y !== 0 && delta.x === 0 ? "y" : null;
      if (axis === null) continue;
      const step = axis === "x" ? delta.x : delta.y;
      const key = `${axis}:${step}:${entry.typeId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      movers.push({
        axis,
        step,
        machine: ownMachine({ typeId: entry.typeId, transform: entry.transform, orientation }),
        cost: entry.cost,
      });
    }
  }
  return movers;
}

function smallestMover(
  movers: readonly AxisMover[],
  axis: "x" | "y",
  direction: -1 | 1,
): AxisMover | null {
  let best: AxisMover | null = null;
  for (const mover of movers) {
    if (mover.axis !== axis || Math.sign(mover.step) !== direction) continue;
    if (best === null || Math.abs(mover.step) < Math.abs(best.step)) best = mover;
  }
  return best;
}

function referenceDifficulty(reference: Template): number {
  const types = new Set(reference.steps.map((step) => step.typeId));
  const diversityBonus = reference.steps.length === 0 ? 0 : types.size - 1;
  const decouplingBonus = reference.steps.some((step) => {
    const transform = step.transform;
    return (
      transform.kind === "swap" ||
      transform.kind === "scale" ||
      (transform.kind === "translate" && transform.relation !== "forward")
    );
  })
    ? 2
    : 0;
  return reference.steps.length + diversityBonus + decouplingBonus;
}

function protectReference(maps: readonly ScratchMap[], reference: Template): void {
  const mm = freezeMaps(maps);
  const start = initialState(mm);
  const revealed = revealAlong(mm, start, reference);
  const final = applyTemplate(mm, start, reference);
  for (let mi = 0; mi < maps.length; mi++) {
    const scratch = maps[mi];
    const map = revealed.maps[mi];
    const pos = final.pos[mi];
    if (scratch === undefined || map === undefined || pos === undefined) continue;
    for (let i = 0; i < map.fog.length; i++) {
      if (map.fog[i] === 1) scratch.protectedCells[i] = 1;
    }
    scratch.protectedCells[idx(scratch.width, pos.x, pos.y)] = 1;
  }
}

function constructDiseases(
  rng: Rng,
  maps: readonly ScratchMap[],
  movers: readonly AxisMover[],
  diseaseCount: number,
  minDifficulty: number,
  maxDifficulty: number,
): BuiltDisease[] {
  const candidatesByDisease: {
    readonly id: DiseaseId;
    readonly map: MapIndex;
    readonly candidates: readonly {
      readonly steps: Machine[];
      readonly difficulty: number;
      readonly cost: number;
    }[];
  }[] = [];
  for (let id = 0; id < diseaseCount; id++) {
    const map = id % maps.length;
    const scratch = maps[map]!;
    const xDirection: -1 | 1 = id % 4 === 1 || id % 4 === 2 ? -1 : 1;
    const yDirection: -1 | 1 = id % 4 >= 2 ? -1 : 1;
    const xMover = smallestMover(movers, "x", xDirection);
    const yMover = smallestMover(movers, "y", yDirection);
    if (xMover === null || yMover === null) {
      throw new Error("mapgen.generate: catalog needs axis-aligned translate movers in every direction");
    }
    const xRoom = xDirection > 0
      ? scratch.width - 1 - scratch.start.x
      : scratch.start.x;
    const yRoom = yDirection > 0
      ? scratch.height - 1 - scratch.start.y
      : scratch.start.y;
    const xCapacity = Math.floor(xRoom / Math.abs(xMover.step));
    const yCapacity = Math.floor(yRoom / Math.abs(yMover.step));
    const candidates: { steps: Machine[]; difficulty: number; cost: number }[] = [];
    for (let stepCount = 1; stepCount <= xCapacity + yCapacity; stepCount++) {
      const xCount = Math.min(stepCount, xCapacity);
      const yCount = stepCount - xCount;
      const steps: Machine[] = [];
      for (let n = 0; n < xCount; n++) steps.push(ownMachine(xMover.machine));
      for (let n = 0; n < yCount; n++) steps.push(ownMachine(yMover.machine));
      const reference: Template = { steps };
      const difficulty = referenceDifficulty(reference);
      if (difficulty < minDifficulty || difficulty > maxDifficulty) continue;
      candidates.push({
        steps,
        difficulty,
        cost: xCount * xMover.cost + yCount * yMover.cost,
      });
    }
    if (candidates.length === 0) {
      throw new Error(
        `mapgen.generate: difficulty [${minDifficulty},${maxDifficulty}] cannot be constructed ` +
          `on ${maps[map]!.width}x${maps[map]!.height}`,
      );
    }
    candidatesByDisease.push({
      id,
      map,
      candidates,
    });
  }

  const commonDifficulties: number[] = [];
  for (let difficulty = minDifficulty; difficulty <= maxDifficulty; difficulty++) {
    if (candidatesByDisease.every((disease) =>
      disease.candidates.some((candidate) => candidate.difficulty === difficulty),
    )) {
      commonDifficulties.push(difficulty);
    }
  }
  if (commonDifficulties.length === 0) {
    throw new Error(
      `mapgen.generate: difficulty [${minDifficulty},${maxDifficulty}] has no shared ` +
        "constructive tier across diseases",
    );
  }
  const chosenDifficulty = commonDifficulties[rng.int(commonDifficulties.length)]!;
  const planned: PlannedDisease[] = candidatesByDisease.map((disease) => {
    const chosen = disease.candidates.find(
      (candidate) => candidate.difficulty === chosenDifficulty,
    )!;
    const reference: Template = Object.freeze({ steps: Object.freeze(chosen.steps) });
    return {
      id: disease.id,
      map: disease.map,
      difficulty: chosen.difficulty,
      cost: chosen.cost,
      reference,
    };
  });

  const built: BuiltDisease[] = [];
  for (const plan of planned) {
    const mm = freezeMaps(maps);
    const final = applyTemplate(mm, initialState(mm), plan.reference);
    const node = final.pos[plan.map];
    if (final.failed || node === undefined) {
      throw new Error(
        `mapgen invariant violation: constructed reference failed for disease ${plan.id}`,
      );
    }
    const cellIndex = idx(maps[plan.map]!.width, node.x, node.y);
    if (maps[plan.map]!.cell[cellIndex] !== CellKind.Empty) {
      throw new Error(`mapgen.generate: constructed cure cell is blocked for disease ${plan.id}`);
    }

    protectReference(maps, plan.reference);
    built.push({
      id: plan.id,
      map: plan.map,
      node,
      difficulty: plan.difficulty,
      cost: plan.cost,
      reference: plan.reference,
    });
  }
  return built;
}

const REGION_DIRECTIONS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function forEachNeighbor(map: ScratchMap, cellIndex: number, visit: (neighbor: number) => void): void {
  const x = cellIndex % map.width;
  const y = Math.floor(cellIndex / map.width);
  for (const direction of REGION_DIRECTIONS) {
    const nx = x + direction.x;
    const ny = y + direction.y;
    if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) continue;
    visit(idx(map.width, nx, ny));
  }
}

function connectedComponent(
  map: ScratchMap,
  seed: number,
  available: (cellIndex: number) => boolean,
): number[] {
  if (!available(seed)) return [];
  const visited = new Uint8Array(map.cell.length);
  const queue = new Int32Array(map.cell.length);
  const cells: number[] = [];
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  visited[seed] = 1;
  while (head < tail) {
    const current = queue[head++]!;
    cells.push(current);
    forEachNeighbor(map, current, (neighbor) => {
      if (visited[neighbor] === 1 || !available(neighbor)) return;
      visited[neighbor] = 1;
      queue[tail++] = neighbor;
    });
  }
  return cells;
}

function largestAvailableComponent(
  map: ScratchMap,
  available: (cellIndex: number) => boolean,
): number[] {
  const visited = new Uint8Array(map.cell.length);
  const queue = new Int32Array(map.cell.length);
  let largest: number[] = [];
  for (let seed = 0; seed < map.cell.length; seed++) {
    if (visited[seed] === 1 || !available(seed)) continue;
    const component: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    visited[seed] = 1;
    while (head < tail) {
      const current = queue[head++]!;
      component.push(current);
      forEachNeighbor(map, current, (neighbor) => {
        if (visited[neighbor] === 1 || !available(neighbor)) return;
        visited[neighbor] = 1;
        queue[tail++] = neighbor;
      });
    }
    if (component.length > largest.length) largest = component;
  }
  return largest;
}

function growConnectedRegion(
  rng: Rng,
  map: ScratchMap,
  seed: number,
  target: number,
  available: (cellIndex: number) => boolean,
  place: (cellIndex: number) => void,
): number {
  const queued = new Uint8Array(map.cell.length);
  const frontier: number[] = [seed];
  queued[seed] = 1;
  let placed = 0;
  while (placed < target && frontier.length > 0) {
    const choice = rng.int(frontier.length);
    const current = frontier[choice]!;
    const last = frontier.pop()!;
    if (choice < frontier.length) frontier[choice] = last;
    if (!available(current)) continue;
    place(current);
    placed++;
    forEachNeighbor(map, current, (neighbor) => {
      if (queued[neighbor] === 1 || !available(neighbor)) return;
      queued[neighbor] = 1;
      frontier.push(neighbor);
    });
  }
  return placed;
}

function placeCures(rng: Rng, maps: readonly ScratchMap[], built: readonly BuiltDisease[]): void {
  for (const disease of built) {
    const map = maps[disease.map];
    if (map === undefined) continue;
    const seed = idx(map.width, disease.node.x, disease.node.y);
    const startIndex = idx(map.width, map.start.x, map.start.y);
    const available = (cellIndex: number): boolean =>
      cellIndex !== startIndex &&
      map.cell[cellIndex] === CellKind.Empty &&
      map.cureId[cellIndex] === -1;
    const component = connectedComponent(map, seed, available);
    if (component.length < 5) {
      throw new Error(`mapgen.generate: duplicate or blocked cure cell for disease ${disease.id}`);
    }
    const maxSize = Math.min(9, component.length);
    const target = 5 + rng.int(maxSize - 4);
    const placed = growConnectedRegion(rng, map, seed, target, available, (cellIndex) => {
      map.cell[cellIndex] = CellKind.Cure;
      map.cureId[cellIndex] = disease.id;
      map.protectedCells[cellIndex] = 1;
    });
    if (placed !== target) {
      throw new Error(`mapgen invariant violation: cure region could not grow for disease ${disease.id}`);
    }
  }
}

function scatter(rng: Rng, map: ScratchMap, sideEffectBase: number): void {
  const len = map.width * map.height;
  const wallCount = Math.floor((len * 4) / 100);
  const hazardCount = Math.floor((len * 3) / 100);
  const sideCount = Math.floor((len * 5) / 100);

  const placeRegion = (count: number, kind: number, sideEffect = false): void => {
    let remaining = count;
    let nextSide = sideEffectBase;
    const available = (cellIndex: number): boolean =>
      map.protectedCells[cellIndex] !== 1 && map.cell[cellIndex] === CellKind.Empty;
    while (remaining > 0) {
      const component = largestAvailableComponent(map, available);
      if (component.length === 0) break;
      const target = Math.min(remaining, component.length);
      const seed = component[rng.int(component.length)]!;
      const placed = growConnectedRegion(rng, map, seed, target, available, (cellIndex) => {
        map.cell[cellIndex] = kind;
        if (sideEffect) map.sideEffectId[cellIndex] = nextSide++;
      });
      if (placed === 0) break;
      remaining -= placed;
    }
  };

  placeRegion(wallCount, CellKind.Wall);
  placeRegion(hazardCount, CellKind.Hazard);
  placeRegion(sideCount, CellKind.SideEffect, true);
}

function requireSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`mapgen.generate: ${name} must be a safe integer, got ${String(value)}`);
  }
}

function validateCatalog(catalog: readonly MachineCatalogEntry[]): void {
  if (!Array.isArray(catalog)) {
    throw new Error("mapgen.generate: catalog must be an array");
  }
  if (catalog.length > MAX_GENERATION_CATALOG_ENTRIES) {
    throw new Error(
      `mapgen.generate: catalog must not exceed ${MAX_GENERATION_CATALOG_ENTRIES} entries`,
    );
  }
  const ids = new Set<string>();
  for (let index = 0; index < catalog.length; index++) {
    const entry = catalog[index];
    const path = `catalog[${index}]`;
    if (entry === undefined || typeof entry.typeId !== "string" || entry.typeId.length === 0) {
      throw new Error(`mapgen.generate: ${path}.typeId must be a non-empty string`);
    }
    if (ids.has(entry.typeId)) {
      throw new Error(`mapgen.generate: duplicate typeId "${entry.typeId}" in catalog`);
    }
    ids.add(entry.typeId);
    if (!Number.isSafeInteger(entry.cost) || entry.cost < 0 || entry.cost > 0x7fffffff) {
      throw new Error(`mapgen.generate: ${path}.cost must be a non-negative safe integer within int32`);
    }
    if (!Number.isSafeInteger(entry.speed) || entry.speed < 1 || entry.speed > 0x7fffffff) {
      throw new Error(`mapgen.generate: ${path}.speed must be a positive safe integer within int32`);
    }
    if (typeof entry.orientable !== "boolean") {
      throw new Error(`mapgen.generate: ${path}.orientable must be boolean`);
    }

    const transform = entry.transform;
    if (transform.kind === "translate") {
      if (
        !Number.isSafeInteger(transform.delta.x) ||
        !Number.isSafeInteger(transform.delta.y) ||
        transform.delta.x < -0x80000000 ||
        transform.delta.x > 0x7fffffff ||
        transform.delta.y < -0x80000000 ||
        transform.delta.y > 0x7fffffff
      ) {
        throw new Error(`mapgen.generate: ${path} translate delta must use safe integers within int32`);
      }
      if (
        transform.relation !== "forward" &&
        transform.relation !== "reverse" &&
        transform.relation !== "perpendicular" &&
        transform.relation !== "offset"
      ) {
        throw new Error(`mapgen.generate: ${path} has unknown translate relation`);
      }
      const orientations: readonly Orientation[] = entry.orientable
        ? ALL_ROTATIONS.flatMap((rot) => [
            { rot, flip: false },
            { rot, flip: true },
          ])
        : [IDENTITY];
      for (const orientation of orientations) {
        const delta = effectiveDelta(transform.delta, transform.relation, orientation);
        if (
          delta.x < -0x80000000 ||
          delta.x > 0x7fffffff ||
          delta.y < -0x80000000 ||
          delta.y > 0x7fffffff
        ) {
          throw new Error(`mapgen.generate: ${path} effective translate exceeds int32`);
        }
      }
    } else if (transform.kind === "scale") {
      if (
        !Number.isSafeInteger(transform.num) ||
        !Number.isSafeInteger(transform.den) ||
        transform.num <= 0 ||
        transform.num >= transform.den ||
        transform.den > 0x7fffffff
      ) {
        throw new Error(
          `mapgen.generate: ${path} scale requires safe integers satisfying 0 < num < den`,
        );
      }
    } else if (transform.kind === "swap") {
      requireSafeInteger(`${path}.transform.a`, transform.a);
      requireSafeInteger(`${path}.transform.b`, transform.b);
      if (transform.a === transform.b) {
        throw new Error(`mapgen.generate: ${path} swap requires distinct map indices`);
      }
      if (transform.a < 0 || transform.a >= 4) {
        throw new Error(
          `mapgen.generate: ${path} swap index ${transform.a} outside supported range 0..3`,
        );
      }
      if (transform.b < 0 || transform.b >= 4) {
        throw new Error(
          `mapgen.generate: ${path} swap index ${transform.b} outside supported range 0..3`,
        );
      }
    } else {
      throw new Error(`mapgen.generate: ${path} has unknown transform kind`);
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
  if (opts.width < 3) {
    throw new Error(`mapgen.generate: width must be at least 3, got ${opts.width}`);
  }
  requireSafeInteger("height", opts.height);
  if (opts.height < 3) {
    throw new Error(`mapgen.generate: height must be at least 3, got ${opts.height}`);
  }
  const mapArea = opts.width * opts.height;
  if (!Number.isSafeInteger(mapArea) || mapArea > MAX_MAP_CELLS) {
    throw new Error(`mapgen.generate: map area must not exceed ${MAX_MAP_CELLS} cells`);
  }
  requireSafeInteger("diseaseCount", opts.diseaseCount);
  if (opts.diseaseCount < 1) {
    throw new Error(`mapgen.generate: diseaseCount must be positive, got ${opts.diseaseCount}`);
  }
  if (opts.diseaseCount > opts.nMaps) {
    throw new Error(
      `mapgen.generate: diseaseCount must not exceed nMaps (seed=${opts.seed})`,
    );
  }
  requireSafeInteger("difficulty.min", opts.difficulty.min);
  if (opts.difficulty.min < 0) {
    throw new Error(
      `mapgen.generate: difficulty.min must be non-negative, got ${opts.difficulty.min}`,
    );
  }
  requireSafeInteger("difficulty.max", opts.difficulty.max);
  if (opts.difficulty.max < 0) {
    throw new Error(
      `mapgen.generate: difficulty.max must be non-negative, got ${opts.difficulty.max}`,
    );
  }
  if (opts.difficulty.max < opts.difficulty.min) {
    throw new Error(
      "mapgen.generate: difficulty.max must be greater than or equal to difficulty.min",
    );
  }
  if (opts.difficulty.max > MAX_GENERATION_DIFFICULTY) {
    throw new Error(
      `mapgen.generate: difficulty.max must not exceed ${MAX_GENERATION_DIFFICULTY}`,
    );
  }
  validateCatalog(opts.catalog);
}

export const generate: GenerateFn = (opts) => {
  validateOptions(opts);
  const { nMaps, width, height, catalog, diseaseCount, difficulty } = opts;
  const seed = opts.seed >>> 0;

  const rng = makeRng(seed);
  const movers = axisMovers(catalog);
  const center = mapCenter(width, height);
  const scratch: ScratchMap[] = [];
  for (let mi = 0; mi < nMaps; mi++) {
    scratch.push(makeScratch(width, height, phaseStart(center, width, height, mi), center));
  }

  let built: BuiltDisease[];
  try {
    built = constructDiseases(
      rng,
      scratch,
      movers,
      diseaseCount,
      difficulty.min,
      difficulty.max,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `mapgen.generate: no constructive level for seed=${opts.seed}, difficulty ` +
        `[${difficulty.min},${difficulty.max}]: ${reason}`,
      { cause: error },
    );
  }

  placeCures(rng, scratch, built);
  let sideEffectBase = 0;
  for (const map of scratch) {
    scatter(rng, map, sideEffectBase);
    sideEffectBase += map.width * map.height;
  }

  const mm = freezeMaps(scratch);
  const initial = initialState(mm);
  const diseases: DiseaseSpec[] = built.map((disease) => {
    const outcome = evaluate(mm, initial, disease.reference);
    if (outcome.failed || !outcome.cured.includes(disease.id)) {
      throw new Error(
        `mapgen invariant violation: constructed reference does not cure disease ${disease.id}`,
      );
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

  return { seed, mm, start: initial, diseases };
};
