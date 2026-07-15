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
 * LOCAL coords; its WORLD cells/ports = local rotated by `footRot` quarter-turns CW
 * (y-down: (x,y)->(-y,x)) + anchor, with port side = (side + footRot) & 3 — the same
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
  Vec2,
} from "../sim/phase0_interfaces";
import { worldCells, worldInPorts, worldOutPorts } from "../sim/factory-geom";
import {
  buildFactoryTransportTopology,
  transportAnimationPhase,
  type FactoryTransportCell,
  type FactoryTransportEdge,
  type FactoryTransportTopology,
} from "./factoryTransportTopology";

// ───────────────────────────── layout constants ─────────────────────────────

const CELL = 42; // px per grid cell
const PAD = 12; // outer padding

// ───────────────────────────── palette ─────────────────────────────

const BG = 0xf4f7fa;
const GRID_LINE = 0xc2ccd6;
const EMPTY_COLOR = 0xe8edf2;
const BELT_COLOR = 0x596675;
const BELT_RAIL = 0x2f3945;
const BELT_ARROW = 0xdce5ec;
const SPLIT_COLOR = 0xe7e0fb;
const SPLIT_MARK = 0x7a52d6;
const MERGE_COLOR = 0xfde7cf;
const MERGE_MARK = 0xd9892a;
const SOURCE_COLOR = 0x2bb673;
const SINK_COLOR = 0x9b5de5;
const PORT_IN = 0x18a558; // green notch — input port
const PORT_OUT = 0xe23b3b; // red notch — output port
const TOKEN_COLOR = 0x1d6fe0;
const TOKEN_FAILED = 0x111111;
const TOKEN_RING = 0xffffff;
const TOKEN_PROC = 0xffb020;

const DIR_DX: readonly number[] = [1, 0, -1, 0];
const DIR_DY: readonly number[] = [0, 1, 0, -1];

export interface FactoryTransportArmGeometry {
  readonly side: Dir;
  readonly from: Vec2;
  readonly to: Vec2;
}

export function factoryTransportArmGeometry(mask: number): readonly FactoryTransportArmGeometry[] {
  if (!Number.isSafeInteger(mask) || mask < 0 || mask > 0b1111) {
    throw new Error("Factory renderer transport mask must be an integer in [0, 15]");
  }
  const arms: FactoryTransportArmGeometry[] = [];
  for (let rawSide = 0; rawSide < 4; rawSide++) {
    const side = rawSide as Dir;
    if ((mask & (1 << side)) === 0) continue;
    arms.push({
      side,
      from: { x: CELL / 2, y: CELL / 2 },
      to: {
        x: CELL / 2 + (DIR_DX[side] ?? 0) * CELL / 2,
        y: CELL / 2 + (DIR_DY[side] ?? 0) * CELL / 2,
      },
    });
  }
  return arms;
}

export interface FactoryTransportFlowPoint extends Vec2 {
  readonly dir: Dir;
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
  const fromX = PAD + edge.from.x * CELL + CELL / 2;
  const fromY = PAD + edge.from.y * CELL + CELL / 2;
  const toX = PAD + edge.to.x * CELL + CELL / 2;
  const toY = PAD + edge.to.y * CELL + CELL / 2;
  const start = fromMachine ? 0.5 : 0.18;
  const end = toMachine ? 0.5 : 0.82;
  const progress = start + (end - start) * phase;
  return {
    x: fromX + (toX - fromX) * progress,
    y: fromY + (toY - fromY) * progress,
    dir: edge.dir,
  };
}

export interface MachineVisualStyle {
  readonly body: number;
  readonly face: number;
  readonly accent: number;
}

export function machineVisualStyle(typeId: string): MachineVisualStyle {
  switch (typeId) {
    case "push":
      return { body: 0x5576d2, face: 0xdce6ff, accent: 0x1d377f };
    case "push2":
      return { body: 0x3655ae, face: 0xcbd9ff, accent: 0x14295f };
    case "pull":
      return { body: 0x7b5ab4, face: 0xeadfff, accent: 0x3c226a };
    case "shear":
      return { body: 0xd47836, face: 0xffe3c5, accent: 0x713610 };
    case "skew":
      return { body: 0x258d9a, face: 0xcdf6f4, accent: 0x0d4d58 };
    case "dilute":
      return { body: 0x3a9b70, face: 0xd1f2df, accent: 0x15553a };
    case "settle":
      return { body: 0xbb4f83, face: 0xffddeb, accent: 0x6e2148 };
    default:
      return { body: 0x607080, face: 0xe2e8ed, accent: 0x26323d };
  }
}

