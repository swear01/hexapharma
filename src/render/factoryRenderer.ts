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
import { Application, Container, Graphics, Text } from "pixi.js";
import type {
  Dir,
  PlacedMachine,
  FactoryTile,
  FactoryLayout,
  FactoryRuntime,
} from "../sim/phase0_interfaces";
import { worldCells, worldInPorts, worldOutPorts } from "../sim/factory-geom";

// ───────────────────────────── layout constants ─────────────────────────────

const CELL = 56; // px per grid cell
const PAD = 12; // outer padding

// ───────────────────────────── palette ─────────────────────────────

const BG = 0xf4f7fa;
const GRID_LINE = 0xc2ccd6;
const EMPTY_COLOR = 0xe8edf2;
const BELT_COLOR = 0xdfe7ee;
const BELT_ARROW = 0x6b7785;
const SPLIT_COLOR = 0xe7e0fb;
const SPLIT_MARK = 0x7a52d6;
const MERGE_COLOR = 0xfde7cf;
const MERGE_MARK = 0xd9892a;
const MACHINE_COLOR = 0xcdd9ff;
const MACHINE_BORDER = 0x4a6bd0;
const BOTTLENECK_COLOR = 0xffd9d2;
const BOTTLENECK_BORDER = 0xe23b3b;
const SOURCE_COLOR = 0x2bb673;
const SINK_COLOR = 0x9b5de5;
const TILE_LABEL = 0x222a33;
const PORT_IN = 0x18a558; // green notch — input port
const PORT_OUT = 0xe23b3b; // red notch — output port
const TOKEN_COLOR = 0x1d6fe0;
const TOKEN_FAILED = 0x111111;
const TOKEN_RING = 0xffffff;
const TOKEN_PROC = 0xffb020;

const DIR_DX: readonly number[] = [1, 0, -1, 0];
const DIR_DY: readonly number[] = [0, 1, 0, -1];

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
function drawPortNotch(g: Graphics, cx: number, cy: number, side: Dir, color: number): void {
  const dx = DIR_DX[side] ?? 0;
  const dy = DIR_DY[side] ?? 0;
  const half = CELL / 2;
  const ex = cx + dx * (half - 5); // mid-point of the edge, just inside
  const ey = cy + dy * (half - 5);
  const w = dx !== 0 ? 6 : 16;
  const h = dy !== 0 ? 6 : 16;
  g.rect(ex - w / 2, ey - h / 2, w, h).fill({ color });
}

function addLabel(labels: Container, text: string, x: number, y: number, fill: number, size = 12): void {
  const t = new Text({
    text,
    style: { fontFamily: "Arial", fontSize: size, fill, fontWeight: "bold" },
  });
  t.x = x;
  t.y = y;
  labels.addChild(t);
}

interface DrawCtx {
  readonly cells: Graphics;
  readonly labels: Container;
}

/** Draw one belt-grid tile (machines are drawn separately from layout.machines). */
function drawTile(tile: FactoryTile, x: number, y: number, ctx: DrawCtx): void {
  const px = PAD + x * CELL;
  const py = PAD + y * CELL;
  const cx = px + CELL / 2;
  const cy = py + CELL / 2;
  const { cells, labels } = ctx;

  switch (tile.kind) {
    case "empty": {
      cells.rect(px, py, CELL, CELL).fill({ color: EMPTY_COLOR });
      break;
    }
    case "belt": {
      cells.rect(px, py, CELL, CELL).fill({ color: BELT_COLOR });
      drawArrow(cells, cx, cy, tile.dir, BELT_ARROW);
      break;
    }
    case "splitter": {
      cells.rect(px, py, CELL, CELL).fill({ color: SPLIT_COLOR });
      cells.circle(cx, cy, CELL * 0.12).fill({ color: SPLIT_MARK });
      for (const d of tile.outDirs) drawArrow(cells, cx, cy, d, SPLIT_MARK, 0.3);
      addLabel(labels, "S", px + 4, py + 3, SPLIT_MARK);
      break;
    }
    case "merger": {
      cells.rect(px, py, CELL, CELL).fill({ color: MERGE_COLOR });
      for (const d of tile.inDirs) drawArrow(cells, cx, cy, ((d + 2) & 3) as Dir, MERGE_MARK, 0.22);
      drawArrow(cells, cx, cy, tile.outDir, MERGE_MARK, 0.3);
      addLabel(labels, "M", px + 4, py + 3, MERGE_MARK);
      break;
    }
    case "source": {
      cells.rect(px, py, CELL, CELL).fill({ color: SOURCE_COLOR });
      drawArrow(cells, cx, cy, tile.dir, 0xffffff);
      addLabel(labels, "SRC", px + 4, py + 3, 0xffffff);
      addLabel(labels, `p${tile.period}`, px + 4, py + CELL - 18, 0xffffff);
      break;
    }
    case "sink": {
      cells.rect(px, py, CELL, CELL).fill({ color: SINK_COLOR });
      cells.circle(cx, cy, CELL * 0.22).stroke({ color: 0xffffff, width: 3 });
      addLabel(labels, "SINK", px + 4, py + 3, 0xffffff);
      break;
    }
  }
  cells.rect(px, py, CELL, CELL).stroke({ color: GRID_LINE, width: 1 });
}

