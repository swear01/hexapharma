/**
 * HexaPharma — Factory renderer (PixiJS v8).
 *
 * A DUMB renderer: handed a FactoryLayout + FactoryRuntime (+ the bottleneck machine
 * id to highlight) it draws the belt-grid tiles, the multi-cell shaped machines
 * (in layout.machines), the source/sink, and the Unit tokens. It contains NO sim
 * logic — no stepping, no throughput analysis. React (src/ui) owns the state and
 * the sim calls; this module only paints what it is given. See AGENTS.md layering.
 *
 * The floor is drawn as a printed orienteering map: paper ground, the entitled hex
 * floor in light rule ink, machines as ink footprints carrying their Atlas path, and
 * belts as continuous flow-blue channels. A Plan renders as a purple overprint
 * (dashed, low ink); Production renders as solid black print.
 *
 * Machines are NOT tiles. Each PlacedMachine carries a MachineShape in LOCAL coords;
 * its WORLD cells/ports = local rotated by `footRot` sixth-turns CW + anchor, with
 * port side = (side + footRot) % 6 — the same geometry the sim uses.
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
import { HEX_DIRS, HEX_DQ, HEX_DR, hexInBounds, hexIndex, oppositeHexDir } from "../sim/hex";
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
import { inkJitter } from "./ink";

// ───────────────────────────── layout constants ─────────────────────────────

const CELL = 42; // px point-to-point hex diameter (logical pixels)
export const FACTORY_HEX_SIZE = CELL / 2;
const HEX_WIDTH = Math.sqrt(3) * FACTORY_HEX_SIZE;
const PAD = 12; // outer padding
/** Backing-store multiplier so CSS zoom up to ~2x stays crisp. */
const MAX_RESOLUTION = 4;

// ───────────────────────────── palette ─────────────────────────────

export const FACTORY_SCHEMATIC_STYLE = Object.freeze({
  ...SHARED_SCHEMATIC_STYLE,
  neatline: 0xb9ae97,
});

export type FactoryRenderMode = "plan" | "production";

export interface FactoryPrintStyle {
  /** Machine outlines, glyphs, ports and symbols. */
  readonly ink: number;
  readonly inkAlpha: number;
  /** Belt channel. */
  readonly channel: number;
  readonly channelAlpha: number;
  /** Machine body fill: opaque, so the floor grid never shows through a machine. */
  readonly fill: number;
  readonly fillAlpha: number;
  /** Plan outlines are dashed overprint; Production is solid print. */
  readonly dashed: boolean;
  /** Hand-drawn wobble on non-functional footprint outlines, in px (never on ports/belts). */
  readonly wobble: number;
}

/** Plan = purple overprint at low ink; Production = black print with blue flow. */
export function factoryPrintStyle(mode: FactoryRenderMode): FactoryPrintStyle {
  const s = FACTORY_SCHEMATIC_STYLE;
  return mode === "plan"
    ? {
        ink: s.course,
        inkAlpha: 0.85,
        channel: s.course,
        channelAlpha: 0.4,
        fill: 0xf2e8f2,
        fillAlpha: 1,
        dashed: true,
        wobble: 0,
      }
    : {
        ink: s.structure,
        inkAlpha: 1,
        channel: s.flow,
        channelAlpha: 1,
        fill: 0xe4e2de,
        fillAlpha: 1,
        dashed: false,
        wobble: 0.6,
      };
}

const CHANNEL_WIDTH = 8;
/** Outer machine outline vs. the seam between two touching machines. */
export const MACHINE_OUTLINE_WIDTH = 1.6;
export const SEAM_WIDTH = 4;
const PORT_HALF = 3.6;
/** Port arrowhead size (drawTriangle radius); the head straddles the footprint edge. */
const PORT_ARROW = 7.5;
/** Farthest icon point from its cell centre; with the end circle (r 3 + stroke) it stays inside one hex. */
export const MACHINE_ICON_RADIUS = 13;

/** Rejected placement: the ghost prints in failure red. */
const INVALID_GHOST_STYLE: FactoryPrintStyle = Object.freeze({
  ink: FACTORY_SCHEMATIC_STYLE.failure,
  inkAlpha: 1,
  channel: FACTORY_SCHEMATIC_STYLE.failure,
  channelAlpha: 0.55,
  fill: 0xf6dcd9,
  fillAlpha: 1,
  dashed: false,
  wobble: 0,
});
const GHOST_ALPHA = 0.8;

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