/** Pixel size of the whole canvas for a layout. */
function canvasSize(layout: FactoryLayout): { width: number; height: number } {
  return {
    width: PAD * 2 + layout.width * CELL,
    height: PAD * 2 + layout.height * CELL,
  };
}

// ───────────────────────────── drawing helpers ─────────────────────────────

/** Draw a triangle arrow centered at (cx,cy) pointing in direction `d`. */
function drawArrow(g: Graphics, cx: number, cy: number, d: Dir, color: number, scale = 0.22): void {
  const dx = DIR_DX[d] ?? 0;
  const dy = DIR_DY[d] ?? 0;
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

/** Draw a small notch rectangle on the `side` edge of the cell at world (cx,cy). */
function drawPortNotch(
  g: Graphics,
  cx: number,
  cy: number,
  side: Dir,
  color: number,
  connected: boolean,
): void {
  const dx = DIR_DX[side] ?? 0;
  const dy = DIR_DY[side] ?? 0;
  const half = CELL / 2;
  const ex = cx + dx * (half - 5); // mid-point of the edge, just inside
  const ey = cy + dy * (half - 5);
  const w = dx !== 0 ? 8 : 18;
  const h = dy !== 0 ? 8 : 18;
  g.rect(ex - w / 2 - 2, ey - h / 2 - 2, w + 4, h + 4).fill({ color: 0x19242d });
  g.rect(ex - w / 2, ey - h / 2, w, h).fill({
    color: connected ? color : 0x7b858d,
    alpha: connected ? 1 : 0.7,
  });
}

interface DrawCtx {
  readonly cells: Graphics;
  readonly topology: FactoryTransportTopology;
}

function drawFloorCell(x: number, y: number, cells: Graphics): void {
  const px = PAD + x * CELL;
  const py = PAD + y * CELL;
  cells.rect(px, py, CELL, CELL).fill({ color: EMPTY_COLOR });
  cells.rect(px, py, CELL, CELL).stroke({ color: GRID_LINE, width: 1 });
}

function drawTransportBase(
  visual: FactoryTransportCell,
  tile: FactoryTile,
  x: number,
  y: number,
  cells: Graphics,
): void {
  const px = PAD + x * CELL;
  const py = PAD + y * CELL;
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  const arms = factoryTransportArmGeometry(visual.incidentMask);
  if (arms.length === 0) {
    if (tile.kind !== "belt") return;
    const dx = DIR_DX[tile.dir] ?? 0;
    const dy = DIR_DY[tile.dir] ?? 0;
    cells.moveTo(cx - dx * 4, cy - dy * 4).lineTo(cx + dx * 10, cy + dy * 10)
      .stroke({ color: BELT_RAIL, width: 22 });
    cells.moveTo(cx - dx * 4, cy - dy * 4).lineTo(cx + dx * 10, cy + dy * 10)
      .stroke({ color: BELT_COLOR, width: 16 });
    return;
  }
  for (const arm of arms) {
    cells.moveTo(px + arm.from.x, py + arm.from.y).lineTo(px + arm.to.x, py + arm.to.y);
  }
  cells.stroke({ color: BELT_RAIL, width: 22 });
  cells.circle(cx, cy, 11).fill({ color: BELT_RAIL });
  for (const arm of arms) {
    cells.moveTo(px + arm.from.x, py + arm.from.y).lineTo(px + arm.to.x, py + arm.to.y);
  }
  cells.stroke({ color: BELT_COLOR, width: 16 });
  cells.circle(cx, cy, 8).fill({ color: BELT_COLOR });
}

/** Draw one transport structure after the shared connection arms. */
function drawTileBody(
  tile: FactoryTile,
  visual: FactoryTransportCell,
  x: number,
  y: number,
  ctx: DrawCtx,
): void {
  const px = PAD + x * CELL;
  const py = PAD + y * CELL;
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
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
      cells.rect(px + 4, py + 4, CELL - 8, CELL - 8).fill({ color: SPLIT_COLOR })
        .stroke({ color: SPLIT_MARK, width: 2 });
      cells.circle(cx, cy, CELL * 0.13).fill({ color: SPLIT_MARK });
      for (const d of tile.outDirs) {
        const dx = DIR_DX[d] ?? 0;
        const dy = DIR_DY[d] ?? 0;
        cells.moveTo(cx, cy).lineTo(cx + dx * CELL * 0.38, cy + dy * CELL * 0.38)
          .stroke({ color: SPLIT_MARK, width: 4 });
      }
      break;
    }
    case "merger": {
      cells.rect(px + 4, py + 4, CELL - 8, CELL - 8).fill({ color: MERGE_COLOR })
        .stroke({ color: MERGE_MARK, width: 2 });
      for (const d of tile.inDirs) {
        const dx = DIR_DX[d] ?? 0;
        const dy = DIR_DY[d] ?? 0;
        cells.moveTo(cx + dx * CELL * 0.38, cy + dy * CELL * 0.38).lineTo(cx, cy)
          .stroke({ color: MERGE_MARK, width: 4 });
      }
      drawArrow(cells, cx, cy, tile.outDir, MERGE_MARK, 0.22);
      break;
    }
    case "source": {
      cells.rect(px + 3, py + 3, CELL - 6, CELL - 6).fill({ color: SOURCE_COLOR })
        .stroke({ color: 0x13633e, width: 3 });
      cells.circle(cx - (DIR_DX[tile.dir] ?? 0) * 5, cy - (DIR_DY[tile.dir] ?? 0) * 5, CELL * 0.24)
        .stroke({ color: 0xffffff, width: 3 });
      drawArrow(cells, cx, cy, tile.dir, 0xffffff, 0.17);
      break;
    }
    case "sink": {
      cells.rect(px + 3, py + 3, CELL - 6, CELL - 6).fill({ color: SINK_COLOR })
        .stroke({ color: 0x56318d, width: 3 });
      cells.circle(cx, cy, CELL * 0.27).stroke({ color: 0xffffff, width: 3 });
      cells.circle(cx, cy, CELL * 0.11).fill({ color: 0xffffff });
      break;
    }
  }
}

