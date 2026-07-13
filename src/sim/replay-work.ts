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

function factoryOutcomeWork(factory: FactoryWorkProfile): number {
  if (factory.processingTicks > MAX_FACTORY_REPLAY_TICKS) {
    return MAX_GAME_REPLAY_WORK + 1;
  }
  const area = cappedMultiply(factory.width, factory.height);
  let ticks = Math.min(MAX_FACTORY_REPLAY_TICKS, cappedAdd(area, 16));
  ticks = ticks >= MAX_FACTORY_REPLAY_TICKS - factory.processingTicks
    ? MAX_FACTORY_REPLAY_TICKS
    : ticks + factory.processingTicks;
  const activeWidth = cappedAdd(area, cappedAdd(factory.machines, factory.sources));
  return cappedMultiply(cappedMultiply(activeWidth, activeWidth), ticks);
}

export function estimateGameReplayWork(
  origin: GenOptions,
  intents: readonly GameIntent[],
): number {
  let mapCells = requireMapCells(origin);
  let total = cappedMultiply(mapCells, 32);
  let research: FactoryWorkProfile | null = null;
  let pilot: FactoryWorkProfile | null = null;
  let pilotContractSteps: number | null = null;
  let production: FactoryWorkProfile | null = null;
  let productionContractSteps: number | null = null;
  let nMaps = origin.nMaps;
  for (const intent of intents) {
    let intentWork = 0;
    switch (intent.kind) {
      case "setResearchLayout":
        research = layoutProfile(intent.layout);
        intentWork = research.cold;
        break;
      case "beginResearchShot":
        intentWork = research === null
          ? 1
          : cappedAdd(research.cold, mapTraversalWork(mapCells, 0));
        break;
      case "advanceResearchShot":
        intentWork = research === null
          ? 1
          : cappedAdd(research.cold, mapTraversalWork(mapCells, 1));
        break;
      case "abortResearchShot":
        intentWork = 1;
        break;
      case "sendResearchToPilot":
        if (research === null) {
          intentWork = 1;
        } else {
          pilot = research;
          pilotContractSteps = research.machines;
          intentWork = cappedAdd(
            research.cold,
            mapTraversalWork(mapCells, research.machines),
          );
        }
        break;
      case "setPilotLayout":
        pilot = layoutProfile(intent.layout);
        intentWork = pilot.cold;
        break;
      case "sendPilotToProduction":
        if (pilot === null || pilotContractSteps === null) {
          intentWork = 1;
        } else {
          production = pilot;
          productionContractSteps = pilotContractSteps;
          intentWork = cappedAdd(
            pilot.cold,
            cappedAdd(
              mapTraversalWork(mapCells, pilotContractSteps),
              factoryOutcomeWork(pilot),
            ),
          );
        }
        break;
      case "setProductionLayout":
        production = layoutProfile(intent.layout);
        intentWork = production.cold;
        break;
      case "productionTicks":
        if (production !== null) {
          intentWork = cappedAdd(
            production.cold,
            cappedMultiply(intent.ticks, production.perTick),
          );
          if (productionContractSteps !== null) {
            intentWork = cappedAdd(
              intentWork,
              mapTraversalWork(mapCells, productionContractSteps),
            );
          }
        }
        break;
      case "resetProduction":
        intentWork = production?.cold ?? 1;
        break;
      case "sellProduct":
        intentWork = MAX_GAME_INVENTORY_PRODUCTS + 1;
        break;
      case "sellProducts":
        intentWork = MAX_GAME_INVENTORY_PRODUCTS + intent.productIds.length;
        break;
      case "unlockPatent":
        intentWork = 262_144;
        if (intent.id === "bench-2") {
          if (research !== null) {
            research = expandProfile(research, 2, 0);
            intentWork = cappedAdd(intentWork, research.cold);
          }
          if (pilot !== null) {
            pilot = expandProfile(pilot, 2, 0);
            intentWork = cappedAdd(intentWork, pilot.cold);
          }
          if (production !== null) {
            production = expandProfile(production, 2, 0);
            intentWork = cappedAdd(intentWork, production.cold);
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
          research = null;
          pilot = null;
          pilotContractSteps = null;
          production = null;
          productionContractSteps = null;
        }
        break;
    }
    total = cappedAdd(total, intentWork);
    if (total > MAX_GAME_REPLAY_WORK) return total;
  }
  return total;
}