/** Unit vector (x, y) of hex direction `d` in screen space; precomputed so hot paths never allocate. */
const DIR_UX = new Float64Array(6);
const DIR_UY = new Float64Array(6);
for (const d of HEX_DIRS) {
  const p = hexToPixel(HEX_DQ[d]!, HEX_DR[d]!, 1);
  const length = Math.hypot(p.x, p.y);
  DIR_UX[d] = p.x / length;
  DIR_UY[d] = p.y / length;
}
/** Centre-to-edge-midpoint distance. */
const EDGE = HEX_WIDTH / 2;

function cellX(q: number, r: number): number {
  return PAD + HEX_WIDTH / 2 + Math.sqrt(3) * FACTORY_HEX_SIZE * (q + r / 2);
}

function cellY(r: number): number {
  return PAD + FACTORY_HEX_SIZE + 1.5 * FACTORY_HEX_SIZE * r;
}

function flowProgress(fromMachine: boolean, toMachine: boolean, phase: number): number {
  const start = fromMachine ? 0.5 : 0.18;
  const end = toMachine ? 0.5 : 0.82;
  return start + (end - start) * phase;
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
  const progress = flowProgress(fromMachine, toMachine, phase);
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    dir: edge.dir,
  };
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

/** Open chevron centred at (cx,cy) pointing along `d`. Allocation-free. */
function drawChevron(g: Graphics, cx: number, cy: number, d: Dir, r: number): void {
  const dx = DIR_UX[d]!;
  const dy = DIR_UY[d]!;
  g.moveTo(cx - dx * r * 0.5 - dy * r, cy - dy * r * 0.5 + dx * r)
    .lineTo(cx + dx * r * 0.5, cy + dy * r * 0.5)
    .lineTo(cx - dx * r * 0.5 + dy * r, cy - dy * r * 0.5 - dx * r);
}

/** Solid triangle pointing along `d`. */
function drawTriangle(g: Graphics, cx: number, cy: number, d: Dir, r: number): void {
  const dx = DIR_UX[d]!;
  const dy = DIR_UY[d]!;
  g.moveTo(cx + dx * r, cy + dy * r)
    .lineTo(cx - dx * r * 0.6 - dy * r * 0.85, cy - dy * r * 0.6 + dx * r * 0.85)
    .lineTo(cx - dx * r * 0.6 + dy * r * 0.85, cy - dy * r * 0.6 - dx * r * 0.85)
    .closePath();
}

export interface DashSegment {
  readonly from: PixelPoint;
  readonly to: PixelPoint;
}

/** Split a line into dash segments (dash, gap) that always start and end on ink. */
export function dashSegments(from: PixelPoint, to: PixelPoint, dash = 4, gap = 3): readonly DashSegment[] {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (length === 0) return [];
  const count = Math.max(1, Math.round((length + gap) / (dash + gap)));
  const step = length / count;
  const ink = step * dash / (dash + gap);
  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const segments: DashSegment[] = [];
  for (let index = 0; index < count; index++) {
    const start = index * step + (index === 0 ? 0 : (step - ink) / 2);
    const end = index === count - 1 ? length : start + ink;
    segments.push({
      from: { x: from.x + ux * start, y: from.y + uy * start },
      to: { x: from.x + ux * end, y: from.y + uy * end },
    });
  }
  return segments;
}

/** Deterministic ≤`amount` px offset for a world-space vertex (shared vertices wobble together). */
function wobbleOffset(x: number, y: number, axis: number, amount: number): number {
  if (amount === 0) return 0;
  return inkJitter(Math.round(x * 4) * 7919 + Math.round(y * 4), axis) * amount;
}

interface DrawCtx {
  readonly cells: Graphics;
  readonly style: FactoryPrintStyle;
}

function drawFloor(layout: FactoryLayout, g: Graphics): void {
  const s = FACTORY_SCHEMATIC_STYLE;
  for (let r = 0; r < layout.height; r++) {
    for (let q = 0; q < layout.width; q++) {
      g.poly([...hexPolygon(cellX(q, r), cellY(r), FACTORY_HEX_SIZE)], true);
    }
  }
  g.fill({ color: s.deck }).stroke({ color: s.rule, width: 1 });
  // Neatline: the floor's outer boundary, so out-of-bounds reads as bare paper.
  for (let r = 0; r < layout.height; r++) {
    for (let q = 0; q < layout.width; q++) {
      const polygon = hexPolygon(cellX(q, r), cellY(r), FACTORY_HEX_SIZE);
      for (const side of HEX_DIRS) {
        if (hexInBounds(layout.width, layout.height, q + HEX_DQ[side]!, r + HEX_DR[side]!)) continue;
        const from = polygon[(side + 1) % 6]!;
        const to = polygon[(side + 2) % 6]!;
        g.moveTo(from.x, from.y).lineTo(to.x, to.y);
      }
    }
  }
  g.stroke({ color: s.neatline, width: 1.5, cap: "round" });
}

