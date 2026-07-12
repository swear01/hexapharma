import type {
  FactoryLayout,
  FactoryRuntime,
  FactoryTile,
  Dir,
  GameIntent as GameIntentContract,
  GameState,
  GeneratedLevel,
  GenOptions,
  InventoryProduct,
  Machine,
  MachineCatalogEntry,
  MultiMap,
  PatentState,
  Template,
} from "./phase0_interfaces";
import {
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  MAX_FACTORY_MACHINES,
  MAX_FACTORY_PORTS,
  MAX_GAME_FACTORY_CELLS,
  MAX_GAME_FACTORY_DIMENSION,
  MAX_GAME_MAP_CELLS,
  MAX_GAME_MAP_DIMENSION,
  MAX_MACHINE_PORTS,
  MAX_MACHINE_SHAPE_CELLS,
  MAX_TEMPLATE_STEPS,
  MAX_FACTORY_REPLAY_TICKS,
  MAX_GAME_INVENTORY_PRODUCTS,
  MAX_GAME_REPLAY_WORK,
  MAX_BULK_SALE_PRODUCTS,
} from "./phase0_interfaces";
import { evaluate, revealAlong } from "./drug-graph";
import { sellUnit } from "./economy";
import { MAX_GENERATION_CATALOG_ENTRIES, generate } from "./mapgen";
import { DEFAULT_PATENTS, activeEffects, unlockPatent } from "./patent";
import {
  clearFactoryProductEvents,
  initFactory,
  restoreFactory,
  snapshotFactory,
  stepFactory,
} from "./factory-sim";
import { derivePrototypeTemplate, factoryOutcome } from "./recipe";
import { hashInit, hashU32 } from "./hash";
import { worldCells } from "./factory-geom";
import { estimateGameReplayWork } from "./replay-work";

export const SIDE_EFFECT_PENALTY = 25;

export type GameIntent = GameIntentContract;

export const MAX_REPLAY_TICKS = MAX_FACTORY_REPLAY_TICKS;
export const MAX_INTENT_TRACE = 4_096;

function canonicalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function ownTransform(transform: Machine["transform"]): Machine["transform"] {
  if (transform.kind === "translate") {
    return Object.freeze({
      kind: "translate" as const,
      delta: Object.freeze({
        x: canonicalNumber(transform.delta.x),
        y: canonicalNumber(transform.delta.y),
      }),
      relation: transform.relation,
    });
  }
  if (transform.kind === "scale") {
    return Object.freeze({
      kind: "scale" as const,
      num: canonicalNumber(transform.num),
      den: canonicalNumber(transform.den),
    });
  }
  return Object.freeze({
    kind: "swap" as const,
    a: canonicalNumber(transform.a),
    b: canonicalNumber(transform.b),
  });
}

function ownMachine(machine: Machine): Machine {
  return Object.freeze({
    typeId: machine.typeId,
    transform: ownTransform(machine.transform),
    orientation: Object.freeze({
      rot: canonicalNumber(machine.orientation.rot) as Machine["orientation"]["rot"],
      flip: machine.orientation.flip,
    }),
  });
}

function ownTemplate(template: Template): Template {
  if (!Array.isArray(template.steps) || template.steps.length > MAX_TEMPLATE_STEPS) {
    throw new Error(`game intent: recipe must not exceed ${MAX_TEMPLATE_STEPS} steps`);
  }
  return Object.freeze({ steps: Object.freeze(template.steps.map(ownMachine)) });
}

function ownGenOptions(genOptions: GenOptions): GenOptions {
  if (
    !Array.isArray(genOptions.catalog) ||
    genOptions.catalog.length > MAX_GENERATION_CATALOG_ENTRIES
  ) {
    throw new Error(
      `game state: generation catalog must not exceed ${MAX_GENERATION_CATALOG_ENTRIES} entries`,
    );
  }
  return Object.freeze({
    seed: canonicalNumber(genOptions.seed),
    nMaps: canonicalNumber(genOptions.nMaps),
    width: canonicalNumber(genOptions.width),
    height: canonicalNumber(genOptions.height),
    catalog: Object.freeze(genOptions.catalog.map((entry) => Object.freeze({
      typeId: entry.typeId,
      transform: ownTransform(entry.transform),
      cost: canonicalNumber(entry.cost),
      speed: canonicalNumber(entry.speed),
      orientable: entry.orientable,
    }))),
    diseaseCount: canonicalNumber(genOptions.diseaseCount),
    difficulty: Object.freeze({
      min: canonicalNumber(genOptions.difficulty.min),
      max: canonicalNumber(genOptions.difficulty.max),
    }),
  });
}

function validateGameMapOptions(genOptions: GenOptions): void {
  const area = genOptions.width * genOptions.height;
  if (
    !Number.isSafeInteger(genOptions.width) ||
    !Number.isSafeInteger(genOptions.height) ||
    genOptions.width < 3 ||
    genOptions.height < 3 ||
    genOptions.width > MAX_GAME_MAP_DIMENSION ||
    genOptions.height > MAX_GAME_MAP_DIMENSION ||
    !Number.isSafeInteger(area) ||
    area > MAX_GAME_MAP_CELLS
  ) {
    throw new Error(
      `game state: map dimensions must fit ${MAX_GAME_MAP_DIMENSION}x` +
        `${MAX_GAME_MAP_DIMENSION} and ${MAX_GAME_MAP_CELLS} cells`,
    );
  }
}

function ownFactoryLayout(layout: FactoryLayout): FactoryLayout {
  const cellCount = layout.width * layout.height;
  if (
    !Number.isSafeInteger(cellCount) ||
    cellCount < 1 ||
    cellCount > MAX_GAME_FACTORY_CELLS ||
    layout.width > MAX_GAME_FACTORY_DIMENSION ||
    layout.height > MAX_GAME_FACTORY_DIMENSION ||
    !Array.isArray(layout.tiles) ||
    layout.tiles.length !== cellCount ||
    !Array.isArray(layout.machines) ||
    layout.machines.length > MAX_FACTORY_MACHINES ||
    layout.machines.length > cellCount
  ) {
    throw new Error(`game intent: factory layout exceeds bounded dimensions or machine count`);
  }
  let totalShapeCells = 0;
  let totalInPorts = 0;
  let totalOutPorts = 0;
  for (const placed of layout.machines) {
    if (
      !Array.isArray(placed.shape.cells) ||
      placed.shape.cells.length < 1 ||
      placed.shape.cells.length > MAX_MACHINE_SHAPE_CELLS ||
      !Array.isArray(placed.shape.inPorts) ||
      !Array.isArray(placed.shape.outPorts) ||
      placed.shape.inPorts.length > MAX_MACHINE_PORTS ||
      placed.shape.outPorts.length > MAX_MACHINE_PORTS
    ) {
      throw new Error(`game intent: machine ${placed.id} shape or port count exceeds bounds`);
    }
    totalShapeCells += placed.shape.cells.length;
    totalInPorts += placed.shape.inPorts.length;
    totalOutPorts += placed.shape.outPorts.length;
  }
  if (
    totalShapeCells > cellCount ||
    totalInPorts > MAX_FACTORY_PORTS ||
    totalOutPorts > MAX_FACTORY_PORTS
  ) {
    throw new Error("game intent: aggregate machine geometry exceeds factory bounds");
  }
  const tiles = layout.tiles.map((tile): FactoryTile => {
    switch (tile.kind) {
      case "empty":
      case "sink":
        return Object.freeze({ kind: tile.kind });
      case "belt":
        return Object.freeze({ kind: "belt", dir: canonicalNumber(tile.dir) as typeof tile.dir });
      case "source":
        return Object.freeze({
          kind: "source",
          dir: canonicalNumber(tile.dir) as typeof tile.dir,
          period: canonicalNumber(tile.period),
        });
      case "splitter":
        if (!Array.isArray(tile.outDirs) || tile.outDirs.length < 1 || tile.outDirs.length > 4) {
          throw new Error("game intent: factory splitter fan-out must contain 1..4 directions");
        }
        return Object.freeze({
          kind: "splitter",
          inDir: canonicalNumber(tile.inDir) as typeof tile.inDir,
          outDirs: Object.freeze(tile.outDirs.map((dir: number) => canonicalNumber(dir) as Dir)),
        });
      case "merger":
        if (!Array.isArray(tile.inDirs) || tile.inDirs.length < 1 || tile.inDirs.length > 4) {
          throw new Error("game intent: factory merger fan-in must contain 1..4 directions");
        }
        return Object.freeze({
          kind: "merger",
          inDirs: Object.freeze(tile.inDirs.map((dir: number) => canonicalNumber(dir) as Dir)),
          outDir: canonicalNumber(tile.outDir) as typeof tile.outDir,
        });
      default:
        throw new Error("game intent: factory tile has an unknown kind");
    }
  });
  const machines = layout.machines.map((placed) => Object.freeze({
    id: canonicalNumber(placed.id),
    def: Object.freeze({
      ...ownMachine(placed.def),
      cost: canonicalNumber(placed.def.cost),
      speed: canonicalNumber(placed.def.speed),
    }),
    anchor: Object.freeze({
      x: canonicalNumber(placed.anchor.x),
      y: canonicalNumber(placed.anchor.y),
    }),
    footRot: canonicalNumber(placed.footRot) as typeof placed.footRot,
    shape: Object.freeze({
      cells: Object.freeze(placed.shape.cells.map((cell: { readonly x: number; readonly y: number }) => Object.freeze({
        x: canonicalNumber(cell.x),
        y: canonicalNumber(cell.y),
      }))),
      inPorts: Object.freeze(placed.shape.inPorts.map((port: { readonly cell: { readonly x: number; readonly y: number }; readonly side: Dir }) => Object.freeze({
        cell: Object.freeze({
          x: canonicalNumber(port.cell.x),
          y: canonicalNumber(port.cell.y),
        }),
        side: canonicalNumber(port.side) as typeof port.side,
      }))),
      outPorts: Object.freeze(placed.shape.outPorts.map((port: { readonly cell: { readonly x: number; readonly y: number }; readonly side: Dir }) => Object.freeze({
        cell: Object.freeze({
          x: canonicalNumber(port.cell.x),
          y: canonicalNumber(port.cell.y),
        }),
        side: canonicalNumber(port.side) as typeof port.side,
      }))),
    }),
  }));
  return Object.freeze({
    width: canonicalNumber(layout.width),
    height: canonicalNumber(layout.height),
    tiles: Object.freeze(tiles),
    machines: Object.freeze(machines),
  });
}

