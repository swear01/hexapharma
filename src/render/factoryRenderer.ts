/**
 * HexaPharma — Factory renderer (PixiJS v8).
 *
 * A DUMB renderer: it is handed a FactoryLayout + FactoryState (+ the bottleneck
 * machine typeId to highlight) and draws the grid, belts, machines, source/sink,
 * and the Unit tokens at their grid positions. It contains NO sim logic — no
 * stepping, no throughput analysis. React (src/ui) owns the state and the sim
 * calls; this module only paints what it is given. See AGENTS.md layering rule.
 */
import { Application, Container, Graphics, Text } from "pixi.js";
import type {
  Dir,
  FactoryTile,
  FactoryLayout,
  FactoryState,
  MachineTypeId,
} from "../sim/phase0_interfaces";

// ───────────────────────────── layout constants ─────────────────────────────

const CELL = 56; // px per grid cell
const PAD = 12; // outer padding

// ───────────────────────────── palette ─────────────────────────────

const BG = 0xf4f7fa;
const GRID_LINE = 0xc2ccd6;
const EMPTY_COLOR = 0xe8edf2;
const BELT_COLOR = 0xdfe7ee;
const BELT_ARROW = 0x6b7785;
const MACHINE_COLOR = 0xcdd9ff;
const MACHINE_BORDER = 0x4a6bd0;
const BOTTLENECK_COLOR = 0xffd9d2;
const BOTTLENECK_BORDER = 0xe23b3b;
const SOURCE_COLOR = 0x2bb673;
const SINK_COLOR = 0x9b5de5;
const TILE_LABEL = 0x222a33;
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

/** Draw a triangle arrow centered at (cx,cy) pointing in direction `d`. */
function drawArrow(g: Graphics, cx: number, cy: number, d: Dir, color: number): void {
  const dx = DIR_DX[d] ?? 0;
  const dy = DIR_DY[d] ?? 0;
  const r = CELL * 0.22;
  // tip in the travel direction; base perpendicular.
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

interface DrawCtx {
  readonly cells: Graphics;
  readonly tokens: Graphics;
  readonly labels: Container;
  readonly bottleneck: MachineTypeId | null;
}

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
    case "source": {
      cells.rect(px, py, CELL, CELL).fill({ color: SOURCE_COLOR });
      drawArrow(cells, cx, cy, tile.dir, 0xffffff);
      addLabel(labels, "SRC", px + 4, py + 3, 0xffffff);
      break;
    }
    case "sink": {
      cells.rect(px, py, CELL, CELL).fill({ color: SINK_COLOR });
      cells.circle(cx, cy, CELL * 0.22).stroke({ color: 0xffffff, width: 3 });
      addLabel(labels, "SINK", px + 4, py + 3, 0xffffff);
      break;
    }
    case "machine": {
      const isBottleneck = ctx.bottleneck !== null && tile.def.typeId === ctx.bottleneck;
      cells
        .rect(px + 2, py + 2, CELL - 4, CELL - 4)
        .fill({ color: isBottleneck ? BOTTLENECK_COLOR : MACHINE_COLOR })
        .stroke({ color: isBottleneck ? BOTTLENECK_BORDER : MACHINE_BORDER, width: isBottleneck ? 3 : 2 });
      // in/out arrows on the tile edges.
      drawArrow(cells, cx, cy, tile.outDir, MACHINE_BORDER);
      addLabel(labels, tile.def.typeId, px + 5, py + 4, TILE_LABEL);
      addLabel(labels, `⏱${tile.def.speed}`, px + 5, py + CELL - 18, TILE_LABEL);
      break;
    }
  }
  cells.rect(px, py, CELL, CELL).stroke({ color: GRID_LINE, width: 1 });
}

function addLabel(labels: Container, text: string, x: number, y: number, fill: number): void {
  const t = new Text({
    text,
    style: { fontFamily: "Arial", fontSize: 12, fill, fontWeight: "bold" },
  });
  t.x = x;
  t.y = y;
  labels.addChild(t);
}

export interface FactoryRenderer {
  readonly canvas: HTMLCanvasElement;
  /** Repaint the given layout + sim state. Pure draw; no sim logic. */
  render(layout: FactoryLayout, state: FactoryState, bottleneck: MachineTypeId | null): void;
  destroy(): void;
}

/**
 * Create + initialize a Factory renderer sized for `layout`. Caller mounts
 * `.canvas`, then calls `.render(layout, state, bottleneck)` whenever React state
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

  function render(
    curr: FactoryLayout,
    state: FactoryState,
    bottleneck: MachineTypeId | null,
  ): void {
    const want = canvasSize(curr);
    if (app.renderer.width !== want.width || app.renderer.height !== want.height) {
      app.renderer.resize(want.width, want.height);
    }
    cells.clear();
    tokens.clear();
    labels.removeChildren();

    const ctx: DrawCtx = { cells, tokens, labels, bottleneck };
    for (let y = 0; y < curr.height; y++) {
      for (let x = 0; x < curr.width; x++) {
        const tile = curr.tiles[y * curr.width + x];
        if (tile === undefined) continue;
        drawTile(tile, x, y, ctx);
      }
    }

    // Unit tokens on top.
    for (const u of state.units) {
      const cx = PAD + u.pos.x * CELL + CELL / 2;
      const cy = PAD + u.pos.y * CELL + CELL / 2;
      const r = CELL * 0.2;
      tokens.circle(cx, cy, r + 2).fill({ color: TOKEN_RING });
      tokens.circle(cx, cy, r).fill({ color: u.drug.failed ? TOKEN_FAILED : TOKEN_COLOR });
      // proc ring on machine tiles being processed.
      if (u.proc > 0) {
        tokens.circle(cx, cy, r + 4).stroke({ color: TOKEN_PROC, width: 2 });
      }
    }
  }

  return {
    canvas: app.canvas,
    render,
    destroy: () => app.destroy(true, { children: true }),
  };
}
