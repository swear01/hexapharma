import type {
  Dir,
  FactoryLayout,
  FactoryTile,
} from "../sim/phase0_interfaces";
import { worldCells, worldInPorts, worldOutPorts } from "../sim/factory-geom";

const DIR_DX: readonly number[] = [1, 0, -1, 0];
const DIR_DY: readonly number[] = [0, 1, 0, -1];
const ALL_SIDES_MASK = 0b1111;

export const TRANSPORT_ANIMATION_PERIOD = 20;

export type FactoryTransportShape =
  | "isolated"
  | "endpoint"
  | "straight"
  | "corner"
  | "tee"
  | "cross";

export type FactoryTransportKind = FactoryTile["kind"] | "machine";

export interface FactoryTransportCell {
  readonly kind: FactoryTransportKind;
  readonly acceptMask: number;
  readonly emitMask: number;
  readonly inMask: number;
  readonly outMask: number;
  readonly incidentMask: number;
  readonly shape: FactoryTransportShape;
}

export interface FactoryTransportEdge {
  readonly from: { readonly x: number; readonly y: number };
  readonly to: { readonly x: number; readonly y: number };
  readonly dir: Dir;
}

export interface FactoryMachinePortVisual {
  readonly machineId: number;
  readonly x: number;
  readonly y: number;
  readonly side: Dir;
  readonly role: "input" | "output";
  readonly connected: boolean;
}

export interface FactoryTransportTopology {
  readonly cells: readonly FactoryTransportCell[];
  readonly edges: readonly FactoryTransportEdge[];
  readonly machinePorts: readonly FactoryMachinePortVisual[];
}

interface MutableTransportCell {
  kind: FactoryTransportKind;
  acceptMask: number;
  emitMask: number;
  inMask: number;
  outMask: number;
}

function sideBit(side: Dir): number {
  return 1 << side;
}

function opposite(side: Dir): Dir {
  return ((side + 2) & 3) as Dir;
}

function maskForSides(sides: readonly Dir[]): number {
  let mask = 0;
  for (const side of sides) mask |= sideBit(side);
  return mask;
}

function tilePorts(tile: FactoryTile): { readonly acceptMask: number; readonly emitMask: number } {
  switch (tile.kind) {
    case "empty":
      return { acceptMask: 0, emitMask: 0 };
    case "belt":
      return { acceptMask: ALL_SIDES_MASK, emitMask: sideBit(tile.dir) };
    case "splitter":
      return { acceptMask: sideBit(tile.inDir), emitMask: maskForSides(tile.outDirs) };
    case "merger":
      return { acceptMask: maskForSides(tile.inDirs), emitMask: sideBit(tile.outDir) };
    case "source":
      return { acceptMask: 0, emitMask: sideBit(tile.dir) };
    case "sink":
      return { acceptMask: ALL_SIDES_MASK, emitMask: 0 };
  }
}

function bitCount(mask: number): number {
  let value = mask & ALL_SIDES_MASK;
  let count = 0;
  while (value !== 0) {
    count += value & 1;
    value >>>= 1;
  }
  return count;
}

export function classifyTransportMask(mask: number): FactoryTransportShape {
  if (!Number.isSafeInteger(mask) || mask < 0 || mask > ALL_SIDES_MASK) {
    throw new Error("Factory transport mask must be an integer in [0, 15]");
  }
  const count = bitCount(mask);
  if (count === 0) return "isolated";
  if (count === 1) return "endpoint";
  if (count === 3) return "tee";
  if (count === 4) return "cross";
  const horizontal = sideBit(0) | sideBit(2);
  const vertical = sideBit(1) | sideBit(3);
  return mask === horizontal || mask === vertical ? "straight" : "corner";
}

function requireCellIndex(layout: FactoryLayout, x: number, y: number, context: string): number {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) {
    throw new Error(`Factory transport ${context} is outside the layout at ${x},${y}`);
  }
  return y * layout.width + x;
}