function ownGameIntent(intent: GameIntent): GameIntent {
  switch (intent.kind) {
    case "saveRecipe":
      return Object.freeze({
        kind: "saveRecipe",
        recipe: ownTemplate(intent.recipe),
        factory: ownFactoryLayout(intent.factory),
      });
    case "setFactory":
      return Object.freeze({ kind: "setFactory", factory: ownFactoryLayout(intent.factory) });
    case "factoryTicks":
      return Object.freeze({ kind: "factoryTicks", ticks: canonicalNumber(intent.ticks) });
    case "resetFactory":
      return Object.freeze({ kind: "resetFactory" });
    case "sellProduct":
      return Object.freeze({
        kind: "sellProduct",
        productId: canonicalNumber(intent.productId),
        disease: canonicalNumber(intent.disease),
      });
    case "sellProducts":
      if (
        !Array.isArray(intent.productIds) ||
        intent.productIds.length < 1 ||
        intent.productIds.length > MAX_BULK_SALE_PRODUCTS
      ) {
        throw new Error(
          `game intent: bulk sale must contain 1..${MAX_BULK_SALE_PRODUCTS} product ids`,
        );
      }
      return Object.freeze({
        kind: "sellProducts",
        productIds: Object.freeze(intent.productIds.map(canonicalNumber)),
        disease: canonicalNumber(intent.disease),
      });
    case "runLab":
      return Object.freeze({ kind: "runLab", template: ownTemplate(intent.template) });
    case "unlockPatent":
      return Object.freeze({ kind: "unlockPatent", id: intent.id });
  }
}

const lockedByPatent = new Set(
  DEFAULT_PATENTS.flatMap((node) =>
    node.effect.kind === "unlockMachine" ? [node.effect.typeId] : [],
  ),
);
const levelCache = new WeakMap<GenOptions, GeneratedLevel>();

function levelFor(genOptions: GenOptions): GeneratedLevel {
  const cached = levelCache.get(genOptions);
  if (cached !== undefined) return cached;
  const level = generate(genOptions);
  levelCache.set(genOptions, level);
  return level;
}

export function availableCatalog(patents: PatentState): readonly MachineCatalogEntry[] {
  const unlocked = new Set(activeEffects(DEFAULT_PATENTS, patents).unlockedMachines);
  return DEFAULT_CATALOG.filter((entry) => !lockedByPatent.has(entry.typeId) || unlocked.has(entry.typeId));
}

function requireAllowedMachine(game: GameState, machine: Machine): MachineCatalogEntry {
  const entry = availableCatalog(game.patents).find((candidate) => candidate.typeId === machine.typeId);
  if (entry === undefined) throw new Error(`game intent: machine "${machine.typeId}" is locked`);
  if (
    !Number.isSafeInteger(machine.orientation.rot) ||
    machine.orientation.rot < 0 ||
    machine.orientation.rot > 3 ||
    typeof machine.orientation.flip !== "boolean"
  ) {
    throw new Error(`game intent: machine "${machine.typeId}" orientation is invalid`);
  }
  if (canonical(machine.transform) !== canonical(entry.transform)) {
    throw new Error(`game intent: machine "${machine.typeId}" transform does not match catalog`);
  }
  if (
    machine.transform.kind === "swap" &&
    (machine.transform.a >= game.genOptions.nMaps || machine.transform.b >= game.genOptions.nMaps)
  ) {
    throw new Error(`game intent: phase exchange "${machine.typeId}" addresses a locked layer`);
  }
  if (!entry.orientable && (machine.orientation.rot !== 0 || machine.orientation.flip)) {
    throw new Error(`game intent: machine "${machine.typeId}" orientation does not match catalog`);
  }
  return entry;
}

function requireAllowedTemplate(game: GameState, template: Template): void {
  if (!Array.isArray(template.steps)) throw new Error("game intent: recipe steps must be an array");
  if (template.steps.length > MAX_TEMPLATE_STEPS) {
    throw new Error(`game intent: recipe must not exceed ${MAX_TEMPLATE_STEPS} steps`);
  }
  for (const machine of template.steps) requireAllowedMachine(game, machine);
}

function requireDir(value: number, path: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new Error(`game intent: ${path} direction must be an integer from 0 to 3`);
  }
}

