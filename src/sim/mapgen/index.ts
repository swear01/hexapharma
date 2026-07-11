/**
 * HexaPharma — deterministic constructive map generation.
 *
 * Generation starts from a known machine sequence. Deliberate map barriers make
 * the first two maps diverge, a swap carries the donor position across the
 * barrier, and the cure is placed at the constructed endpoint. Only after every
 * reference path has been replayed and protected do walls, hazards, and side
 * effects grow around it. Solvability therefore follows from construction; the
 * dev/test-only solver is not part of the production dependency graph.
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
    origin,
    start,
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

function originFor(mapIndex: MapIndex, width: number, height: number): Vec2 {
  const corners: readonly Vec2[] = [
    { x: 0, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
  ];
  return corners[mapIndex % corners.length] ?? { x: 0, y: 0 };
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
      const axis = delta.x > 0 && delta.y === 0 ? "x" : delta.y > 0 && delta.x === 0 ? "y" : null;
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

function smallestMover(movers: readonly AxisMover[], axis: "x" | "y"): AxisMover | null {
  let best: AxisMover | null = null;
  for (const mover of movers) {
    if (mover.axis !== axis) continue;
    if (best === null || mover.step < best.step) best = mover;
  }
  return best;
}

function swap01(catalog: readonly MachineCatalogEntry[]): { machine: Machine; cost: number } | null {
  for (const entry of catalog) {
    const transform = entry.transform;
    if (
      transform.kind === "swap" &&
      ((transform.a === 0 && transform.b === 1) || (transform.a === 1 && transform.b === 0))
    ) {
      return {
        machine: ownMachine({ typeId: entry.typeId, transform, orientation: IDENTITY }),
        cost: entry.cost,
      };
    }
  }
  return null;
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

function addBarrier(map: ScratchMap, axis: "x" | "y"): void {
  if (axis === "x") {
    for (let y = 0; y < map.height; y++) {
      const i = idx(map.width, 1, y);
      map.cell[i] = CellKind.Wall;
      map.protectedCells[i] = 1;
    }
    return;
  }
  for (let x = 0; x < map.width; x++) {
    const i = idx(map.width, x, 1);
    map.cell[i] = CellKind.Wall;
    map.protectedCells[i] = 1;
  }
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
  catalog: readonly MachineCatalogEntry[],
  movers: readonly AxisMover[],
  diseaseCount: number,
  minDifficulty: number,
  maxDifficulty: number,
): BuiltDisease[] {
  const swap = swap01(catalog);
  const xMover = smallestMover(movers, "x");
  const yMover = smallestMover(movers, "y");
  if (swap === null || xMover === null || yMover === null) {
    throw new Error("mapgen.generate: catalog needs +x/+y movers and a swap between maps 0 and 1");
  }

  const planned: PlannedDisease[] = [];
  for (let id = 0; id < diseaseCount; id++) {
    const map = id % maps.length;
    const axis = id % 2 === 0 ? "x" : "y";
    const mover = axis === "x" ? xMover : yMover;
    const span = axis === "x" ? maps[map]!.width - 1 : maps[map]!.height - 1;
    const minMoves = Math.ceil(2 / mover.step);
    const maxMoves = Math.ceil(span / mover.step);
    const fixedBonus = mover.machine.typeId === swap.machine.typeId ? 3 : 4;
    const low = Math.max(minDifficulty, minMoves + fixedBonus);
    const high = Math.min(maxDifficulty, maxMoves + fixedBonus);
    if (low > high) {
      throw new Error(
        `mapgen.generate: difficulty [${minDifficulty},${maxDifficulty}] cannot be constructed ` +
          `on ${maps[map]!.width}x${maps[map]!.height}`,
      );
    }

    const desired = low + rng.int(high - low + 1);
    const moveCount = desired - fixedBonus;
    const steps: Machine[] = [];
    for (let n = 0; n < moveCount; n++) steps.push(ownMachine(mover.machine));
    steps.push(ownMachine(swap.machine));
    const reference: Template = Object.freeze({ steps: Object.freeze(steps) });
    const difficulty = referenceDifficulty(reference);

    planned.push({
      id,
      map,
      difficulty,
      cost: moveCount * mover.cost + swap.cost,
      reference,
    });
  }

  addBarrier(maps[0]!, "x");
  addBarrier(maps[1]!, "y");

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

function placeCures(maps: readonly ScratchMap[], built: readonly BuiltDisease[]): void {
  for (const disease of built) {
    const map = maps[disease.map];
    if (map === undefined) continue;
    const i = idx(map.width, disease.node.x, disease.node.y);
    if (map.cell[i] !== CellKind.Empty || map.cureId[i] !== -1) {
      throw new Error(`mapgen.generate: duplicate or blocked cure cell for disease ${disease.id}`);
    }
    map.cell[i] = CellKind.Cure;
    map.cureId[i] = disease.id;
    map.protectedCells[i] = 1;
  }
}

function placeTensionHazards(maps: readonly ScratchMap[], built: readonly BuiltDisease[]): void {
  for (const disease of built) {
    for (let mi = 0; mi < maps.length; mi++) {
      if (mi === disease.map) continue;
      const map = maps[mi];
      if (map === undefined) continue;
      const i = idx(map.width, disease.node.x, disease.node.y);
      if (map.protectedCells[i] === 1 || map.cell[i] !== CellKind.Empty) continue;
      map.cell[i] = CellKind.Hazard;
      map.protectedCells[i] = 1;
    }
  }
}

function scatter(rng: Rng, map: ScratchMap, sideEffectBase: number): void {
  const len = map.width * map.height;
  const wallCount = Math.floor((len * 4) / 100);
  const hazardCount = Math.floor((len * 3) / 100);
  const sideCount = Math.floor((len * 5) / 100);

  const placeBlocking = (count: number, kind: number): void => {
    for (let n = 0; n < count; n++) {
      const x = rng.int(map.width);
      const y = rng.int(map.height);
      const i = idx(map.width, x, y);
      if (map.protectedCells[i] === 1 || map.cell[i] !== CellKind.Empty) continue;
      map.cell[i] = kind;
    }
  };

  placeBlocking(wallCount, CellKind.Wall);
  placeBlocking(hazardCount, CellKind.Hazard);

  let nextSide = sideEffectBase;
  for (let n = 0; n < sideCount; n++) {
    const x = rng.int(map.width);
    const y = rng.int(map.height);
    const i = idx(map.width, x, y);
    if (map.protectedCells[i] === 1 || map.cell[i] !== CellKind.Empty) continue;
    map.cell[i] = CellKind.SideEffect;
    map.sideEffectId[i] = nextSide;
    nextSide += 1;
  }
}

function requireSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`mapgen.generate: ${name} must be a safe integer, got ${String(value)}`);
  }
}

function validateCatalog(catalog: readonly MachineCatalogEntry[], nMaps: number): void {
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
      if (transform.a < 0 || transform.a >= nMaps) {
        throw new Error(
          `mapgen.generate: ${path} swap index ${transform.a} outside 0..${nMaps - 1}`,
        );
      }
      if (transform.b < 0 || transform.b >= nMaps) {
        throw new Error(
          `mapgen.generate: ${path} swap index ${transform.b} outside 0..${nMaps - 1}`,
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
  if (opts.nMaps < 2 || opts.nMaps > 4) {
    throw new Error(`mapgen.generate: nMaps must be between 2 and 4, got ${opts.nMaps}`);
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
  validateCatalog(opts.catalog, opts.nMaps);
}

export const generate: GenerateFn = (opts) => {
  validateOptions(opts);
  const { nMaps, width, height, catalog, diseaseCount, difficulty } = opts;
  const seed = opts.seed >>> 0;

  const rng = makeRng(seed);
  const movers = axisMovers(catalog);
  const start: Vec2 = { x: 0, y: 0 };
  const scratch: ScratchMap[] = [];
  for (let mi = 0; mi < nMaps; mi++) {
    scratch.push(makeScratch(width, height, start, originFor(mi, width, height)));
  }

  let built: BuiltDisease[];
  try {
    built = constructDiseases(
      rng,
      scratch,
      catalog,
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

  placeCures(scratch, built);
  placeTensionHazards(scratch, built);
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
