import type {
  GameState,
  GenOptions,
  EconomyState,
  PatentState,
  FactoryLayout,
  FactoryTile,
  FactoryMachineDef,
  PlacedMachine,
  MachineShape,
  Port,
  RngState,
  Template,
  Machine,
  DrugState,
  Outcome,
  FactoryState,
  Unit,
  ProducedUnit,
  InventoryProduct,
  Dir,
  HexCoord,
  SerializeGameFn,
  DeserializeGameFn,
} from "../phase0_interfaces";
import {
  MAX_FACTORY_MACHINES,
  MAX_FACTORY_PORTS,
  MAX_MACHINE_PORTS,
  MAX_MACHINE_SHAPE_CELLS,
  MAX_TEMPLATE_STEPS,
  MAX_GAME_INVENTORY_PRODUCTS,
  MAX_GAME_FACTORY_CELLS,
  MAX_GAME_FACTORY_DIMENSION,
} from "../phase0_interfaces";
import { restoreFactory, snapshotFactory } from "../factory-sim";
import {
  MAX_GENERATION_CATALOG_ENTRIES,
  MAX_GENERATION_DISEASES,
  generate,
} from "../mapgen";
import { DEFAULT_PATENTS } from "../patent";
import {
  requireEntitledFacilityLayout,
  validateGameOptions,
  validateGameState,
} from "../game";
import { isJsonObject } from "../../json-guards";
import { fnv1a32Hex } from "../hash";
import { DEFAULT_CATALOG, DEFAULT_SHAPES } from "../phase0_interfaces";

// HexaPharma save/load (Phase 3).
//
// The immutable level is stored as GenOptions and regenerated deterministically;
// mutable typed state such as fog is converted to arrays. A save is a
// stable-key-ordered JSON document tagged with a format version.
//
// Round-trip invariant (docs/invariants.md): deserializeGame(serializeGame(g))
// deep-equals g for any valid GameState. We achieve this by validating the parsed
// blob field-by-field and rebuilding a structurally-equal GameState — never
// defaulting silently on missing/wrong fields.

export const SAVE_VERSION = 11;
export const SAVE_CONTENT_BUILD = fnv1a32Hex(canonical({
  rules: 2,
  catalog: DEFAULT_CATALOG,
  shapes: DEFAULT_SHAPES,
  patents: DEFAULT_PATENTS,
}));
export const MAX_SLOT_STATES = 20;
export const MAX_SAVE_CHARACTERS = 5_000_000;