export function validateFactoryLayout(game: GameState, layout: FactoryLayout): void {
  if (
    !Number.isSafeInteger(layout.width) ||
    !Number.isSafeInteger(layout.height) ||
    layout.width <= 0 ||
    layout.height <= 0 ||
    layout.width > MAX_GAME_FACTORY_DIMENSION ||
    layout.height > MAX_GAME_FACTORY_DIMENSION ||
    layout.width * layout.height > MAX_GAME_FACTORY_CELLS
  ) {
    throw new Error(
      `game intent: factory dimensions must be positive, at most ` +
        `${MAX_GAME_FACTORY_DIMENSION} per side, and at most ${MAX_GAME_FACTORY_CELLS} cells`,
    );
  }
  if (!Array.isArray(layout.tiles) || !Array.isArray(layout.machines)) {
    throw new Error("game intent: factory tiles and machines must be arrays");
  }
  if (layout.tiles.length !== layout.width * layout.height) {
    throw new Error("game intent: factory tile count does not match its dimensions");
  }
  if (layout.machines.length > MAX_FACTORY_MACHINES || layout.machines.length > layout.tiles.length) {
    throw new Error("game intent: factory machine count exceeds its bounded cell capacity");
  }
  let totalShapeCells = 0;
  let totalInPorts = 0;
  let totalOutPorts = 0;
  for (const placed of layout.machines) {
    if (
      !Array.isArray(placed.shape.cells) ||
      !Array.isArray(placed.shape.inPorts) ||
      !Array.isArray(placed.shape.outPorts) ||
      placed.shape.cells.length < 1 ||
      placed.shape.cells.length > MAX_MACHINE_SHAPE_CELLS ||
      placed.shape.inPorts.length > MAX_MACHINE_PORTS ||
      placed.shape.outPorts.length > MAX_MACHINE_PORTS
    ) {
      throw new Error(`game intent: machine ${placed.id} shape or port count exceeds bounds`);
    }
    totalShapeCells += placed.shape.cells.length;
    totalInPorts += placed.shape.inPorts.length;
    totalOutPorts += placed.shape.outPorts.length;
  }
  if (
    totalShapeCells > layout.tiles.length ||
    totalInPorts > MAX_FACTORY_PORTS ||
    totalOutPorts > MAX_FACTORY_PORTS
  ) {
    throw new Error("game intent: aggregate machine geometry exceeds factory bounds");
  }
  for (let index = 0; index < layout.tiles.length; index++) {
    const tile = layout.tiles[index];
    if (tile === undefined || typeof tile !== "object") {
      throw new Error(`game intent: factory tile ${index} is invalid`);
    }
    switch (tile.kind) {
      case "empty":
      case "sink":
        break;
      case "belt":
        requireDir(tile.dir, `factory tile ${index}`);
        break;
      case "source":
        requireDir(tile.dir, `factory tile ${index}`);
        if (!Number.isSafeInteger(tile.period) || tile.period <= 0 || tile.period > 0x7fff_ffff) {
          throw new Error("game intent: factory source period must be a positive int32 integer");
        }
        break;
      case "splitter":
        requireDir(tile.inDir, `factory tile ${index} input`);
        if (!Array.isArray(tile.outDirs) || tile.outDirs.length === 0 || tile.outDirs.length > 4) {
          throw new Error(`game intent: factory splitter ${index} requires an output direction`);
        }
        for (let output = 0; output < tile.outDirs.length; output++) {
          const dir = tile.outDirs[output] ?? -1;
          requireDir(dir, `factory tile ${index} output`);
          if (tile.outDirs.indexOf(dir) !== output) {
            throw new Error(`game intent: factory splitter ${index} has duplicate outputs`);
          }
        }
        break;
      case "merger":
        if (!Array.isArray(tile.inDirs) || tile.inDirs.length === 0 || tile.inDirs.length > 4) {
          throw new Error(`game intent: factory merger ${index} requires an input direction`);
        }
        for (let input = 0; input < tile.inDirs.length; input++) {
          const dir = tile.inDirs[input] ?? -1;
          requireDir(dir, `factory tile ${index} input`);
          if (tile.inDirs.indexOf(dir) !== input) {
            throw new Error(`game intent: factory merger ${index} has duplicate inputs`);
          }
        }
        requireDir(tile.outDir, `factory tile ${index} output`);
        break;
      default:
        throw new Error(`game intent: factory tile ${index} has an unknown kind`);
    }
  }

  const occupied = new Int32Array(layout.width * layout.height).fill(-1);
  const machineIds = new Set<number>();
  for (const placed of layout.machines) {
    if (!Number.isSafeInteger(placed.id) || placed.id < 0 || placed.id > 0x7fff_ffff) {
      throw new Error("game intent: factory machine id must be a non-negative safe integer");
    }
    if (machineIds.has(placed.id)) {
      throw new Error(`game intent: duplicate factory machine id ${placed.id}`);
    }
    machineIds.add(placed.id);
    if (
      !Number.isSafeInteger(placed.anchor.x) ||
      !Number.isSafeInteger(placed.anchor.y) ||
      !Number.isSafeInteger(placed.footRot) ||
      placed.footRot < 0 ||
      placed.footRot > 3
    ) {
      throw new Error(`game intent: machine ${placed.id} placement is invalid`);
    }
    const entry = requireAllowedMachine(game, placed.def);
    const shape = DEFAULT_SHAPES[placed.def.typeId];
    if (
      !Array.isArray(placed.shape.cells) ||
      !Array.isArray(placed.shape.inPorts) ||
      !Array.isArray(placed.shape.outPorts) ||
      placed.shape.cells.length > MAX_MACHINE_SHAPE_CELLS ||
      placed.shape.inPorts.length > MAX_MACHINE_PORTS ||
      placed.shape.outPorts.length > MAX_MACHINE_PORTS
    ) {
      throw new Error(`game intent: machine ${placed.id} shape or port count exceeds bounds`);
    }
    if (
      placed.def.cost !== entry.cost ||
      placed.def.speed !== entry.speed ||
      shape === undefined ||
      canonical(placed.shape) !== canonical(shape)
    ) {
      throw new Error(`game intent: machine "${placed.def.typeId}" definition does not match catalog`);
    }
    for (const cell of worldCells(placed)) {
      if (
        !Number.isSafeInteger(cell.x) ||
        !Number.isSafeInteger(cell.y) ||
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= layout.width ||
        cell.y >= layout.height
      ) {
        throw new Error(`game intent: machine ${placed.id} footprint is out of bounds`);
      }
      const index = cell.y * layout.width + cell.x;
      if ((occupied[index] ?? -1) >= 0) {
        throw new Error(`game intent: machine ${placed.id} footprint overlaps another machine`);
      }
      if (layout.tiles[index]?.kind !== "empty") {
        throw new Error(`game intent: machine ${placed.id} footprint must cover only empty tiles`);
      }
      occupied[index] = placed.id;
    }
  }
}

const BASE_LAB_VISIBILITY_RADIUS = 3;

function revealStartRadius(map: MultiMap["maps"][number], radius: number): Uint8Array {
  const fog = new Uint8Array(map.width * map.height);
  for (let dy = -radius; dy <= radius; dy++) {
    const y = map.start.y + dy;
    if (y < 0 || y >= map.height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const x = map.start.x + dx;
      if (x >= 0 && x < map.width) fog[y * map.width + x] = 1;
    }
  }
  return fog;
}

function freshFog(mm: MultiMap, radius = BASE_LAB_VISIBILITY_RADIUS): Uint8Array[] {
  return mm.maps.map((map) => revealStartRadius(map, radius));
}

function unionFog(dst: readonly Uint8Array[], src: MultiMap, radius: number): readonly Uint8Array[] {
  let result: Uint8Array[] | null = null;
  for (let mapIndex = 0; mapIndex < dst.length; mapIndex++) {
    const current = dst[mapIndex];
    const map = src.maps[mapIndex];
    if (current === undefined || map === undefined) continue;
    let next: Uint8Array | null = null;
    for (let i = 0; i < map.fog.length; i++) {
      if (map.fog[i] !== 1) continue;
      const sourceX = i % map.width;
      const sourceY = Math.floor(i / map.width);
      for (let dy = -radius; dy <= radius; dy++) {
        const y = sourceY + dy;
        if (y < 0 || y >= map.height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const x = sourceX + dx;
          if (x < 0 || x >= map.width) continue;
          const target = y * map.width + x;
          if ((next ?? current)[target] === 1) continue;
          if (next === null) next = Uint8Array.from(current);
          next[target] = 1;
        }
      }
    }
    if (next === null) continue;
    if (result === null) result = [...dst];
    result[mapIndex] = next;
  }
  return result ?? dst;
}

function revealAidFog(fog: readonly Uint8Array[], mm: MultiMap, radius: number): readonly Uint8Array[] {
  return fog.map((current, mapIndex) => {
    const map = mm.maps[mapIndex];
    if (map === undefined) return current;
    const next = Uint8Array.from(current);
    for (let dy = -radius; dy <= radius; dy++) {
      const y = map.start.y + dy;
      if (y < 0 || y >= map.height) continue;
      for (let dx = -radius; dx <= radius; dx++) {
        const x = map.start.x + dx;
        if (x >= 0 && x < map.width) next[y * map.width + x] = 1;
      }
    }
    return next;
  });
}

const LAB_WORLD_SIZE = 63;

function validateGameCatalog(catalog: readonly MachineCatalogEntry[]): void {
  const catalogIds = new Set<string>();
  for (const entry of catalog) {
    if (catalogIds.has(entry.typeId)) {
      throw new Error(`game state: duplicate generation catalog entry "${entry.typeId}"`);
    }
    catalogIds.add(entry.typeId);
    const canonicalEntry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === entry.typeId);
    if (canonicalEntry === undefined || canonical(entry) !== canonical(canonicalEntry)) {
      throw new Error(`game state: generation catalog entry "${entry.typeId}" does not match catalog`);
    }
  }
}