function drawTransportBase(
  visual: FactoryTransportCell,
  tile: FactoryTile,
  q: number,
  r: number,
  ctx: DrawCtx,
): void {
  const { cells, style } = ctx;
  const cx = cellX(q, r);
  const cy = cellY(r);
  const stroke = { color: style.channel, alpha: style.channelAlpha, width: CHANNEL_WIDTH };
  // Inside a machine the footprint carries the flow; its ports show the connection.
  if (visual.kind === "machine") return;
  if (visual.incidentMask === 0) {
    if (tile.kind !== "belt") return;
    // Isolated belt: a short stub toward its heading, ending on the shared edge.
    cells.moveTo(cx - DIR_UX[tile.dir]! * 5, cy - DIR_UY[tile.dir]! * 5)
      .lineTo(cx + DIR_UX[tile.dir]! * EDGE, cy + DIR_UY[tile.dir]! * EDGE)
      .stroke(stroke);
    return;
  }
  for (const side of HEX_DIRS) {
    if ((visual.incidentMask & (1 << side)) === 0) continue;
    cells.moveTo(cx, cy).lineTo(cx + DIR_UX[side]! * EDGE, cy + DIR_UY[side]! * EDGE);
  }
  cells.stroke(stroke);
  // Round joint so turns and junctions read as one continuous channel.
  cells.circle(cx, cy, CHANNEL_WIDTH / 2).fill({ color: style.channel, alpha: style.channelAlpha });
}

/** Draw one transport structure (legend symbol) after the shared channel. */
function drawTileBody(
  tile: FactoryTile,
  visual: FactoryTransportCell,
  q: number,
  r: number,
  ctx: DrawCtx,
): void {
  const { cells, style } = ctx;
  const cx = cellX(q, r);
  const cy = cellY(r);
  const ink = { color: style.ink, alpha: style.inkAlpha };
  const paper = { color: FACTORY_SCHEMATIC_STYLE.deck };

  switch (tile.kind) {
    case "empty":
      break;
    case "belt": {
      // A belt that leads nowhere is an open end: show its heading and a stop bar on the edge.
      if (visual.outMask === 0) {
        drawChevron(cells, cx, cy, tile.dir, 4.5);
        cells.stroke({ ...ink, width: 2, cap: "round", join: "round" });
        const ex = cx + DIR_UX[tile.dir]! * (EDGE - 2);
        const ey = cy + DIR_UY[tile.dir]! * (EDGE - 2);
        cells.moveTo(ex - DIR_UY[tile.dir]! * 6, ey + DIR_UX[tile.dir]! * 6)
          .lineTo(ex + DIR_UY[tile.dir]! * 6, ey - DIR_UX[tile.dir]! * 6)
          .stroke({ ...ink, width: 2, cap: "round" });
      }
      break;
    }
    case "splitter": {
      // Fork: hollow hub, branches carried by the channel.
      cells.circle(cx, cy, 6).fill(paper).stroke({ ...ink, width: 2 });
      cells.circle(cx, cy, 1.8).fill(ink);
      break;
    }
    case "merger": {
      // Funnel: solid triangle toward the single output.
      cells.circle(cx, cy, 7).fill(paper);
      drawTriangle(cells, cx, cy, tile.outDir, 6.5);
      cells.fill(ink);
      break;
    }
    case "source": {
      // Start symbol: open triangle pointing along the emitted flow.
      drawTriangle(cells, cx, cy, tile.dir, 11);
      cells.fill(paper).stroke({ ...ink, width: 2, join: "round" });
      break;
    }
    case "sink": {
      // Finish symbol: double circle.
      cells.circle(cx, cy, 11).fill(paper).stroke({ ...ink, width: 2 });
      cells.circle(cx, cy, 6.5).stroke({ ...ink, width: 2 });
      break;
    }
  }
}

export interface MachinePathGlyph {
  readonly points: readonly PixelPoint[];
}

export function machinePathGlyph(path: PathStamp, span = 22): MachinePathGlyph {
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
  const scale = span / Math.max(1, maxX - minX, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    points: authored.map((point) => ({
      x: (point.x - centerX) * scale,
      y: (point.y - centerY) * scale,
    })),
  };
}

/**
 * The machine's path icon, centred on (0,0), scaled so its farthest point is MACHINE_ICON_RADIUS
 * (so any turn still fits one hex) and turned with its footprint (sixth-turns clockwise).
 */
