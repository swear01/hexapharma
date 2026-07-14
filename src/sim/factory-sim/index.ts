import type {
  Dir,
  FactoryLayout,
  FactoryRuntime,
  InitFactoryFn,
  MachineTypeId,
  MultiMap,
  ProducedUnit,
  RestoreFactoryFn,
  SnapshotFactoryFn,
  StepFactoryFn,
  ThroughputReport,
  Unit,
  AnalyzeThroughputFn,
  CopyFactoryProductEventFn,
  FactoryMachineDef,
} from "../phase0_interfaces";
import {
  MAX_FACTORY_CELLS,
  MAX_FACTORY_ANALYSIS_WORK,
  MAX_FACTORY_MACHINES,
  MAX_FACTORY_PORTS,
  MAX_FACTORY_REPLAY_TICKS,
  MAX_MACHINE_PORTS,
  MAX_MACHINE_SHAPE_CELLS,
} from "../phase0_interfaces";
import {
  initialState,
  validateEffectMap,
  validateMachinePath,
  walkValidatedPathInto,
} from "../drug-graph";
import { worldCells, worldInPorts, worldOutPorts } from "../factory-geom";

const DIR_DX: readonly number[] = [1, 0, -1, 0];
const DIR_DY: readonly number[] = [0, 1, 0, -1];
const ACCEPT_NONE = -3;
const ACCEPT_TILE = -2;
const ACCEPT_SINK = -1;

type Acceptance = number;

interface CompiledLayout {
  readonly layout: FactoryLayout;
  readonly cellOwner: Int32Array;
  readonly machineSlotById: ReadonlyMap<number, number>;
  readonly machineIds: Int32Array;
  readonly machineSpeeds: Int32Array;
  readonly machineCosts: Int32Array;
  readonly machineDefs: readonly FactoryMachineDef[];
  readonly outPortStart: Int32Array;
  readonly outPortCount: Int32Array;
  readonly outPortX: Int32Array;
  readonly outPortY: Int32Array;
  readonly outPortSide: Int8Array;
  readonly inPortHead: Int32Array;
  readonly inPortMachineSlot: Int32Array;
  readonly inPortSide: Int8Array;
  readonly inPortNext: Int32Array;
  readonly sourceCells: Int32Array;
  readonly sourceDirs: Int8Array;
  readonly sourcePeriods: Int32Array;
  readonly splitterCells: Int32Array;
  readonly splitterSlotByCell: Int32Array;
}

interface MutableProductEvents {
  capacity: number;
  mapCount: number;
  count: number;
  ids: Int32Array;
  productionCosts: Int32Array;
  failed: Uint8Array;
  drugX: Int32Array;
  drugY: Int32Array;
}

interface MutableFactoryRuntime {
  capacity: number;
  mapCount: number;
  unitIds: Int32Array;
  unitX: Int32Array;
  unitY: Int32Array;
  unitProc: Int32Array;
  unitMachineIds: Int32Array;
  unitProductionCosts: Int32Array;
  unitFailed: Uint8Array;
  unitDrugX: Int32Array;
  unitDrugY: Int32Array;
  splitterCursors: Int32Array;
  producedEvents: MutableProductEvents;
  tick: number;
  unitCount: number;
  nextUnitId: number;
  producedTotal: number;
  deadlocked: boolean;
}

interface RuntimeInternals {
  readonly layout: FactoryLayout;
  readonly mm: MultiMap;
  readonly mapCount: number;
  readonly compiled: CompiledLayout;
  readonly unitMachineSlots: Int32Array;
  readonly occupancy: Int32Array;
  readonly machineHeld: Int32Array;
  readonly removed: Uint8Array;
  readonly movedTick: Uint8Array;
  readonly targetX: Int32Array;
  readonly targetY: Int32Array;
  readonly targetAcceptance: Int32Array;
  readonly targetMoveDir: Int8Array;
  readonly targetSplitterNext: Int32Array;
  readonly sourceDrugX: Int32Array;
  readonly sourceDrugY: Int32Array;
  readonly sourceFailed: number;
  readonly pathOut: Int32Array;
}

const compiledLayouts = new WeakMap<FactoryLayout, CompiledLayout>();
const runtimeInternals = new WeakMap<FactoryRuntime, RuntimeInternals>();
let layoutCompiles = 0;
let runtimeAllocations = 0;
let hotAllocations = 0;
let hotTicks = 0;

export function __factorySimDebugCounts(): {
  readonly layoutCompiles: number;
  readonly runtimeAllocations: number;
  readonly hotAllocations: number;
  readonly hotTicks: number;
} {
  return { layoutCompiles, runtimeAllocations, hotAllocations, hotTicks };
}

export function __resetFactorySimDebugCounts(): void {
  layoutCompiles = 0;
  runtimeAllocations = 0;
  hotAllocations = 0;
  hotTicks = 0;
}

export function requireFactoryAnalysisBudget(
  layout: FactoryLayout,
  ticks: number,
  operation: string,
): void {
  const area = layout.width * layout.height;
  if (!Number.isSafeInteger(area) || area < 1 || !Number.isSafeInteger(ticks) || ticks < 0) {
    throw new Error(`${operation}: invalid layout or tick budget`);
  }
  let sources = 0;
  for (const tile of layout.tiles) if (tile.kind === "source") sources += 1;
  const activeWidth = area + layout.machines.length + sources;
  const workPerTick = activeWidth * activeWidth;
  if (
    !Number.isSafeInteger(workPerTick) ||
    (workPerTick !== 0 && ticks > Math.floor(MAX_FACTORY_ANALYSIS_WORK / workPerTick))
  ) {
    throw new Error(
      `${operation}: estimated layout-weighted work exceeds analysis work budget ` +
        `${MAX_FACTORY_ANALYSIS_WORK}`,
    );
  }
}

function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

function inBounds(layout: FactoryLayout, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < layout.width && y < layout.height;
}

function validDir(value: number): value is Dir {
  return Number.isInteger(value) && value >= 0 && value <= 3;
}

function freezeLayoutAuthority(layout: FactoryLayout): void {
  for (const tile of layout.tiles) {
    if (tile.kind === "splitter") Object.freeze(tile.outDirs);
    if (tile.kind === "merger") Object.freeze(tile.inDirs);
    Object.freeze(tile);
  }
  for (const machine of layout.machines) {
    for (const delta of machine.def.path) Object.freeze(delta);
    Object.freeze(machine.def.path);
    Object.freeze(machine.def);
    for (const cell of machine.shape.cells) Object.freeze(cell);
    for (const port of machine.shape.inPorts) {
      Object.freeze(port.cell);
      Object.freeze(port);
    }
    for (const port of machine.shape.outPorts) {
      Object.freeze(port.cell);
      Object.freeze(port);
    }
    Object.freeze(machine.shape.cells);
    Object.freeze(machine.shape.inPorts);
    Object.freeze(machine.shape.outPorts);
    Object.freeze(machine.shape);
    Object.freeze(machine.anchor);
    Object.freeze(machine);
  }
  Object.freeze(layout.tiles);
  Object.freeze(layout.machines);
  Object.freeze(layout);
}