export function createGameState(genOptions: GenOptions, cash: number, research: number): GameState {
  requireSafeInteger(cash, "game state: starting cash");
  requireSafeInteger(research, "game state: starting research", 0);
  const ownedOptions = ownGenOptions(genOptions);
  const ownedCash = canonicalNumber(cash);
  const ownedResearch = canonicalNumber(research);
  validateGameMapOptions(ownedOptions);
  validateGameCatalog(ownedOptions.catalog);
  const level = levelFor(ownedOptions);
  return {
    origin: Object.freeze({
      genOptions: ownedOptions,
      cash: ownedCash,
      research: ownedResearch,
    }),
    intentTrace: Object.freeze([]),
    replayTicks: 0,
    genOptions: ownedOptions,
    economy: { cash: ownedCash, research: ownedResearch, sold: [] },
    patents: { unlocked: [] },
    recipe: null,
    factory: null,
    factoryState: null,
    factoryWaste: 0,
    inventory: [],
    nextInventoryId: 0,
    fog: freshFog(level.mm),
    rng: { s: ownedOptions.seed >>> 0 },
  };
}

function expandFactory(layout: FactoryLayout, dw: number, dh: number): FactoryLayout {
  if (dw === 0 && dh === 0) return layout;
  const width = layout.width + dw;
  const height = layout.height + dh;
  const tiles: FactoryTile[] = new Array<FactoryTile>(width * height).fill({ kind: "empty" });
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      const tile = layout.tiles[y * layout.width + x];
      if (tile !== undefined) tiles[y * width + x] = tile;
    }
  }
  return ownFactoryLayout({ width, height, tiles, machines: layout.machines });
}

interface ProductDrain {
  readonly sourceInventory: readonly InventoryProduct[];
  inventory: InventoryProduct[] | null;
  nextInventoryId: number;
  factoryWaste: number;
}

function drainProducts(
  runtime: FactoryRuntime,
  expectedKey: string | null,
  level: GeneratedLevel,
  current: ProductDrain,
): void {
  const events = runtime.producedEvents;
  if (events.count === 0) return;
  for (let eventIndex = 0; eventIndex < events.count; eventIndex++) {
    const pos: { x: number; y: number }[] = [];
    const base = eventIndex * events.mapCount;
    for (let mapIndex = 0; mapIndex < events.mapCount; mapIndex++) {
      pos.push({
        x: events.drugX[base + mapIndex] ?? 0,
        y: events.drugY[base + mapIndex] ?? 0,
      });
    }
    const drug = { pos, failed: (events.failed[eventIndex] ?? 0) !== 0 };
    const outcome = evaluate(level.mm, drug, { steps: [] });
    if (
      expectedKey === null ||
      outcome.failed ||
      outcome.cured.length === 0 ||
      canonical(outcome) !== expectedKey
    ) {
      current.factoryWaste += 1;
      continue;
    }
    const inventoryLength = current.inventory?.length ?? current.sourceInventory.length;
    if (inventoryLength >= MAX_GAME_INVENTORY_PRODUCTS) {
      throw new Error(
        `game intent: inventory exceeds ${MAX_GAME_INVENTORY_PRODUCTS} physical products`,
      );
    }
    if (current.inventory === null) current.inventory = [...current.sourceInventory];
    current.inventory.push({
      id: events.ids[eventIndex] ?? 0,
      inventoryId: current.nextInventoryId,
      drug,
      productionCost: events.productionCosts[eventIndex] ?? 0,
      outcome,
    });
    current.nextInventoryId += 1;
  }
}

function sellPhysicalProducts(
  game: GameState,
  productIds: readonly number[],
  diseaseId: number,
): GameState {
  if (!Number.isSafeInteger(diseaseId) || diseaseId < 0) {
    throw new Error("game intent: disease id must be a non-negative safe integer");
  }
  if (
    !Array.isArray(productIds) ||
    productIds.length < 1 ||
    productIds.length > MAX_BULK_SALE_PRODUCTS
  ) {
    throw new Error(
      `game intent: sale must contain 1..${MAX_BULK_SALE_PRODUCTS} product ids`,
    );
  }
  const level = levelFor(game.genOptions);
  const disease = level.diseases.find((candidate) => candidate.id === diseaseId);
  if (disease === undefined) {
    throw new Error(`game intent: sale references unknown disease ${diseaseId}`);
  }
  const byId = new Map<number, InventoryProduct>();
  for (const product of game.inventory) byId.set(product.inventoryId, product);
  const soldIds = new Set<number>();
  let economy = game.economy;
  for (let index = 0; index < productIds.length; index++) {
    const productId = productIds[index];
    if (!Number.isSafeInteger(productId) || productId === undefined || productId < 0) {
      throw new Error(`game intent: product id ${index} must be a non-negative safe integer`);
    }
    const product = byId.get(productId);
    if (soldIds.has(productId) || product === undefined || !product.outcome.cured.includes(diseaseId)) {
      throw new Error(`game intent: product ${productId} is duplicated, unavailable, or not a cure`);
    }
    soldIds.add(productId);
    const penalty = product.outcome.sideEffects.length * SIDE_EFFECT_PENALTY;
    economy = sellUnit(
      economy,
      diseaseId,
      disease.basePrice,
      product.productionCost,
      penalty,
    ).econ;
  }
  return {
    ...game,
    economy,
    inventory: game.inventory.filter((product) => !soldIds.has(product.inventoryId)),
  };
}

function factoryRuntimeIsInitial(game: GameState): boolean {
  if (game.factoryState === null || game.factoryWaste !== 0) return false;
  const snapshot = snapshotFactory(game.factoryState);
  return (
    snapshot.tick === 0 &&
    snapshot.units.length === 0 &&
    snapshot.nextUnitId === 0 &&
    snapshot.producedTotal === 0 &&
    snapshot.producedEvents.length === 0 &&
    snapshot.deadlocked === false &&
    snapshot.splitterCursors.every((cursor) => cursor === 0)
  );
}

