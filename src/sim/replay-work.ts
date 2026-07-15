import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
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
  readonly geometryOverhead: number;
  readonly processingTicks: number;
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
  processingTicks: number,
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
    geometryOverhead: geometry - area,
    processingTicks,
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
  let processingTicks = 0;
  for (const machine of layout.machines) {
    geometry += machine.shape.cells.length;
    geometry += machine.shape.inPorts.length;
    geometry += machine.shape.outPorts.length;
    const speed = machine.def.speed;
    if (!Number.isSafeInteger(speed) || speed < 0) {
      processingTicks = MAX_FACTORY_REPLAY_TICKS + 1;
    } else if (processingTicks < MAX_FACTORY_REPLAY_TICKS) {
      processingTicks = processingTicks >= MAX_FACTORY_REPLAY_TICKS - speed
        ? MAX_FACTORY_REPLAY_TICKS
        : processingTicks + speed;
    }
  }
  return profile(
    layout.width,
    layout.height,
    layout.machines.length,
    sources,
    carriers,
    geometry,
    processingTicks,
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
    (factory.width + widthDelta) * (factory.height + heightDelta) + factory.geometryOverhead,
    factory.processingTicks,
  );
}

function mapTraversalWork(mapCells: number, steps: number): number {
  return cappedMultiply(mapCells, steps + 4);
}

export function estimateGameReplayWork(
  origin: GenOptions,
  intents: readonly GameIntent[],
): number {
  const mapCells = requireMapCells(origin);
  let total = cappedMultiply(mapCells, 32);
  let researchSteps = 0;
  let pilot: FactoryWorkProfile | null = null;
  let production = profile(
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
    0,
    0,
    0,
    BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT,
    0,
  );
  for (const intent of intents) {
    let intentWork = 0;
    switch (intent.kind) {
      case "setResearchProgram":
        researchSteps = intent.program.steps.length;
        intentWork = mapTraversalWork(mapCells, researchSteps);
        break;
      case "beginResearchShot":
        intentWork = researchSteps === 0
          ? 1
          : mapTraversalWork(mapCells, researchSteps);
        break;
      case "advanceResearchShot":
        intentWork = researchSteps === 0
          ? 1
          : mapTraversalWork(mapCells, 1);
        break;
      case "abortResearchShot":
        intentWork = 1;
        break;
      case "setPilotLayout":
        pilot = layoutProfile(intent.layout);
        intentWork = pilot.cold;
        break;
      case "buildProductionLayout":
        production = layoutProfile(intent.layout);
        intentWork = production.cold;
        break;
      case "productionTicks":
        intentWork = cappedAdd(
          production.cold,
          cappedMultiply(intent.ticks, production.perTick),
        );
        break;
      case "resetProduction":
        intentWork = production.cold;
        break;
      case "sellProduct":
        intentWork = MAX_GAME_INVENTORY_PRODUCTS + 1;
        break;
      case "sellProducts":
        intentWork = MAX_GAME_INVENTORY_PRODUCTS + intent.productIds.length;
        break;
      case "unlockPatent":
        intentWork = 262_144;
        if (intent.id === "bench-2" || intent.id === "floor-depth") {
          const dw = intent.id === "bench-2" ? 2 : 0;
          const dh = intent.id === "floor-depth" ? 2 : 0;
          if (pilot !== null) {
            pilot = expandProfile(pilot, dw, dh);
            intentWork = cappedAdd(intentWork, pilot.cold);
          }
          production = expandProfile(production, dw, dh);
          intentWork = cappedAdd(intentWork, production.cold);
        }
        break;
    }
    total = cappedAdd(total, intentWork);
    if (total > MAX_GAME_REPLAY_WORK) return total;
  }
  return total;
}