function compileLayout(layout: FactoryLayout): CompiledLayout {
  const cached = compiledLayouts.get(layout);
  if (cached !== undefined) return cached;

  if (
    !Number.isSafeInteger(layout.width) ||
    !Number.isSafeInteger(layout.height) ||
    layout.width < 1 ||
    layout.height < 1
  ) {
    throw new Error("factory layout: width and height must be positive safe integers");
  }

  const cellCount = layout.width * layout.height;
  if (
    !Number.isSafeInteger(cellCount) ||
    cellCount > MAX_FACTORY_CELLS ||
    !Array.isArray(layout.tiles) ||
    layout.tiles.length !== cellCount
  ) {
    throw new Error("factory layout: tile count does not match dimensions");
  }
  const machineCount = layout.machines.length;
  if (
    !Array.isArray(layout.machines) ||
    machineCount > MAX_FACTORY_MACHINES ||
    machineCount > cellCount
  ) {
    throw new Error("factory layout: machine count exceeds bounded cell capacity");
  }
  for (let slot = 0; slot < machineCount; slot++) {
    const machine = layout.machines[slot];
    if (
      machine === undefined ||
      !Array.isArray(machine.shape.cells) ||
      machine.shape.cells.length < 1 ||
      machine.shape.cells.length > MAX_MACHINE_SHAPE_CELLS ||
      !Array.isArray(machine.shape.inPorts) ||
      !Array.isArray(machine.shape.outPorts) ||
      machine.shape.inPorts.length > MAX_MACHINE_PORTS ||
      machine.shape.outPorts.length > MAX_MACHINE_PORTS
    ) {
      throw new Error(`factory layout: machine ${slot} shape or port count exceeds bounds`);
    }
  }
  const cellOwner = new Int32Array(cellCount).fill(-1);
  const machineSlotById = new Map<number, number>();
  const machineIds = new Int32Array(machineCount);
  const machineSpeeds = new Int32Array(machineCount);
  const machineCosts = new Int32Array(machineCount);
  const machineDefs = new Array<FactoryMachineDef>(machineCount);
  const outPortStart = new Int32Array(machineCount);
  const outPortCount = new Int32Array(machineCount);
  const inPortHead = new Int32Array(cellCount).fill(-1);
  const inPortTail = new Int32Array(cellCount).fill(-1);

  let inCount = 0;
  let outCount = 0;
  let shapeCellCount = 0;
  let sourceCount = 0;
  let splitterCount = 0;
  for (let i = 0; i < machineCount; i++) {
    const machine = layout.machines[i];
    if (machine === undefined) throw new Error(`factory layout: missing machine ${i}`);
    inCount += machine.shape.inPorts.length;
    outCount += machine.shape.outPorts.length;
    shapeCellCount += machine.shape.cells.length;
  }
  if (
    shapeCellCount > cellCount ||
    inCount > MAX_FACTORY_PORTS ||
    outCount > MAX_FACTORY_PORTS
  ) {
    throw new Error(`factory layout: total port count exceeds ${MAX_FACTORY_PORTS}`);
  }
  for (let cell = 0; cell < cellCount; cell++) {
    const tile = layout.tiles[cell];
    if (tile === undefined) throw new Error(`factory layout: missing tile ${cell}`);
    if (tile.kind === "source") {
      if (
        !validDir(tile.dir) ||
        !Number.isSafeInteger(tile.period) ||
        tile.period < 1 ||
        tile.period > 0x7fffffff
      ) {
        throw new Error(`factory layout: invalid source at tile ${cell}`);
      }
      sourceCount += 1;
    } else if (tile.kind === "belt") {
      if (!validDir(tile.dir)) throw new Error(`factory layout: invalid belt at tile ${cell}`);
    } else if (tile.kind === "splitter") {
      if (!validDir(tile.inDir) || tile.outDirs.length === 0 || tile.outDirs.length > 4) {
        throw new Error(`factory layout: invalid splitter at tile ${cell}`);
      }
      for (let i = 0; i < tile.outDirs.length; i++) {
        if (!validDir(tile.outDirs[i] ?? -1)) {
          throw new Error(`factory layout: invalid splitter output at tile ${cell}`);
        }
        for (let previous = 0; previous < i; previous++) {
          if (tile.outDirs[previous] === tile.outDirs[i]) {
            throw new Error(`factory layout: duplicate splitter output at tile ${cell}`);
          }
        }
      }
      splitterCount += 1;
    } else if (tile.kind === "merger") {
      if (!validDir(tile.outDir) || tile.inDirs.length === 0 || tile.inDirs.length > 4) {
        throw new Error(`factory layout: invalid merger at tile ${cell}`);
      }
      for (let i = 0; i < tile.inDirs.length; i++) {
        if (!validDir(tile.inDirs[i] ?? -1)) {
          throw new Error(`factory layout: invalid merger input at tile ${cell}`);
        }
        for (let previous = 0; previous < i; previous++) {
          if (tile.inDirs[previous] === tile.inDirs[i]) {
            throw new Error(`factory layout: duplicate merger input at tile ${cell}`);
          }
        }
      }
    } else if (tile.kind !== "empty" && tile.kind !== "sink") {
      throw new Error(`factory layout: unknown tile kind at tile ${cell}`);
    }
  }

  const inPortMachineSlot = new Int32Array(inCount);
  const inPortSide = new Int8Array(inCount);
  const inPortNext = new Int32Array(inCount).fill(-1);
  const outPortX = new Int32Array(outCount);
  const outPortY = new Int32Array(outCount);
  const outPortSide = new Int8Array(outCount);
  const sourceCells = new Int32Array(sourceCount);
  const sourceDirs = new Int8Array(sourceCount);
  const sourcePeriods = new Int32Array(sourceCount);
  const splitterCells = new Int32Array(splitterCount);
  const splitterSlotByCell = new Int32Array(cellCount).fill(-1);

  let inIndex = 0;
  let outIndex = 0;
  for (let slot = 0; slot < machineCount; slot++) {
    const machine = layout.machines[slot];
    if (machine === undefined) throw new Error(`factory layout: missing machine ${slot}`);
    if (
      !Number.isSafeInteger(machine.id) ||
      machine.id < 0 ||
      machine.id > 0x7fffffff ||
      !Number.isSafeInteger(machine.anchor.x) ||
      !Number.isSafeInteger(machine.anchor.y) ||
      !Number.isInteger(machine.footRot) ||
      machine.footRot < 0 ||
      machine.footRot > 3
    ) {
      throw new Error(`factory layout: invalid placement for machine ${machine.id}`);
    }
    if (machineSlotById.has(machine.id)) {
      throw new Error(`factory layout: duplicate machine id ${machine.id}`);
    }
    if (
      typeof machine.def.typeId !== "string" ||
      machine.def.typeId.length === 0
    ) {
      throw new Error(`factory layout: invalid definition for machine ${machine.id}`);
    }
    validateMachinePath(machine.def);
    if (machine.shape.cells.length === 0) {
      throw new Error(`factory layout: machine ${machine.id} has no footprint cells`);
    }
    for (let cellIndex = 0; cellIndex < machine.shape.cells.length; cellIndex++) {
      const cell = machine.shape.cells[cellIndex];
      if (
        cell === undefined ||
        !Number.isSafeInteger(cell.x) ||
        !Number.isSafeInteger(cell.y)
      ) {
        throw new Error(`factory layout: invalid footprint for machine ${machine.id}`);
      }
      for (let previous = 0; previous < cellIndex; previous++) {
        const other = machine.shape.cells[previous];
        if (other?.x === cell.x && other.y === cell.y) {
          throw new Error(`factory layout: duplicate footprint cell for machine ${machine.id}`);
        }
      }
    }
    for (let kind = 0; kind < 2; kind++) {
      const ports = kind === 0 ? machine.shape.inPorts : machine.shape.outPorts;
      for (let portIndex = 0; portIndex < ports.length; portIndex++) {
        const port = ports[portIndex];
        if (
          port === undefined ||
          !Number.isSafeInteger(port.cell.x) ||
          !Number.isSafeInteger(port.cell.y) ||
          !validDir(port.side)
        ) {
          throw new Error(`factory layout: invalid port for machine ${machine.id}`);
        }
        let belongsToFootprint = false;
        for (let cellIndex = 0; cellIndex < machine.shape.cells.length; cellIndex++) {
          const cell = machine.shape.cells[cellIndex];
          if (cell?.x === port.cell.x && cell.y === port.cell.y) belongsToFootprint = true;
        }
        if (!belongsToFootprint) {
          throw new Error(`factory layout: detached port for machine ${machine.id}`);
        }
      }
    }
    machineSlotById.set(machine.id, slot);
    machineIds[slot] = machine.id;
    machineSpeeds[slot] = machine.def.speed;
    machineCosts[slot] = machine.def.cost;
    machineDefs[slot] = machine.def;
    if (
      !Number.isSafeInteger(machine.def.speed) ||
      machine.def.speed < 1 ||
      machine.def.speed > 0x7fffffff
    ) {
      throw new Error(`factory layout: invalid speed for machine ${machine.id}`);
    }
    if (
      !Number.isSafeInteger(machine.def.cost) ||
      machine.def.cost < 0 ||
      machine.def.cost > 0x7fffffff
    ) {
      throw new Error(`factory layout: invalid cost for machine ${machine.id}`);
    }

    const cells = worldCells(machine);
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i];
      if (cell === undefined || !inBounds(layout, cell.x, cell.y)) {
        throw new Error(`factory layout: machine ${machine.id} extends out of bounds`);
      }
      const index = cell.y * layout.width + cell.x;
      if ((cellOwner[index] ?? -1) >= 0) {
        throw new Error(`factory layout: overlapping machine cell ${cell.x},${cell.y}`);
      }
      if (layout.tiles[index]?.kind !== "empty") {
        throw new Error(`factory layout: machine ${machine.id} overlaps a factory tile`);
      }
      cellOwner[index] = slot;
    }

    const inputs = worldInPorts(machine);
    for (let i = 0; i < inputs.length; i++) {
      const port = inputs[i];
      if (port === undefined) continue;
      if (!inBounds(layout, port.x, port.y)) {
        throw new Error(`factory layout: machine ${machine.id} input port is out of bounds`);
      }
      inPortMachineSlot[inIndex] = slot;
      inPortSide[inIndex] = port.side;
      const cellIndex = port.y * layout.width + port.x;
      const tail = inPortTail[cellIndex] ?? -1;
      if (tail < 0) inPortHead[cellIndex] = inIndex;
      else inPortNext[tail] = inIndex;
      inPortTail[cellIndex] = inIndex;
      inIndex += 1;
    }

    const outputs = worldOutPorts(machine);
    outPortStart[slot] = outIndex;
    outPortCount[slot] = outputs.length;
    for (let i = 0; i < outputs.length; i++) {
      const port = outputs[i];
      if (port === undefined) continue;
      if (!inBounds(layout, port.x, port.y)) {
        throw new Error(`factory layout: machine ${machine.id} output port is out of bounds`);
      }
      outPortX[outIndex] = port.x;
      outPortY[outIndex] = port.y;
      outPortSide[outIndex] = port.side;
      outIndex += 1;
    }
  }

  let sourceIndex = 0;
  let splitterIndex = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    const tile = layout.tiles[cell];
    if (tile?.kind === "source") {
      sourceCells[sourceIndex] = cell;
      sourceDirs[sourceIndex] = tile.dir;
      sourcePeriods[sourceIndex] = tile.period;
      sourceIndex += 1;
    } else if (tile?.kind === "splitter") {
      splitterCells[splitterIndex] = cell;
      splitterSlotByCell[cell] = splitterIndex;
      splitterIndex += 1;
    }
  }

  const compiled: CompiledLayout = {
    layout,
    cellOwner,
    machineSlotById,
    machineIds,
    machineSpeeds,
    machineCosts,
    machineDefs,
    outPortStart,
    outPortCount,
    outPortX,
    outPortY,
    outPortSide,
    inPortHead,
    inPortMachineSlot,
    inPortSide,
    inPortNext,
    sourceCells,
    sourceDirs,
    sourcePeriods,
    splitterCells,
    splitterSlotByCell,
  };
  freezeLayoutAuthority(layout);
  compiledLayouts.set(layout, compiled);
  layoutCompiles += 1;
  return compiled;
}