export function placedMachinePathGlyph(machine: PlacedMachine): MachinePathGlyph {
  const glyph = machinePathGlyph(machine.def.path, 1);
  let reach = 0;
  for (const point of glyph.points) reach = Math.max(reach, Math.hypot(point.x, point.y));
  const angle = machine.footRot * Math.PI / 3;
  const scale = MACHINE_ICON_RADIUS / reach;
  const cos = Math.cos(angle) * scale;
  const sin = Math.sin(angle) * scale;
  return {
    points: glyph.points.map((point) => ({
      x: point.x * cos - point.y * sin,
      y: point.x * sin + point.y * cos,
    })),
  };
}

/**
 * The footprint cell nearest the footprint's centroid (ties: one without a port arrow, then shape
 * order): the icon sits there, always inside the body.
 */
export function machineIconCell(machine: PlacedMachine): { readonly q: number; readonly r: number } {
  const cells = worldCells(machine);
  const ports = [...worldInPorts(machine), ...worldOutPorts(machine)];
  let sumX = 0;
  let sumY = 0;
  for (const cell of cells) {
    sumX += cellX(cell.q, cell.r);
    sumY += cellY(cell.r);
  }
  const meanX = sumX / cells.length;
  const meanY = sumY / cells.length;
  let best = cells[0];
  let bestScore = Infinity;
  for (const cell of cells) {
    // Whole-pixel distance so float noise cannot break a tie; a port cell loses the tie.
    const distance = Math.round(Math.hypot(cellX(cell.q, cell.r) - meanX, cellY(cell.r) - meanY));
    const score = distance * 2 + (ports.some((port) => port.q === cell.q && port.r === cell.r) ? 1 : 0);
    if (score < bestScore) {
      best = cell;
      bestScore = score;
    }
  }
  if (best === undefined) throw new Error("Factory renderer machine has no footprint");
  return best;
}

/** Atlas path in ink, matching MachineIcon: filled start dot, hollow end circle. */
function drawMachineGlyph(g: Graphics, machine: PlacedMachine, cx: number, cy: number, style: FactoryPrintStyle): void {
  const glyph = placedMachinePathGlyph(machine);
  const first = glyph.points[0];
  const end = glyph.points[glyph.points.length - 1];
  if (first === undefined || end === undefined) throw new Error("Factory renderer path glyph is missing its ends");
  const ink = { color: style.ink, alpha: style.inkAlpha };
  g.moveTo(cx + first.x, cy + first.y);
  for (let index = 1; index < glyph.points.length; index++) {
    const point = glyph.points[index]!;
    g.lineTo(cx + point.x, cy + point.y);
  }
  g.stroke({ ...ink, width: 2.2, cap: "round", join: "round" });
  g.circle(cx + first.x, cy + first.y, 2.4).fill(ink);
  g.circle(cx + end.x, cy + end.y, 3).fill({ color: style.fill })
    .stroke({ ...ink, width: 1.6 });
}

/** Ports sit just inside the footprint edge, where an incoming belt channel ends. */
const PORT_INSET = PORT_HALF + 1;

function portCenterX(q: number, r: number, side: Dir): number {
  return cellX(q, r) + DIR_UX[side]! * (EDGE - PORT_INSET);
}

function portCenterY(r: number, side: Dir): number {
  return cellY(r) + DIR_UY[side]! * (EDGE - PORT_INSET);
}

/** Machine output feeding the next machine's input directly: a short channel across the shared edge. */
function drawMachineLinks(layout: FactoryLayout, topology: FactoryTransportTopology, g: Graphics, style: FactoryPrintStyle): void {
  let any = false;
  for (const edge of topology.edges) {
    if (topology.cells[hexIndex(layout.width, edge.from.q, edge.from.r)]?.kind !== "machine") continue;
    if (topology.cells[hexIndex(layout.width, edge.to.q, edge.to.r)]?.kind !== "machine") continue;
    g.moveTo(portCenterX(edge.from.q, edge.from.r, edge.dir), portCenterY(edge.from.r, edge.dir))
      .lineTo(portCenterX(edge.to.q, edge.to.r, ((edge.dir + 3) % 6) as Dir), portCenterY(edge.to.r, ((edge.dir + 3) % 6) as Dir));
    any = true;
  }
  if (any) g.stroke({ color: style.channel, alpha: style.channelAlpha, width: CHANNEL_WIDTH });
}

