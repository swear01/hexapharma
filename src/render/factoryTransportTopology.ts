import type {
  Dir,
  FactoryLayout,
  FactoryTile,
} from "../sim/phase0_interfaces";
import { worldCells, worldInPorts, worldOutPorts } from "../sim/factory-geom";
import { HEX_DIRS, HEX_DQ, HEX_DR, hexInBounds, hexIndex, oppositeHexDir } from "../sim/hex";

const ALL_SIDES_MASK = 0b111111;

export const TRANSPORT_ANIMATION_PERIOD = 20;

export type FactoryTransportKind = FactoryTile["kind"] | "machine";

export interface FactoryTransportCell {
  readonly kind: FactoryTransportKind;
  readonly acceptMask: number;
  readonly emitMask: number;
  readonly inMask: number;
  readonly outMask: number;
  readonly incidentMask: number;
}

export interface FactoryTransportEdge {
  readonly from: { readonly q: number; readonly r: number };
  readonly to: { readonly q: number; readonly r: number };
  readonly dir: Dir;
}

export interface FactoryMachinePortVisual {
  readonly machineId: number;
  readonly q: number;
  readonly r: number;
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

function requireCellIndex(layout: FactoryLayout, q: number, r: number, context: string): number {
  if (!hexInBounds(layout.width, layout.height, q, r)) {
    throw new Error(`Factory transport ${context} is outside the layout at ${q},${r}`);
  }
  return hexIndex(layout.width, q, r);
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
      const index = requireCellIndex(layout, worldCell.q, worldCell.r, `machine ${machine.id} cell`);
      const cell = cells[index];
      if (cell === undefined) throw new Error(`Factory transport layout is missing tile ${index}`);
      if (cell.kind === "machine") {
        throw new Error(`Factory transport machines overlap at ${worldCell.q},${worldCell.r}`);
      }
      if (cell.kind !== "empty") {
        throw new Error(`Factory transport machine ${machine.id} overlaps a ${cell.kind} tile`);
      }
      cell.kind = "machine";
      cell.acceptMask = 0;
      cell.emitMask = 0;
    }
    for (const port of worldInPorts(machine)) {
      const index = requireCellIndex(layout, port.q, port.r, `machine ${machine.id} input port`);
      const cell = cells[index];
      if (cell === undefined || cell.kind !== "machine") {
        throw new Error(`Factory transport machine ${machine.id} has a detached input port`);
      }
      cell.acceptMask |= sideBit(port.side);
      unresolvedPorts.push({
        machineId: machine.id,
        q: port.q,
        r: port.r,
        side: port.side,
        role: "input",
      });
    }
    for (const port of worldOutPorts(machine)) {
      const index = requireCellIndex(layout, port.q, port.r, `machine ${machine.id} output port`);
      const cell = cells[index];
      if (cell === undefined || cell.kind !== "machine") {
        throw new Error(`Factory transport machine ${machine.id} has a detached output port`);
      }
      cell.emitMask |= sideBit(port.side);
      unresolvedPorts.push({
        machineId: machine.id,
        q: port.q,
        r: port.r,
        side: port.side,
        role: "output",
      });
    }
  }

  const edges: FactoryTransportEdge[] = [];
  for (let r = 0; r < layout.height; r++) {
    for (let q = 0; q < layout.width; q++) {
      const index = hexIndex(layout.width, q, r);
      const from = cells[index];
      if (from === undefined) continue;
      for (const dir of HEX_DIRS) {
        if ((from.emitMask & sideBit(dir)) === 0) continue;
        const toQ = q + HEX_DQ[dir]!;
        const toR = r + HEX_DR[dir]!;
        if (!hexInBounds(layout.width, layout.height, toQ, toR)) continue;
        const to = cells[hexIndex(layout.width, toQ, toR)];
        const toSide = oppositeHexDir(dir);
        if (to === undefined || (to.acceptMask & sideBit(toSide)) === 0) continue;
        from.outMask |= sideBit(dir);
        to.inMask |= sideBit(toSide);
        edges.push({ from: { q, r }, to: { q: toQ, r: toR }, dir });
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
    };
  });
  const machinePorts: FactoryMachinePortVisual[] = unresolvedPorts.map((port) => {
    const cell = resolvedCells[hexIndex(layout.width, port.q, port.r)];
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