function acceptanceAt(
  compiled: CompiledLayout,
  tx: number,
  ty: number,
  moveDir: Dir,
): Acceptance {
  const layout = compiled.layout;
  if (!inBounds(layout, tx, ty)) return ACCEPT_NONE;
  const index = ty * layout.width + tx;
  if ((compiled.cellOwner[index] ?? -1) >= 0) {
    const side = opposite(moveDir);
    let port = compiled.inPortHead[index] ?? -1;
    while (port >= 0) {
      if (compiled.inPortSide[port] === side) {
        return compiled.inPortMachineSlot[port] ?? ACCEPT_NONE;
      }
      port = compiled.inPortNext[port] ?? -1;
    }
    return ACCEPT_NONE;
  }
  const tile = layout.tiles[index];
  if (tile === undefined) return ACCEPT_NONE;
  if (tile.kind === "belt") {
    return ACCEPT_TILE;
  }
  const incomingSide = opposite(moveDir);
  if (tile.kind === "splitter") {
    return tile.inDir === incomingSide ? ACCEPT_TILE : ACCEPT_NONE;
  }
  if (tile.kind === "merger") {
    for (let i = 0; i < tile.inDirs.length; i++) {
      if (tile.inDirs[i] === incomingSide) return ACCEPT_TILE;
    }
    return ACCEPT_NONE;
  }
  if (tile.kind === "sink") return ACCEPT_SINK;
  return ACCEPT_NONE;
}

function isMachineInputCell(
  compiled: CompiledLayout,
  machineSlot: number,
  x: number,
  y: number,
): boolean {
  if (!inBounds(compiled.layout, x, y)) return false;
  let port = compiled.inPortHead[y * compiled.layout.width + x] ?? -1;
  while (port >= 0) {
    if (compiled.inPortMachineSlot[port] === machineSlot) return true;
    port = compiled.inPortNext[port] ?? -1;
  }
  return false;
}

function targetIfFree(
  compiled: CompiledLayout,
  occupancy: Int32Array,
  machineHeld: Int32Array,
  tx: number,
  ty: number,
  moveDir: Dir,
): Acceptance {
  const acceptance = acceptanceAt(compiled, tx, ty, moveDir);
  if (acceptance === ACCEPT_NONE) return ACCEPT_NONE;
  if (acceptance >= 0) return machineHeld[acceptance] === -1 ? acceptance : ACCEPT_NONE;
  if (acceptance === ACCEPT_SINK) return ACCEPT_SINK;
  return occupancy[ty * compiled.layout.width + tx] === -1 ? ACCEPT_TILE : ACCEPT_NONE;
}

function mergerInputPriority(layout: FactoryLayout, x: number, y: number, moveDir: Dir): number {
  if (!inBounds(layout, x, y)) return -1;
  const tile = layout.tiles[y * layout.width + x];
  if (tile?.kind !== "merger") return -1;
  const incomingSide = opposite(moveDir);
  for (let priority = 0; priority < tile.inDirs.length; priority++) {
    if (tile.inDirs[priority] === incomingSide) return priority;
  }
  return -1;
}

