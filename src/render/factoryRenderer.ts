/**
 * HexaPharma — Factory renderer (PixiJS v8).
 *
 * A DUMB renderer: handed a FactoryLayout + FactoryRuntime (+ the bottleneck machine
 * id to highlight) it draws the belt-grid tiles, the multi-cell shaped machines
 * (in layout.machines), the source/sink, and the Unit tokens. It contains NO sim
 * logic — no stepping, no throughput analysis. React (src/ui) owns the state and
 * the sim calls; this module only paints what it is given. See AGENTS.md layering.
 *
 * NEW model: machines are NOT tiles. Each PlacedMachine carries a MachineShape in
 * LOCAL coords; its WORLD cells/ports = local rotated by `footRot` sixth-turns CW
 * + anchor, with port side = (side + footRot) % 6 — the same
 * geometry the sim uses (src/sim/factory-sim). Belts/splitters/mergers route units
 * between machine ports, so parallel machines really raise throughput.
 */
import { Application, Graphics } from "pixi.js";
import type {
  Dir,
  PlacedMachine,
  FactoryTile,
  FactoryLayout,
  FactoryRuntime,
  PathStamp,
} from "../sim/phase0_interfaces";
import { worldCells, worldInPorts, worldOutPorts } from "../sim/factory-geom";
import { HEX_DIRS, HEX_DQ, HEX_DR, hexIndex } from "../sim/hex";
import {
  hexBoardBounds,
  hexPolygon,
  hexToPixel,
  type PixelPoint,
} from "./hexProjection";
import {
  buildFactoryTransportTopology,
  transportAnimationPhase,
  type FactoryTransportCell,
  type FactoryTransportEdge,
  type FactoryTransportTopology,
} from "./factoryTransportTopology";
import { SHARED_SCHEMATIC_STYLE } from "./schematicStyle";

// ───────────────────────────── layout constants ─────────────────────────────

const CELL = 42; // px point-to-point hex diameter
export const FACTORY_HEX_SIZE = CELL / 2;
const HEX_WIDTH = Math.sqrt(3) * FACTORY_HEX_SIZE;
const PAD = 12; // outer padding

// ───────────────────────────── palette ─────────────────────────────

export const FACTORY_SCHEMATIC_STYLE = Object.freeze({
  ...SHARED_SCHEMATIC_STYLE,
  shadow: 0x000000,
  gridLine: 0x30383e,
  belt: 0x40515a,
  beltRail: 0x101920,
  merge: 0x303a3f,
  source: 0x173d45,
  sink: 0x2b3d27,
  chassis: 0x28343b,
  selection: 0xc0d5e2,
  portFrame: 0x19242d,
  portDisconnected: 0x7b858d,
  portInput: SHARED_SCHEMATIC_STYLE.flow,
  portOutput: SHARED_SCHEMATIC_STYLE.structure,
  pushBody: 0x2a373f,
  pushFace: 0xbcc6c9,
  push2Body: 0x24323a,
  push2Face: 0xc9d1d1,
  pullBody: 0x303840,
  pullFace: 0xd2d3cd,
  shearBody: 0x34383a,
  shearFace: 0xd8d3c5,
  skewBody: 0x25363c,
  skewFace: 0xc7d5d4,
  diluteBody: 0x293a38,
  diluteFace: 0xcbd8d0,
  settleBody: 0x34333a,
  settleFace: 0xd4ccd3,
  bottleneckBody: 0x3b352a,
  bottleneckFace: 0xddd1b9,
});
export const FACTORY_MACHINE_SHADOW_ALPHA = 0.28;

const BG = FACTORY_SCHEMATIC_STYLE.background;
const GRID_LINE = FACTORY_SCHEMATIC_STYLE.gridLine;
const EMPTY_COLOR = FACTORY_SCHEMATIC_STYLE.deck;
const BELT_COLOR = FACTORY_SCHEMATIC_STYLE.belt;
const BELT_RAIL = FACTORY_SCHEMATIC_STYLE.beltRail;
const BELT_ARROW = FACTORY_SCHEMATIC_STYLE.portDisconnected;
const SPLIT_COLOR = FACTORY_SCHEMATIC_STYLE.chassis;
const SPLIT_MARK = FACTORY_SCHEMATIC_STYLE.structure;
const MERGE_COLOR = FACTORY_SCHEMATIC_STYLE.merge;
const MERGE_MARK = FACTORY_SCHEMATIC_STYLE.structure;
const SOURCE_COLOR = FACTORY_SCHEMATIC_STYLE.source;
const SINK_COLOR = FACTORY_SCHEMATIC_STYLE.sink;
const PORT_IN = FACTORY_SCHEMATIC_STYLE.portInput;
const PORT_OUT = FACTORY_SCHEMATIC_STYLE.portOutput;
const TOKEN_COLOR = FACTORY_SCHEMATIC_STYLE.flow;
const TOKEN_FAILED = FACTORY_SCHEMATIC_STYLE.failure;
const TOKEN_RING = FACTORY_SCHEMATIC_STYLE.structure;
const TOKEN_PROC = FACTORY_SCHEMATIC_STYLE.selection;