/** Edges two different machines share, each listed once (lower machine id first). */
export function factoryMachineSeams(layout: FactoryLayout): readonly { readonly q: number; readonly r: number; readonly side: Dir }[] {
  const owner = new Int32Array(layout.width * layout.height).fill(-1);
  for (const machine of layout.machines) {
    for (const cell of worldCells(machine)) {
      if (hexInBounds(layout.width, layout.height, cell.q, cell.r)) owner[hexIndex(layout.width, cell.q, cell.r)] = machine.id;
    }
  }
  const seams: { q: number; r: number; side: Dir }[] = [];
  for (let r = 0; r < layout.height; r++) {
    for (let q = 0; q < layout.width; q++) {
      const own = owner[hexIndex(layout.width, q, r)]!;
      if (own < 0) continue;
      for (const side of HEX_DIRS) {
        const nq = q + HEX_DQ[side]!;
        const nr = r + HEX_DR[side]!;
        if (!hexInBounds(layout.width, layout.height, nq, nr)) continue;
        const other = owner[hexIndex(layout.width, nq, nr)]!;
        if (other >= 0 && own < other) seams.push({ q, r, side });
      }
    }
  }
  return seams;
}

/** Where two machines touch, the dividing line prints heavier than a line's outer outline. */
function drawMachineSeams(layout: FactoryLayout, g: Graphics, style: FactoryPrintStyle): void {
  const seams = factoryMachineSeams(layout);
  for (const seam of seams) {
    const polygon = hexPolygon(cellX(seam.q, seam.r), cellY(seam.r), FACTORY_HEX_SIZE);
    const a = polygon[(seam.side + 1) % 6]!;
    const b = polygon[(seam.side + 2) % 6]!;
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  if (seams.length > 0) g.stroke({ color: style.ink, alpha: style.inkAlpha, width: SEAM_WIDTH, cap: "round" });
}

/**
 * Ports are arrowheads straddling the footprint edge: inputs point into the machine, outputs out
 * of it. Connected = solid ink, open = hollow.
 */
function drawPort(
  g: Graphics,
  q: number,
  r: number,
  side: Dir,
  role: "input" | "output",
  connected: boolean,
  style: FactoryPrintStyle,
): void {
  const ink = { color: style.ink, alpha: style.inkAlpha };
  // Centre so the tip and the back sit equally far either side of the edge.
  const offset = role === "output" ? -0.2 * PORT_ARROW : 0.2 * PORT_ARROW;
  const x = cellX(q, r) + DIR_UX[side]! * (EDGE + offset);
  const y = cellY(r) + DIR_UY[side]! * (EDGE + offset);
  drawTriangle(g, x, y, role === "output" ? side : oppositeHexDir(side), PORT_ARROW);
  if (connected) g.fill(ink);
  else g.fill({ color: style.fill }).stroke({ ...ink, width: 1.5, join: "round" });
}

/** Draw a placed multi-cell machine: one filled body with a single outer outline, and its icon. */
function drawMachine(m: PlacedMachine, isBottleneck: boolean, ctx: DrawCtx): void {
  const { cells, style } = ctx;
  const occupied = worldCells(m);

  for (const wc of occupied) {
    cells.poly([...hexPolygon(cellX(wc.q, wc.r), cellY(wc.r), FACTORY_HEX_SIZE)], true);
  }
  cells.fill({ color: style.fill, alpha: style.fillAlpha });

  for (const wc of occupied) {
    const body = hexPolygon(cellX(wc.q, wc.r), cellY(wc.r), FACTORY_HEX_SIZE);
    for (const side of HEX_DIRS) {
      if (occupied.some((n) => n.q === wc.q + HEX_DQ[side]! && n.r === wc.r + HEX_DR[side]!)) continue;
      const a = body[(side + 1) % 6]!;
      const b = body[(side + 2) % 6]!;
      if (style.dashed) {
        for (const dash of dashSegments(a, b)) cells.moveTo(dash.from.x, dash.from.y).lineTo(dash.to.x, dash.to.y);
      } else {
        cells.moveTo(a.x + wobbleOffset(a.x, a.y, 0, style.wobble), a.y + wobbleOffset(a.x, a.y, 1, style.wobble))
          .lineTo(b.x + wobbleOffset(b.x, b.y, 0, style.wobble), b.y + wobbleOffset(b.x, b.y, 1, style.wobble));
      }
    }
  }
  cells.stroke({ color: style.ink, alpha: style.inkAlpha, width: isBottleneck ? 3 : MACHINE_OUTLINE_WIDTH, cap: "round", join: "round" });

  const icon = machineIconCell(m);
  const cx = cellX(icon.q, icon.r);
  const cy = cellY(icon.r);
  drawMachineGlyph(cells, m, cx, cy, style);
  if (isBottleneck) {
    // Bottleneck tag: a solid ink square at the icon's shoulder (shape, not colour).
    cells.rect(cx + 9, cy - 13, 6, 6).fill({ color: style.ink, alpha: style.inkAlpha });
  }
}

/** Cold per-layout facts the per-tick pass reads without allocating. */
interface BlockIndex {
  /** Per cell: a transport whose flow can never leave (no outgoing edge). */
  readonly deadEnd: Uint8Array;
  /** Per cell: heading of that dead end (6 = none). */
  readonly deadDir: Uint8Array;
  /** Machines with no connected output; their finished units can never leave. */
  readonly stuckMachines: ReadonlyMap<number, { readonly speed: number; readonly ports: readonly { readonly q: number; readonly r: number; readonly side: Dir }[] }>;
}

function buildBlockIndex(layout: FactoryLayout, topology: FactoryTransportTopology): BlockIndex {
  const area = layout.width * layout.height;
  const deadEnd = new Uint8Array(area);
  const deadDir = new Uint8Array(area).fill(6);
  for (let index = 0; index < area; index++) {
    const visual = topology.cells[index];
    const tile = layout.tiles[index];
    if (visual === undefined || tile === undefined || visual.kind === "machine") continue;
    if (tile.kind === "belt" || tile.kind === "merger" || tile.kind === "splitter") {
      if (visual.emitMask !== 0 && visual.outMask === 0) {
        deadEnd[index] = 1;
        deadDir[index] = tile.kind === "belt" ? tile.dir : tile.kind === "merger" ? tile.outDir : tile.outDirs[0] ?? 6;
      }
    }
  }
  const stuckMachines = new Map<number, { readonly speed: number; readonly ports: readonly { q: number; r: number; side: Dir }[] }>();
  for (const machine of layout.machines) {
    const outputs = topology.machinePorts.filter((port) => port.machineId === machine.id && port.role === "output");
    if (outputs.some((port) => port.connected)) continue;
    stuckMachines.set(machine.id, { speed: machine.def.speed, ports: worldOutPorts(machine) });
  }
  return { deadEnd, deadDir, stuckMachines };
}

/** A unit that can never move again on this layout (dead-end belt or machine with no output). */
export function factoryUnitBlocked(
  layout: FactoryLayout,
  topology: FactoryTransportTopology,
  unit: { readonly q: number; readonly r: number; readonly machineId: number; readonly proc: number },
): boolean {
  const index = buildBlockIndex(layout, topology);
  return unitBlocked(index, layout.width, unit.q, unit.r, unit.machineId, unit.proc);
}

function unitBlocked(index: BlockIndex, width: number, q: number, r: number, machineId: number, proc: number): boolean {
  if (machineId >= 0) {
    const stuck = index.stuckMachines.get(machineId);
    return stuck !== undefined && proc >= stuck.speed;
  }
  return index.deadEnd[hexIndex(width, q, r)] === 1;
}

/** Failure stop bar across an exit edge: red, thick, perpendicular to the flow. */
function drawStopBar(g: Graphics, x: number, y: number, d: Dir): void {
  const px = -DIR_UY[d]!;
  const py = DIR_UX[d]!;
  g.moveTo(x + px * 8, y + py * 8).lineTo(x - px * 8, y - py * 8);
}

function drawTransportFlow(
  topology: FactoryTransportTopology,
  width: number,
  phase: number,
  flow: Graphics,
  style: FactoryPrintStyle,
): void {
  for (const edge of topology.edges) {
    const from = topology.cells[hexIndex(width, edge.from.q, edge.from.r)];
    const to = topology.cells[hexIndex(width, edge.to.q, edge.to.r)];
    if (from === undefined || to === undefined) {
      throw new Error("Factory renderer transport edge references a missing cell");
    }
    const progress = flowProgress(from.kind === "machine", to.kind === "machine", phase);
    const x0 = cellX(edge.from.q, edge.from.r);
    const y0 = cellY(edge.from.r);
    const x = x0 + (cellX(edge.to.q, edge.to.r) - x0) * progress;
    const y = y0 + (cellY(edge.to.r) - y0) * progress;
    drawChevron(flow, x, y, edge.dir, 2.6);
  }
  flow.stroke({ color: FACTORY_SCHEMATIC_STYLE.deck, alpha: style.channelAlpha === 1 ? 0.95 : 0.9, width: 1.6, cap: "round", join: "round" });
}

export interface FactoryGhostTile {
  readonly q: number;
  readonly r: number;
  readonly tile: FactoryTile;
}

/** What a placement would build, drawn like the real thing at reduced opacity. */
export interface FactoryGhost {
  /** Valid: the layout with the edit applied (the ghost joins the line as built). Invalid: the current layout. */
  readonly layout: FactoryLayout;
  readonly invalid: boolean;
  readonly tiles: readonly FactoryGhostTile[];
  readonly machine: PlacedMachine | null;
}

const EMPTY_TILE: FactoryTile = Object.freeze({ kind: "empty" });

/** Cold path: runs only when the hovered placement changes. */
function drawGhost(ghost: FactoryGhost, g: Graphics, modeStyle: FactoryPrintStyle): void {
  // Solid outline: a Plan ghost must read against the dashed overprint it previews.
  const style = ghost.invalid ? INVALID_GHOST_STYLE : { ...modeStyle, dashed: false, wobble: 0 };
  let layout = ghost.layout;
  if (ghost.invalid) {
    // A rejected edit has no proposed layout: draw the ghost on its own.
    const tiles = layout.tiles.map(() => EMPTY_TILE);
    for (const { q, r, tile } of ghost.tiles) {
      if (hexInBounds(layout.width, layout.height, q, r)) tiles[hexIndex(layout.width, q, r)] = tile;
    }
    layout = { ...layout, tiles, machines: [] };
  }
  const topology = buildFactoryTransportTopology(layout);
  const ctx: DrawCtx = { cells: g, style };
  // Cells the edit skips (under a machine) show nothing.
  const visualAt = (q: number, r: number): FactoryTransportCell | undefined => {
    const visual = hexInBounds(layout.width, layout.height, q, r) ? topology.cells[hexIndex(layout.width, q, r)] : undefined;
    return visual?.kind === "machine" ? undefined : visual;
  };
  for (const { q, r, tile } of ghost.tiles) {
    const visual = visualAt(q, r);
    if (visual !== undefined) drawTransportBase(visual, tile, q, r, ctx);
  }
  if (ghost.machine !== null) {
    const machine = ghost.machine;
    drawMachine(machine, false, ctx);
    const connected = (q: number, r: number, side: Dir, role: "input" | "output") =>
      topology.machinePorts.some((port) =>
        port.machineId === machine.id && port.q === q && port.r === r && port.side === side && port.role === role && port.connected);
    for (const port of worldInPorts(machine)) drawPort(g, port.q, port.r, port.side, "input", connected(port.q, port.r, port.side, "input"), style);
    for (const port of worldOutPorts(machine)) drawPort(g, port.q, port.r, port.side, "output", connected(port.q, port.r, port.side, "output"), style);
  }
  for (const { q, r, tile } of ghost.tiles) {
    const visual = visualAt(q, r);
    if (visual === undefined) continue;
    drawTileBody(tile, visual, q, r, ctx);
    // A connected belt shows its heading at the centre (an open end already prints one).
    if (tile.kind === "belt" && visual.outMask !== 0) {
      drawChevron(g, cellX(q, r), cellY(r), tile.dir, 5.5);
      g.stroke({ color: style.ink, alpha: style.inkAlpha, width: 2.4, cap: "round", join: "round" });
    }
  }
}

export interface FactoryRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Repaint the given layout + mutable sim runtime. Pure draw; no sim logic. */
  render(layout: FactoryLayout, runtime: FactoryRuntime, bottleneckId: number | null): void;
  /** Repaint only the placement preview (null clears it). */
  renderGhost(ghost: FactoryGhost | null): void;
  destroy(): void;
}