function reduceGameIntent(game: GameState, intent: GameIntent): GameState {
  switch (intent.kind) {
    case "saveRecipe": {
      requireAllowedTemplate(game, intent.recipe);
      const level = levelFor(game.genOptions);
      const outcome = evaluate(level.mm, level.start, intent.recipe);
      if (outcome.failed || outcome.cured.length === 0) {
        throw new Error("game intent: saved recipe must produce a non-failed cure");
      }
      validateFactoryLayout(game, intent.factory);
      const effects = activeEffects(DEFAULT_PATENTS, game.patents);
      const entitledWidth = BASE_GAME_FACTORY_WIDTH + effects.factoryDw;
      const entitledHeight = BASE_GAME_FACTORY_HEIGHT + effects.factoryDh;
      if (intent.factory.width !== entitledWidth || intent.factory.height !== entitledHeight) {
        throw new Error(
          `game intent: pilot prototype must use the entitled ` +
            `${entitledWidth}x${entitledHeight} Factory floor`,
        );
      }
      const derivedRecipe = derivePrototypeTemplate(intent.factory);
      if (canonical(derivedRecipe) !== canonical(intent.recipe)) {
        throw new Error("game intent: physical pilot topology does not match the submitted recipe");
      }
      const physicalOutcome = factoryOutcome(intent.factory, level.mm, level.start);
      if (canonical(physicalOutcome) !== canonical(outcome)) {
        throw new Error("game intent: pilot prototype routing does not realize the saved recipe");
      }
      const factory = ownFactoryLayout(intent.factory);
      if (
        game.recipe !== null &&
        game.factory !== null &&
        canonical(game.recipe) === canonical(intent.recipe) &&
        canonical(game.factory) === canonical(factory) &&
        factoryRuntimeIsInitial(game)
      ) {
        return game;
      }
      return {
        ...game,
        recipe: intent.recipe,
        factory,
        factoryState: initFactory(factory, level.mm, level.start),
        factoryWaste: 0,
      };
    }
    case "setFactory": {
      validateFactoryLayout(game, intent.factory);
      if (game.factory === null) {
        const effects = activeEffects(DEFAULT_PATENTS, game.patents);
        const entitledWidth = BASE_GAME_FACTORY_WIDTH + effects.factoryDw;
        const entitledHeight = BASE_GAME_FACTORY_HEIGHT + effects.factoryDh;
        if (
          intent.factory.width !== entitledWidth ||
          intent.factory.height !== entitledHeight
        ) {
          throw new Error(
            `game intent: a factory without a saved recipe must use the ` +
              `${entitledWidth}x${entitledHeight} patent-authorized base dimensions`,
          );
        }
      } else if (
        intent.factory.width !== game.factory.width ||
        intent.factory.height !== game.factory.height
      ) {
        throw new Error(
          "game intent: factory dimensions can change only through an expansion patent",
        );
      }
      if (game.factory !== null && canonical(game.factory) === canonical(intent.factory)) return game;
      const level = levelFor(game.genOptions);
      return {
        ...game,
        factory: intent.factory,
        factoryState: initFactory(intent.factory, level.mm, level.start),
        factoryWaste: 0,
      };
    }
    case "factoryTicks": {
      if (!Number.isSafeInteger(intent.ticks) || intent.ticks < 0) {
        throw new Error("game intent: factory ticks must be a non-negative safe integer");
      }
      if (intent.ticks === 0) return game;
      if (game.factory === null) {
        throw new Error("game intent: no authoritative factory layout is active");
      }
      if (game.factoryState !== null && game.factoryState.producedEvents.count !== 0) {
        throw new Error("game intent: factory product events must be drained before advancing");
      }
      const level = levelFor(game.genOptions);
      const state = game.factoryState === null
        ? initFactory(game.factory, level.mm, level.start)
        : restoreFactory(
            game.factory,
            level.mm,
            level.start,
            snapshotFactory(game.factoryState),
          );
      const expectedKey = game.recipe === null
        ? null
        : canonical(evaluate(level.mm, level.start, game.recipe));
      const drained: ProductDrain = {
        sourceInventory: game.inventory,
        inventory: null,
        nextInventoryId: game.nextInventoryId,
        factoryWaste: game.factoryWaste,
      };
      clearFactoryProductEvents(state);
      for (let i = 0; i < intent.ticks; i++) {
        stepFactory(game.factory, level.mm, state);
        drainProducts(state, expectedKey, level, drained);
        clearFactoryProductEvents(state);
      }
      return {
        ...game,
        factoryState: state,
        inventory: drained.inventory ?? game.inventory,
        nextInventoryId: drained.nextInventoryId,
        factoryWaste: drained.factoryWaste,
      };
    }
    case "resetFactory": {
      if (game.factory === null) return game;
      if (factoryRuntimeIsInitial(game)) return game;
      const level = levelFor(game.genOptions);
      return {
        ...game,
        factoryState: initFactory(game.factory, level.mm, level.start),
        factoryWaste: 0,
      };
    }
    case "sellProduct": {
      if (
        !Number.isSafeInteger(intent.productId) ||
        intent.productId < 0 ||
        !Number.isSafeInteger(intent.disease) ||
        intent.disease < 0
      ) {
        throw new Error("game intent: product and disease ids must be non-negative safe integers");
      }
      return sellPhysicalProducts(game, [intent.productId], intent.disease);
    }
    case "sellProducts":
      return sellPhysicalProducts(game, intent.productIds, intent.disease);
    case "runLab": {
      requireAllowedTemplate(game, intent.template);
      if (intent.template.steps.length === 0) return game;
      const level = levelFor(game.genOptions);
      const revealRadius = BASE_LAB_VISIBILITY_RADIUS +
        activeEffects(DEFAULT_PATENTS, game.patents).revealAid;
      const fog = unionFog(
        game.fog,
        revealAlong(level.mm, level.start, intent.template),
        revealRadius,
      );
      return fog === game.fog ? game : { ...game, fog };
    }
    case "unlockPatent": {
      const node = DEFAULT_PATENTS.find((candidate) => candidate.id === intent.id);
      if (node === undefined) throw new Error(`game intent: unknown patent "${intent.id}"`);
      const unlocked = unlockPatent(
        DEFAULT_PATENTS,
        game.patents,
        game.economy.cash,
        game.economy.research,
        intent.id,
      );
      let next: GameState = {
        ...game,
        patents: unlocked.patents,
        economy: { ...game.economy, cash: unlocked.cash, research: unlocked.research },
      };
      if (node.effect.kind === "expandFactory" && next.factory !== null) {
        next = {
          ...next,
          factory: expandFactory(next.factory, node.effect.dw, node.effect.dh),
          factoryState: null,
          factoryWaste: 0,
        };
      }
      if (node.effect.kind === "revealAid") {
        const level = levelFor(next.genOptions);
        next = {
          ...next,
          fog: revealAidFog(
            next.fog,
            level.mm,
            BASE_LAB_VISIBILITY_RADIUS + node.effect.amount,
          ),
        };
      }
      if (node.effect.kind === "unlockMap") {
        const nMaps = Math.min(4, next.genOptions.nMaps + 1);
        const genOptions = ownGenOptions({
          ...next.genOptions,
          seed: (next.genOptions.seed + 1) >>> 0,
          nMaps,
          width: LAB_WORLD_SIZE,
          height: LAB_WORLD_SIZE,
          catalog: availableCatalog(next.patents),
          diseaseCount: nMaps,
        });
        const level = levelFor(genOptions);
        const revealAid = activeEffects(DEFAULT_PATENTS, next.patents).revealAid;
        const fog = freshFog(level.mm, BASE_LAB_VISIBILITY_RADIUS + revealAid);
        next = {
          ...next,
          genOptions,
          economy: { ...next.economy, sold: [] },
          recipe: null,
          factory: null,
          factoryState: null,
          factoryWaste: 0,
          inventory: [],
          fog,
          rng: { s: genOptions.seed >>> 0 },
        };
      }
      return next;
    }
  }
}

function appendIntentTrace(game: GameState, intent: GameIntent, next: GameState): GameState {
  if (next === game) return game;
  if (intent.kind === "factoryTicks") {
    const replayTicks = game.replayTicks + intent.ticks;
    if (!Number.isSafeInteger(replayTicks) || replayTicks > MAX_REPLAY_TICKS) {
      throw new Error(`game intent: cumulative factory ticks exceed ${MAX_REPLAY_TICKS}`);
    }
    const previous = game.intentTrace[game.intentTrace.length - 1];
    if (previous?.kind === "factoryTicks") {
      const ticks = previous.ticks + intent.ticks;
      if (!Number.isSafeInteger(ticks)) {
        throw new Error("game intent: normalized factory tick batch exceeds safe integer range");
      }
      return {
        ...next,
        intentTrace: Object.freeze([
          ...game.intentTrace.slice(0, -1),
          Object.freeze({ kind: "factoryTicks" as const, ticks }),
        ]),
        replayTicks,
      };
    }
    if (game.intentTrace.length >= MAX_INTENT_TRACE) {
      throw new Error(`game intent: input trace exceeds ${MAX_INTENT_TRACE} entries`);
    }
    return { ...next, intentTrace: Object.freeze([...game.intentTrace, intent]), replayTicks };
  }
  const previous = game.intentTrace[game.intentTrace.length - 1];
  if (intent.kind === "setFactory" && previous?.kind === "setFactory") {
    return {
      ...next,
      intentTrace: Object.freeze([...game.intentTrace.slice(0, -1), intent]),
    };
  }
  if (
    (intent.kind === "sellProduct" || intent.kind === "sellProducts") &&
    (previous?.kind === "sellProduct" || previous?.kind === "sellProducts") &&
    intent.disease === previous.disease
  ) {
    const previousIds = previous.kind === "sellProduct" ? [previous.productId] : previous.productIds;
    const currentIds = intent.kind === "sellProduct" ? [intent.productId] : intent.productIds;
    if (previousIds.length + currentIds.length > MAX_BULK_SALE_PRODUCTS) {
      throw new Error(`game intent: normalized bulk sale exceeds ${MAX_BULK_SALE_PRODUCTS} products`);
    }
    const merged = Object.freeze({
      kind: "sellProducts" as const,
      productIds: Object.freeze([...previousIds, ...currentIds]),
      disease: intent.disease,
    });
    return {
      ...next,
      intentTrace: Object.freeze([...game.intentTrace.slice(0, -1), merged]),
    };
  }
  if (game.intentTrace.length >= MAX_INTENT_TRACE) {
    throw new Error(`game intent: input trace exceeds ${MAX_INTENT_TRACE} entries`);
  }
  return { ...next, intentTrace: Object.freeze([...game.intentTrace, intent]) };
}