export interface FactoryTransportArmGeometry {
  readonly side: Dir;
  readonly from: PixelPoint;
  readonly to: PixelPoint;
}

export function factoryTransportArmGeometry(mask: number): readonly FactoryTransportArmGeometry[] {
  if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0b111111) {
    throw new Error("Factory renderer transport mask must be an integer in [0, 63]");
  }
  const arms: FactoryTransportArmGeometry[] = [];
  for (const side of HEX_DIRS) {
    if ((mask & (1 << side)) === 0) continue;
    const offset = hexToPixel(HEX_DQ[side]!, HEX_DR[side]!, FACTORY_HEX_SIZE);
    arms.push({
      side,
      from: { x: HEX_WIDTH / 2, y: FACTORY_HEX_SIZE },
      to: { x: HEX_WIDTH / 2 + offset.x / 2, y: FACTORY_HEX_SIZE + offset.y / 2 },
    });
  }
  return arms;
}

export interface FactoryTransportFlowPoint extends PixelPoint {
  readonly dir: Dir;
}

export function factoryCellCenter(q: number, r: number): PixelPoint {
  const projected = hexToPixel(q, r, FACTORY_HEX_SIZE);
  return {
    x: PAD + HEX_WIDTH / 2 + projected.x,
    y: PAD + FACTORY_HEX_SIZE + projected.y,
  };
}

export function factoryTransportFlowPoint(
  edge: FactoryTransportEdge,
  fromMachine: boolean,
  toMachine: boolean,
  phase: number,
): FactoryTransportFlowPoint {
  if (!Number.isFinite(phase) || phase < 0 || phase >= 1) {
    throw new Error("Factory renderer transport animation phase must be in [0, 1)");
  }
  const from = factoryCellCenter(edge.from.q, edge.from.r);
  const to = factoryCellCenter(edge.to.q, edge.to.r);
  const start = fromMachine ? 0.5 : 0.18;
  const end = toMachine ? 0.5 : 0.82;
  const progress = start + (end - start) * phase;
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    dir: edge.dir,
  };
}

export interface MachineVisualStyle {
  readonly body: number;
  readonly face: number;
}

export function machineVisualStyle(typeId: string): MachineVisualStyle {
  switch (typeId) {
    case "push":
      return { body: FACTORY_SCHEMATIC_STYLE.pushBody, face: FACTORY_SCHEMATIC_STYLE.pushFace };
    case "push2":
      return { body: FACTORY_SCHEMATIC_STYLE.push2Body, face: FACTORY_SCHEMATIC_STYLE.push2Face };
    case "pull":
      return { body: FACTORY_SCHEMATIC_STYLE.pullBody, face: FACTORY_SCHEMATIC_STYLE.pullFace };
    case "shear":
      return { body: FACTORY_SCHEMATIC_STYLE.shearBody, face: FACTORY_SCHEMATIC_STYLE.shearFace };
    case "skew":
      return { body: FACTORY_SCHEMATIC_STYLE.skewBody, face: FACTORY_SCHEMATIC_STYLE.skewFace };
    case "dilute":
      return { body: FACTORY_SCHEMATIC_STYLE.diluteBody, face: FACTORY_SCHEMATIC_STYLE.diluteFace };
    case "settle":
      return { body: FACTORY_SCHEMATIC_STYLE.settleBody, face: FACTORY_SCHEMATIC_STYLE.settleFace };
    default:
      return {
        body: FACTORY_SCHEMATIC_STYLE.chassis,
        face: FACTORY_SCHEMATIC_STYLE.structure,
      };
  }
}