function prepareUnitTargets(
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  occupancy: Int32Array,
  machineHeld: Int32Array,
  removed: Uint8Array,
  movedTick: Uint8Array,
): void {
  const compiled = data.compiled;
  const layout = data.layout;
  const width = layout.width;
  data.targetAcceptance.fill(ACCEPT_NONE);
  data.targetSplitterNext.fill(-1);
  for (let i = 0; i < runtime.unitCount; i++) {
    if (removed[i] !== 0 || movedTick[i] !== 0) continue;
    let targetX = 0;
    let targetY = 0;
    let targetAcceptance = ACCEPT_NONE;
    let targetMoveDir: Dir = 0;
    const currentMachineSlot = data.unitMachineSlots[i] ?? -1;
    if (currentMachineSlot >= 0) {
      if ((runtime.unitProc[i] ?? 0) < (compiled.machineSpeeds[currentMachineSlot] ?? 0)) {
        continue;
      }
      const start = compiled.outPortStart[currentMachineSlot] ?? 0;
      const count = compiled.outPortCount[currentMachineSlot] ?? 0;
      for (let portOffset = 0; portOffset < count; portOffset++) {
        const portIndex = start + portOffset;
        const side = (compiled.outPortSide[portIndex] ?? 0) as Dir;
        const nx = (compiled.outPortX[portIndex] ?? 0) + (DIR_DX[side] ?? 0);
        const ny = (compiled.outPortY[portIndex] ?? 0) + (DIR_DY[side] ?? 0);
        const acceptance = targetIfFree(compiled, occupancy, machineHeld, nx, ny, side);
        if (acceptance === ACCEPT_NONE) continue;
        targetX = nx;
        targetY = ny;
        targetAcceptance = acceptance;
        targetMoveDir = side;
        break;
      }
    } else {
      const x = runtime.unitX[i] ?? 0;
      const y = runtime.unitY[i] ?? 0;
      const cell = y * width + x;
      const tile = layout.tiles[cell];
      if (tile === undefined) continue;
      if (tile.kind === "belt" || tile.kind === "merger") {
        const dir = tile.kind === "belt" ? tile.dir : tile.outDir;
        const nx = x + (DIR_DX[dir] ?? 0);
        const ny = y + (DIR_DY[dir] ?? 0);
        const acceptance = targetIfFree(compiled, occupancy, machineHeld, nx, ny, dir);
        if (acceptance !== ACCEPT_NONE) {
          targetX = nx;
          targetY = ny;
          targetAcceptance = acceptance;
          targetMoveDir = dir;
        }
      } else if (tile.kind === "splitter") {
        const splitterSlot = compiled.splitterSlotByCell[cell] ?? -1;
        const outputCount = tile.outDirs.length;
        const cursor = runtime.splitterCursors[splitterSlot] ?? 0;
        for (let offset = 0; offset < outputCount; offset++) {
          const outputIndex = (cursor + offset) % outputCount;
          const dir = (tile.outDirs[outputIndex] ?? 0) as Dir;
          const nx = x + (DIR_DX[dir] ?? 0);
          const ny = y + (DIR_DY[dir] ?? 0);
          const acceptance = targetIfFree(compiled, occupancy, machineHeld, nx, ny, dir);
          if (acceptance === ACCEPT_NONE) continue;
          targetX = nx;
          targetY = ny;
          targetAcceptance = acceptance;
          targetMoveDir = dir;
          data.targetSplitterNext[i] = (outputIndex + 1) % outputCount;
          break;
        }
      }
    }
    if (targetAcceptance === ACCEPT_NONE) continue;
    data.targetX[i] = targetX;
    data.targetY[i] = targetY;
    data.targetAcceptance[i] = targetAcceptance;
    data.targetMoveDir[i] = targetMoveDir;
  }
}

function winningUnitForMerger(
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  targetX: number,
  targetY: number,
): number {
  let winner = -1;
  let winnerPriority = 0x7fffffff;
  let winnerId = 0x7fffffff;
  for (let i = 0; i < runtime.unitCount; i++) {
    if (
      data.targetAcceptance[i] === ACCEPT_NONE ||
      data.targetX[i] !== targetX ||
      data.targetY[i] !== targetY
    ) {
      continue;
    }
    const priority = mergerInputPriority(
      data.layout,
      targetX,
      targetY,
      (data.targetMoveDir[i] ?? 0) as Dir,
    );
    if (priority < 0) continue;
    const id = runtime.unitIds[i] ?? 0x7fffffff;
    if (priority < winnerPriority || (priority === winnerPriority && id < winnerId)) {
      winner = i;
      winnerPriority = priority;
      winnerId = id;
    }
  }
  return winner;
}

function hasHigherPriorityScheduledSource(
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  targetX: number,
  targetY: number,
  priority: number,
  excludedSource: number,
): boolean {
  const compiled = data.compiled;
  const width = data.layout.width;
  for (let sourceIndex = 0; sourceIndex < compiled.sourceCells.length; sourceIndex++) {
    if (sourceIndex === excludedSource) continue;
    const period = compiled.sourcePeriods[sourceIndex] ?? 0;
    if (period <= 0 || runtime.tick % period !== 0) continue;
    const sourceCell = compiled.sourceCells[sourceIndex] ?? 0;
    const sourceX = sourceCell % width;
    const sourceY = (sourceCell - sourceX) / width;
    const dir = (compiled.sourceDirs[sourceIndex] ?? 0) as Dir;
    if (
      sourceX + (DIR_DX[dir] ?? 0) !== targetX ||
      sourceY + (DIR_DY[dir] ?? 0) !== targetY
    ) {
      continue;
    }
    const candidatePriority = mergerInputPriority(data.layout, targetX, targetY, dir);
    if (candidatePriority >= 0 && candidatePriority < priority) return true;
  }
  return false;
}

function resetProductEvents(events: MutableProductEvents): void {
  events.count = 0;
  events.ids.fill(0);
  events.productionCosts.fill(0);
  events.failed.fill(0);
  events.drugX.fill(0);
  events.drugY.fill(0);
}

export function clearFactoryProductEvents(runtime: FactoryRuntime): void {
  resetProductEvents((runtime as MutableFactoryRuntime).producedEvents);
}

export const copyFactoryProductEvent: CopyFactoryProductEventFn = (
  runtime,
  eventIndex,
  out,
  outOffset,
) => {
  const events = runtime.producedEvents;
  const needed = 3 + runtime.mapCount * 2;
  if (
    !Number.isInteger(eventIndex) ||
    eventIndex < 0 ||
    eventIndex >= events.count ||
    !Number.isInteger(outOffset) ||
    outOffset < 0 ||
    outOffset + needed > out.length
  ) {
    throw new Error("factory product event copy: index or output range is invalid");
  }
  out[outOffset] = events.ids[eventIndex] ?? 0;
  out[outOffset + 1] = events.productionCosts[eventIndex] ?? 0;
  out[outOffset + 2] = events.failed[eventIndex] ?? 0;
  const base = eventIndex * runtime.mapCount;
  for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
    out[outOffset + 3 + mapIndex * 2] = events.drugX[base + mapIndex] ?? 0;
    out[outOffset + 4 + mapIndex * 2] = events.drugY[base + mapIndex] ?? 0;
  }
};

function clearUnitSlot(runtime: MutableFactoryRuntime, data: RuntimeInternals, slot: number): void {
  runtime.unitIds[slot] = 0;
  runtime.unitX[slot] = 0;
  runtime.unitY[slot] = 0;
  runtime.unitProc[slot] = 0;
  runtime.unitMachineIds[slot] = -1;
  runtime.unitProductionCosts[slot] = 0;
  runtime.unitFailed[slot] = 0;
  data.unitMachineSlots[slot] = -1;
  const base = slot * runtime.mapCount;
  for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
    runtime.unitDrugX[base + mapIndex] = 0;
    runtime.unitDrugY[base + mapIndex] = 0;
  }
}

function copyUnitSlot(
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  from: number,
  to: number,
): void {
  runtime.unitIds[to] = runtime.unitIds[from] ?? 0;
  runtime.unitX[to] = runtime.unitX[from] ?? 0;
  runtime.unitY[to] = runtime.unitY[from] ?? 0;
  runtime.unitProc[to] = runtime.unitProc[from] ?? 0;
  runtime.unitMachineIds[to] = runtime.unitMachineIds[from] ?? -1;
  runtime.unitProductionCosts[to] = runtime.unitProductionCosts[from] ?? 0;
  runtime.unitFailed[to] = runtime.unitFailed[from] ?? 0;
  data.unitMachineSlots[to] = data.unitMachineSlots[from] ?? -1;
  const fromBase = from * runtime.mapCount;
  const toBase = to * runtime.mapCount;
  for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
    runtime.unitDrugX[toBase + mapIndex] = runtime.unitDrugX[fromBase + mapIndex] ?? 0;
    runtime.unitDrugY[toBase + mapIndex] = runtime.unitDrugY[fromBase + mapIndex] ?? 0;
  }
}

function appendProductFromUnit(
  runtime: MutableFactoryRuntime,
  unitIndex: number,
): void {
  const events = runtime.producedEvents;
  const eventIndex = events.count;
  if (eventIndex >= events.capacity) {
    throw new Error("factory invariant: product event capacity exceeded");
  }
  events.ids[eventIndex] = runtime.unitIds[unitIndex] ?? 0;
  events.productionCosts[eventIndex] = runtime.unitProductionCosts[unitIndex] ?? 0;
  events.failed[eventIndex] = runtime.unitFailed[unitIndex] ?? 0;
  const unitBase = unitIndex * runtime.mapCount;
  const eventBase = eventIndex * runtime.mapCount;
  for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
    events.drugX[eventBase + mapIndex] = runtime.unitDrugX[unitBase + mapIndex] ?? 0;
    events.drugY[eventBase + mapIndex] = runtime.unitDrugY[unitBase + mapIndex] ?? 0;
  }
  events.count = eventIndex + 1;
  runtime.producedTotal += 1;
}