export function buildFactoryTransportTopology(layout: FactoryLayout): FactoryTransportTopology {
  const area = layout.width * layout.height;
  const cells: MutableTransportCell[] = new Array<MutableTransportCell>(area);
  for (let index = 0; index < area; index++) {
    const tile = layout.tiles[index];
    if (tile === undefined) throw new Error(`Factory transport layout is missing tile ${index}`);
    const ports = tilePorts(tile);
    cells[index] = {
      kind: tile.kind,
      acceptMask: ports.acceptMask,
      emitMask: ports.emitMask,
      inMask: 0,
      outMask: 0,
    };
  }

  const unresolvedPorts: Omit<FactoryMachinePortVisual, "connected">[] = [];
  for (const machine of layout.machines) {
    for (const worldCell of worldCells(machine)) {
      const index = requireCellIndex(layout, worldCell.x, worldCell.y, `machine ${machine.id} cell`);
      const cell = cells[index];
      if (cell === undefined) throw new Error(`Factory transport layout is missing tile ${index}`);
      if (cell.kind === "machine") {
        throw new Error(`Factory transport machines overlap at ${worldCell.x},${worldCell.y}`);
      }
      if (cell.kind !== "empty") {
        throw new Error(`Factory transport machine ${machine.id} overlaps a ${cell.kind} tile`);
      }
      cell.kind = "machine";
      cell.acceptMask = 0;
      cell.emitMask = 0;
    }
    for (const port of worldInPorts(machine)) {
      const index = requireCellIndex(layout, port.x, port.y, `machine ${machine.id} input port`);
      const cell = cells[index];
      if (cell === undefined || cell.kind !== "machine") {
        throw new Error(`Factory transport machine ${machine.id} has a detached input port`);
      }
      cell.acceptMask |= sideBit(port.side);
      unresolvedPorts.push({
        machineId: machine.id,
        x: port.x,
        y: port.y,
        side: port.side,
        role: "input",
      });
    }
    for (const port of worldOutPorts(machine)) {
      const index = requireCellIndex(layout, port.x, port.y, `machine ${machine.id} output port`);
      const cell = cells[index];
      if (cell === undefined || cell.kind !== "machine") {
        throw new Error(`Factory transport machine ${machine.id} has a detached output port`);
      }
      cell.emitMask |= sideBit(port.side);
      unresolvedPorts.push({
        machineId: machine.id,
        x: port.x,
        y: port.y,
        side: port.side,
        role: "output",
      });
    }
  }

  const edges: FactoryTransportEdge[] = [];
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      const index = y * layout.width + x;
      const from = cells[index];
      if (from === undefined) continue;
      for (let rawDir = 0; rawDir < 4; rawDir++) {
        const dir = rawDir as Dir;
        if ((from.emitMask & sideBit(dir)) === 0) continue;
        const toX = x + (DIR_DX[dir] ?? 0);
        const toY = y + (DIR_DY[dir] ?? 0);
        if (toX < 0 || toY < 0 || toX >= layout.width || toY >= layout.height) continue;
        const to = cells[toY * layout.width + toX];
        const toSide = opposite(dir);
        if (to === undefined || (to.acceptMask & sideBit(toSide)) === 0) continue;
        from.outMask |= sideBit(dir);
        to.inMask |= sideBit(toSide);
        edges.push({ from: { x, y }, to: { x: toX, y: toY }, dir });
      }
    }
  }

  const resolvedCells: FactoryTransportCell[] = cells.map((cell) => {
    const incidentMask = cell.inMask | cell.outMask;
    return {
      kind: cell.kind,
      acceptMask: cell.acceptMask,
      emitMask: cell.emitMask,
      inMask: cell.inMask,
      outMask: cell.outMask,
      incidentMask,
      shape: classifyTransportMask(incidentMask),
    };
  });
  const machinePorts: FactoryMachinePortVisual[] = unresolvedPorts.map((port) => {
    const cell = resolvedCells[port.y * layout.width + port.x];
    if (cell === undefined) throw new Error("Factory transport resolved port cell is missing");
    const connectedMask = port.role === "input" ? cell.inMask : cell.outMask;
    return { ...port, connected: (connectedMask & sideBit(port.side)) !== 0 };
  });

  return { cells: resolvedCells, edges, machinePorts };
}

export function transportAnimationPhase(tick: number): number {
  if (!Number.isSafeInteger(tick) || tick < 0) {
    throw new Error("Factory transport animation tick must be a non-negative safe integer");
  }
  return (tick % TRANSPORT_ANIMATION_PERIOD) / TRANSPORT_ANIMATION_PERIOD;
}