/** Pixel size of the whole canvas for a layout. */
function canvasSize(layout: FactoryLayout): { width: number; height: number } {
  const bounds = hexBoardBounds(layout.width, layout.height, FACTORY_HEX_SIZE);
  return {
    width: Math.ceil(PAD * 2 + bounds.maxX - bounds.minX),
    height: Math.ceil(PAD * 2 + bounds.maxY - bounds.minY),
  };
}

// ───────────────────────────── drawing helpers ─────────────────────────────

/** Draw a triangle arrow centered at (cx,cy) pointing in direction `d`. */
function drawArrow(g: Graphics, cx: number, cy: number, d: Dir, color: number, scale = 0.22): void {
  const projected = hexToPixel(HEX_DQ[d]!, HEX_DR[d]!, 1);
  const length = Math.hypot(projected.x, projected.y);
  const dx = projected.x / length;
  const dy = projected.y / length;
  const r = CELL * scale;
  const tipX = cx + dx * r;
  const tipY = cy + dy * r;
  const px = -dy; // perpendicular
  const py = dx;
  const b1x = cx - dx * r * 0.6 + px * r * 0.7;
  const b1y = cy - dy * r * 0.6 + py * r * 0.7;
  const b2x = cx - dx * r * 0.6 - px * r * 0.7;
  const b2y = cy - dy * r * 0.6 - py * r * 0.7;
  g.moveTo(tipX, tipY).lineTo(b1x, b1y).lineTo(b2x, b2y).lineTo(tipX, tipY).fill({ color });
}

/** Draw a small notch on the `side` edge of the cell at world (cx,cy). */
function drawPortNotch(
  g: Graphics,
  cx: number,
  cy: number,
  side: Dir,
  color: number,
  connected: boolean,
): void {
  const offset = hexToPixel(HEX_DQ[side]!, HEX_DR[side]!, FACTORY_HEX_SIZE);
  const ex = cx + offset.x * 0.42;
  const ey = cy + offset.y * 0.42;
  g.rect(ex - 5, ey - 5, 10, 10).fill({ color: FACTORY_SCHEMATIC_STYLE.portFrame });
  if (color === PORT_IN) g.rect(ex - 3, ey - 3, 6, 6);
  else g.circle(ex, ey, 3.5);
  if (connected) g.fill({ color });
  else g.stroke({ color: FACTORY_SCHEMATIC_STYLE.portDisconnected, width: 1.5 });
}

interface DrawCtx {
  readonly cells: Graphics;
  readonly topology: FactoryTransportTopology;
}

function drawFloorCell(q: number, r: number, cells: Graphics): void {
  const center = factoryCellCenter(q, r);
  const polygon = hexPolygon(center.x, center.y, FACTORY_HEX_SIZE);
  cells.poly([...polygon], true).fill({ color: EMPTY_COLOR });
  cells.poly([...polygon], true).stroke({ color: GRID_LINE, width: 1 });
}

function drawTransportBase(
  visual: FactoryTransportCell,
  tile: FactoryTile,
  q: number,
  r: number,
  cells: Graphics,
): void {
  const center = factoryCellCenter(q, r);
  const px = center.x - HEX_WIDTH / 2;
  const py = center.y - FACTORY_HEX_SIZE;
  const cx = center.x;
  const cy = center.y;
  const arms = factoryTransportArmGeometry(visual.incidentMask);
  if (arms.length === 0) {
    if (tile.kind !== "belt") return;
    const offset = hexToPixel(HEX_DQ[tile.dir]!, HEX_DR[tile.dir]!, FACTORY_HEX_SIZE);
    const dx = offset.x / Math.hypot(offset.x, offset.y);
    const dy = offset.y / Math.hypot(offset.x, offset.y);
    cells.moveTo(cx - dx * 4, cy - dy * 4).lineTo(cx + offset.x / 2, cy + offset.y / 2)
      .stroke({ color: BELT_RAIL, width: 15 });
    cells.moveTo(cx - dx * 4, cy - dy * 4).lineTo(cx + offset.x / 2, cy + offset.y / 2)
      .stroke({ color: BELT_COLOR, width: 10 });
    return;
  }
  for (const arm of arms) {
    cells.moveTo(px + arm.from.x, py + arm.from.y).lineTo(px + arm.to.x, py + arm.to.y);
  }
  cells.stroke({ color: BELT_RAIL, width: 15 });
  cells.circle(cx, cy, 7.5).fill({ color: BELT_RAIL });
  for (const arm of arms) {
    cells.moveTo(px + arm.from.x, py + arm.from.y).lineTo(px + arm.to.x, py + arm.to.y);
  }
  cells.stroke({ color: BELT_COLOR, width: 10 });
  cells.circle(cx, cy, 5).fill({ color: BELT_COLOR });
}