function appendProductFromSource(
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  id: number,
): void {
  const events = runtime.producedEvents;
  const eventIndex = events.count;
  if (eventIndex >= events.capacity) {
    throw new Error("factory invariant: product event capacity exceeded");
  }
  events.ids[eventIndex] = id;
  events.productionCosts[eventIndex] = 0;
  events.failed[eventIndex] = data.sourceFailed;
  const eventBase = eventIndex * runtime.mapCount;
  for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
    events.drugX[eventBase + mapIndex] = data.sourceDrugX[mapIndex] ?? 0;
    events.drugY[eventBase + mapIndex] = data.sourceDrugY[mapIndex] ?? 0;
  }
  events.count = eventIndex + 1;
  runtime.producedTotal += 1;
}

function applyMachineInPlace(
  mm: MultiMap,
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  unitIndex: number,
  machineSlot: number,
): void {
  if (runtime.unitFailed[unitIndex] !== 0) return;
  const compiled = data.compiled;
  const machine = compiled.machineDefs[machineSlot];
  if (machine === undefined) throw new Error("factory invariant: missing compiled machine path");
  const base = unitIndex * runtime.mapCount;
  let failed = 0;
  for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
    const map = mm.maps[mapIndex];
    if (map === undefined) throw new Error("factory invariant: missing validated effect map");
    const index = base + mapIndex;
    const fromX = runtime.unitDrugX[index] ?? 0;
    const fromY = runtime.unitDrugY[index] ?? 0;
    walkValidatedPathInto(map, fromX, fromY, machine, data.pathOut, 0);
    runtime.unitDrugX[index] = data.pathOut[0] ?? fromX;
    runtime.unitDrugY[index] = data.pathOut[1] ?? fromY;
    if (data.pathOut[2] !== 0) failed = 1;
  }
  runtime.unitFailed[unitIndex] = failed;
}

function emitUnit(
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  x: number,
  y: number,
  machineSlot: number,
): number {
  const slot = runtime.unitCount;
  if (slot >= runtime.capacity) {
    throw new Error("factory invariant: active unit capacity exceeded");
  }
  runtime.unitIds[slot] = runtime.nextUnitId;
  runtime.unitX[slot] = x;
  runtime.unitY[slot] = y;
  runtime.unitProc[slot] = 0;
  runtime.unitProductionCosts[slot] = 0;
  runtime.unitFailed[slot] = data.sourceFailed;
  data.unitMachineSlots[slot] = machineSlot;
  runtime.unitMachineIds[slot] =
    machineSlot >= 0 ? (data.compiled.machineIds[machineSlot] ?? -1) : -1;
  const base = slot * runtime.mapCount;
  for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
    runtime.unitDrugX[base + mapIndex] = data.sourceDrugX[mapIndex] ?? 0;
    runtime.unitDrugY[base + mapIndex] = data.sourceDrugY[mapIndex] ?? 0;
  }
  runtime.unitCount = slot + 1;
  runtime.nextUnitId += 1;
  return slot;
}

interface ImportMetaEnvironment {
  readonly env?: { readonly DEV?: boolean };
}

const IMPORT_META_ENV = (import.meta as ImportMetaEnvironment).env;
const DEBUG_INVARIANTS =
  IMPORT_META_ENV?.DEV ??
  (typeof process !== "undefined" && process.env.NODE_ENV !== "production");

function assertRuntime(
  runtime: MutableFactoryRuntime,
  data: RuntimeInternals,
  force: boolean,
): void {
  if (!force && !DEBUG_INVARIANTS) return;
  if (
    !Number.isSafeInteger(runtime.tick) ||
    runtime.tick < 0 ||
    !Number.isSafeInteger(runtime.nextUnitId) ||
    runtime.nextUnitId < 0 ||
    !Number.isSafeInteger(runtime.producedTotal) ||
    runtime.producedTotal < 0 ||
    typeof runtime.deadlocked !== "boolean"
  ) {
    throw new Error("factory invariant: invalid runtime scalar state");
  }
  if (runtime.mapCount !== data.mapCount) {
    throw new Error("factory invariant: map count mismatch");
  }
  if (runtime.splitterCursors.length !== data.compiled.splitterCells.length) {
    throw new Error("factory invariant: splitter cursor count mismatch");
  }
  for (let slot = 0; slot < runtime.splitterCursors.length; slot++) {
    const cell = data.compiled.splitterCells[slot] ?? -1;
    const tile = data.layout.tiles[cell];
    const cursor = runtime.splitterCursors[slot] ?? -1;
    if (tile?.kind !== "splitter" || cursor < 0 || cursor >= tile.outDirs.length) {
      throw new Error(`factory invariant: invalid splitter cursor ${slot}`);
    }
  }
  if (runtime.nextUnitId !== runtime.unitCount + runtime.producedTotal) {
    throw new Error(
      `factory invariant: mass conservation failed: nextUnitId=${runtime.nextUnitId}, producedTotal=${runtime.producedTotal}, inTransit=${runtime.unitCount}`,
    );
  }
  if (runtime.unitCount < 0 || runtime.unitCount > runtime.capacity) {
    throw new Error("factory invariant: invalid active unit count");
  }
  if (
    runtime.producedEvents.count < 0 ||
    runtime.producedEvents.count > runtime.producedEvents.capacity ||
    runtime.producedEvents.count > runtime.producedTotal
  ) {
    throw new Error("factory invariant: invalid product event count");
  }

  for (let i = 0; i < runtime.unitCount; i++) {
    const id = runtime.unitIds[i] ?? -1;
    if (!Number.isInteger(id) || id < 0 || id >= runtime.nextUnitId) {
      throw new Error(`factory invariant: invalid in-transit unit id ${id}`);
    }
    if (i > 0 && id <= (runtime.unitIds[i - 1] ?? -1)) {
      throw new Error(`factory invariant: duplicate or unsorted unit id ${id}`);
    }
    const proc = runtime.unitProc[i] ?? -1;
    const cost = runtime.unitProductionCosts[i] ?? -1;
    if (!Number.isInteger(proc) || proc < 0) {
      throw new Error(`factory invariant: negative proc for unit ${id}`);
    }
    if (!Number.isInteger(cost) || cost < 0) {
      throw new Error(`factory invariant: negative production cost for unit ${id}`);
    }
    const machineSlot = data.unitMachineSlots[i] ?? -1;
    if (machineSlot < 0) {
      if ((runtime.unitMachineIds[i] ?? -1) !== -1) {
        throw new Error(`factory invariant: machine id/slot mismatch for unit ${id}`);
      }
      const x = runtime.unitX[i] ?? -1;
      const y = runtime.unitY[i] ?? -1;
      if (!inBounds(data.layout, x, y)) {
        throw new Error(`factory invariant: belt unit ${id} is out of bounds`);
      }
      if ((data.compiled.cellOwner[y * data.layout.width + x] ?? -1) >= 0) {
        throw new Error(`factory invariant: belt unit ${id} overlaps a machine`);
      }
      const tile = data.layout.tiles[y * data.layout.width + x];
      if (
        tile === undefined ||
        (tile.kind !== "belt" && tile.kind !== "splitter" && tile.kind !== "merger")
      ) {
        throw new Error(`factory invariant: belt unit ${id} occupies a non-carrier tile`);
      }
      for (let j = 0; j < i; j++) {
        if (
          (data.unitMachineSlots[j] ?? -1) < 0 &&
          runtime.unitX[j] === x &&
          runtime.unitY[j] === y
        ) {
          throw new Error(`factory invariant: belt capacity exceeded at ${x},${y}`);
        }
      }
      continue;
    }
    if (machineSlot >= data.compiled.machineIds.length) {
      throw new Error(`factory invariant: unit ${id} references unknown machine slot ${machineSlot}`);
    }
    if ((runtime.unitMachineIds[i] ?? -1) !== data.compiled.machineIds[machineSlot]) {
      throw new Error(`factory invariant: machine id/slot mismatch for unit ${id}`);
    }
    if (
      !isMachineInputCell(
        data.compiled,
        machineSlot,
        runtime.unitX[i] ?? -1,
        runtime.unitY[i] ?? -1,
      )
    ) {
      throw new Error(`factory invariant: machine-held unit ${id} is not at an input port`);
    }
    if (proc > (data.compiled.machineSpeeds[machineSlot] ?? 0)) {
      throw new Error(`factory invariant: proc exceeds machine speed for unit ${id}`);
    }
    for (let j = 0; j < i; j++) {
      if (data.unitMachineSlots[j] === machineSlot) {
        throw new Error(
          `factory invariant: machine ${data.compiled.machineIds[machineSlot]} capacity exceeded`,
        );
      }
    }
  }

  for (let i = 0; i < runtime.producedEvents.count; i++) {
    const id = runtime.producedEvents.ids[i] ?? -1;
    if (!Number.isInteger(id) || id < 0 || id >= runtime.nextUnitId) {
      throw new Error(`factory invariant: invalid produced unit id ${id}`);
    }
    if (i > 0 && id <= (runtime.producedEvents.ids[i - 1] ?? -1)) {
      throw new Error(`factory invariant: duplicate or unsorted produced unit id ${id}`);
    }
    for (let unitIndex = 0; unitIndex < runtime.unitCount; unitIndex++) {
      if (runtime.unitIds[unitIndex] === id) {
        throw new Error(`factory invariant: produced unit ${id} is still in transit`);
      }
    }
    const cost = runtime.producedEvents.productionCosts[i] ?? -1;
    if (!Number.isInteger(cost) || cost < 0) {
      throw new Error(`factory invariant: negative production cost for unit ${id}`);
    }
  }
}

