/**
 * HexaPharma — Lab renderer (PixiJS v8).
 *
 * A DUMB renderer: it is handed sim state (MultiMap + DrugState) and draws it.
 * It contains NO sim logic — no sweeping, no evaluate, no fog computation. React
 * (src/ui) owns the state and the sim calls; this module only paints what it is
 * given. See AGENTS.md layering rule.
 */
import { Application, Container, Graphics, Text } from "pixi.js";
import type { MultiMap, DrugState, EffectMap, Vec2 } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";

// ───────────────────────────── layout constants ─────────────────────────────

const CELL = 32; // px per grid cell
const PAD = 12; // outer padding
const LABEL_H = 24; // height reserved for the per-map label
const GAP = 28; // horizontal gap between maps

// ───────────────────────────── palette ─────────────────────────────

const CELL_COLOR: Record<number, number> = {
  [CellKind.Empty]: 0xe8edf2, // light
  [CellKind.Wall]: 0x3a3f44, // dark gray
  [CellKind.Hazard]: 0xe23b3b, // red
  [CellKind.SideEffect]: 0x9b5de5, // purple
  [CellKind.Cure]: 0x2bb673, // green
};

const GRID_LINE = 0xc2ccd6;
const FOG_COLOR = 0x10141a;
const FOG_ALPHA = 0.82;
const TOKEN_COLOR = 0x1d6fe0;
const TOKEN_RING = 0xffffff;
const BG = 0xf4f7fa;
const LABEL_COLOR = 0x222a33;

/** Pixel size of the whole canvas for an N-map level (all maps assumed same W/H). */
function canvasSize(mm: MultiMap): { width: number; height: number } {
  const n = mm.maps.length;
  const first = mm.maps[0];
  const w = first ? first.width : 9;
  const h = first ? first.height : 9;
  const mapW = w * CELL;
  const mapH = h * CELL;
  return {
    width: PAD * 2 + n * mapW + (n - 1) * GAP,
    height: PAD * 2 + LABEL_H + mapH,
  };
}

/** Top-left pixel origin of map `i` (after outer pad + its label row). */
function mapOriginPx(mm: MultiMap, i: number): { ox: number; oy: number } {
  const first = mm.maps[0];
  const w = first ? first.width : 9;
  const mapW = w * CELL;
  return {
    ox: PAD + i * (mapW + GAP),
    oy: PAD + LABEL_H,
  };
}

/** Draw one map's cells, grid, and fog into `g`/`fogG`. */
function drawMap(map: EffectMap, ox: number, oy: number, g: Graphics, fogG: Graphics): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const kind = map.cell[i] ?? CellKind.Empty;
      const color = CELL_COLOR[kind] ?? CELL_COLOR[CellKind.Empty]!;
      const px = ox + x * CELL;
      const py = oy + y * CELL;
      g.rect(px, py, CELL, CELL).fill({ color });
      g.rect(px, py, CELL, CELL).stroke({ color: GRID_LINE, width: 1 });
      // Mark Cure cells with a bright target ring so players can spot goals.
      if (kind === CellKind.Cure) {
        const ccx = px + CELL / 2;
        const ccy = py + CELL / 2;
        g.circle(ccx, ccy, CELL * 0.3).stroke({ color: 0xffffff, width: 2 });
        g.circle(ccx, ccy, CELL * 0.12).fill({ color: 0xffffff });
      }
      // Fog overlay on hidden cells (fog === 0 means hidden/fogged).
      if ((map.fog[i] ?? 0) === 0) {
        fogG.rect(px, py, CELL, CELL).fill({ color: FOG_COLOR, alpha: FOG_ALPHA });
      }
    }
  }
}

/** Draw the drug token (a circle) at grid `pos` on map `i`. */
function drawToken(mm: MultiMap, i: number, pos: Vec2, g: Graphics, failed: boolean): void {
  const { ox, oy } = mapOriginPx(mm, i);
  const cx = ox + pos.x * CELL + CELL / 2;
  const cy = oy + pos.y * CELL + CELL / 2;
  const r = CELL * 0.32;
  g.circle(cx, cy, r + 2).fill({ color: TOKEN_RING });
  g.circle(cx, cy, r).fill({ color: failed ? 0x111111 : TOKEN_COLOR });
}

export interface LabRenderer {
  /** The canvas element to mount into the DOM. */
  readonly canvas: HTMLCanvasElement;
  /** Repaint the given sim state. Pure draw; no sim logic. */
  render(mm: MultiMap, drug: DrugState): void;
  /** Tear down the Pixi application and free GPU resources. */
  destroy(): void;
}

/**
 * Create + initialize a Lab renderer for a level of the given shape. The canvas is
 * sized from `mm` (maps are assumed uniform W/H). Caller mounts `.canvas`, then
 * calls `.render(mm, drug)` whenever the React state changes, and `.destroy()` on
 * unmount.
 */
export async function createLabRenderer(mm: MultiMap): Promise<LabRenderer> {
  const { width, height } = canvasSize(mm);
  const app = new Application();
  await app.init({ width, height, background: BG, antialias: true });

  // Persistent layers: static cells, fog overlay, token, labels.
  const cells = new Graphics();
  const fog = new Graphics();
  const token = new Graphics();
  const labels = new Container();
  app.stage.addChild(cells, fog, token, labels);

  function render(curr: MultiMap, drug: DrugState): void {
    cells.clear();
    fog.clear();
    token.clear();
    labels.removeChildren();

    for (let i = 0; i < curr.maps.length; i++) {
      const map = curr.maps[i];
      if (map === undefined) continue;
      const { ox, oy } = mapOriginPx(curr, i);
      drawMap(map, ox, oy, cells, fog);

      const label = new Text({
        text: `Map ${i}`,
        style: { fontFamily: "Arial", fontSize: 15, fill: LABEL_COLOR, fontWeight: "bold" },
      });
      label.x = ox;
      label.y = PAD - 2;
      labels.addChild(label);

      const pos = drug.pos[i];
      if (pos !== undefined) drawToken(curr, i, pos, token, drug.failed);
    }
  }

  return {
    canvas: app.canvas,
    render,
    destroy: () => app.destroy(true, { children: true }),
  };
}