export function applyGameIntent(game: GameState, intent: GameIntent): GameState {
  if (intent.kind === "factoryTicks") {
    if (!Number.isSafeInteger(intent.ticks) || intent.ticks < 0) {
      throw new Error("game intent: factory ticks must be a non-negative safe integer");
    }
    if (
      game.factory !== null &&
      intent.ticks > 0 &&
      (intent.ticks > MAX_REPLAY_TICKS || game.replayTicks > MAX_REPLAY_TICKS - intent.ticks)
    ) {
      throw new Error(`game intent: cumulative factory ticks exceed ${MAX_REPLAY_TICKS}`);
    }
  }
  const ownedIntent = ownGameIntent(intent);
  if (ownedIntent.kind === "factoryTicks" && game.factory !== null && ownedIntent.ticks > 0) {
    const previous = game.intentTrace[game.intentTrace.length - 1];
    const prospectiveTrace = previous?.kind === "factoryTicks"
      ? [
          ...game.intentTrace.slice(0, -1),
          Object.freeze({
            kind: "factoryTicks" as const,
            ticks: previous.ticks + ownedIntent.ticks,
          }),
        ]
      : [...game.intentTrace, ownedIntent];
    if (estimateGameReplayWork(game.origin.genOptions, prospectiveTrace) > MAX_GAME_REPLAY_WORK) {
      throw new Error(`game intent: replay work exceeds ${MAX_GAME_REPLAY_WORK}`);
    }
  }
  const next = appendIntentTrace(game, ownedIntent, reduceGameIntent(game, ownedIntent));
  if (
    next !== game &&
    estimateGameReplayWork(next.origin.genOptions, next.intentTrace) > MAX_GAME_REPLAY_WORK
  ) {
    throw new Error(`game intent: replay work exceeds ${MAX_GAME_REPLAY_WORK}`);
  }
  return next;
}