export const initFactory: InitFactoryFn = (layout, mm, start) => {
  const compiled = compileLayout(layout);
  const mapCount = mm.maps.length;
  if (mapCount < 1 || mapCount > 4 || start.pos.length !== mapCount) {
    throw new Error("factory init: start state map count mismatch");
  }
  if (typeof start.failed !== "boolean") {
    throw new Error("factory init: invalid start failure flag");
  }
  let carrierCount = 0;
  for (const tile of layout.tiles) {
    if (tile.kind === "belt" || tile.kind === "splitter" || tile.kind === "merger") {
      carrierCount += 1;
    }
  }
  const capacity = carrierCount + layout.machines.length;
  const eventCapacity = capacity + compiled.sourceCells.length;
  const productEvents: MutableProductEvents = {
    capacity: eventCapacity,
    mapCount,
    count: 0,
    ids: new Int32Array(eventCapacity),
    productionCosts: new Int32Array(eventCapacity),
    failed: new Uint8Array(eventCapacity),
    drugX: new Int32Array(eventCapacity * mapCount),
    drugY: new Int32Array(eventCapacity * mapCount),
  };
  const runtime: MutableFactoryRuntime = {
    capacity,
    mapCount,
    unitIds: new Int32Array(capacity),
    unitX: new Int32Array(capacity),
    unitY: new Int32Array(capacity),
    unitProc: new Int32Array(capacity),
    unitMachineIds: new Int32Array(capacity).fill(-1),
    unitProductionCosts: new Int32Array(capacity),
    unitFailed: new Uint8Array(capacity),
    unitDrugX: new Int32Array(capacity * mapCount),
    unitDrugY: new Int32Array(capacity * mapCount),
    splitterCursors: new Int32Array(compiled.splitterCells.length),
    producedEvents: productEvents,
    tick: 0,
    unitCount: 0,
    nextUnitId: 0,
    producedTotal: 0,
    deadlocked: false,
  };
  const sourceDrugX = new Int32Array(mapCount);
  const sourceDrugY = new Int32Array(mapCount);
  for (let mapIndex = 0; mapIndex < mapCount; mapIndex++) {
    const map = mm.maps[mapIndex];
    const pos = start.pos[mapIndex];
    if (map === undefined) throw new Error("factory init: missing effect map");
    validateEffectMap(map);
    if (
      pos === undefined ||
      map.cureId.length !== map.cell.length ||
      map.sideEffectId.length !== map.cell.length ||
      map.fog.length !== map.cell.length ||
      !Number.isSafeInteger(pos.x) ||
      !Number.isSafeInteger(pos.y) ||
      pos.x < 0 ||
      pos.y < 0 ||
      pos.x >= map.width ||
      pos.y >= map.height
    ) {
      throw new Error("factory init: invalid map or start position");
    }
    sourceDrugX[mapIndex] = pos.x;
    sourceDrugY[mapIndex] = pos.y;
  }
  const data: RuntimeInternals = {
    layout,
    mm,
    mapCount,
    compiled,
    unitMachineSlots: new Int32Array(capacity).fill(-1),
    occupancy: new Int32Array(layout.width * layout.height),
    machineHeld: new Int32Array(layout.machines.length),
    removed: new Uint8Array(capacity),
    movedTick: new Uint8Array(capacity),
    targetX: new Int32Array(capacity),
    targetY: new Int32Array(capacity),
    targetAcceptance: new Int32Array(capacity),
    targetMoveDir: new Int8Array(capacity),
    targetSplitterNext: new Int32Array(capacity),
    sourceDrugX,
    sourceDrugY,
    sourceFailed: start.failed ? 1 : 0,
    pathOut: new Int32Array(3),
  };
  const publicRuntime: FactoryRuntime = runtime;
  runtimeInternals.set(publicRuntime, data);
  runtimeAllocations += 1;
  assertRuntime(runtime, data, true);
  return publicRuntime;
};