/** Draw one transport structure after the shared connection arms. */
function drawTileBody(
  tile: FactoryTile,
  visual: FactoryTransportCell,
  q: number,
  r: number,
  ctx: DrawCtx,
): void {
  const center = factoryCellCenter(q, r);
  const cx = center.x;
  const cy = center.y;
  const body = (inset: number) => hexPolygon(cx, cy, FACTORY_HEX_SIZE - inset);
  const { cells } = ctx;

  switch (tile.kind) {
    case "empty": {
      break;
    }
    case "belt": {
      if (visual.outMask === 0) drawArrow(cells, cx, cy, tile.dir, BELT_ARROW, 0.13);
      break;
    }
    case "splitter": {
      cells.poly([...body(4)], true).fill({ color: SPLIT_COLOR })
        .stroke({ color: SPLIT_MARK, width: 2 });
      cells.circle(cx, cy, CELL * 0.13).fill({ color: SPLIT_MARK });
      for (const d of tile.outDirs) {
        const offset = hexToPixel(HEX_DQ[d]!, HEX_DR[d]!, FACTORY_HEX_SIZE);
        cells.moveTo(cx, cy).lineTo(cx + offset.x * 0.45, cy + offset.y * 0.45)
          .stroke({ color: SPLIT_MARK, width: 4 });
      }
      break;
    }
    case "merger": {
      cells.poly([...body(4)], true).fill({ color: MERGE_COLOR })
        .stroke({ color: MERGE_MARK, width: 2 });
      for (const d of tile.inDirs) {
        const offset = hexToPixel(HEX_DQ[d]!, HEX_DR[d]!, FACTORY_HEX_SIZE);
        cells.moveTo(cx + offset.x * 0.45, cy + offset.y * 0.45).lineTo(cx, cy)
          .stroke({ color: MERGE_MARK, width: 4 });
      }
      drawArrow(cells, cx, cy, tile.outDir, MERGE_MARK, 0.22);
      break;
    }
    case "source": {
      cells.poly([...body(3)], true).fill({ color: SOURCE_COLOR })
        .stroke({ color: FACTORY_SCHEMATIC_STYLE.portDisconnected, width: 2 });
      const offset = hexToPixel(HEX_DQ[tile.dir]!, HEX_DR[tile.dir]!, 5 / Math.sqrt(3));
      cells.circle(cx - offset.x, cy - offset.y, CELL * 0.24)
        .stroke({ color: FACTORY_SCHEMATIC_STYLE.structure, width: 3 });
      drawArrow(cells, cx, cy, tile.dir, FACTORY_SCHEMATIC_STYLE.flow, 0.17);
      break;
    }
    case "sink": {
      cells.poly([...body(3)], true).fill({ color: SINK_COLOR })
        .stroke({ color: FACTORY_SCHEMATIC_STYLE.cure, width: 3 });
      cells.circle(cx, cy, CELL * 0.27).stroke({ color: FACTORY_SCHEMATIC_STYLE.structure, width: 3 });
      cells.circle(cx, cy, CELL * 0.11).fill({ color: FACTORY_SCHEMATIC_STYLE.cure });
      break;
    }
  }
}

export interface MachinePathGlyph {
  readonly points: readonly PixelPoint[];
}

export function machinePathGlyph(path: PathStamp): MachinePathGlyph {
  if (path.length === 0) {
    throw new Error("Factory renderer requires a non-empty path");
  }
  const authored: PixelPoint[] = [{ x: 0, y: 0 }];
  let q = 0;
  let r = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const dir of path) {
    q += HEX_DQ[dir]!;
    r += HEX_DR[dir]!;
    const point = hexToPixel(q, r, 1);
    authored.push(point);
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  const scale = 22 / Math.max(1, maxX - minX, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    points: authored.map((point) => ({
      x: (point.x - centerX) * scale,
      y: (point.y - centerY) * scale,
    })),
  };
}

export function placedMachinePathGlyph(machine: PlacedMachine): MachinePathGlyph {
  return machinePathGlyph(machine.def.path);
}