/**
 * Create + initialize a Factory renderer sized for `layout`. Caller mounts
 * `.canvas`, then calls `.render(layout, state, bottleneckId)` whenever React state
 * changes, and `.destroy()` on unmount. The canvas CSS size is the logical size;
 * the backing store is denser so CSS zoom stays crisp.
 */
export async function createFactoryRenderer(
  layout: FactoryLayout,
  mode: FactoryRenderMode,
): Promise<FactoryRenderer> {
  const { width, height } = canvasSize(layout);
  const style = factoryPrintStyle(mode);
  const resolution = Math.min(MAX_RESOLUTION, Math.ceil((globalThis.devicePixelRatio || 1) * 2));
  const app = new Application();
  await app.init({
    autoStart: false,
    width,
    height,
    // Transparent: the contour paper around the floor is printed by the page underneath.
    backgroundAlpha: 0,
    antialias: true,
    resolution,
    autoDensity: true,
  });

  const cells = new Graphics();
  const flow = new Graphics();
  const ghost = new Graphics();
  ghost.alpha = GHOST_ALPHA;
  const tokens = new Graphics();
  const alerts = new Graphics();
  app.stage.addChild(cells, flow, ghost, tokens, alerts);
  let destroyed = false;
  let renderedLayout: FactoryLayout | null = null;
  let renderedBottleneck: number | null = null;
  let renderedTopology: FactoryTransportTopology | null = null;
  let blockIndex: BlockIndex | null = null;

  function render(curr: FactoryLayout, runtime: FactoryRuntime, bottleneckId: number | null): void {
    const want = canvasSize(curr);
    if (app.renderer.width !== want.width || app.renderer.height !== want.height) {
      app.renderer.resize(want.width, want.height);
    }
    flow.clear();
    tokens.clear();
    alerts.clear();
    if (renderedLayout !== curr || renderedBottleneck !== bottleneckId) {
      renderedLayout = curr;
      renderedBottleneck = bottleneckId;
      renderedTopology = buildFactoryTransportTopology(curr);
      blockIndex = buildBlockIndex(curr, renderedTopology);
      cells.clear();
      const ctx: DrawCtx = { cells, style };
      drawFloor(curr, cells);
      for (let r = 0; r < curr.height; r++) {
        for (let q = 0; q < curr.width; q++) {
          const tile = curr.tiles[hexIndex(curr.width, q, r)];
          const visual = renderedTopology.cells[hexIndex(curr.width, q, r)];
          if (tile === undefined || visual === undefined) continue;
          drawTransportBase(visual, tile, q, r, ctx);
        }
      }
      for (const m of curr.machines) {
        drawMachine(m, bottleneckId !== null && m.id === bottleneckId, ctx);
      }
      drawMachineSeams(curr, cells, style);
      drawMachineLinks(curr, renderedTopology, cells, style);
      for (const port of renderedTopology.machinePorts) {
        drawPort(cells, port.q, port.r, port.side, port.role, port.connected, style);
      }
      for (let r = 0; r < curr.height; r++) {
        for (let q = 0; q < curr.width; q++) {
          const tile = curr.tiles[hexIndex(curr.width, q, r)];
          const visual = renderedTopology.cells[hexIndex(curr.width, q, r)];
          if (tile === undefined || visual === undefined) continue;
          drawTileBody(tile, visual, q, r, ctx);
        }
      }
    }
    if (renderedTopology === null || blockIndex === null) {
      throw new Error("Factory renderer transport topology was not initialized");
    }
    // Plan has no clock: chevrons sit still mid-edge. Production moves them with the tick.
    drawTransportFlow(
      renderedTopology,
      curr.width,
      mode === "plan" ? 0.5 : transportAnimationPhase(runtime.tick),
      flow,
      style,
    );

    const s = FACTORY_SCHEMATIC_STYLE;
    let blocked = 0;
    for (let unitIndex = 0; unitIndex < runtime.unitCount; unitIndex++) {
      const q = runtime.unitX[unitIndex] ?? 0;
      const r = runtime.unitY[unitIndex] ?? 0;
      const machineId = runtime.unitMachineIds[unitIndex] ?? -1;
      const proc = runtime.unitProc[unitIndex] ?? 0;
      const cx = cellX(q, r);
      const cy = cellY(r);
      if (runtime.unitFailed[unitIndex] !== 0) {
        // Failed unit: red square (shape cue, not colour alone).
        tokens.rect(cx - 5.5, cy - 5.5, 11, 11).fill({ color: s.deck });
        tokens.rect(cx - 4, cy - 4, 8, 8).fill({ color: s.failure });
      } else {
        tokens.circle(cx, cy, 5.6).fill({ color: s.deck });
        tokens.circle(cx, cy, 4).fill({ color: s.structure });
      }
      if (unitBlocked(blockIndex, curr.width, q, r, machineId, proc)) {
        blocked++;
        if (machineId >= 0) {
          const stuck = blockIndex.stuckMachines.get(machineId);
          if (stuck !== undefined) {
            for (const port of stuck.ports) {
              // Just past the output arrowhead's tip.
              drawStopBar(alerts, cellX(port.q, port.r) + DIR_UX[port.side]! * (EDGE + PORT_ARROW + 2), cellY(port.r) + DIR_UY[port.side]! * (EDGE + PORT_ARROW + 2), port.side);
            }
          }
        } else {
          const d = blockIndex.deadDir[hexIndex(curr.width, q, r)] ?? 6;
          if (d < 6) drawStopBar(alerts, cx + DIR_UX[d]! * (EDGE - 2), cy + DIR_UY[d]! * (EDGE - 2), d as Dir);
        }
      } else if (runtime.deadlocked) {
        blocked++;
        alerts.circle(cx, cy, 8.5);
      }
    }
    if (blocked > 0) alerts.stroke({ color: s.failure, width: 3.5, cap: "round" });
    app.render();
  }

  function renderGhost(next: FactoryGhost | null): void {
    ghost.clear();
    if (next !== null) drawGhost(next, ghost, style);
    app.render();
  }

  return {
    canvas: app.canvas,
    render,
    renderGhost,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      app.stage.removeChildren();
      cells.destroy();
      flow.destroy();
      ghost.destroy();
      tokens.destroy();
      alerts.destroy();
      app.destroy({ removeView: true });
    },
  };
}