export const stepFactory: StepFactoryFn = (layout, mm, publicRuntime) => {
  const runtime = publicRuntime as MutableFactoryRuntime;
  const data = runtimeInternals.get(publicRuntime);
  if (data === undefined) throw new Error("factory runtime was not created by init/restore");
  if (data.layout !== layout || data.mm !== mm || runtime.mapCount !== mm.maps.length) {
    throw new Error("factory runtime layout/map authority mismatch");
  }
  const compiled = data.compiled;
  const width = layout.width;
  hotTicks += 1;
  assertRuntime(runtime, data, false);
  resetProductEvents(runtime.producedEvents);
  if (runtime.deadlocked) {
    runtime.tick += 1;
    assertRuntime(runtime, data, false);
    return;
  }

  const occupancy = data.occupancy;
  const machineHeld = data.machineHeld;
  const removed = data.removed;
  const movedTick = data.movedTick;
  occupancy.fill(-1);
  machineHeld.fill(-1);
  removed.fill(0);
  movedTick.fill(0);

  for (let i = 0; i < runtime.unitCount; i++) {
    const machineSlot = data.unitMachineSlots[i] ?? -1;
    if (machineSlot < 0) {
      const x = runtime.unitX[i] ?? 0;
      const y = runtime.unitY[i] ?? 0;
      occupancy[y * width + x] = i;
    } else {
      machineHeld[machineSlot] = i;
    }
  }

  let didProcess = false;
  let didMove = false;
  let didEmit = false;
  let didProduce = false;

  for (let i = 0; i < runtime.unitCount; i++) {
    const machineSlot = data.unitMachineSlots[i] ?? -1;
    if (machineSlot < 0) continue;
    const speed = compiled.machineSpeeds[machineSlot] ?? 0;
    const proc = runtime.unitProc[i] ?? 0;
    if (proc >= speed) continue;
    const nextProc = proc + 1;
    runtime.unitProc[i] = nextProc;
    didProcess = true;
    if (nextProc === speed) {
      const currentCost = runtime.unitProductionCosts[i] ?? 0;
      const machineCost = compiled.machineCosts[machineSlot] ?? 0;
      if (currentCost > 0x7fffffff - machineCost) {
        throw new Error(`factory runtime: production cost exceeds int32 for unit ${runtime.unitIds[i]}`);
      }
      applyMachineInPlace(mm, runtime, data, i, machineSlot);
      runtime.unitProductionCosts[i] = currentCost + machineCost;
    }
  }

  let movedThisPass = true;
  while (movedThisPass) {
    movedThisPass = false;
    prepareUnitTargets(runtime, data, occupancy, machineHeld, removed, movedTick);
    for (let i = 0; i < runtime.unitCount; i++) {
      if (removed[i] !== 0 || movedTick[i] !== 0) continue;
      const targetX = data.targetX[i] ?? 0;
      const targetY = data.targetY[i] ?? 0;
      const targetAcceptance = data.targetAcceptance[i] ?? ACCEPT_NONE;
      const moveDir = (data.targetMoveDir[i] ?? 0) as Dir;
      const currentMachineSlot = data.unitMachineSlots[i] ?? -1;
      if (targetAcceptance === ACCEPT_NONE) continue;
      const mergerPriority = mergerInputPriority(layout, targetX, targetY, moveDir);
      if (
        mergerPriority >= 0 &&
        (winningUnitForMerger(runtime, data, targetX, targetY) !== i ||
          hasHigherPriorityScheduledSource(
            runtime,
            data,
            targetX,
            targetY,
            mergerPriority,
            -1,
          ))
      ) {
        continue;
      }
      if (
        targetIfFree(compiled, occupancy, machineHeld, targetX, targetY, moveDir) === ACCEPT_NONE
      ) {
        continue;
      }
      const nextCursor = data.targetSplitterNext[i] ?? -1;
      let splitterSlot = -1;
      if (currentMachineSlot < 0) {
        const x = runtime.unitX[i] ?? 0;
        const y = runtime.unitY[i] ?? 0;
        if (nextCursor >= 0) splitterSlot = compiled.splitterSlotByCell[y * width + x] ?? -1;
        occupancy[y * width + x] = -1;
      } else {
        machineHeld[currentMachineSlot] = -1;
      }

      runtime.unitX[i] = targetX;
      runtime.unitY[i] = targetY;
      movedTick[i] = 1;
      didMove = true;
      movedThisPass = true;
      if (splitterSlot >= 0) runtime.splitterCursors[splitterSlot] = nextCursor;

      if (targetAcceptance === ACCEPT_SINK) {
        appendProductFromUnit(runtime, i);
        removed[i] = 1;
        data.unitMachineSlots[i] = -1;
        runtime.unitMachineIds[i] = -1;
        didProduce = true;
      } else if (targetAcceptance >= 0) {
        data.unitMachineSlots[i] = targetAcceptance;
        runtime.unitMachineIds[i] = compiled.machineIds[targetAcceptance] ?? -1;
        runtime.unitProc[i] = 0;
        machineHeld[targetAcceptance] = i;
      } else {
        data.unitMachineSlots[i] = -1;
        runtime.unitMachineIds[i] = -1;
        runtime.unitProc[i] = 0;
        occupancy[targetY * width + targetX] = i;
      }
    }
  }

  const previousUnitCount = runtime.unitCount;
  let outCount = 0;
  for (let i = 0; i < previousUnitCount; i++) {
    if (removed[i] !== 0) continue;
    if (outCount !== i) copyUnitSlot(runtime, data, i, outCount);
    outCount += 1;
  }
  runtime.unitCount = outCount;
  for (let i = outCount; i < previousUnitCount; i++) clearUnitSlot(runtime, data, i);

  let pendingSource = false;
  for (let sourceIndex = 0; sourceIndex < compiled.sourceCells.length; sourceIndex++) {
    const period = compiled.sourcePeriods[sourceIndex] ?? 0;
    if (period <= 0 || runtime.tick % period !== 0) continue;
    const sourceCell = compiled.sourceCells[sourceIndex] ?? 0;
    const sourceX = sourceCell % width;
    const sourceY = (sourceCell - sourceX) / width;
    const dir = (compiled.sourceDirs[sourceIndex] ?? 0) as Dir;
    const targetX = sourceX + (DIR_DX[dir] ?? 0);
    const targetY = sourceY + (DIR_DY[dir] ?? 0);
    const acceptance = targetIfFree(
      compiled,
      occupancy,
      machineHeld,
      targetX,
      targetY,
      dir,
    );
    if (acceptance === ACCEPT_NONE) {
      pendingSource = true;
      continue;
    }
    const mergerPriority = mergerInputPriority(layout, targetX, targetY, dir);
    if (
      mergerPriority >= 0 &&
      hasHigherPriorityScheduledSource(
        runtime,
        data,
        targetX,
        targetY,
        mergerPriority,
        sourceIndex,
      )
    ) {
      pendingSource = true;
      continue;
    }

    const id = runtime.nextUnitId;
    if (id > 0x7fffffff) {
      throw new Error("factory invariant: unit id capacity exhausted");
    }
    if (acceptance === ACCEPT_SINK) {
      appendProductFromSource(runtime, data, id);
      runtime.nextUnitId += 1;
      didEmit = true;
      didProduce = true;
      continue;
    }

    const machineSlot = acceptance >= 0 ? acceptance : -1;
    const slot = emitUnit(runtime, data, targetX, targetY, machineSlot);
    if (machineSlot >= 0) machineHeld[machineSlot] = slot;
    else occupancy[targetY * width + targetX] = slot;
    didEmit = true;
  }

  const changed = didProcess || didMove || didEmit || didProduce;
  runtime.deadlocked = !changed && (runtime.unitCount > 0 || pendingSource);
  runtime.tick += 1;
  assertRuntime(runtime, data, false);
};

export const snapshotProducedEvents = (runtime: FactoryRuntime): readonly ProducedUnit[] => {
  const products: ProducedUnit[] = [];
  const events = runtime.producedEvents;
  for (let i = 0; i < events.count; i++) {
    const pos: { x: number; y: number }[] = [];
    const base = i * runtime.mapCount;
    for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
      pos.push({ x: events.drugX[base + mapIndex] ?? 0, y: events.drugY[base + mapIndex] ?? 0 });
    }
    products.push({
      id: events.ids[i] ?? 0,
      productionCost: events.productionCosts[i] ?? 0,
      drug: { pos, failed: events.failed[i] !== 0 },
    });
  }
  return products;
};

export const snapshotFactory: SnapshotFactoryFn = (publicRuntime) => {
  const runtime = publicRuntime as MutableFactoryRuntime;
  const units: Unit[] = [];
  for (let i = 0; i < runtime.unitCount; i++) {
    const pos: { x: number; y: number }[] = [];
    const base = i * runtime.mapCount;
    for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
      pos.push({
        x: runtime.unitDrugX[base + mapIndex] ?? 0,
        y: runtime.unitDrugY[base + mapIndex] ?? 0,
      });
    }
    units.push({
      id: runtime.unitIds[i] ?? 0,
      pos: { x: runtime.unitX[i] ?? 0, y: runtime.unitY[i] ?? 0 },
      drug: { pos, failed: runtime.unitFailed[i] !== 0 },
      proc: runtime.unitProc[i] ?? 0,
      machineId: (runtime.unitMachineIds[i] ?? -1) < 0 ? null : (runtime.unitMachineIds[i] ?? -1),
      productionCost: runtime.unitProductionCosts[i] ?? 0,
    });
  }
  return {
    tick: runtime.tick,
    units,
    nextUnitId: runtime.nextUnitId,
    producedTotal: runtime.producedTotal,
    splitterCursors: Array.from(runtime.splitterCursors),
    producedEvents: snapshotProducedEvents(runtime),
    deadlocked: runtime.deadlocked,
  };
};