function drawMachineGlyph(
  g: Graphics,
  machine: PlacedMachine,
  cx: number,
  cy: number,
  color: number,
): void {
  const glyph = placedMachinePathGlyph(machine);
  const first = glyph.points[0];
  if (first === undefined) throw new Error("Factory renderer path glyph is missing its origin");
  g.moveTo(cx + first.x, cy + first.y);
  for (let index = 1; index < glyph.points.length; index++) {
    const point = glyph.points[index];
    if (point !== undefined) g.lineTo(cx + point.x, cy + point.y);
  }
  g.stroke({ color, width: 3.5, alpha: 1 });
  g.circle(cx + first.x, cy + first.y, 2.6).fill({ color });

  const end = glyph.points[glyph.points.length - 1];
  const beforeEnd = glyph.points[glyph.points.length - 2];
  if (end === undefined || beforeEnd === undefined) {
    throw new Error("Factory renderer path glyph is missing its endpoint");
  }
  const dx = end.x - beforeEnd.x;
  const dy = end.y - beforeEnd.y;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const tipX = cx + end.x;
  const tipY = cy + end.y;
  g.moveTo(tipX, tipY)
    .lineTo(tipX - ux * 6 + px * 4, tipY - uy * 6 + py * 4)
    .lineTo(tipX - ux * 6 - px * 4, tipY - uy * 6 - py * 4)
    .lineTo(tipX, tipY)
    .fill({ color });
}

/** Draw a placed multi-cell machine: shaped body, semantic glyph, and port notches. */
function drawMachine(m: PlacedMachine, isBottleneck: boolean, ctx: DrawCtx): void {
  const { cells, topology } = ctx;
  const baseStyle = machineVisualStyle(m.def.typeId);
  const style = baseStyle;
  const accent = style.face;
  const occupiedCells = worldCells(m);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wc of occupiedCells) {
    const center = factoryCellCenter(wc.q, wc.r);
    const shadow = hexPolygon(center.x + 3, center.y + 4, FACTORY_HEX_SIZE - 3);
    const body = hexPolygon(center.x, center.y, FACTORY_HEX_SIZE);
    cells.poly([...shadow], true)
      .fill({ color: FACTORY_SCHEMATIC_STYLE.shadow, alpha: FACTORY_MACHINE_SHADOW_ALPHA });
    cells.poly([...body], true).fill({ color: style.body });
    for (const side of HEX_DIRS) {
      if (occupiedCells.some((neighbor) => neighbor.q === wc.q + HEX_DQ[side]! && neighbor.r === wc.r + HEX_DR[side]!)) continue;
      const from = body[(side + 1) % 6]!;
      const to = body[(side + 2) % 6]!;
      cells.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: accent, width: 1.5, alpha: .7 });
    }
    if (center.x < minX) minX = center.x;
    if (center.y < minY) minY = center.y;
    if (center.x > maxX) maxX = center.x;
    if (center.y > maxY) maxY = center.y;
  }

  for (const wp of worldInPorts(m)) {
    const connected = topology.machinePorts.some((port) =>
      port.machineId === m.id &&
      port.role === "input" &&
      port.q === wp.q &&
      port.r === wp.r &&
      port.side === wp.side &&
      port.connected
    );
    drawPortNotch(
      cells,
      factoryCellCenter(wp.q, wp.r).x,
      factoryCellCenter(wp.q, wp.r).y,
      wp.side,
      PORT_IN,
      connected,
    );
  }
  for (const wp of worldOutPorts(m)) {
    const connected = topology.machinePorts.some((port) =>
      port.machineId === m.id &&
      port.role === "output" &&
      port.q === wp.q &&
      port.r === wp.r &&
      port.side === wp.side &&
      port.connected
    );
    drawPortNotch(
      cells,
      factoryCellCenter(wp.q, wp.r).x,
      factoryCellCenter(wp.q, wp.r).y,
      wp.side,
      PORT_OUT,
      connected,
    );
  }

  if (minX !== Infinity) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    cells.rect(cx - 15, cy - 15, 30, 30).fill({ color: style.body });
    drawMachineGlyph(cells, m, cx, cy, accent);
    if (isBottleneck) cells.rect(cx + 11, cy - 18, 5, 5).fill({ color: accent });
  }
}

function drawTransportFlow(
  topology: FactoryTransportTopology,
  width: number,
  tick: number,
  flow: Graphics,
): void {
  const phase = transportAnimationPhase(tick);
  for (const edge of topology.edges) {
    const from = topology.cells[hexIndex(width, edge.from.q, edge.from.r)];
    const to = topology.cells[hexIndex(width, edge.to.q, edge.to.r)];
    if (from === undefined || to === undefined) {
      throw new Error("Factory renderer transport edge references a missing cell");
    }
    const point = factoryTransportFlowPoint(
      edge,
      from.kind === "machine",
      to.kind === "machine",
      phase,
    );
    drawArrow(flow, point.x, point.y, point.dir, BELT_ARROW, 0.1);
  }
}

