/**
 * HexaPharma — Lab renderer (PixiJS v8).
 *
 * A DUMB renderer: it is handed sim state (MultiMap + DrugState) and draws it.
 * It contains NO sim logic — no sweeping, no evaluate, no fog computation. React
 * (src/ui) owns the state and the sim calls; this module only paints what it is
 * given. See AGENTS.md layering rule.
 *
 * The `fog` array on each EffectMap is authored by React (the persistent
 * accumulated exploration fog, or an all-revealed override for the debug toggle):
 * a fogged cell (fog === 0) is drawn as UNKNOWN ("?") so the player discovers a
 * cell's true feature only once a sweep has revealed it.
 *
 * Maps are laid out in a GRID (up to 2 per row) so 2..4 maps fit; cells shrink for
 * N ≥ 3 so the canvas stays a sensible size.
 */
import { Application, Container, Graphics, Text } from "pixi.js";
import type { MultiMap, DrugState, EffectMap, Vec2 } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";

// ───────────────────────────── layout constants ─────────────────────────────

const PAD = 12; // outer padding
const LABEL_H = 24; // height reserved for each map's label
const GAP_X = 28; // horizontal gap between maps in a row
const GAP_Y = 20; // vertical gap between rows
const COLS = 2; // maps per row (wrap to a grid for N ≥ 3)

/** Cell size in px for an N-map level — shrink as N grows so the canvas stays sane. */
function cellSize(nMaps: number): number {
  if (nMaps <= 2) return 32;
  if (nMaps === 3) return 26;
  return 22;
}

/** Grid placement (column/row) of map `i`. */
function gridPos(i: number): { col: number; row: number } {
  return { col: i % COLS, row: Math.floor(i / COLS) };
}

// ───────────────────────────── palette ─────────────────────────────

const CELL_COLOR: Record<number, number> = {
  [CellKind.Empty]: 0xe8edf2, // light
  [CellKind.Wall]: 0x3a3f44, // dark gray
  [CellKind.Hazard]: 0xe23b3b, // red
  [CellKind.SideEffect]: 0x9b5de5, // purple
  [CellKind.Cure]: 0x2bb673, // green
};

const GRID_LINE = 0xc2ccd6;
const FOG_COLOR = 0x10141a; // unknown (fogged) cell fill
const FOG_MARK = 0x6b7785; // "?" glyph on a fogged cell
const TOKEN_COLOR = 0x1d6fe0;
const TOKEN_RING = 0xffffff;
const BG = 0xf4f7fa;
const LABEL_COLOR = 0x222a33;

/** Width/height of one map in px at the given cell size. */
function mapPx(map: EffectMap | undefined, cell: number, fallbackW = 9, fallbackH = 9): { w: number; h: number } {
  const w = (map ? map.width : fallbackW) * cell;
  const h = (map ? map.height : fallbackH) * cell;
  return { w, h };
}

/** Pixel size of the whole canvas for an N-map level (all maps assumed same W/H). */
function canvasSize(mm: MultiMap): { width: number; height: number } {
  const n = mm.maps.length;
  const cell = cellSize(n);
  const { w: mapW, h: mapH } = mapPx(mm.maps[0], cell);
  const cols = Math.min(COLS, Math.max(1, n));
  const rows = Math.ceil(n / COLS);
  return {
    width: PAD * 2 + cols * mapW + (cols - 1) * GAP_X,
    height: PAD * 2 + rows * (LABEL_H + mapH) + (rows - 1) * GAP_Y,
  };
}

/** Top-left pixel origin of map `i` (after outer pad + its label row). */
function mapOriginPx(mm: MultiMap, i: number): { ox: number; oy: number } {
  const cell = cellSize(mm.maps.length);
  const { w: mapW, h: mapH } = mapPx(mm.maps[0], cell);
  const { col, row } = gridPos(i);
  return {
    ox: PAD + col * (mapW + GAP_X),
    oy: PAD + LABEL_H + row * (LABEL_H + mapH + GAP_Y),
  };
}

/** Draw one map's cells, grid, and fog into `g`/`fogG` at cell size `cell`. */
function drawMap(map: EffectMap, ox: number, oy: number, cell: number, g: Graphics, fogG: Graphics, labels: Container): void {
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const px = ox + x * cell;
      const py = oy + y * cell;
      const revealed = (map.fog[i] ?? 0) === 1;

      if (!revealed) {
        // Unknown cell: solid dark fill + a "?" glyph; the true feature stays hidden.
        fogG.rect(px, py, cell, cell).fill({ color: FOG_COLOR });
        fogG.rect(px, py, cell, cell).stroke({ color: GRID_LINE, width: 1 });
        if (cell >= 24) {
          const q = new Text({
            text: "?",
            style: { fontFamily: "Arial", fontSize: Math.round(cell * 0.5), fill: FOG_MARK, fontWeight: "bold" },
          });
          q.anchor.set(0.5);
          q.x = px + cell / 2;
          q.y = py + cell / 2;
          labels.addChild(q);
        }
        continue;
      }

      const kind = map.cell[i] ?? CellKind.Empty;
      const color = CELL_COLOR[kind] ?? CELL_COLOR[CellKind.Empty]!;
      g.rect(px, py, cell, cell).fill({ color });
      g.rect(px, py, cell, cell).stroke({ color: GRID_LINE, width: 1 });
      // Mark Cure cells with a bright target ring so players can spot goals.
      if (kind === CellKind.Cure) {
        const ccx = px + cell / 2;
        const ccy = py + cell / 2;
        g.circle(ccx, ccy, cell * 0.3).stroke({ color: 0xffffff, width: 2 });
        g.circle(ccx, ccy, cell * 0.12).fill({ color: 0xffffff });
      }
    }
  }
}

/** Draw the drug token (a circle) at grid `pos` on map `i`. */
function drawToken(mm: MultiMap, i: number, pos: Vec2, g: Graphics, failed: boolean): void {
  const cell = cellSize(mm.maps.length);
  const { ox, oy } = mapOriginPx(mm, i);
  const cx = ox + pos.x * cell + cell / 2;
  const cy = oy + pos.y * cell + cell / 2;
  const r = cell * 0.32;
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
 * sized from `mm` (maps are assumed uniform W/H) and laid out in a grid. Caller
 * mounts `.canvas`, then calls `.render(mm, drug)` whenever the React state changes,
 * and `.destroy()` on unmount.
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

    const cell = cellSize(curr.maps.length);
    for (let i = 0; i < curr.maps.length; i++) {
      const map = curr.maps[i];
      if (map === undefined) continue;
      const { ox, oy } = mapOriginPx(curr, i);
      drawMap(map, ox, oy, cell, cells, fog, labels);

      const label = new Text({
        text: `Map ${i}`,
        style: { fontFamily: "Arial", fontSize: 15, fill: LABEL_COLOR, fontWeight: "bold" },
      });
      label.x = ox;
      label.y = oy - LABEL_H + 2;
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