function canonical(value: unknown): string {
  if (value instanceof Uint8Array || value instanceof Int16Array || value instanceof Int32Array) {
    return `[${Array.from(value).join(",")}]`;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const HASH_TEXT_ENCODER = new TextEncoder();

function hashText(hash: number, text: string, scratch: Uint8Array): number {
  let remaining = text;
  let next = hash;
  while (remaining.length > 0) {
    const encoded = HASH_TEXT_ENCODER.encodeInto(remaining, scratch);
    if (encoded.read === 0) throw new Error("game hash: UTF-8 encoder made no progress");
    for (let index = 0; index < encoded.written; index++) {
      next = hashU32(next, scratch[index] ?? 0);
    }
    if (encoded.read === remaining.length) break;
    remaining = remaining.slice(encoded.read);
  }
  return next;
}

function hashCanonicalValue(hash: number, value: unknown, scratch: Uint8Array): number {
  if (value instanceof Uint8Array || value instanceof Int16Array || value instanceof Int32Array) {
    let next = hashText(hash, "[", scratch);
    for (let index = 0; index < value.length; index++) {
      if (index > 0) next = hashText(next, ",", scratch);
      next = hashText(next, String(value[index] ?? 0), scratch);
    }
    return hashText(next, "]", scratch);
  }
  if (Array.isArray(value)) {
    let next = hashText(hash, "[", scratch);
    for (let index = 0; index < value.length; index++) {
      if (index > 0) next = hashText(next, ",", scratch);
      next = hashCanonicalValue(next, value[index], scratch);
    }
    return hashText(next, "]", scratch);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    let next = hashText(hash, "{", scratch);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (index > 0) next = hashText(next, ",", scratch);
      next = hashText(next, JSON.stringify(key), scratch);
      next = hashText(next, ":", scratch);
      next = hashCanonicalValue(next, record[key], scratch);
    }
    return hashText(next, "}", scratch);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("game hash: unsupported undefined value");
  return hashText(hash, serialized, scratch);
}

function requireSafeInteger(value: number, path: string, min?: number): void {
  if (!Number.isSafeInteger(value) || (min !== undefined && value < min)) {
    throw new Error(`${path} must be ${min === undefined ? "a" : `an integer >= ${min} and`} safe integer`);
  }
}

function requireObject(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function validateTraceIntent(intent: unknown, index: number): asserts intent is GameIntent {
  const path = `game state: intent trace[${index}]`;
  requireObject(intent, path);
  switch (intent.kind) {
    case "saveRecipe":
      requireObject(intent.recipe, `${path}.recipe`);
      requireObject(intent.factory, `${path}.factory`);
      return;
    case "setFactory":
      requireObject(intent.factory, `${path}.factory`);
      return;
    case "factoryTicks":
      requireSafeInteger(intent.ticks as number, `${path}.ticks`, 1);
      return;
    case "resetFactory":
      return;
    case "sellProduct":
      requireSafeInteger(intent.productId as number, `${path}.productId`, 0);
      requireSafeInteger(intent.disease as number, `${path}.disease`, 0);
      return;
    case "sellProducts": {
      if (!Array.isArray(intent.productIds)) throw new Error(`${path}.productIds must be an array`);
      if (intent.productIds.length < 1 || intent.productIds.length > MAX_BULK_SALE_PRODUCTS) {
        throw new Error(`${path}.productIds exceeds bulk sale bounds`);
      }
      for (let product = 0; product < intent.productIds.length; product++) {
        requireSafeInteger(intent.productIds[product] as number, `${path}.productIds[${product}]`, 0);
      }
      requireSafeInteger(intent.disease as number, `${path}.disease`, 0);
      return;
    }
    case "runLab":
      requireObject(intent.template, `${path}.template`);
      return;
    case "unlockPatent":
      if (typeof intent.id !== "string") throw new Error(`${path}.id must be a string`);
      return;
    default:
      throw new Error(`${path}.kind is unknown`);
  }
}

function typedArrayName(value: unknown): string | null {
  if (value instanceof Uint8Array) return "Uint8Array";
  if (value instanceof Int16Array) return "Int16Array";
  if (value instanceof Int32Array) return "Int32Array";
  return null;
}

function firstDifference(expected: unknown, actual: unknown, path: string): string | null {
  if (Object.is(expected, actual)) return null;
  const expectedTyped = typedArrayName(expected);
  const actualTyped = typedArrayName(actual);
  if (expectedTyped !== null || actualTyped !== null) {
    if (expectedTyped !== actualTyped) return path;
    const a = expected as Uint8Array | Int16Array | Int32Array;
    const b = actual as Uint8Array | Int16Array | Int32Array;
    if (a.length !== b.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return `${path}[${i}]`;
    }
    return null;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return path;
    if (expected.length !== actual.length) return `${path}.length`;
    for (let i = 0; i < expected.length; i++) {
      const difference = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (difference !== null) return difference;
    }
    return null;
  }
  if (
    expected === null ||
    actual === null ||
    typeof expected !== "object" ||
    typeof actual !== "object"
  ) {
    return path;
  }
  const expectedRecord = expected as Record<string, unknown>;
  const actualRecord = actual as Record<string, unknown>;
  const expectedKeys = Object.keys(expectedRecord).sort();
  const actualKeys = Object.keys(actualRecord).sort();
  if (expectedKeys.length !== actualKeys.length) return path;
  for (let i = 0; i < expectedKeys.length; i++) {
    const key = expectedKeys[i];
    if (key === undefined || key !== actualKeys[i]) return path;
    const difference = firstDifference(
      expectedRecord[key],
      actualRecord[key],
      path.length === 0 ? key : `${path}.${key}`,
    );
    if (difference !== null) return difference;
  }
  return null;
}

function comparableGame(game: GameState): unknown {
  return {
    ...game,
    factoryState: game.factoryState === null ? null : snapshotFactory(game.factoryState),
  };
}

function validateDrugState(
  drug: { readonly pos: readonly { readonly x: number; readonly y: number }[]; readonly failed: boolean },
  level: GeneratedLevel,
  path: string,
): void {
  if (typeof drug.failed !== "boolean" || drug.pos.length !== level.mm.maps.length) {
    throw new Error(`${path} has an invalid map count or failed flag`);
  }
  for (let mapIndex = 0; mapIndex < drug.pos.length; mapIndex++) {
    const pos = drug.pos[mapIndex];
    const map = level.mm.maps[mapIndex];
    if (
      pos === undefined ||
      map === undefined ||
      !Number.isSafeInteger(pos.x) ||
      !Number.isSafeInteger(pos.y) ||
      pos.x < 0 ||
      pos.y < 0 ||
      pos.x >= map.width ||
      pos.y >= map.height
    ) {
      throw new Error(`${path}.pos[${mapIndex}] is outside its effect map`);
    }
  }
}

function validateRuntime(game: GameState, runtime: FactoryRuntime, level: GeneratedLevel): void {
  const layout = game.factory;
  if (layout === null) throw new Error("game state: factory runtime requires a layout");
  const capacity = layout.machines.length + layout.tiles.reduce(
    (count, tile) => count + (
      tile.kind === "belt" || tile.kind === "splitter" || tile.kind === "merger" ? 1 : 0
    ),
    0,
  );
  const sourceCount = layout.tiles.reduce(
    (count, tile) => count + (tile.kind === "source" ? 1 : 0),
    0,
  );
  if (runtime.capacity !== capacity || runtime.mapCount !== level.mm.maps.length) {
    throw new Error("game state: factory runtime capacity/map count does not match layout");
  }
  const unitArrays = [
    runtime.unitIds,
    runtime.unitX,
    runtime.unitY,
    runtime.unitProc,
    runtime.unitMachineIds,
    runtime.unitProductionCosts,
    runtime.unitFailed,
  ];
  if (
    !(runtime.unitIds instanceof Int32Array) ||
    !(runtime.unitX instanceof Int32Array) ||
    !(runtime.unitY instanceof Int32Array) ||
    !(runtime.unitProc instanceof Int32Array) ||
    !(runtime.unitMachineIds instanceof Int32Array) ||
    !(runtime.unitProductionCosts instanceof Int32Array) ||
    !(runtime.unitFailed instanceof Uint8Array) ||
    !(runtime.unitDrugX instanceof Int32Array) ||
    !(runtime.unitDrugY instanceof Int32Array) ||
    !(runtime.splitterCursors instanceof Int32Array)
  ) {
    throw new Error("game state: factory runtime buffers must use canonical TypedArrays");
  }
  if (unitArrays.some((array) => array.length !== capacity)) {
    throw new Error("game state: factory runtime unit buffers have invalid capacity");
  }
  if (
    runtime.unitDrugX.length !== capacity * runtime.mapCount ||
    runtime.unitDrugY.length !== capacity * runtime.mapCount
  ) {
    throw new Error("game state: factory runtime drug buffers have invalid capacity");
  }
  const splitters = layout.tiles.filter((tile) => tile.kind === "splitter");
  if (runtime.splitterCursors.length !== splitters.length) {
    throw new Error("game state: factory splitter cursor count does not match layout");
  }
  for (let slot = 0; slot < runtime.splitterCursors.length; slot++) {
    const cursor = runtime.splitterCursors[slot] ?? -1;
    const splitter = splitters[slot];
    if (splitter?.kind !== "splitter" || cursor < 0 || cursor >= splitter.outDirs.length) {
      throw new Error(`game state: factory splitter cursor ${slot} is outside its output range`);
    }
  }
  const events = runtime.producedEvents;
  const eventCapacity = capacity + sourceCount;
  if (
    !(events.ids instanceof Int32Array) ||
    !(events.productionCosts instanceof Int32Array) ||
    !(events.failed instanceof Uint8Array) ||
    !(events.drugX instanceof Int32Array) ||
    !(events.drugY instanceof Int32Array)
  ) {
    throw new Error("game state: factory product events must use canonical TypedArrays");
  }
  if (
    events.capacity !== eventCapacity ||
    events.mapCount !== runtime.mapCount ||
    events.ids.length !== eventCapacity ||
    events.productionCosts.length !== eventCapacity ||
    events.failed.length !== eventCapacity ||
    events.drugX.length !== eventCapacity * runtime.mapCount ||
    events.drugY.length !== eventCapacity * runtime.mapCount
  ) {
    throw new Error("game state: factory product-event buffers have invalid capacity");
  }
  if (events.count !== 0) {
    throw new Error("game state: factory product events must be drained before persistence");
  }
  requireSafeInteger(runtime.tick, "game state: factory tick", 0);
  requireSafeInteger(runtime.unitCount, "game state: factory unit count", 0);
  requireSafeInteger(runtime.nextUnitId, "game state: factory next unit id", 0);
  requireSafeInteger(runtime.producedTotal, "game state: factory produced total", 0);
  if (runtime.unitCount > capacity) {
    throw new Error("game state: factory unit count exceeds runtime capacity");
  }
  if (typeof runtime.deadlocked !== "boolean") {
    throw new Error("game state: factory deadlocked flag must be boolean");
  }
  for (let i = 0; i < runtime.unitCount; i++) {
    if ((runtime.unitFailed[i] ?? 0) > 1 || (runtime.unitMachineIds[i] ?? -1) < -1) {
      throw new Error(`game state: factory unit ${i} has a non-canonical flag or machine id`);
    }
  }
  for (let i = runtime.unitCount; i < capacity; i++) {
    if (
      runtime.unitIds[i] !== 0 ||
      runtime.unitX[i] !== 0 ||
      runtime.unitY[i] !== 0 ||
      runtime.unitProc[i] !== 0 ||
      runtime.unitMachineIds[i] !== -1 ||
      runtime.unitProductionCosts[i] !== 0 ||
      runtime.unitFailed[i] !== 0
    ) {
      throw new Error(`game state: factory unused unit slot ${i} is not canonical`);
    }
    const base = i * runtime.mapCount;
    for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
      if (runtime.unitDrugX[base + mapIndex] !== 0 || runtime.unitDrugY[base + mapIndex] !== 0) {
        throw new Error(`game state: factory unused drug slot ${i} is not canonical`);
      }
    }
  }
  for (let i = 0; i < eventCapacity; i++) {
    if (
      events.ids[i] !== 0 ||
      events.productionCosts[i] !== 0 ||
      events.failed[i] !== 0
    ) {
      throw new Error(`game state: drained product-event slot ${i} is not canonical`);
    }
    const base = i * runtime.mapCount;
    for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
      if (events.drugX[base + mapIndex] !== 0 || events.drugY[base + mapIndex] !== 0) {
        throw new Error(`game state: drained product-event position ${i} is not canonical`);
      }
    }
  }
  const snapshot = snapshotFactory(runtime);
  for (let i = 0; i < snapshot.units.length; i++) {
    const unit = snapshot.units[i];
    if (unit === undefined) continue;
    requireSafeInteger(unit.id, `game state: factory unit ${i} id`, 0);
    requireSafeInteger(unit.proc, `game state: factory unit ${i} progress`, 0);
    requireSafeInteger(unit.productionCost, `game state: factory unit ${i} production cost`, 0);
    validateDrugState(unit.drug, level, `game state: factory unit ${i}.drug`);
  }
  restoreFactory(layout, level.mm, level.start, snapshot);
}

export function validateGameState(game: GameState): GameState {
  requireObject(game.origin, "game state: origin");
  requireObject(game.origin.genOptions, "game state: origin.genOptions");
  validateGameMapOptions(game.origin.genOptions);
  validateGameCatalog(game.origin.genOptions.catalog);
  requireSafeInteger(game.origin.cash, "game state: origin cash");
  requireSafeInteger(game.origin.research, "game state: origin research", 0);
  levelFor(game.origin.genOptions);
  if (!Array.isArray(game.intentTrace)) {
    throw new Error("game state: intent trace must be an array");
  }
  if (game.intentTrace.length > MAX_INTENT_TRACE) {
    throw new Error(`game state: intent trace exceeds ${MAX_INTENT_TRACE} entries`);
  }
  requireSafeInteger(game.replayTicks, "game state: replay ticks", 0);
  let traceTicks = 0;
  let previousWasTicks = false;
  let previousWasFactory = false;
  let previousSaleDisease: number | null = null;
  for (let index = 0; index < game.intentTrace.length; index++) {
    const intent: unknown = game.intentTrace[index];
    validateTraceIntent(intent, index);
    if (intent.kind === "factoryTicks") {
      if (previousWasTicks) {
        throw new Error("game state: consecutive factory tick intents must be normalized");
      }
      if (intent.ticks > MAX_REPLAY_TICKS - traceTicks) {
        throw new Error(`game state: replay ticks exceed ${MAX_REPLAY_TICKS}`);
      }
      traceTicks += intent.ticks;
      previousWasTicks = true;
      previousWasFactory = false;
      previousSaleDisease = null;
    } else {
      previousWasTicks = false;
      if (intent.kind === "setFactory" && previousWasFactory) {
        throw new Error("game state: consecutive factory layouts must be normalized");
      }
      previousWasFactory = intent.kind === "setFactory";
      if (intent.kind === "sellProduct" || intent.kind === "sellProducts") {
        if (previousSaleDisease === intent.disease) {
          throw new Error("game state: consecutive same-disease sales must be normalized");
        }
        previousSaleDisease = intent.disease;
      } else {
        previousSaleDisease = null;
      }
    }
  }
  if (traceTicks !== game.replayTicks) {
    throw new Error("game state: replay tick total does not match intent trace");
  }
  let replayWork: number;
  try {
    replayWork = estimateGameReplayWork(game.origin.genOptions, game.intentTrace);
  } catch (error) {
    throw new Error(
      `game state: replay work cannot be estimated: ${(error as Error).message}`,
      { cause: error },
    );
  }
  if (replayWork > MAX_GAME_REPLAY_WORK) {
    throw new Error(`game state: replay work exceeds ${MAX_GAME_REPLAY_WORK}`);
  }

  validateGameMapOptions(game.genOptions);
  validateGameCatalog(game.genOptions.catalog);
  const level = levelFor(game.genOptions);
  requireSafeInteger(game.economy.cash, "game state: cash");
  requireSafeInteger(game.economy.research, "game state: research", 0);
  const soldDiseases = new Set<number>();
  const diseaseIds = new Set(level.diseases.map((disease) => disease.id));
  let previousSoldDisease = -1;
  for (const sold of game.economy.sold) {
    requireSafeInteger(sold.disease, "game state: sold disease", 0);
    requireSafeInteger(sold.count, "game state: sold count", 1);
    if (
      !diseaseIds.has(sold.disease) ||
      soldDiseases.has(sold.disease) ||
      sold.disease <= previousSoldDisease
    ) {
      throw new Error(`game state: sold disease ${sold.disease} is unknown, duplicated, or out of order`);
    }
    soldDiseases.add(sold.disease);
    previousSoldDisease = sold.disease;
  }

  const unlocked = new Set<string>();
  for (const id of game.patents.unlocked) {
    const node = DEFAULT_PATENTS.find((candidate) => candidate.id === id);
    if (node === undefined) throw new Error(`game state: unknown patent "${id}"`);
    if (unlocked.has(id)) throw new Error(`game state: duplicate patent "${id}"`);
    for (const required of node.requires) {
      if (!unlocked.has(required)) {
        throw new Error(`game state: patent "${id}" appears before prerequisite "${required}"`);
      }
    }
    unlocked.add(id);
  }
  if (unlocked.has("new-map") && game.genOptions.nMaps < 2) {
    throw new Error("game state: new-map patent requires a 2+ map level");
  }
  if (unlocked.has("new-map-4") && game.genOptions.nMaps < 3) {
    throw new Error("game state: new-map-4 patent requires a 3+ map level");
  }
  if (unlocked.has("deep-map-4") && game.genOptions.nMaps < 4) {
    throw new Error("game state: deep-map-4 patent requires a 4-map level");
  }

  if (game.recipe !== null) {
    requireAllowedTemplate(game, game.recipe);
    const outcome = evaluate(level.mm, level.start, game.recipe);
    if (outcome.failed || outcome.cured.length === 0) {
      throw new Error("game state: saved recipe must produce a non-failed cure");
    }
  }
  if (game.factory !== null) validateFactoryLayout(game, game.factory);
  if (game.factoryState !== null) validateRuntime(game, game.factoryState, level);
  requireSafeInteger(game.factoryWaste, "game state: factory waste", 0);
  if (game.factoryState === null && game.factoryWaste !== 0) {
    throw new Error("game state: factory waste requires a live factory runtime");
  }
  if (game.factoryState !== null && game.factoryWaste > game.factoryState.producedTotal) {
    throw new Error("game state: factory waste exceeds total production");
  }

  requireSafeInteger(game.nextInventoryId, "game state: next inventory id", 0);
  if (game.inventory.length > MAX_GAME_INVENTORY_PRODUCTS) {
    throw new Error(
      `game state: inventory exceeds ${MAX_GAME_INVENTORY_PRODUCTS} physical products`,
    );
  }
  const inventoryIds = new Set<number>();
  for (let i = 0; i < game.inventory.length; i++) {
    const product = game.inventory[i];
    if (product === undefined) continue;
    requireSafeInteger(product.id, `game state: inventory ${i} factory id`, 0);
    if (product.id > 0x7fff_ffff) {
      throw new Error(`game state: inventory ${i} factory id exceeds int32`);
    }
    requireSafeInteger(product.inventoryId, `game state: inventory ${i} id`, 0);
    requireSafeInteger(product.productionCost, `game state: inventory ${i} production cost`, 0);
    if (product.inventoryId >= game.nextInventoryId || inventoryIds.has(product.inventoryId)) {
      throw new Error(`game state: inventory id ${product.inventoryId} is duplicated or not allocated`);
    }
    inventoryIds.add(product.inventoryId);
    validateDrugState(product.drug, level, `game state: inventory ${i}.drug`);
    const actual = evaluate(level.mm, product.drug, { steps: [] });
    if (actual.failed || actual.cured.length === 0 || canonical(actual) !== canonical(product.outcome)) {
      throw new Error(`game state: inventory ${i} outcome does not match its physical drug`);
    }
  }

  if (game.fog.length !== level.mm.maps.length) {
    throw new Error("game state: fog map count does not match level");
  }
  for (let mapIndex = 0; mapIndex < game.fog.length; mapIndex++) {
    const fog = game.fog[mapIndex];
    const map = level.mm.maps[mapIndex];
    if (fog === undefined || map === undefined || fog.length !== map.width * map.height) {
      throw new Error(`game state: fog[${mapIndex}] has invalid length`);
    }
    for (let cell = 0; cell < fog.length; cell++) {
      if (fog[cell] !== 0 && fog[cell] !== 1) {
        throw new Error(`game state: fog[${mapIndex}][${cell}] must be 0 or 1`);
      }
    }
  }
  requireSafeInteger(game.rng.s, "game state: rng state", 0);
  if (game.rng.s > 0xffff_ffff) throw new Error("game state: rng state exceeds uint32");

  let replayed: GameState;
  const canonicalTrace: GameIntent[] = [];
  try {
    replayed = createGameState(game.origin.genOptions, game.origin.cash, game.origin.research);
    for (const intent of game.intentTrace) {
      const ownedIntent = ownGameIntent(intent);
      const next = reduceGameIntent(replayed, ownedIntent);
      if (next === replayed) {
        throw new Error(`non-authoritative no-op intent "${ownedIntent.kind}"`);
      }
      replayed = next;
      canonicalTrace.push(ownedIntent);
    }
  } catch (error) {
    throw new Error(`game state: input trace cannot be replayed: ${(error as Error).message}`, {
      cause: error,
    });
  }
  replayed = {
    ...replayed,
    intentTrace: Object.freeze(canonicalTrace),
    replayTicks: traceTicks,
  };
  const difference = firstDifference(comparableGame(replayed), comparableGame(game), "");
  if (difference !== null) {
    throw new Error(`game state: input trace replay mismatch at ${difference || "root"}`);
  }
  return replayed;
}

export function hashGame(game: GameState): number {
  const comparable = {
    ...game,
    factoryState: game.factoryState === null ? null : snapshotFactory(game.factoryState),
  };
  return hashCanonicalValue(hashInit(), comparable, new Uint8Array(256)) >>> 0;
}

export function replayGame(initial: GameState, intents: readonly GameIntent[]): GameState {
  const level = levelFor(initial.genOptions);
  let game: GameState = initial.factory === null || initial.factoryState === null
    ? initial
    : {
        ...initial,
        factoryState: restoreFactory(
          initial.factory,
          level.mm,
          level.start,
          snapshotFactory(initial.factoryState),
        ),
      };
  for (const intent of intents) game = applyGameIntent(game, intent);
  return game;
}