export interface PreparedSnapshot {
  readonly game: GameState;
  readonly serialized: string;
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

// ── canonical JSON (stable key order ⇒ deterministic string) ──

function stable(value: unknown): unknown {
  if (value instanceof Uint8Array || value instanceof Int16Array || value instanceof Int32Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(stable(value));
}

// ── validation helpers (no silent defaults: throw a clear SaveError) ──

function reqObject(v: unknown, path: string): Record<string, unknown> {
  if (!isJsonObject(v)) throw new SaveError(`${path}: expected object, got ${describe(v)}`);
  return v;
}

function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new SaveError(`unknown field ${path}.${key}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new SaveError(`missing field ${path}.${key}`);
    }
  }
}

function reqExactObject(
  v: unknown,
  path: string,
  keys: readonly string[],
): Record<string, unknown> {
  const value = reqObject(v, path);
  requireExactKeys(value, keys, path);
  return value;
}

function reqArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new SaveError(`${path}: expected array, got ${describe(v)}`);
  return v;
}

function reqInt(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) {
    throw new SaveError(`${path}: expected safe integer, got ${describe(v)}`);
  }
  return v;
}

function reqNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SaveError(`${path}: expected finite number, got ${describe(v)}`);
  }
  return v;
}

function reqString(v: unknown, path: string): string {
  if (typeof v !== "string") throw new SaveError(`${path}: expected string, got ${describe(v)}`);
  return v;
}

function reqBool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new SaveError(`${path}: expected boolean, got ${describe(v)}`);
  return v;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ── shape parsers (rebuild structurally-equal values) ──

function parseHexCoord(v: unknown, path: string): HexCoord {
  const o = reqExactObject(v, path, ["q", "r"]);
  return { q: reqInt(o.q, `${path}.q`), r: reqInt(o.r, `${path}.r`) };
}

function parseGenOptions(v: unknown, path = "genOptions"): GenOptions {
  const o = reqExactObject(v, path, [
    "seed",
    "nMaps",
    "width",
    "height",
    "catalog",
    "diseaseCount",
    "difficulty",
  ]);
  const diff = reqExactObject(o.difficulty, `${path}.difficulty`, ["min", "max"]);
  const options = {
    seed: reqInt(o.seed, `${path}.seed`),
    nMaps: reqInt(o.nMaps, `${path}.nMaps`),
    width: reqInt(o.width, `${path}.width`),
    height: reqInt(o.height, `${path}.height`),
    catalog: parseCatalog(o.catalog, `${path}.catalog`),
    diseaseCount: reqInt(o.diseaseCount, `${path}.diseaseCount`),
    difficulty: {
      min: reqNumber(diff.min, `${path}.difficulty.min`),
      max: reqNumber(diff.max, `${path}.difficulty.max`),
    },
  };
  try {
    validateGameOptions(options);
  } catch (error) {
    throw new SaveError(`${path}: ${(error as Error).message}`);
  }
  return options;
}

function parsePathStamp(v: unknown, path: string): Machine["path"] {
  const deltas = reqArray(v, path);
  if (deltas.length < 1 || deltas.length > MAX_TEMPLATE_STEPS) {
    throw new SaveError(`${path}: path length must be 1..${MAX_TEMPLATE_STEPS}`);
  }
  return deltas.map((value, index) => parseDir(value, `${path}[${index}]`));
}

function parseCatalog(v: unknown, catalogPath: string): GenOptions["catalog"] {
  const arr = reqArray(v, catalogPath);
  if (arr.length > MAX_GENERATION_CATALOG_ENTRIES) {
    throw new SaveError(`${catalogPath}: exceeds ${MAX_GENERATION_CATALOG_ENTRIES} entries`);
  }
  return arr.map((e, i) => {
    const path = `${catalogPath}[${i}]`;
    const o = reqExactObject(e, path, ["typeId", "path", "cost", "speed"]);
    return {
      typeId: reqString(o.typeId, `${path}.typeId`),
      path: parsePathStamp(o.path, `${path}.path`),
      cost: reqNumber(o.cost, `${path}.cost`),
      speed: reqInt(o.speed, `${path}.speed`),
    };
  });
}

function parseEconomy(v: unknown, diseaseCount: number): EconomyState {
  const o = reqExactObject(v, "economy", ["cash", "research", "sold"]);
  const sold = reqArray(o.sold, "economy.sold");
  if (sold.length > diseaseCount) {
    throw new SaveError("economy.sold: count exceeds generated diseases");
  }
  return {
    cash: reqInt(o.cash, "economy.cash"),
    research: reqInt(o.research, "economy.research"),
    sold: sold.map((s, i) => {
      const path = `economy.sold[${i}]`;
      const so = reqExactObject(s, path, ["disease", "count"]);
      return {
        disease: reqInt(so.disease, `${path}.disease`),
        count: reqInt(so.count, `${path}.count`),
      };
    }),
  };
}

function parsePatents(v: unknown): PatentState {
  const o = reqExactObject(v, "patents", ["unlocked"]);
  const unlocked = reqArray(o.unlocked, "patents.unlocked");
  if (unlocked.length > DEFAULT_PATENTS.length) {
    throw new SaveError("patents.unlocked: count exceeds patent tree");
  }
  return {
    unlocked: unlocked.map((u, i) => reqString(u, `patents.unlocked[${i}]`)),
  };
}

function parseMachine(v: unknown, path: string): Machine {
  const o = reqExactObject(v, path, ["typeId", "path"]);
  return {
    typeId: reqString(o.typeId, `${path}.typeId`),
    path: parsePathStamp(o.path, `${path}.path`),
  };
}

function parseTemplate(v: unknown, path: string): Template {
  const o = reqExactObject(v, path, ["steps"]);
  const steps = reqArray(o.steps, `${path}.steps`);
  if (steps.length > MAX_TEMPLATE_STEPS) {
    throw new SaveError(`${path}.steps: exceeds ${MAX_TEMPLATE_STEPS}`);
  }
  return {
    steps: steps.map((machine, i) =>
      parseMachine(machine, `${path}.steps[${i}]`),
    ),
  };
}

function parseDrugState(v: unknown, path: string, expectedMaps?: number): DrugState {
  const o = reqExactObject(v, path, ["pos", "failed"]);
  const pos = reqArray(o.pos, `${path}.pos`);
  if (expectedMaps !== undefined && pos.length !== expectedMaps) {
    throw new SaveError(`${path}.pos: map count mismatch`);
  }
  return {
    pos: pos.map((p, i) => parseHexCoord(p, `${path}.pos[${i}]`)),
    failed: reqBool(o.failed, `${path}.failed`),
  };
}

function parseOutcome(v: unknown, path: string, expectedMaps: number): Outcome {
  const o = reqExactObject(v, path, ["failed", "final", "cured", "sideEffects"]);
  const final = reqArray(o.final, `${path}.final`);
  const cured = reqArray(o.cured, `${path}.cured`);
  const sideEffects = reqArray(o.sideEffects, `${path}.sideEffects`);
  if (
    final.length !== expectedMaps ||
    cured.length > expectedMaps ||
    sideEffects.length > expectedMaps
  ) {
    throw new SaveError(`${path}: outcome collection exceeds map count`);
  }
  return {
    failed: reqBool(o.failed, `${path}.failed`),
    final: final.map((p, i) => parseHexCoord(p, `${path}.final[${i}]`)),
    cured: cured.map((id, i) => reqInt(id, `${path}.cured[${i}]`)),
    sideEffects: sideEffects.map((id, i) =>
      reqInt(id, `${path}.sideEffects[${i}]`),
    ),
  };
}

function parseTile(v: unknown, path: string): FactoryTile {
  const o = reqObject(v, path);
  const kind = reqString(o.kind, `${path}.kind`);
  switch (kind) {
    case "empty":
      requireExactKeys(o, ["kind"], path);
      return { kind: "empty" };
    case "belt":
      requireExactKeys(o, ["kind", "dir"], path);
      return { kind: "belt", dir: parseDir(o.dir, `${path}.dir`) };
    case "source":
      requireExactKeys(o, ["kind", "dir", "period"], path);
      return {
        kind: "source",
        dir: parseDir(o.dir, `${path}.dir`),
        period: reqInt(o.period, `${path}.period`),
      };
    case "sink":
      requireExactKeys(o, ["kind"], path);
      return { kind: "sink" };
    case "splitter":
      requireExactKeys(o, ["kind", "inDir", "outDirs"], path);
      if (reqArray(o.outDirs, `${path}.outDirs`).length > 6) {
        throw new SaveError(`${path}.outDirs: exceeds six directions`);
      }
      return {
        kind: "splitter",
        inDir: parseDir(o.inDir, `${path}.inDir`),
        outDirs: reqArray(o.outDirs, `${path}.outDirs`).map((d, i) =>
          parseDir(d, `${path}.outDirs[${i}]`),
        ),
      };
    case "merger":
      requireExactKeys(o, ["kind", "inDirs", "outDir"], path);
      if (reqArray(o.inDirs, `${path}.inDirs`).length > 6) {
        throw new SaveError(`${path}.inDirs: exceeds six directions`);
      }
      return {
        kind: "merger",
        inDirs: reqArray(o.inDirs, `${path}.inDirs`).map((d, i) =>
          parseDir(d, `${path}.inDirs[${i}]`),
        ),
        outDir: parseDir(o.outDir, `${path}.outDir`),
      };
    default:
      throw new SaveError(`${path}.kind: unknown FactoryTile kind "${kind}"`);
  }
}

function parseDir(v: unknown, path: string): Dir {
  const d = reqInt(v, path);
  if (d < 0 || d > 5) {
    throw new SaveError(`${path}: expected Dir 0..5, got ${d}`);
  }
  return d as Dir;
}

function parseMachineDef(v: unknown, path: string): FactoryMachineDef {
  const o = reqExactObject(v, path, ["typeId", "path", "cost", "speed"]);
  return {
    typeId: reqString(o.typeId, `${path}.typeId`),
    path: parsePathStamp(o.path, `${path}.path`),
    cost: reqNumber(o.cost, `${path}.cost`),
    speed: reqInt(o.speed, `${path}.speed`),
  };
}

function parsePort(v: unknown, path: string): Port {
  const o = reqExactObject(v, path, ["cell", "side"]);
  return { cell: parseHexCoord(o.cell, `${path}.cell`), side: parseDir(o.side, `${path}.side`) };
}

function parseShape(v: unknown, path: string): MachineShape {
  const o = reqExactObject(v, path, ["cells", "inPorts", "outPorts"]);
  const cells = reqArray(o.cells, `${path}.cells`);
  const inPorts = reqArray(o.inPorts, `${path}.inPorts`);
  const outPorts = reqArray(o.outPorts, `${path}.outPorts`);
  if (
    cells.length < 1 ||
    cells.length > MAX_MACHINE_SHAPE_CELLS ||
    inPorts.length > MAX_MACHINE_PORTS ||
    outPorts.length > MAX_MACHINE_PORTS
  ) {
    throw new SaveError(`${path}: shape or port count exceeds bounds`);
  }
  return {
    cells: cells.map((c, i) => parseHexCoord(c, `${path}.cells[${i}]`)),
    inPorts: inPorts.map((p, i) => parsePort(p, `${path}.inPorts[${i}]`)),
    outPorts: outPorts.map((p, i) =>
      parsePort(p, `${path}.outPorts[${i}]`),
    ),
  };
}

function parsePlacedMachine(v: unknown, path: string): PlacedMachine {
  const o = reqExactObject(v, path, ["id", "def", "anchor", "footRot", "shape"]);
  const footRot = parseDir(o.footRot, `${path}.footRot`);
  return {
    id: reqInt(o.id, `${path}.id`),
    def: parseMachineDef(o.def, `${path}.def`),
    anchor: parseHexCoord(o.anchor, `${path}.anchor`),
    footRot,
    shape: parseShape(o.shape, `${path}.shape`),
  };
}

function parseFactory(v: unknown, path = "factory"): FactoryLayout {
  const o = reqExactObject(v, path, ["width", "height", "tiles", "machines"]);
  const width = reqInt(o.width, `${path}.width`);
  const height = reqInt(o.height, `${path}.height`);
  const cellCount = width * height;
  if (
    width > MAX_GAME_FACTORY_DIMENSION ||
    height > MAX_GAME_FACTORY_DIMENSION ||
    !Number.isSafeInteger(cellCount) ||
    cellCount < 1 ||
    cellCount > MAX_GAME_FACTORY_CELLS
  ) {
    throw new SaveError(
      `${path}: dimensions exceed ${MAX_GAME_FACTORY_DIMENSION} per side or ` +
        `${MAX_GAME_FACTORY_CELLS} cells`,
    );
  }
  const tiles = reqArray(o.tiles, `${path}.tiles`);
  if (tiles.length !== cellCount) {
    throw new SaveError(
      `${path}.tiles: length ${tiles.length} !== width*height (${width}*${height}=${width * height})`,
    );
  }
  const parsedTiles = tiles.map((t, i) => parseTile(t, `${path}.tiles[${i}]`));
  const machines = reqArray(o.machines, `${path}.machines`);
  if (machines.length > MAX_FACTORY_MACHINES || machines.length > cellCount) {
    throw new SaveError(`${path}.machines: count exceeds bounded cell capacity`);
  }
  let totalShapeCells = 0;
  let totalInPorts = 0;
  let totalOutPorts = 0;
  for (let index = 0; index < machines.length; index++) {
    const machine = reqObject(machines[index], `${path}.machines[${index}]`);
    const shape = reqObject(machine.shape, `${path}.machines[${index}].shape`);
    const cells = reqArray(shape.cells, `${path}.machines[${index}].shape.cells`);
    const inPorts = reqArray(shape.inPorts, `${path}.machines[${index}].shape.inPorts`);
    const outPorts = reqArray(shape.outPorts, `${path}.machines[${index}].shape.outPorts`);
    if (
      cells.length < 1 ||
      cells.length > MAX_MACHINE_SHAPE_CELLS ||
      inPorts.length > MAX_MACHINE_PORTS ||
      outPorts.length > MAX_MACHINE_PORTS
    ) {
      throw new SaveError(`${path}.machines[${index}].shape: geometry exceeds bounds`);
    }
    totalShapeCells += cells.length;
    totalInPorts += inPorts.length;
    totalOutPorts += outPorts.length;
  }
  if (
    totalShapeCells > cellCount ||
    totalInPorts > MAX_FACTORY_PORTS ||
    totalOutPorts > MAX_FACTORY_PORTS
  ) {
    throw new SaveError(`${path}.machines: aggregate geometry exceeds factory bounds`);
  }
  return {
    width,
    height,
    tiles: parsedTiles,
    machines: machines.map((m, i) => parsePlacedMachine(m, `${path}.machines[${i}]`)),
  };
}

function parseNullableFactory(v: unknown, path = "factory"): FactoryLayout | null {
  return v === null ? null : parseFactory(v, path);
}

function parseUnit(v: unknown, path: string, expectedMaps: number): Unit {
  const o = reqExactObject(v, path, [
    "id",
    "pos",
    "drug",
    "proc",
    "machineId",
    "productionCost",
  ]);
  return {
    id: reqInt(o.id, `${path}.id`),
    pos: parseHexCoord(o.pos, `${path}.pos`),
    drug: parseDrugState(o.drug, `${path}.drug`, expectedMaps),
    proc: reqInt(o.proc, `${path}.proc`),
    machineId: o.machineId === null ? null : reqInt(o.machineId, `${path}.machineId`),
    productionCost: reqInt(o.productionCost, `${path}.productionCost`),
  };
}

function parseProducedUnit(v: unknown, path: string, expectedMaps: number): ProducedUnit {
  const o = reqExactObject(v, path, ["id", "drug", "productionCost"]);
  return {
    id: reqInt(o.id, `${path}.id`),
    drug: parseDrugState(o.drug, `${path}.drug`, expectedMaps),
    productionCost: reqInt(o.productionCost, `${path}.productionCost`),
  };
}

function parseFactorySnapshot(
  v: unknown,
  path: string,
  factory: FactoryLayout,
  expectedMaps: number,
): FactoryState {
  const o = reqExactObject(v, path, [
    "tick",
    "units",
    "nextUnitId",
    "producedTotal",
    "splitterCursors",
    "producedEvents",
    "deadlocked",
  ]);
  const units = reqArray(o.units, `${path}.units`);
  const splitterCursors = reqArray(o.splitterCursors, `${path}.splitterCursors`);
  const producedEvents = reqArray(o.producedEvents, `${path}.producedEvents`);
  const capacity = factory.machines.length + factory.tiles.reduce(
    (count, tile) => count + (
      tile.kind === "belt" || tile.kind === "splitter" || tile.kind === "merger" ? 1 : 0
    ),
    0,
  );
  const splitterCount = factory.tiles.reduce(
    (count, tile) => count + (tile.kind === "splitter" ? 1 : 0),
    0,
  );
  if (units.length > capacity) throw new SaveError(`${path}.units: exceeds runtime capacity`);
  if (splitterCursors.length !== splitterCount) {
    throw new SaveError(`${path}.splitterCursors: count does not match layout`);
  }
  if (producedEvents.length !== 0) {
    throw new SaveError(`${path}.producedEvents: product events must be drained before save`);
  }
  return {
    tick: reqInt(o.tick, `${path}.tick`),
    units: units.map((unit, i) => parseUnit(unit, `${path}.units[${i}]`, expectedMaps)),
    nextUnitId: reqInt(o.nextUnitId, `${path}.nextUnitId`),
    producedTotal: reqInt(o.producedTotal, `${path}.producedTotal`),
    splitterCursors: splitterCursors.map((cursor, i) =>
      reqInt(cursor, `${path}.splitterCursors[${i}]`),
    ),
    producedEvents: producedEvents.map((product, i) =>
      parseProducedUnit(product, `${path}.producedEvents[${i}]`, expectedMaps),
    ),
    deadlocked: reqBool(o.deadlocked, `${path}.deadlocked`),
  };
}

function validateFactorySnapshot(
  snapshot: FactoryState,
  factory: FactoryLayout,
  nMaps: number,
  path: string,
): void {
  const nonNegative = (value: number, path: string): void => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SaveError(`${path}: expected non-negative safe integer, got ${value}`);
    }
  };
  nonNegative(snapshot.tick, `${path}.tick`);
  nonNegative(snapshot.nextUnitId, `${path}.nextUnitId`);
  nonNegative(snapshot.producedTotal, `${path}.producedTotal`);
  const splitters = factory.tiles.filter((tile) => tile.kind === "splitter");
  if (snapshot.splitterCursors.length !== splitters.length) {
    throw new SaveError(`${path}.splitterCursors: count does not match layout`);
  }
  for (let slot = 0; slot < snapshot.splitterCursors.length; slot++) {
    const cursor = snapshot.splitterCursors[slot] ?? -1;
    const splitter = splitters[slot];
    if (splitter?.kind !== "splitter" || cursor < 0 || cursor >= splitter.outDirs.length) {
      throw new SaveError(`${path}.splitterCursors[${slot}]: outside output range`);
    }
  }
  if (snapshot.producedEvents.length !== 0) {
    throw new SaveError(`${path}.producedEvents: product events must be drained before save`);
  }
  if (snapshot.nextUnitId !== snapshot.units.length + snapshot.producedTotal) {
    throw new SaveError(`${path}: mass conservation does not match nextUnitId`);
  }
  let previousId = -1;
  const machineIds = new Set(factory.machines.map((machine) => machine.id));
  for (let index = 0; index < snapshot.units.length; index++) {
    const unit = snapshot.units[index];
    if (unit === undefined) continue;
    nonNegative(unit.id, `${path}.units[${index}].id`);
    nonNegative(unit.proc, `${path}.units[${index}].proc`);
    nonNegative(unit.productionCost, `${path}.units[${index}].productionCost`);
    if (unit.proc > 0x7fff_ffff || unit.productionCost > 0x7fff_ffff) {
      throw new SaveError(`${path}.units[${index}]: progress or production cost exceeds int32`);
    }
    if (unit.id <= previousId) {
      throw new SaveError(`${path}.units[${index}].id: ids must be unique and sorted`);
    }
    previousId = unit.id;
    if (
      !Number.isSafeInteger(unit.pos.q) ||
      !Number.isSafeInteger(unit.pos.r) ||
      unit.pos.q < 0 ||
      unit.pos.r < 0 ||
      unit.pos.q >= factory.width ||
      unit.pos.r >= factory.height
    ) {
      throw new SaveError(`${path}.units[${index}].pos: outside factory layout`);
    }
    if (unit.machineId !== null && !machineIds.has(unit.machineId)) {
      throw new SaveError(`${path}.units[${index}].machineId: unknown machine`);
    }
    if (unit.drug.pos.length !== nMaps) {
      throw new SaveError(`${path}.units[${index}].drug: map count mismatch`);
    }
  }
}

function parseInventory(v: unknown, expectedMaps: number): InventoryProduct[] {
  const inventory = reqArray(v, "inventory");
  if (inventory.length > MAX_GAME_INVENTORY_PRODUCTS) {
    throw new SaveError(`inventory: exceeds ${MAX_GAME_INVENTORY_PRODUCTS} physical products`);
  }
  return inventory.map((value, i) => {
    const path = `inventory[${i}]`;
    const o = reqExactObject(value, path, [
      "id",
      "drug",
      "productionCost",
      "inventoryId",
      "outcome",
    ]);
    return {
      id: reqInt(o.id, `${path}.id`),
      drug: parseDrugState(o.drug, `${path}.drug`, expectedMaps),
      productionCost: reqInt(o.productionCost, `${path}.productionCost`),
      inventoryId: reqInt(o.inventoryId, `${path}.inventoryId`),
      outcome: parseOutcome(o.outcome, `${path}.outcome`, expectedMaps),
    };
  });
}

function parseFog(v: unknown, genOptions: GenOptions): Uint8Array[] {
  const maps = reqArray(v, "fog");
  if (maps.length !== genOptions.nMaps) {
    throw new SaveError(`fog: map count ${maps.length} !== genOptions.nMaps ${genOptions.nMaps}`);
  }
  const expectedCells = genOptions.width * genOptions.height;
  return maps.map((value, mapIndex) => {
    const path = `fog[${mapIndex}]`;
    const rawValues = reqArray(value, path);
    if (rawValues.length !== expectedCells) {
      throw new SaveError(`${path}: length ${rawValues.length} !== ${expectedCells}`);
    }
    const values = rawValues.map((cell, i) => {
      const bit = reqInt(cell, `${path}[${i}]`);
      if (bit !== 0 && bit !== 1) throw new SaveError(`${path}[${i}]: expected 0 or 1, got ${bit}`);
      return bit;
    });
    return Uint8Array.from(values);
  });
}

function parseRng(v: unknown): RngState {
  const o = reqExactObject(v, "rng", ["s"]);
  return { s: reqInt(o.s, "rng.s") };
}

function parseResearchFacility(v: unknown, expectedMaps: number): GameState["research"] {
  const path = "research";
  const o = reqExactObject(v, path, ["program", "shot", "lastOutcome", "discoveredFormulas"]);
  const discoveredFormulas = reqArray(o.discoveredFormulas, `${path}.discoveredFormulas`);
  if (discoveredFormulas.length > MAX_GENERATION_DISEASES) {
    throw new SaveError(`${path}.discoveredFormulas: exceeds generated disease limit`);
  }
  const shotObject = o.shot === null
    ? null
    : reqExactObject(o.shot, `${path}.shot`, ["step", "drug", "cost"]);
  return {
    program: parseTemplate(o.program, `${path}.program`),
    shot: shotObject === null
      ? null
      : {
          step: reqInt(shotObject.step, `${path}.shot.step`),
          drug: parseDrugState(shotObject.drug, `${path}.shot.drug`, expectedMaps),
          cost: reqInt(shotObject.cost, `${path}.shot.cost`),
        },
    lastOutcome: o.lastOutcome === null
      ? null
      : parseOutcome(o.lastOutcome, `${path}.lastOutcome`, expectedMaps),
    discoveredFormulas: discoveredFormulas.map((value, index) => {
      const formulaPath = `${path}.discoveredFormulas[${index}]`;
      const formula = reqExactObject(value, formulaPath, [
        "disease",
        "program",
        "researchCost",
        "outcome",
      ]);
      return {
        disease: reqInt(formula.disease, `${formulaPath}.disease`),
        program: parseTemplate(formula.program, `${formulaPath}.program`),
        researchCost: reqInt(formula.researchCost, `${formulaPath}.researchCost`),
        outcome: parseOutcome(formula.outcome, `${formulaPath}.outcome`, expectedMaps),
      };
    }),
  };
}

function parsePilotFacility(v: unknown): GameState["pilot"] {
  const path = "pilot";
  const o = reqExactObject(v, path, ["layout"]);
  return {
    layout: parseNullableFactory(o.layout, `${path}.layout`),
  };
}

interface ParsedProductionFacility {
  readonly layout: FactoryLayout;
  readonly snapshot: FactoryState;
  readonly waste: number;
}

function parseProductionFacility(v: unknown, expectedMaps: number): ParsedProductionFacility {
  const path = "production";
  const o = reqExactObject(v, path, ["layout", "runtime", "waste"]);
  const layout = parseFactory(o.layout, `${path}.layout`);
  return {
    layout,
    snapshot: parseFactorySnapshot(o.runtime, `${path}.runtime`, layout, expectedMaps),
    waste: reqInt(o.waste, `${path}.waste`),
  };
}

function parseGameState(v: unknown): GameState {
  const o = reqExactObject(v, "game", [
    "genOptions",
    "economy",
    "patents",
    "research",
    "pilot",
    "production",
    "inventory",
    "nextInventoryId",
    "fog",
    "rng",
  ]);
  const genOptions = parseGenOptions(o.genOptions);
  const fog = parseFog(o.fog, genOptions);
  if (fog.length !== genOptions.nMaps) {
    throw new SaveError(`fog: map count ${fog.length} !== genOptions.nMaps ${genOptions.nMaps}`);
  }
  const expectedCells = genOptions.width * genOptions.height;
  for (let i = 0; i < fog.length; i++) {
    if (fog[i]?.length !== expectedCells) {
      throw new SaveError(`fog[${i}]: length ${fog[i]?.length ?? 0} !== ${expectedCells}`);
    }
  }
  const research = parseResearchFacility(o.research, genOptions.nMaps);
  const pilot = parsePilotFacility(o.pilot);
  const production = parseProductionFacility(o.production, genOptions.nMaps);
  try {
    const patents = parsePatents(o.patents);
    requireEntitledFacilityLayout({ patents }, production.layout, "Production");
    if (pilot.layout !== null) requireEntitledFacilityLayout({ patents }, pilot.layout, "Pilot Plant");
    validateFactorySnapshot(
      production.snapshot,
      production.layout,
      genOptions.nMaps,
      "production.runtime",
    );
    const level = generate(genOptions);
    const parsed: GameState = {
      genOptions,
      economy: parseEconomy(o.economy, genOptions.diseaseCount),
      patents,
      research,
      pilot,
      production: {
        layout: production.layout,
        runtime: restoreFactory(
          production.layout,
          level.mm,
          level.start,
          production.snapshot,
        ),
        waste: production.waste,
      },
      inventory: parseInventory(o.inventory, genOptions.nMaps),
      nextInventoryId: reqInt(o.nextInventoryId, "nextInventoryId"),
      fog,
      rng: parseRng(o.rng),
    };
    return validateGameState(parsed);
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(`game: ${(error as Error).message}`);
  }
}

function snapshot(game: GameState) {
  return {
    ...game,
    production: { ...game.production, runtime: snapshotFactory(game.production.runtime) },
  };
}

function encode(payload: Record<string, unknown>): string {
  const serialized = canonical({ version: SAVE_VERSION, contentBuild: SAVE_CONTENT_BUILD, ...payload });
  if (serialized.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  return serialized;
}

function decode(serialized: string, field: string): unknown {
  if (serialized.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new SaveError(`malformed save: invalid JSON (${(error as Error).message})`);
  }
  const envelope = reqObject(parsed, "save");
  if (!("version" in envelope)) throw new SaveError("save: missing version");
  const version = reqInt(envelope.version, "save.version");
  if (version !== SAVE_VERSION) {
    throw new SaveError(`save: incompatible version ${version} (expected ${SAVE_VERSION}); alpha saves are not migrated`);
  }
  requireExactKeys(envelope, ["version", "contentBuild", field], "save");
  if (envelope.contentBuild !== SAVE_CONTENT_BUILD) {
    throw new SaveError("save: incompatible content build");
  }
  return envelope[field];
}

export const serializeGame: SerializeGameFn = (game) => {
  try {
    return encode({ game: snapshot(validateGameState(game)) });
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(`game: ${(error as Error).message}`);
  }
};

export const deserializeGame: DeserializeGameFn = (serialized) =>
  parseGameState(decode(serialized, "game"));

interface InventoryGroup {
  readonly drug: DrugState;
  readonly productionCost: number;
  readonly outcome: Outcome;
  readonly ids: [number, number][];
}

export function prepareSnapshot(game: GameState): PreparedSnapshot {
  const owned = validateGameState(game);
  const state = snapshot(owned);
  const inventory: InventoryGroup[] = [];
  let previous = "";
  for (const product of state.inventory) {
    const payload = { drug: product.drug, productionCost: product.productionCost, outcome: product.outcome };
    const key = canonical(payload);
    if (key !== previous) inventory.push({ ...payload, ids: [] });
    inventory[inventory.length - 1]!.ids.push([product.id, product.inventoryId]);
    previous = key;
  }
  return { game: owned, serialized: encode({ snapshot: { ...state, inventory } }) };
}

export function deserializeSnapshot(serialized: string): GameState {
  const state = reqObject(decode(serialized, "snapshot"), "snapshot");
  const groups = reqArray(state.inventory, "snapshot.inventory");
  if (groups.length > MAX_GAME_INVENTORY_PRODUCTS) {
    throw new SaveError("snapshot.inventory: exceeds physical product limit");
  }
  let count = 0;
  const parsed = groups.map((value, index) => {
    const path = `snapshot.inventory[${index}]`;
    const group = reqExactObject(value, path, ["drug", "productionCost", "outcome", "ids"]);
    const ids = reqArray(group.ids, `${path}.ids`);
    count += ids.length;
    if (ids.length === 0 || count > MAX_GAME_INVENTORY_PRODUCTS) {
      throw new SaveError("snapshot.inventory: empty group or exceeds physical product limit");
    }
    return { group, ids, path };
  });
  const inventory = parsed.flatMap(({ group, ids, path }) => ids.map((value, index) => {
    const pair = reqArray(value, `${path}.ids[${index}]`);
    if (pair.length !== 2) throw new SaveError(`${path}.ids[${index}]: expected two IDs`);
    return {
      id: reqInt(pair[0], `${path}.ids[${index}][0]`),
      inventoryId: reqInt(pair[1], `${path}.ids[${index}][1]`),
      drug: group.drug, productionCost: group.productionCost, outcome: group.outcome,
    };
  }));
  return parseGameState({ ...state, inventory });
}

export function serializeSnapshot(game: GameState): string {
  return prepareSnapshot(game).serialized;
}

export const serializeSlots = (states: readonly GameState[]): string => {
  if (states.length > MAX_SLOT_STATES) {
    throw new SaveError(`slots: state count exceeds ${MAX_SLOT_STATES}`);
  }
  return encode({ slots: states.map((state) => snapshot(validateGameState(state))) });
};

export const deserializeSlots = (serialized: string): GameState[] => {
  const states = reqArray(decode(serialized, "slots"), "slots");
  if (states.length > MAX_SLOT_STATES) {
    throw new SaveError(`slots: state count exceeds ${MAX_SLOT_STATES}`);
  }
  return states.map(parseGameState);
};

/** Push a snapshot onto a rewind history (returns a new array; does not mutate). */
export const pushSnapshot = (history: readonly GameState[], g: GameState): GameState[] => {
  try {
    return [...history.slice(-(MAX_SLOT_STATES - 1)), validateGameState(g)];
  } catch (error) {
    throw new SaveError(`game: ${(error as Error).message}`);
  }
};

/**
 * Rewind to the snapshot `stepsBack` before the latest (default 1 = previous).
 * Returns the recalled state and the truncated history ending at that state.
 */
export const rewind = (
  history: readonly GameState[],
  stepsBack = 1,
): { state: GameState; history: GameState[] } => {
  if (!Number.isInteger(stepsBack) || stepsBack < 0) {
    throw new SaveError(`rewind: stepsBack must be a non-negative integer, got ${stepsBack}`);
  }
  const idx = history.length - 1 - stepsBack;
  const state = history[idx];
  if (idx < 0 || state === undefined) {
    throw new SaveError(`rewind: cannot go back ${stepsBack} from history of length ${history.length}`);
  }
  return {
    state: validateGameState(state),
    history: history.slice(0, idx + 1),
  };
};