/** Draw a placed multi-cell machine: its rotated footprint, label, and port notches. */
function drawMachine(m: PlacedMachine, isBottleneck: boolean, ctx: DrawCtx): void {
  const { cells, labels } = ctx;
  const fill = isBottleneck ? BOTTLENECK_COLOR : MACHINE_COLOR;
  const border = isBottleneck ? BOTTLENECK_BORDER : MACHINE_BORDER;
  const borderW = isBottleneck ? 3 : 2;

  // body: fill + outline every occupied cell (the footprint).
  let minX = Infinity;
  let minY = Infinity;
  for (const wc of worldCells(m)) {
    const px = PAD + wc.x * CELL;
    const py = PAD + wc.y * CELL;
    cells.rect(px + 2, py + 2, CELL - 4, CELL - 4).fill({ color: fill }).stroke({ color: border, width: borderW });
    if (wc.x < minX) minX = wc.x;
    if (wc.y < minY) minY = wc.y;
  }

  // port notches: green = input, red = output.
  for (const wp of worldInPorts(m)) {
    drawPortNotch(cells, PAD + wp.x * CELL + CELL / 2, PAD + wp.y * CELL + CELL / 2, wp.side, PORT_IN);
  }
  for (const wp of worldOutPorts(m)) {
    drawPortNotch(cells, PAD + wp.x * CELL + CELL / 2, PAD + wp.y * CELL + CELL / 2, wp.side, PORT_OUT);
  }

  // label (typeId + speed) at the top-left cell of the footprint.
  if (minX !== Infinity) {
    const lx = PAD + minX * CELL + 5;
    const ly = PAD + minY * CELL + 4;
    addLabel(labels, m.def.typeId, lx, ly, TILE_LABEL);
    addLabel(labels, `⏱${m.def.speed}`, lx, ly + 15, TILE_LABEL);
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
  const tokens = new Graphics();
  const labels = new Container();
  app.stage.addChild(cells, tokens, labels);
  let destroyed = false;
  let renderedLayout: FactoryLayout | null = null;
  let renderedBottleneck: number | null = null;

  function clearLabels(): void {
    for (const child of labels.removeChildren()) child.destroy();
  }

  function render(curr: FactoryLayout, runtime: FactoryRuntime, bottleneckId: number | null): void {
    const want = canvasSize(curr);
    if (app.renderer.width !== want.width || app.renderer.height !== want.height) {
      app.renderer.resize(want.width, want.height);
    }
    tokens.clear();
    if (renderedLayout !== curr || renderedBottleneck !== bottleneckId) {
      renderedLayout = curr;
      renderedBottleneck = bottleneckId;
      cells.clear();
      clearLabels();
      const ctx: DrawCtx = { cells, labels };
      for (let y = 0; y < curr.height; y++) {
        for (let x = 0; x < curr.width; x++) {
          const tile = curr.tiles[y * curr.width + x];
          if (tile === undefined) continue;
          drawTile(tile, x, y, ctx);
        }
      }
      for (const m of curr.machines) {
        drawMachine(m, bottleneckId !== null && m.id === bottleneckId, ctx);
      }
    }
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
      clearLabels();
      app.stage.removeChildren();
      cells.destroy();
      tokens.destroy();
      labels.destroy();
      app.destroy({ removeView: true });
    },
  };
}
