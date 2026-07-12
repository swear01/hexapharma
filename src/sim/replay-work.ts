import {
  MAX_GAME_FACTORY_CELLS,
  MAX_GAME_FACTORY_DIMENSION,
  MAX_GAME_INVENTORY_PRODUCTS,
  MAX_GAME_MAP_CELLS,
  MAX_GAME_MAP_DIMENSION,
  MAX_GAME_REPLAY_WORK,
  MAX_FACTORY_REPLAY_TICKS,
  type FactoryLayout,
  type GameIntent,
  type GenOptions,
} from "./phase0_interfaces";

interface FactoryWorkProfile {
  readonly width: number;
  readonly height: number;
  readonly machines: number;
  readonly sources: number;
  readonly carriers: number;
  readonly cold: number;
  readonly perTick: number;
}

function cappedAdd(left: number, right: number): number {
  if (left > MAX_GAME_REPLAY_WORK - right) return MAX_GAME_REPLAY_WORK + 1;
  return left + right;
}

function cappedMultiply(left: number, right: number): number {
  if (left !== 0 && right > Math.floor(MAX_GAME_REPLAY_WORK / left)) {
    return MAX_GAME_REPLAY_WORK + 1;
  }
  return left * right;
}

function requireMapCells(options: GenOptions): number {
  const area = options.width * options.height;
  if (
    !Number.isSafeInteger(options.nMaps) ||
    options.nMaps < 1 ||
    options.nMaps > 4 ||
    !Number.isSafeInteger(options.width) ||
    !Number.isSafeInteger(options.height) ||
    options.width < 3 ||
    options.height < 3 ||
    !Number.isSafeInteger(area) ||
    options.width > MAX_GAME_MAP_DIMENSION ||
    options.height > MAX_GAME_MAP_DIMENSION ||
    area > MAX_GAME_MAP_CELLS
  ) {
    throw new Error("game replay: origin map dimensions are invalid");
  }
  return area * options.nMaps;
}

function profile(
  width: number,
  height: number,
  machines: number,
  sources: number,
  carriers: number,
  geometry: number,
): FactoryWorkProfile {
  const area = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(area) ||
    area > MAX_GAME_FACTORY_CELLS ||
    width > MAX_GAME_FACTORY_DIMENSION ||
    height > MAX_GAME_FACTORY_DIMENSION
  ) {
    throw new Error(
      `game replay: factory must fit ${MAX_GAME_FACTORY_DIMENSION}x` +
        `${MAX_GAME_FACTORY_DIMENSION} and ${MAX_GAME_FACTORY_CELLS} cells`,
    );
  }
  const coldCapacity = area + machines;
  const carrierCapacity = carriers + machines;
  const activeWidth = carriers + machines + sources;
  return {
    width,
    height,
    machines,
    sources,
    carriers,
    cold: Math.min(MAX_GAME_REPLAY_WORK + 1, coldCapacity * 16 + geometry * 4),
    perTick: cappedAdd(
      area,
      cappedAdd(
        cappedMultiply(carrierCapacity, 4),
        cappedMultiply(activeWidth, activeWidth),
      ),
    ),
  };
}

function layoutProfile(layout: FactoryLayout): FactoryWorkProfile {
  let sources = 0;
  let carriers = 0;
  for (const tile of layout.tiles) {
    if (tile.kind === "source") sources += 1;
    if (tile.kind === "belt" || tile.kind === "splitter" || tile.kind === "merger") {
      carriers += 1;
    }
  }
  let geometry = layout.width * layout.height;
  for (const machine of layout.machines) {
    geometry += machine.shape.cells.length;
    geometry += machine.shape.inPorts.length;
    geometry += machine.shape.outPorts.length;
  }
  return profile(
    layout.width,
    layout.height,
    layout.machines.length,
    sources,
    carriers,
    geometry,
  );
}

function expandProfile(
  factory: FactoryWorkProfile,
  widthDelta: number,
  heightDelta: number,
): FactoryWorkProfile {
  return profile(
    factory.width + widthDelta,
    factory.height + heightDelta,
    factory.machines,
    factory.sources,
    factory.carriers,
    (factory.width + widthDelta) * (factory.height + heightDelta) + factory.machines,
  );
}

function mapTraversalWork(mapCells: number, steps: number): number {
  return cappedMultiply(mapCells, steps + 4);
}

function factoryOutcomeWork(layout: FactoryLayout, factory: FactoryWorkProfile): number {
  const area = cappedMultiply(factory.width, factory.height);
  let ticks = Math.min(MAX_FACTORY_REPLAY_TICKS, cappedAdd(area, 16));
  for (const machine of layout.machines) {
    const speed = machine.def.speed;
    if (!Number.isSafeInteger(speed) || speed < 0) return MAX_GAME_REPLAY_WORK + 1;
    if (ticks >= MAX_FACTORY_REPLAY_TICKS - speed) {
      ticks = MAX_FACTORY_REPLAY_TICKS;
      break;
    }
    ticks += speed;
  }
  const activeWidth = cappedAdd(area, cappedAdd(factory.machines, factory.sources));
  return cappedMultiply(cappedMultiply(activeWidth, activeWidth), ticks);
}

export function estimateGameReplayWork(
  origin: GenOptions,
  intents: readonly GameIntent[],
): number {
  let mapCells = requireMapCells(origin);
  let total = cappedMultiply(mapCells, 32);
  let factory: FactoryWorkProfile | null = null;
  let nMaps = origin.nMaps;
  for (const intent of intents) {
    let intentWork = 0;
    switch (intent.kind) {
      case "saveRecipe": {
        factory = layoutProfile(intent.factory);
        intentWork = cappedAdd(
          mapTraversalWork(mapCells, intent.recipe.steps.length),
          cappedAdd(factory.cold, factoryOutcomeWork(intent.factory, factory)),
        );
        break;
      }
      case "setFactory":
        factory = layoutProfile(intent.factory);
        intentWork = factory.cold;
        break;
      case "factoryTicks":
        if (factory !== null) {
          intentWork = cappedAdd(factory.cold, cappedMultiply(intent.ticks, factory.perTick));
        }
        break;
      case "resetFactory":
        intentWork = factory?.cold ?? 1;
        break;
      case "sellProduct":
        intentWork = MAX_GAME_INVENTORY_PRODUCTS + 1;
        break;
      case "sellProducts":
        intentWork = MAX_GAME_INVENTORY_PRODUCTS + intent.productIds.length;
        break;
      case "runLab":
        intentWork = mapTraversalWork(mapCells, intent.template.steps.length);
        break;
      case "unlockPatent":
        intentWork = 262_144;
        if (intent.id === "bench-2") {
          if (factory !== null) {
            factory = expandProfile(factory, 2, 0);
            intentWork = cappedAdd(intentWork, factory.cold);
          }
        } else if (
          intent.id === "new-map" ||
          intent.id === "new-map-4" ||
          intent.id === "deep-map-4"
        ) {
          nMaps = Math.min(4, nMaps + 1);
          const dimension = 63;
          mapCells = nMaps * dimension * dimension;
          intentWork = cappedAdd(intentWork, cappedMultiply(mapCells, 32));
          factory = null;
        }
        break;
    }
    total = cappedAdd(total, intentWork);
    if (total > MAX_GAME_REPLAY_WORK) return total;
  }
  return total;
}