export interface MachinePathGlyph {
  readonly points: readonly Vec2[];
}

export function machinePathGlyph(path: PathStamp): MachinePathGlyph {
  if (path.length === 0) {
    throw new Error("Factory renderer requires a non-empty path");
  }
  const authored: Vec2[] = [{ x: 0, y: 0 }];
  let x = 0;
  let y = 0;
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const delta of path) {
    x += delta.x;
    y += delta.y;
    authored.push({ x, y });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
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
  const style = isBottleneck
    ? { body: 0xe25d52, face: 0xffded9, accent: 0x801f1b }
    : baseStyle;
  const occupiedCells = worldCells(m);
  const occupied = new Set(occupiedCells.map((cell) => `${cell.x},${cell.y}`));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const wc of occupiedCells) {
    const px = PAD + wc.x * CELL;
    const py = PAD + wc.y * CELL;
    const leftConnected = occupied.has(`${wc.x - 1},${wc.y}`);
    const rightConnected = occupied.has(`${wc.x + 1},${wc.y}`);
    const topConnected = occupied.has(`${wc.x},${wc.y - 1}`);
    const bottomConnected = occupied.has(`${wc.x},${wc.y + 1}`);
    const x0 = px + (leftConnected ? 0 : 3);
    const y0 = py + (topConnected ? 0 : 3);
    const x1 = px + CELL - (rightConnected ? 0 : 3);
    const y1 = py + CELL - (bottomConnected ? 0 : 3);
    cells.rect(x0 + 3, y0 + 4, x1 - x0, y1 - y0).fill({ color: 0x17212a, alpha: 0.28 });
    cells.rect(x0, y0, x1 - x0, y1 - y0).fill({ color: style.body });
    if (!topConnected) cells.moveTo(x0, y0).lineTo(x1, y0);
    if (!rightConnected) cells.moveTo(x1, y0).lineTo(x1, y1);
    if (!bottomConnected) cells.moveTo(x1, y1).lineTo(x0, y1);
    if (!leftConnected) cells.moveTo(x0, y1).lineTo(x0, y0);
    cells.stroke({ color: style.accent, width: isBottleneck ? 4 : 3 });
    cells.circle(px + CELL / 2, py + CELL / 2, 2.5).fill({ color: style.face, alpha: 0.58 });
    if (wc.x < minX) minX = wc.x;
    if (wc.y < minY) minY = wc.y;
    if (wc.x > maxX) maxX = wc.x;
    if (wc.y > maxY) maxY = wc.y;
  }

  const input = worldInPorts(m)[0];
  const output = worldOutPorts(m)[0];
  if (minX !== Infinity && input !== undefined && output !== undefined) {
    const cx = PAD + ((minX + maxX + 1) * CELL) / 2;
    const cy = PAD + ((minY + maxY + 1) * CELL) / 2;
    const inX = PAD + input.x * CELL + CELL / 2;
    const inY = PAD + input.y * CELL + CELL / 2;
    const outX = PAD + output.x * CELL + CELL / 2;
    const outY = PAD + output.y * CELL + CELL / 2;
    cells.moveTo(inX, inY).lineTo(cx, cy).lineTo(outX, outY)
      .stroke({ color: style.face, width: 6, alpha: 0.46 });
  }

  // port notches: green = input, red = output.
  for (const wp of worldInPorts(m)) {
    const connected = topology.machinePorts.some((port) =>
      port.machineId === m.id &&
      port.role === "input" &&
      port.x === wp.x &&
      port.y === wp.y &&
      port.side === wp.side &&
      port.connected
    );
    drawPortNotch(
      cells,
      PAD + wp.x * CELL + CELL / 2,
      PAD + wp.y * CELL + CELL / 2,
      wp.side,
      PORT_IN,
      connected,
    );
  }
  for (const wp of worldOutPorts(m)) {
    const connected = topology.machinePorts.some((port) =>
      port.machineId === m.id &&
      port.role === "output" &&
      port.x === wp.x &&
      port.y === wp.y &&
      port.side === wp.side &&
      port.connected
    );
    drawPortNotch(
      cells,
      PAD + wp.x * CELL + CELL / 2,
      PAD + wp.y * CELL + CELL / 2,
      wp.side,
      PORT_OUT,
      connected,
    );
  }

  if (minX !== Infinity) {
    const cx = PAD + ((minX + maxX + 1) * CELL) / 2;
    const cy = PAD + ((minY + maxY + 1) * CELL) / 2;
    cells.rect(cx - 19, cy - 19, 38, 38).fill({ color: style.face })
      .stroke({ color: style.accent, width: 3 });
    cells.rect(cx - 13, cy - 13, 26, 26).stroke({ color: style.body, width: 2, alpha: 0.6 });
    drawMachineGlyph(cells, m, cx, cy, style.accent);
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
    const from = topology.cells[edge.from.y * width + edge.from.x];
    const to = topology.cells[edge.to.y * width + edge.to.x];
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
  await app.init({ width, height, background: BG, antialias: true });

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
      for (let y = 0; y < curr.height; y++) {
        for (let x = 0; x < curr.width; x++) drawFloorCell(x, y, cells);
      }
      for (let y = 0; y < curr.height; y++) {
        for (let x = 0; x < curr.width; x++) {
          const tile = curr.tiles[y * curr.width + x];
          const visual = renderedTopology.cells[y * curr.width + x];
          if (tile === undefined || visual === undefined) continue;
          drawTransportBase(visual, tile, x, y, cells);
        }
      }
      for (let y = 0; y < curr.height; y++) {
        for (let x = 0; x < curr.width; x++) {
          const tile = curr.tiles[y * curr.width + x];
          const visual = renderedTopology.cells[y * curr.width + x];
          if (tile === undefined || visual === undefined) continue;
          drawTileBody(tile, visual, x, y, ctx);
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
      const cx = PAD + (runtime.unitX[unitIndex] ?? 0) * CELL + CELL / 2;
      const cy = PAD + (runtime.unitY[unitIndex] ?? 0) * CELL + CELL / 2;
      const r = CELL * 0.2;
      tokens.circle(cx, cy, r + 2).fill({ color: TOKEN_RING });
      tokens.circle(cx, cy, r).fill({
        color: runtime.unitFailed[unitIndex] === 0 ? TOKEN_COLOR : TOKEN_FAILED,
      });
      // proc ring while a unit is being processed inside a machine.
      if ((runtime.unitMachineIds[unitIndex] ?? -1) >= 0 && (runtime.unitProc[unitIndex] ?? 0) > 0) {
        tokens.circle(cx, cy, r + 4).stroke({ color: TOKEN_PROC, width: 2 });
      }
    }
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