export const restoreFactory: RestoreFactoryFn = (layout, mm, start, snapshot) => {
  const publicRuntime = initFactory(layout, mm, start);
  const runtime = publicRuntime as MutableFactoryRuntime;
  const data = runtimeInternals.get(publicRuntime);
  if (data === undefined) throw new Error("factory restore: missing runtime internals");
  if (snapshot.units.length > runtime.capacity) {
    throw new Error("factory restore: active units exceed capacity");
  }
  if (snapshot.producedEvents.length > runtime.producedEvents.capacity) {
    throw new Error("factory restore: product events exceed capacity");
  }
  if (snapshot.splitterCursors.length !== runtime.splitterCursors.length) {
    throw new Error("factory restore: splitter cursor count mismatch");
  }
  runtime.tick = snapshot.tick;
  runtime.nextUnitId = snapshot.nextUnitId;
  runtime.producedTotal = snapshot.producedTotal;
  runtime.deadlocked = snapshot.deadlocked;
  runtime.unitCount = snapshot.units.length;
  for (let slot = 0; slot < snapshot.splitterCursors.length; slot++) {
    const cursor = snapshot.splitterCursors[slot];
    const cell = data.compiled.splitterCells[slot] ?? -1;
    const tile = layout.tiles[cell];
    if (
      !Number.isSafeInteger(cursor) ||
      cursor === undefined ||
      tile?.kind !== "splitter" ||
      cursor < 0 ||
      cursor >= tile.outDirs.length
    ) {
      throw new Error(`factory restore: invalid splitter cursor ${slot}`);
    }
    runtime.splitterCursors[slot] = cursor;
  }

  for (let i = 0; i < snapshot.units.length; i++) {
    const unit = snapshot.units[i];
    if (
      unit === undefined ||
      unit.drug.pos.length !== runtime.mapCount ||
      !Number.isSafeInteger(unit.id) ||
      unit.id < 0 ||
      unit.id > 0x7fffffff ||
      !Number.isSafeInteger(unit.pos.x) ||
      !Number.isSafeInteger(unit.pos.y) ||
      !inBounds(layout, unit.pos.x, unit.pos.y) ||
      !Number.isSafeInteger(unit.proc) ||
      unit.proc < 0 ||
      !Number.isSafeInteger(unit.productionCost) ||
      unit.productionCost < 0 ||
      typeof unit.drug.failed !== "boolean" ||
      (unit.machineId !== null &&
        (!Number.isSafeInteger(unit.machineId) || unit.machineId < 0))
    ) {
      throw new Error("factory restore: invalid unit drug state");
    }
    runtime.unitIds[i] = unit.id;
    runtime.unitX[i] = unit.pos.x;
    runtime.unitY[i] = unit.pos.y;
    runtime.unitProc[i] = unit.proc;
    runtime.unitProductionCosts[i] = unit.productionCost;
    runtime.unitFailed[i] = unit.drug.failed ? 1 : 0;
    const machineSlot =
      unit.machineId === null ? -1 : (data.compiled.machineSlotById.get(unit.machineId) ?? -2);
    if (machineSlot === -2) {
      throw new Error(`factory restore: unknown machine ${unit.machineId}`);
    }
    data.unitMachineSlots[i] = machineSlot;
    runtime.unitMachineIds[i] = unit.machineId ?? -1;
    const base = i * runtime.mapCount;
    for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
      const pos = unit.drug.pos[mapIndex];
      const map = mm.maps[mapIndex];
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
        throw new Error("factory restore: invalid unit map position");
      }
      runtime.unitDrugX[base + mapIndex] = pos.x;
      runtime.unitDrugY[base + mapIndex] = pos.y;
    }
  }

  runtime.producedEvents.count = snapshot.producedEvents.length;
  for (let i = 0; i < snapshot.producedEvents.length; i++) {
    const product = snapshot.producedEvents[i];
    if (
      product === undefined ||
      product.drug.pos.length !== runtime.mapCount ||
      !Number.isSafeInteger(product.id) ||
      product.id < 0 ||
      product.id > 0x7fffffff ||
      !Number.isSafeInteger(product.productionCost) ||
      product.productionCost < 0 ||
      typeof product.drug.failed !== "boolean"
    ) {
      throw new Error("factory restore: invalid product event drug state");
    }
    runtime.producedEvents.ids[i] = product.id;
    runtime.producedEvents.productionCosts[i] = product.productionCost;
    runtime.producedEvents.failed[i] = product.drug.failed ? 1 : 0;
    const base = i * runtime.mapCount;
    for (let mapIndex = 0; mapIndex < runtime.mapCount; mapIndex++) {
      const pos = product.drug.pos[mapIndex];
      const map = mm.maps[mapIndex];
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
        throw new Error("factory restore: invalid product map position");
      }
      runtime.producedEvents.drugX[base + mapIndex] = pos.x;
      runtime.producedEvents.drugY[base + mapIndex] = pos.y;
    }
  }
  assertRuntime(runtime, data, true);
  return publicRuntime;
};

const MIN_THROUGHPUT_TAIL = 200;

function throughputWindow(layout: FactoryLayout): {
  readonly warmupTicks: number;
  readonly tailTicks: number;
} {
  let machineLatency = 0;
  let maxMachineSpeed = 0;
  for (const machine of layout.machines) {
    const speed = machine.def.speed;
    machineLatency += speed;
    if (speed > maxMachineSpeed) maxMachineSpeed = speed;
  }
  let maxSourcePeriod = 0;
  for (const tile of layout.tiles) {
    if (tile.kind !== "source") continue;
    const period = tile.period;
    if (period > maxSourcePeriod) maxSourcePeriod = period;
  }
  const warmupTicks = layout.width * layout.height + machineLatency + maxSourcePeriod;
  const tailTicks = Math.max(
    MIN_THROUGHPUT_TAIL,
    maxMachineSpeed * 2,
    maxSourcePeriod * 2,
  );
  if (warmupTicks > MAX_FACTORY_REPLAY_TICKS - tailTicks) {
    throw new Error(
      `factory throughput: required steady-state window exceeds replay budget ${MAX_FACTORY_REPLAY_TICKS}`,
    );
  }
  return { warmupTicks, tailTicks };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x === 0 ? 1 : x;
}

export const analyzeThroughput: AnalyzeThroughputFn = (layout, mm): ThroughputReport => {
  const { warmupTicks, tailTicks } = throughputWindow(layout);
  requireFactoryAnalysisBudget(
    layout,
    warmupTicks + tailTicks,
    "factory throughput",
  );
  const start = initialState(mm);
  const runtime = initFactory(layout, mm, start);
  const data = runtimeInternals.get(runtime);
  if (data === undefined) throw new Error("factory throughput: missing runtime internals");
  const busy = new Int32Array(layout.machines.length);
  for (let tick = 0; tick < warmupTicks; tick++) {
    stepFactory(layout, mm, runtime);
    if (runtime.deadlocked) break;
  }
  if (runtime.deadlocked) {
    return { rateNum: 0, rateDen: 1, bottleneck: null, bottleneckType: null };
  }

  const tailStartProduced = runtime.producedTotal;
  for (let tick = 0; tick < tailTicks; tick++) {
    stepFactory(layout, mm, runtime);
    if (runtime.deadlocked) {
      return { rateNum: 0, rateDen: 1, bottleneck: null, bottleneckType: null };
    }
    for (let unitIndex = 0; unitIndex < runtime.unitCount; unitIndex++) {
      const machineSlot = data.unitMachineSlots[unitIndex] ?? -1;
      if (machineSlot >= 0) busy[machineSlot] = (busy[machineSlot] ?? 0) + 1;
    }
  }

  const producedInTail = runtime.producedTotal - tailStartProduced;
  let rateNum = producedInTail;
  let rateDen = tailTicks;
  const divisor = gcd(rateNum, rateDen);
  rateNum /= divisor;
  rateDen /= divisor;
  if (rateNum === 0) rateDen = 1;

  let bottleneck: number | null = null;
  let bottleneckSlot = -1;
  let bestBusy = 0;
  for (let slot = 0; slot < busy.length; slot++) {
    const count = busy[slot] ?? 0;
    const machineId = data.compiled.machineIds[slot] ?? -1;
    if (
      count > bestBusy ||
      (count === bestBusy && count > 0 && (bottleneck === null || machineId < bottleneck))
    ) {
      bestBusy = count;
      bottleneck = machineId;
      bottleneckSlot = slot;
    }
  }
  if (bestBusy * 10 < tailTicks * 9) {
    bottleneck = null;
    bottleneckSlot = -1;
  }

  let bottleneckType: MachineTypeId | null = null;
  if (bottleneckSlot >= 0) {
    bottleneckType = layout.machines[bottleneckSlot]?.def.typeId ?? null;
  }
  return { rateNum, rateDen, bottleneck, bottleneckType };
};
