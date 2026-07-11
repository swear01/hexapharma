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
  GameIntent,
  SerializeGameFn,
  DeserializeGameFn,
} from "../phase0_interfaces";
import {
  MAX_FACTORY_MACHINES,
  MAX_FACTORY_PORTS,
  MAX_MACHINE_PORTS,
  MAX_MACHINE_SHAPE_CELLS,
  MAX_TEMPLATE_STEPS,
  MAX_BULK_SALE_PRODUCTS,
  MAX_GAME_INVENTORY_PRODUCTS,
  MAX_GAME_FACTORY_CELLS,
  MAX_GAME_FACTORY_DIMENSION,
  MAX_GAME_REPLAY_WORK,
  MAX_REWIND_HISTORY_REPLAY_TICKS,
  MAX_REWIND_HISTORY_REPLAY_WORK,
  MAX_REWIND_HISTORY_TRACE_ENTRIES,
} from "../phase0_interfaces";
import { restoreFactory, snapshotFactory } from "../factory-sim";
import { MAX_GENERATION_CATALOG_ENTRIES, generate } from "../mapgen";
import { DEFAULT_PATENTS } from "../patent";
import {
  MAX_INTENT_TRACE,
  MAX_REPLAY_TICKS,
  applyGameIntent,
  createGameState,
  hashGame,
  validateFactoryLayout,
  validateGameState,
} from "../game";
import { estimateGameReplayWork } from "../replay-work";

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

export const SAVE_VERSION = 3;
export const MAX_SLOT_STATES = 20;
export const MAX_SAVE_CHARACTERS = 5_000_000;

/** Tag carried by every serialized blob. Bump on incompatible format changes. */
interface SaveEnvelope {
  readonly version: number;
  readonly game: unknown;
}

interface AuthorityPayload {
  readonly origin: GameState["origin"];
  readonly intentTrace: GameState["intentTrace"];
  readonly replayTicks: number;
  readonly stateHash: number;
}

export interface GameAuthorityWork {
  readonly replayTicks: number;
  readonly intentCount: number;
  readonly replayWork: number;
}

export interface PreparedGameAuthority {
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

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function reqObject(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) throw new SaveError(`${path}: expected object, got ${describe(v)}`);
  return v;
}

function reqArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new SaveError(`${path}: expected array, got ${describe(v)}`);
  return v;
}