export interface FactoryRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Repaint the given layout + mutable sim runtime. Pure draw; no sim logic. */
  render(layout: FactoryLayout, runtime: FactoryRuntime, bottleneckId: number | null): void;
  destroy(): void;
}

/**
 * Create + initialize a Factory renderer sized for `layout`. Caller mounts
 * `.canvas`, then calls `.render(layout, state, bottleneckId)` whenever React state
 * changes, and `.destroy()` on unmount.
 */
export async function createFactoryRenderer(layout: FactoryLayout): Promise<FactoryRenderer> {
  const { width, height } = canvasSize(layout);
  const app = new Application();
  await app.init({ autoStart: false, width, height, background: BG, antialias: true });

  const cells = new Graphics();
  const flow = new Graphics();
  const tokens = new Graphics();
  app.stage.addChild(cells, flow, tokens);
  let destroyed = false;
  let renderedLayout: FactoryLayout | null = null;
  let renderedBottleneck: number | null = null;
  let renderedTopology: FactoryTransportTopology | null = null;

  function render(curr: FactoryLayout, runtime: FactoryRuntime, bottleneckId: number | null): void {
    const want = canvasSize(curr);
    if (app.renderer.width !== want.width || app.renderer.height !== want.height) {
      app.renderer.resize(want.width, want.height);
    }
    flow.clear();
    tokens.clear();
    if (renderedLayout !== curr || renderedBottleneck !== bottleneckId) {
      renderedLayout = curr;
      renderedBottleneck = bottleneckId;
      renderedTopology = buildFactoryTransportTopology(curr);
      cells.clear();
      const ctx: DrawCtx = { cells, topology: renderedTopology };
      for (let r = 0; r < curr.height; r++) {
        for (let q = 0; q < curr.width; q++) drawFloorCell(q, r, cells);
      }
      for (let r = 0; r < curr.height; r++) {
        for (let q = 0; q < curr.width; q++) {
          const tile = curr.tiles[hexIndex(curr.width, q, r)];
          const visual = renderedTopology.cells[hexIndex(curr.width, q, r)];
          if (tile === undefined || visual === undefined) continue;
          drawTransportBase(visual, tile, q, r, cells);
        }
      }
      for (let r = 0; r < curr.height; r++) {
        for (let q = 0; q < curr.width; q++) {
          const tile = curr.tiles[hexIndex(curr.width, q, r)];
          const visual = renderedTopology.cells[hexIndex(curr.width, q, r)];
          if (tile === undefined || visual === undefined) continue;
          drawTileBody(tile, visual, q, r, ctx);
        }
      }
      for (const m of curr.machines) {
        drawMachine(m, bottleneckId !== null && m.id === bottleneckId, ctx);
      }
    }
    if (renderedTopology === null) {
      throw new Error("Factory renderer transport topology was not initialized");
    }
    drawTransportFlow(renderedTopology, curr.width, runtime.tick, flow);
    for (let unitIndex = 0; unitIndex < runtime.unitCount; unitIndex++) {
      const center = factoryCellCenter(
        runtime.unitX[unitIndex] ?? 0,
        runtime.unitY[unitIndex] ?? 0,
      );
      const cx = center.x;
      const cy = center.y;
      const r = CELL * 0.2;
      tokens.rect(cx - r * .65 - 1, cy - r - 1, r * 1.3 + 2, r * 2 + 2).fill({ color: TOKEN_RING });
      tokens.rect(cx - r * .65, cy - r, r * 1.3, r * 2).fill({
        color: runtime.unitFailed[unitIndex] === 0 ? TOKEN_COLOR : TOKEN_FAILED,
      });
      // proc ring while a unit is being processed inside a machine.
      if ((runtime.unitMachineIds[unitIndex] ?? -1) >= 0 && (runtime.unitProc[unitIndex] ?? 0) > 0) {
        tokens.rect(cx - r, cy + r + 3, r * 2, 2).fill({ color: TOKEN_PROC });
      }
    }
    app.render();
  }

  return {
    canvas: app.canvas,
    render,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      app.stage.removeChildren();
      cells.destroy();
      flow.destroy();
      tokens.destroy();
      app.destroy({ removeView: true });
    },
  };
}