function reqInt(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new SaveError(`${path}: expected integer, got ${describe(v)}`);
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

function parseVec2(v: unknown, path: string): { x: number; y: number } {
  const o = reqObject(v, path);
  return { x: reqInt(o.x, `${path}.x`), y: reqInt(o.y, `${path}.y`) };
}

function parseGenOptions(v: unknown, path = "genOptions"): GenOptions {
  const o = reqObject(v, path);
  const diff = reqObject(o.difficulty, `${path}.difficulty`);
  return {
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
}

function parseTransform(v: unknown, path: string): GenOptions["catalog"][number]["transform"] {
  const o = reqObject(v, path);
  const kind = reqString(o.kind, `${path}.kind`);
  switch (kind) {
    case "translate": {
      const rel = reqString(o.relation, `${path}.relation`);
      if (rel !== "forward" && rel !== "reverse" && rel !== "perpendicular" && rel !== "offset") {
        throw new SaveError(`${path}.relation: unknown TranslateRelation "${rel}"`);
      }
      return { kind: "translate", delta: parseVec2(o.delta, `${path}.delta`), relation: rel };
    }
    case "scale":
      return { kind: "scale", num: reqInt(o.num, `${path}.num`), den: reqInt(o.den, `${path}.den`) };
    case "swap":
      return { kind: "swap", a: reqInt(o.a, `${path}.a`), b: reqInt(o.b, `${path}.b`) };
    default:
      throw new SaveError(`${path}.kind: unknown Transform kind "${kind}"`);
  }
}

function parseCatalog(v: unknown, catalogPath: string): GenOptions["catalog"] {
  const arr = reqArray(v, catalogPath);
  if (arr.length > MAX_GENERATION_CATALOG_ENTRIES) {
    throw new SaveError(`${catalogPath}: exceeds ${MAX_GENERATION_CATALOG_ENTRIES} entries`);
  }
  return arr.map((e, i) => {
    const path = `${catalogPath}[${i}]`;
    const o = reqObject(e, path);
    return {
      typeId: reqString(o.typeId, `${path}.typeId`),
      transform: parseTransform(o.transform, `${path}.transform`),
      cost: reqNumber(o.cost, `${path}.cost`),
      speed: reqInt(o.speed, `${path}.speed`),
      orientable: reqBool(o.orientable, `${path}.orientable`),
    };
  });
}

function parseEconomy(v: unknown, diseaseCount: number): EconomyState {
  const o = reqObject(v, "economy");
  const sold = reqArray(o.sold, "economy.sold");
  if (sold.length > diseaseCount) {
    throw new SaveError("economy.sold: count exceeds generated diseases");
  }
  return {
    cash: reqInt(o.cash, "economy.cash"),
    research: reqInt(o.research, "economy.research"),
    sold: sold.map((s, i) => {
      const path = `economy.sold[${i}]`;
      const so = reqObject(s, path);
      return {
        disease: reqInt(so.disease, `${path}.disease`),
        count: reqInt(so.count, `${path}.count`),
      };
    }),
  };
}

function parsePatents(v: unknown): PatentState {
  const o = reqObject(v, "patents");
  const unlocked = reqArray(o.unlocked, "patents.unlocked");
  if (unlocked.length > DEFAULT_PATENTS.length) {
    throw new SaveError("patents.unlocked: count exceeds patent tree");
  }
  return {
    unlocked: unlocked.map((u, i) => reqString(u, `patents.unlocked[${i}]`)),
  };
}

function parseOrientation(v: unknown, path: string): { rot: 0 | 1 | 2 | 3; flip: boolean } {
  const o = reqObject(v, path);
  const rot = reqInt(o.rot, `${path}.rot`);
  if (rot !== 0 && rot !== 1 && rot !== 2 && rot !== 3) {
    throw new SaveError(`${path}.rot: expected 0..3, got ${rot}`);
  }
  return { rot, flip: reqBool(o.flip, `${path}.flip`) };
}

function parseMachine(v: unknown, path: string): Machine {
  const o = reqObject(v, path);
  return {
    typeId: reqString(o.typeId, `${path}.typeId`),
    transform: parseTransform(o.transform, `${path}.transform`),
    orientation: parseOrientation(o.orientation, `${path}.orientation`),
  };
}

function parseTemplate(v: unknown, path: string): Template {
  const o = reqObject(v, path);
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
  const o = reqObject(v, path);
  const pos = reqArray(o.pos, `${path}.pos`);
  if (expectedMaps !== undefined && pos.length !== expectedMaps) {
    throw new SaveError(`${path}.pos: map count mismatch`);
  }
  return {
    pos: pos.map((p, i) => parseVec2(p, `${path}.pos[${i}]`)),
    failed: reqBool(o.failed, `${path}.failed`),
  };
}

function parseOutcome(v: unknown, path: string, expectedMaps: number): Outcome {
  const o = reqObject(v, path);
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
    final: final.map((p, i) => parseVec2(p, `${path}.final[${i}]`)),
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
      return { kind: "empty" };
    case "belt":
      return { kind: "belt", dir: parseDir(o.dir, `${path}.dir`) };
    case "source":
      return {
        kind: "source",
        dir: parseDir(o.dir, `${path}.dir`),
        period: reqInt(o.period, `${path}.period`),
      };
    case "sink":
      return { kind: "sink" };
    case "splitter":
      if (reqArray(o.outDirs, `${path}.outDirs`).length > 4) {
        throw new SaveError(`${path}.outDirs: exceeds four directions`);
      }
      return {
        kind: "splitter",
        inDir: parseDir(o.inDir, `${path}.inDir`),
        outDirs: reqArray(o.outDirs, `${path}.outDirs`).map((d, i) =>
          parseDir(d, `${path}.outDirs[${i}]`),
        ),
      };
    case "merger":
      if (reqArray(o.inDirs, `${path}.inDirs`).length > 4) {
        throw new SaveError(`${path}.inDirs: exceeds four directions`);
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

function parseDir(v: unknown, path: string): 0 | 1 | 2 | 3 {
  const d = reqInt(v, path);
  if (d !== 0 && d !== 1 && d !== 2 && d !== 3) {
    throw new SaveError(`${path}: expected Dir 0..3, got ${d}`);
  }
  return d;
}

function parseMachineDef(v: unknown, path: string): FactoryMachineDef {
  const o = reqObject(v, path);
  return {
    typeId: reqString(o.typeId, `${path}.typeId`),
    transform: parseTransform(o.transform, `${path}.transform`),
    orientation: parseOrientation(o.orientation, `${path}.orientation`),
    cost: reqNumber(o.cost, `${path}.cost`),
    speed: reqInt(o.speed, `${path}.speed`),
  };
}

function parsePort(v: unknown, path: string): Port {
  const o = reqObject(v, path);
  return { cell: parseVec2(o.cell, `${path}.cell`), side: parseDir(o.side, `${path}.side`) };
}

function parseShape(v: unknown, path: string): MachineShape {
  const o = reqObject(v, path);
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
    cells: cells.map((c, i) => parseVec2(c, `${path}.cells[${i}]`)),
    inPorts: inPorts.map((p, i) => parsePort(p, `${path}.inPorts[${i}]`)),
    outPorts: outPorts.map((p, i) =>
      parsePort(p, `${path}.outPorts[${i}]`),
    ),
  };
}

function parsePlacedMachine(v: unknown, path: string): PlacedMachine {
  const o = reqObject(v, path);
  const footRot = reqInt(o.footRot, `${path}.footRot`);
  if (footRot !== 0 && footRot !== 1 && footRot !== 2 && footRot !== 3) {
    throw new SaveError(`${path}.footRot: expected 0..3, got ${footRot}`);
  }
  return {
    id: reqInt(o.id, `${path}.id`),
    def: parseMachineDef(o.def, `${path}.def`),
    anchor: parseVec2(o.anchor, `${path}.anchor`),
    footRot,
    shape: parseShape(o.shape, `${path}.shape`),
  };
}

function parseFactory(v: unknown, path = "factory"): FactoryLayout {
  const o = reqObject(v, path);
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

function parseGameIntent(v: unknown, index: number, tracePath = "intentTrace"): GameIntent {
  const path = `${tracePath}[${index}]`;
  const o = reqObject(v, path);
  const kind = reqString(o.kind, `${path}.kind`);
  switch (kind) {
    case "saveRecipe":
      return { kind, recipe: parseTemplate(o.recipe, `${path}.recipe`) };
    case "setFactory":
      return { kind, factory: parseFactory(o.factory, `${path}.factory`) };
    case "factoryTicks":
      return { kind, ticks: reqInt(o.ticks, `${path}.ticks`) };
    case "resetFactory":
      return { kind };
    case "sellProduct":
      return {
        kind,
        productId: reqInt(o.productId, `${path}.productId`),
        disease: reqInt(o.disease, `${path}.disease`),
      };
    case "sellProducts": {
      const productIds = reqArray(o.productIds, `${path}.productIds`);
      if (productIds.length < 1 || productIds.length > MAX_BULK_SALE_PRODUCTS) {
        throw new SaveError(`${path}.productIds: exceeds bulk sale bounds`);
      }
      return {
        kind,
        productIds: productIds.map((id, product) =>
          reqInt(id, `${path}.productIds[${product}]`),
        ),
        disease: reqInt(o.disease, `${path}.disease`),
      };
    }
    case "runLab":
      return { kind, template: parseTemplate(o.template, `${path}.template`) };
    case "unlockPatent":
      return { kind, id: reqString(o.id, `${path}.id`) };
    default:
      throw new SaveError(`${path}.kind: unknown GameIntent kind "${kind}"`);
  }
}

function parseUnit(v: unknown, path: string, expectedMaps: number): Unit {
  const o = reqObject(v, path);
  return {
    id: reqInt(o.id, `${path}.id`),
    pos: parseVec2(o.pos, `${path}.pos`),
    drug: parseDrugState(o.drug, `${path}.drug`, expectedMaps),
    proc: reqInt(o.proc, `${path}.proc`),
    machineId: o.machineId === null ? null : reqInt(o.machineId, `${path}.machineId`),
    productionCost: reqInt(o.productionCost, `${path}.productionCost`),
  };
}

function parseProducedUnit(v: unknown, path: string, expectedMaps: number): ProducedUnit {
  const o = reqObject(v, path);
  return {
    id: reqInt(o.id, `${path}.id`),
    drug: parseDrugState(o.drug, `${path}.drug`, expectedMaps),
    productionCost: reqInt(o.productionCost, `${path}.productionCost`),
  };
}

function parseFactoryState(
  v: unknown,
  path: string,
  factory: FactoryLayout,
  expectedMaps: number,
): FactoryState {
  const o = reqObject(v, path);
  const units = reqArray(o.units, `${path}.units`);
  const splitterCursors = reqArray(o.splitterCursors, `${path}.splitterCursors`);
  const producedEvents = reqArray(o.producedEvents, `${path}.producedEvents`);
  const capacity = factory.width * factory.height + factory.machines.length;
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
): void {
  const nonNegative = (value: number, path: string): void => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new SaveError(`${path}: expected non-negative safe integer, got ${value}`);
    }
  };
  nonNegative(snapshot.tick, "factoryState.tick");
  nonNegative(snapshot.nextUnitId, "factoryState.nextUnitId");
  nonNegative(snapshot.producedTotal, "factoryState.producedTotal");
  const splitters = factory.tiles.filter((tile) => tile.kind === "splitter");
  if (snapshot.splitterCursors.length !== splitters.length) {
    throw new SaveError("factoryState.splitterCursors: count does not match layout");
  }
  for (let slot = 0; slot < snapshot.splitterCursors.length; slot++) {
    const cursor = snapshot.splitterCursors[slot] ?? -1;
    const splitter = splitters[slot];
    if (splitter?.kind !== "splitter" || cursor < 0 || cursor >= splitter.outDirs.length) {
      throw new SaveError(`factoryState.splitterCursors[${slot}]: outside output range`);
    }
  }
  if (snapshot.producedEvents.length !== 0) {
    throw new SaveError("factoryState.producedEvents: product events must be drained before save");
  }
  if (snapshot.nextUnitId !== snapshot.units.length + snapshot.producedTotal) {
    throw new SaveError("factoryState: mass conservation does not match nextUnitId");
  }
  let previousId = -1;
  const machineIds = new Set(factory.machines.map((machine) => machine.id));
  for (let index = 0; index < snapshot.units.length; index++) {
    const unit = snapshot.units[index];
    if (unit === undefined) continue;
    nonNegative(unit.id, `factoryState.units[${index}].id`);
    nonNegative(unit.proc, `factoryState.units[${index}].proc`);
    nonNegative(unit.productionCost, `factoryState.units[${index}].productionCost`);
    if (unit.id <= previousId) {
      throw new SaveError(`factoryState.units[${index}].id: ids must be unique and sorted`);
    }
    previousId = unit.id;
    if (
      !Number.isSafeInteger(unit.pos.x) ||
      !Number.isSafeInteger(unit.pos.y) ||
      unit.pos.x < 0 ||
      unit.pos.y < 0 ||
      unit.pos.x >= factory.width ||
      unit.pos.y >= factory.height
    ) {
      throw new SaveError(`factoryState.units[${index}].pos: outside factory layout`);
    }
    if (unit.machineId !== null && !machineIds.has(unit.machineId)) {
      throw new SaveError(`factoryState.units[${index}].machineId: unknown machine`);
    }
    if (unit.drug.pos.length !== nMaps) {
      throw new SaveError(`factoryState.units[${index}].drug: map count mismatch`);
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
    const o = reqObject(value, path);
    return {
      ...parseProducedUnit(value, path, expectedMaps),
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
  const o = reqObject(v, "rng");
  return { s: reqInt(o.s, "rng.s") };
}

function parseAuthorityPayload(v: unknown, path = "authority"): AuthorityPayload {
  const o = reqObject(v, path);
  const originObject = reqObject(o.origin, `${path}.origin`);
  const origin = {
    genOptions: parseGenOptions(originObject.genOptions, `${path}.origin.genOptions`),
    cash: reqInt(originObject.cash, `${path}.origin.cash`),
    research: reqInt(originObject.research, `${path}.origin.research`),
  };
  const rawIntentTrace = reqArray(o.intentTrace, `${path}.intentTrace`);
  if (rawIntentTrace.length > MAX_INTENT_TRACE) {
    throw new SaveError(`${path}.intentTrace: exceeds ${MAX_INTENT_TRACE} entries`);
  }
  return {
    origin,
    intentTrace: rawIntentTrace.map((intent, index) =>
      parseGameIntent(intent, index, `${path}.intentTrace`),
    ),
    replayTicks: reqInt(o.replayTicks, `${path}.replayTicks`),
    stateHash: reqInt(o.stateHash, `${path}.stateHash`),
  };
}

function restoreAuthority(payload: AuthorityPayload): GameState {
  let game = createGameState(
    payload.origin.genOptions,
    payload.origin.cash,
    payload.origin.research,
  );
  for (const intent of payload.intentTrace) game = applyGameIntent(game, intent);
  if (
    game.replayTicks !== payload.replayTicks ||
    canonical(game.intentTrace) !== canonical(payload.intentTrace)
  ) {
    throw new SaveError("authority: trace is not canonical or replay tick total does not match");
  }
  const canonicalGame = validateGameState(game);
  if (
    payload.stateHash < 0 ||
    payload.stateHash > 0xffff_ffff ||
    hashGame(canonicalGame) !== payload.stateHash
  ) {
    throw new SaveError("authority: replayed state hash does not match the saved build result");
  }
  return canonicalGame;
}

function parseAuthorityEnvelope(serialized: string): unknown {
  if (serialized.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`authority: save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new SaveError(`malformed authority: invalid JSON (${(error as Error).message})`);
  }
  const envelope = reqObject(parsed, "authority save");
  const version = reqInt(envelope.version, "authority save.version");
  if (version !== SAVE_VERSION) {
    throw new SaveError(
      `authority save: incompatible version ${version} (expected ${SAVE_VERSION})`,
    );
  }
  return envelope.authority;
}

function parseGameState(v: unknown): GameState {
  const o = reqObject(v, "game");
  const genOptions = parseGenOptions(o.genOptions);
  const originObject = reqObject(o.origin, "origin");
  const origin = {
    genOptions: parseGenOptions(originObject.genOptions, "origin.genOptions"),
    cash: reqInt(originObject.cash, "origin.cash"),
    research: reqInt(originObject.research, "origin.research"),
  };
  const rawIntentTrace = reqArray(o.intentTrace, "intentTrace");
  if (rawIntentTrace.length > MAX_INTENT_TRACE) {
    throw new SaveError(`intentTrace: exceeds ${MAX_INTENT_TRACE} entries`);
  }
  const intentTrace = rawIntentTrace.map((intent, index) => parseGameIntent(intent, index));
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
  const factory = parseNullableFactory(o.factory);
  if (o.factoryState !== null && factory === null) {
    throw new SaveError("factoryState: runtime requires a factory layout");
  }
  const factorySnapshot = o.factoryState === null || factory === null
    ? null
    : parseFactoryState(o.factoryState, "factoryState", factory, genOptions.nMaps);
  const parsed: GameState = {
    origin,
    intentTrace,
    replayTicks: reqInt(o.replayTicks, "replayTicks"),
    genOptions,
    economy: parseEconomy(o.economy, genOptions.diseaseCount),
    patents: parsePatents(o.patents),
    recipe: o.recipe === null ? null : parseTemplate(o.recipe, "recipe"),
    factory,
    factoryState: null,
    factoryWaste: reqInt(o.factoryWaste, "factoryWaste"),
    inventory: parseInventory(o.inventory, genOptions.nMaps),
    nextInventoryId: reqInt(o.nextInventoryId, "nextInventoryId"),
    fog,
    rng: parseRng(o.rng),
  };
  try {
    if (factorySnapshot === null) {
      return validateGameState(parsed);
    }
    if (factory === null) throw new Error("factory runtime requires a factory layout");
    validateFactoryLayout(parsed, factory);
    validateFactorySnapshot(factorySnapshot, factory, genOptions.nMaps);
    const level = generate(genOptions);
    const game: GameState = {
      ...parsed,
      factoryState: restoreFactory(factory, level.mm, level.start, factorySnapshot),
    };
    return validateGameState(game);
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(`game: ${(error as Error).message}`);
  }
}

// ── public API ──

export const serializeGame: SerializeGameFn = (g) => {
  try {
    validateGameState(g);
  } catch (error) {
    throw new SaveError(`game: ${(error as Error).message}`);
  }
  const game = {
    ...g,
    factoryState: g.factoryState === null ? null : snapshotFactory(g.factoryState),
  };
  const envelope: SaveEnvelope = { version: SAVE_VERSION, game };
  const serialized = canonical(envelope);
  if (serialized.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`game: save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  return serialized;
};

export const deserializeGame: DeserializeGameFn = (s) => {
  if (s.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`game: save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new SaveError(`malformed save: invalid JSON (${(e as Error).message})`);
  }
  const env = reqObject(parsed, "save");
  if (!("version" in env)) throw new SaveError("save: missing version tag");
  const version = reqInt(env.version, "save.version");
  if (version !== SAVE_VERSION) {
    throw new SaveError(`save: incompatible version ${version} (expected ${SAVE_VERSION})`);
  }
  if (!("game" in env)) throw new SaveError("save: missing game payload");
  inspectFullGameValue(env.game, "game");
  return parseGameState(env.game);
};

export function prepareGameAuthority(game: GameState): PreparedGameAuthority {
  let canonicalGame: GameState;
  try {
    canonicalGame = validateGameState(game);
  } catch (error) {
    throw new SaveError(`authority: ${(error as Error).message}`);
  }
  const serialized = canonical({
    version: SAVE_VERSION,
    authority: {
      origin: canonicalGame.origin,
      intentTrace: canonicalGame.intentTrace,
      replayTicks: canonicalGame.replayTicks,
      stateHash: hashGame(canonicalGame),
    },
  });
  if (serialized.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`authority: save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  return Object.freeze({ game: canonicalGame, serialized });
}

export function serializeGameAuthority(game: GameState): string {
  return prepareGameAuthority(game).serialized;
}

function computeAuthorityWork(
  origin: GenOptions,
  intentTrace: readonly GameIntent[],
  replayTicks: number,
  path: string,
): GameAuthorityWork {
  if (replayTicks < 0 || replayTicks > MAX_REPLAY_TICKS) {
    throw new SaveError(
      `${path}.replayTicks: expected 0..${MAX_REPLAY_TICKS}, got ${replayTicks}`,
    );
  }
  let computedReplayTicks = 0;
  for (let index = 0; index < intentTrace.length; index++) {
    const intent = intentTrace[index]!;
    if (intent.kind !== "factoryTicks") continue;
    if (intent.ticks <= 0 || intent.ticks > MAX_REPLAY_TICKS - computedReplayTicks) {
      throw new SaveError(
        `${path}.intentTrace[${index}].ticks: cumulative replay work exceeds ` +
          `${MAX_REPLAY_TICKS}`,
      );
    }
    computedReplayTicks += intent.ticks;
  }
  if (replayTicks !== computedReplayTicks) {
    throw new SaveError(
      `${path}.replayTicks: declared ${replayTicks} does not match computed trace total ` +
        `${computedReplayTicks}`,
    );
  }
  let replayWork: number;
  try {
    replayWork = estimateGameReplayWork(origin, intentTrace);
  } catch (error) {
    throw new SaveError(`${path} replay work: ${(error as Error).message}`);
  }
  if (replayWork > MAX_GAME_REPLAY_WORK) {
    throw new SaveError(`${path} replay work exceeds ${MAX_GAME_REPLAY_WORK}`);
  }
  return Object.freeze({
    replayTicks: computedReplayTicks,
    intentCount: intentTrace.length,
    replayWork,
  });
}

function inspectFullGameValue(value: unknown, path: string): GameAuthorityWork {
  const game = reqObject(value, path);
  const origin = reqObject(game.origin, `${path}.origin`);
  const genOptions = parseGenOptions(origin.genOptions, `${path}.origin.genOptions`);
  const rawIntentTrace = reqArray(game.intentTrace, `${path}.intentTrace`);
  if (rawIntentTrace.length > MAX_INTENT_TRACE) {
    throw new SaveError(`${path}.intentTrace: exceeds ${MAX_INTENT_TRACE} entries`);
  }
  const intentTrace = rawIntentTrace.map((intent, index) =>
    parseGameIntent(intent, index, `${path}.intentTrace`),
  );
  return computeAuthorityWork(
    genOptions,
    intentTrace,
    reqInt(game.replayTicks, `${path}.replayTicks`),
    path,
  );
}

function requireAggregateHistoryWork(
  work: readonly GameAuthorityWork[],
  path: string,
): void {
  if (work.length < 2) return;
  let replayTicks = 0;
  let intentCount = 0;
  let replayWork = 0;
  for (const entry of work) {
    replayTicks += entry.replayTicks;
    intentCount += entry.intentCount;
    replayWork += entry.replayWork;
  }
  if (replayTicks > MAX_REWIND_HISTORY_REPLAY_TICKS) {
    throw new SaveError(
      `${path}: aggregate replay ticks exceed ${MAX_REWIND_HISTORY_REPLAY_TICKS}`,
    );
  }
  if (intentCount > MAX_REWIND_HISTORY_TRACE_ENTRIES) {
    throw new SaveError(
      `${path}: aggregate trace entries exceed ${MAX_REWIND_HISTORY_TRACE_ENTRIES}`,
    );
  }
  if (replayWork > MAX_REWIND_HISTORY_REPLAY_WORK) {
    throw new SaveError(
      `${path}: aggregate replay work exceeds ${MAX_REWIND_HISTORY_REPLAY_WORK}`,
    );
  }
}

export function inspectGameAuthority(serialized: string): GameAuthorityWork {
  const payload = parseAuthorityPayload(parseAuthorityEnvelope(serialized));
  if (payload.stateHash < 0 || payload.stateHash > 0xffff_ffff) {
    throw new SaveError("authority.stateHash: expected a uint32 checksum");
  }
  return computeAuthorityWork(
    payload.origin.genOptions,
    payload.intentTrace,
    payload.replayTicks,
    "authority",
  );
}

export function deserializeGameAuthority(serialized: string): GameState {
  try {
    inspectGameAuthority(serialized);
    return restoreAuthority(parseAuthorityPayload(parseAuthorityEnvelope(serialized)));
  } catch (error) {
    if (error instanceof SaveError) throw error;
    throw new SaveError(`authority: ${(error as Error).message}`);
  }
}

// ── multi-save / rewind (snapshot history) ──
//
// A run keeps a list of GameState snapshots; rewind = drop back to an earlier one.
// serializeSlots/deserializeSlots persist the whole list as one versioned blob.

export const serializeSlots = (states: readonly GameState[]): string => {
  if (states.length > MAX_SLOT_STATES) {
    throw new SaveError(`slots: state count exceeds ${MAX_SLOT_STATES}`);
  }
  const work = states.map((state, index) =>
    computeAuthorityWork(
      state.origin.genOptions,
      state.intentTrace,
      state.replayTicks,
      `slots[${index}]`,
    ),
  );
  requireAggregateHistoryWork(work, "slots");
  const slots = states.map((state) => {
    try {
      validateGameState(state);
    } catch (error) {
      throw new SaveError(`game: ${(error as Error).message}`);
    }
    return {
      ...state,
      factoryState: state.factoryState === null ? null : snapshotFactory(state.factoryState),
    };
  });
  const envelope = { version: SAVE_VERSION, slots };
  const serialized = canonical(envelope);
  if (serialized.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`slots: save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  return serialized;
};

export const deserializeSlots = (s: string): GameState[] => {
  if (s.length > MAX_SAVE_CHARACTERS) {
    throw new SaveError(`slots: save exceeds ${MAX_SAVE_CHARACTERS} characters`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new SaveError(`malformed slots: invalid JSON (${(e as Error).message})`);
  }
  const env = reqObject(parsed, "slots");
  if (!("version" in env)) throw new SaveError("slots: missing version tag");
  const version = reqInt(env.version, "slots.version");
  if (version !== SAVE_VERSION) {
    throw new SaveError(`slots: incompatible version ${version} (expected ${SAVE_VERSION})`);
  }
  const arr = reqArray(env.slots, "slots.slots");
  if (arr.length > MAX_SLOT_STATES) {
    throw new SaveError(`slots: state count exceeds ${MAX_SLOT_STATES}`);
  }
  const work = arr.map((game, index) => inspectFullGameValue(game, `slots[${index}]`));
  requireAggregateHistoryWork(work, "slots");
  return arr.map((g, i) => parseGameState((reqObject({ game: g }, `slots[${i}]`)).game));
};

/** Push a snapshot onto a rewind history (returns a new array; does not mutate). */
export const pushSnapshot = (history: readonly GameState[], g: GameState): GameState[] => {
  try {
    return [...history, validateGameState(g)];
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
