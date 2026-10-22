import { Application, Container, Graphics, Text } from "pixi.js";
import type { DrugState, EffectMap, MultiMap, Vec2 } from "../sim/phase0_interfaces";
import { hexInBounds, hexIndex } from "../sim/hex";
import {
  LAB_CELL_PIXELS,
  LAB_VIEWPORT,
  labCellCenter,
  labCellPolygon,
  labGridKindForBoundary,
  labGridLineStyle,
  visibleLabCells,
  type LabCamera,
  type LabGridLineKind,
} from "./labCamera";
import { drugDrawPoint, hexBoardBounds, hexToPixel, pixelToHex, type PixelPoint } from "./hexProjection";
import { CONTOUR_LEVELS, contourField } from "./labContours";
import { atlasContains } from "../sim/mapgen";
import { inkJitter } from "./ink";
import { revealedRegionEdges, type RegionEdges } from "./labRegions";
import { labTerrainVisual, type CellTerrainVisual, type PortalTerrainVisual } from "./labTerrain";
import { SHARED_SCHEMATIC_STYLE } from "./schematicStyle";

export const LAB_SCHEMATIC_STYLE = Object.freeze({
  ...SHARED_SCHEMATIC_STYLE,
  /** The held candidate is the player's own line: course purple, dashed. */
  candidate: SHARED_SCHEMATIC_STYLE.course,
  oliveInk: 0x6f7d34,
});

/** Ink-draw time for a committed leg (exponential ease-out); instant under reduced motion. */
export const LAB_LEG_DRAW_MS = 220;

export interface LabRenderView {
  readonly activeMap: number;
  readonly camera: LabCamera;
  /** Actual trail of the last trial (solid); points may sit half-way inside swamp. */
  readonly trail: readonly (Vec2 | null)[];
  /** Planned route on the known map (dashed). */
  readonly previewTrail?: readonly (Vec2 | null)[];
  readonly previewDrug?: DrugState;
  /** Endpoint of each planned step, in order (numbered control circles). */
  readonly controls?: readonly Vec2[];
  /** The last control is a Cure: draw it as the orienteering finish. */
  readonly finish?: boolean;
}


export interface LabRenderer {
  readonly canvas: HTMLCanvasElement;
  render(mm: MultiMap, drug: DrugState, view: LabRenderView): void;
  destroy(): void;
}

const LAB_HEX_SIZE = LAB_CELL_PIXELS / 2;

function isRevealed(map: EffectMap, q: number, r: number): boolean {
  if (!hexInBounds(map.width, map.height, q, r)) return false;
  return map.fog[hexIndex(map.width, q, r)] === 1;
}

function cellSeed(q: number, r: number): number {
  return Math.imul(q, 92_821) ^ Math.imul(r, 68_917);
}

function drawGridKind(
  grid: Graphics,
  kind: LabGridLineKind,
  map: EffectMap,
  camera: LabCamera,
  bounds: ReturnType<typeof visibleLabCells>,
): void {
  let drewCell = false;
  for (let r = bounds.r0; r < bounds.r1; r++) {
    for (let q = bounds.q0; q < bounds.q1; q++) {
      if (!isRevealed(map, q, r)) continue;
      const isMajor = labGridKindForBoundary(q, map.origin.q) === "major"
        || labGridKindForBoundary(r, map.origin.r) === "major";
      if ((kind === "major") !== isMajor) continue;
      grid.poly([...labCellPolygon(camera, { q, r })], true);
      drewCell = true;
    }
  }
  if (drewCell) grid.stroke(labGridLineStyle(kind, camera.zoom));
}

/** A light grid only where the map is printed, so picking stays legible without gridding the fog. */
function drawRevealedGrid(map: EffectMap, camera: LabCamera, grid: Graphics): void {
  const bounds = visibleLabCells(camera, LAB_VIEWPORT, map);
  drawGridKind(grid, "minor", map, camera, bounds);
  drawGridKind(grid, "major", map, camera, bounds);
}

// ───────────────────────────── relief contours ─────────────────────────────

const CONTOUR_STEP = 8;
const CONTOUR_CHUNK = 32;

/**
 * Contours of the generated relief (labContours), marching squares over CONTOUR_STEP world
 * pixels, one ink. Each chunk of CONTOUR_CHUNK² squares is built once in world pixels and moved with
 * the camera. Drawn over fog and revealed ground alike: the sign-free field cannot tell a
 * mountain from water, and it never reads fog, cells or effects.
 */
function drawContours(map: EffectMap, target: Graphics, gx0: number, gy0: number): void {
  const cols = CONTOUR_CHUNK;
  const rows = CONTOUR_CHUNK;
  const stride = cols + 1;
  const field = new Float64Array(stride * (rows + 1));
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      field[j * stride + i] = contourField(map, (gx0 + i) * CONTOUR_STEP, (gy0 + j) * CONTOUR_STEP, LAB_HEX_SIZE);
    }
  }
  const crossing = (gi: number, gj: number, vertical: boolean, a: number, b: number, threshold: number): PixelPoint => {
    const t = Math.min(1, Math.max(0, (threshold - a) / (b - a)));
    return {
      x: (vertical ? gi : gi + t) * CONTOUR_STEP,
      y: (vertical ? gj + t : gj) * CONTOUR_STEP,
    };
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const gi = gx0 + i;
      const gj = gy0 + j;
      const hex = pixelToHex((gi + 0.5) * CONTOUR_STEP, (gj + 0.5) * CONTOUR_STEP, LAB_HEX_SIZE);
      if (!atlasContains(map, hex.q, hex.r)) continue;
      const v0 = field[j * stride + i]!;
      const v1 = field[j * stride + i + 1]!;
      const v2 = field[(j + 1) * stride + i + 1]!;
      const v3 = field[(j + 1) * stride + i]!;
      for (const threshold of CONTOUR_LEVELS) {
        const code = (v0 > threshold ? 1 : 0) | (v1 > threshold ? 2 : 0)
          | (v2 > threshold ? 4 : 0) | (v3 > threshold ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const top = () => crossing(gi, gj, false, v0, v1, threshold);
        const right = () => crossing(gi + 1, gj, true, v1, v2, threshold);
        const bottom = () => crossing(gi, gj + 1, false, v3, v2, threshold);
        const left = () => crossing(gi, gj, true, v0, v3, threshold);
        const segment = (a: PixelPoint, b: PixelPoint) => target.moveTo(a.x, a.y).lineTo(b.x, b.y);
        switch (code) {
          case 1: case 14: segment(left(), top()); break;
          case 2: case 13: segment(top(), right()); break;
          case 3: case 12: segment(left(), right()); break;
          case 4: case 11: segment(right(), bottom()); break;
          case 6: case 9: segment(top(), bottom()); break;
          case 7: case 8: segment(left(), bottom()); break;
          case 5: segment(left(), top()); segment(right(), bottom()); break;
          case 10: segment(top(), right()); segment(left(), bottom()); break;
        }
      }
    }
  }
  target.stroke({ color: LAB_SCHEMATIC_STYLE.contour, width: 1.1, alpha: 0.55 });
}

// ───────────────────────────── printed terrain ─────────────────────────────

function edgeEnds(polygon: readonly PixelPoint[], direction: number): readonly [PixelPoint, PixelPoint] {
  return [polygon[(direction + 1) % 6]!, polygon[(direction + 2) % 6]!];
}

function portalMarkerColor(marker: string): number {
  let hash = 0;
  for (let index = 0; index < marker.length; index++) {
    hash = ((hash * 31) + marker.charCodeAt(index)) >>> 0;
  }
  const palette = [
    LAB_SCHEMATIC_STYLE.flow,
    LAB_SCHEMATIC_STYLE.contour,
    LAB_SCHEMATIC_STYLE.structure,
    LAB_SCHEMATIC_STYLE.oliveInk,
  ] as const;
  return palette[hash % palette.length] ?? LAB_SCHEMATIC_STYLE.flow;
}

function drawPortalMotif(
  terrain: Graphics,
  visual: PortalTerrainVisual,
  center: PixelPoint,
  polygon: readonly PixelPoint[],
  cell: number,
): void {
  const { x: cx, y: cy } = center;
  const marker = visual.pairMarker ?? `unpaired-${visual.role}`;
  const markerColor = portalMarkerColor(marker);
  terrain.poly([...polygon], true).fill({ color: visual.baseColor, alpha: 1 });
  terrain.rect(cx - cell * .24, cy - cell * .3, cell * .48, cell * .6)
    .fill({ color: LAB_SCHEMATIC_STYLE.deck })
    .stroke({ color: markerColor, width: Math.max(2, cell * .055) });

  if (visual.direction === null) {
    if (visual.role === "entry") {
      terrain.moveTo(cx, cy - cell * 0.1)
        .lineTo(cx + cell * 0.1, cy)
        .lineTo(cx, cy + cell * 0.1)
        .lineTo(cx - cell * 0.1, cy)
        .lineTo(cx, cy - cell * 0.1)
        .fill({ color: markerColor });
    } else {
      terrain.rect(cx - cell * 0.09, cy - cell * 0.09, cell * 0.18, cell * 0.18)
        .stroke({ color: markerColor, width: Math.max(2, cell * 0.05) });
    }
    return;
  }
  const projectedDirection = hexToPixel(visual.direction.q, visual.direction.r, 1);
  const length = Math.hypot(projectedDirection.x, projectedDirection.y);
  const dx = projectedDirection.x / length;
  const dy = projectedDirection.y / length;
  const px = -dy;
  const py = dx;
  const tipX = cx + dx * cell * 0.19;
  const tipY = cy + dy * cell * 0.19;
  terrain.moveTo(cx - dx * cell * 0.1, cy - dy * cell * 0.1)
    .lineTo(tipX, tipY)
    .stroke({ color: LAB_SCHEMATIC_STYLE.structure, width: Math.max(2, cell * 0.06) });
  terrain.moveTo(tipX, tipY)
    .lineTo(tipX - dx * cell * 0.13 + px * cell * 0.09, tipY - dy * cell * 0.13 + py * cell * 0.09)
    .lineTo(tipX - dx * cell * 0.13 - px * cell * 0.09, tipY - dy * cell * 0.13 - py * cell * 0.09)
    .lineTo(tipX, tipY)
    .fill({ color: LAB_SCHEMATIC_STYLE.structure });
  if (visual.role === "exit") {
    terrain.rect(cx - cell * 0.07, cy - cell * 0.07, cell * 0.14, cell * 0.14)
      .stroke({ color: markerColor, width: Math.max(2, cell * 0.04) });
  }
}

/** Failure ground: solid black ink with short hand-drawn tags pointing off every open edge. */
function drawCliff(
  cliffs: Graphics,
  visual: CellTerrainVisual,
  center: PixelPoint,
  polygon: readonly PixelPoint[],
  edges: RegionEdges,
  cell: number,
  seed: number,
): void {
  cliffs.poly([...polygon], true).fill({ color: visual.baseColor });
  let tagged = false;
  for (let direction = 0; direction < 6; direction++) {
    if (!edges[direction]) continue;
    const [a, b] = edgeEnds(polygon, direction);
    const mx = (a.x + b.x) / 2 - center.x;
    const my = (a.y + b.y) / 2 - center.y;
    const normal = Math.hypot(mx, my);
    const along = 0.5 + inkJitter(seed, direction) * 0.12;
    const x = a.x + (b.x - a.x) * along;
    const y = a.y + (b.y - a.y) * along;
    const length = cell * (0.12 + inkJitter(seed, direction + 6) * 0.03) / normal;
    cliffs.moveTo(x, y).lineTo(x + mx * length, y + my * length);
    tagged = true;
  }
  if (tagged) cliffs.stroke({ color: visual.rimColor, width: Math.max(1.5, cell * 0.045), cap: "round" });
}

function drawMarshHatch(terrain: Graphics, center: PixelPoint, cell: number, color: number, seed: number): void {
  const size = cell / 2;
  const rowOffsets = [-0.54, -0.18, 0.18, 0.54] as const;
  for (let row = 0; row < rowOffsets.length; row++) {
    const dy = rowOffsets[row]! * size;
    const half = Math.sqrt(3) / 2 * size * Math.min(1, (size - Math.abs(dy)) / (size / 2)) * 0.82;
    const gap = size * (0.12 + inkJitter(seed, row) * 0.05);
    const split = center.x + inkJitter(seed, row + 8) * half * 0.35;
    const y = center.y + dy + inkJitter(seed, row + 16) * cell * 0.012;
    terrain.moveTo(center.x - half, y).lineTo(split - gap / 2, y)
      .moveTo(split + gap / 2, y).lineTo(center.x + half, y);
  }
  terrain.stroke({ color, width: Math.max(1.2, cell * 0.04), cap: "round" });
}

/** Amber dot screen; kept around the centre when it overprints a Cure cross so both read. */
function drawEffectDots(target: Graphics, center: PixelPoint, cell: number, aroundCross: boolean): void {
  const radius = cell * 0.31;
  for (let index = 0; index < 6; index++) {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    target.circle(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, cell * 0.06);
  }
  if (!aroundCross) target.circle(center.x, center.y, cell * 0.075);
  target.fill({ color: LAB_SCHEMATIC_STYLE.sideEffect });
}

function drawTerrainMotif(
  terrain: Graphics,
  visual: CellTerrainVisual | PortalTerrainVisual,
  center: PixelPoint,
  polygon: readonly PixelPoint[],
  cell: number,
  seed: number,
): void {
  if (visual.kind === "empty" || visual.kind === "abyss") return;
  if (visual.kind === "portal") {
    drawPortalMotif(terrain, visual, center, polygon, cell);
    return;
  }
  terrain.poly([...polygon], true).fill({ color: visual.baseColor });
  if (visual.kind === "wall") return;
  if (visual.kind === "swamp") {
    drawMarshHatch(terrain, center, cell, visual.rimColor, seed);
  } else if (visual.kind === "sideEffect") {
    drawEffectDots(terrain, center, cell, false);
  } else if (visual.premium === true) {
    const star: number[] = [];
    for (let point = 0; point < 10; point++) {
      const angle = -Math.PI / 2 + point * Math.PI / 5;
      const radius = cell * (point % 2 === 0 ? 0.26 : 0.11);
      star.push(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius);
    }
    terrain.poly(star, true).fill({ color: visual.rimColor });
  } else {
    terrain.rect(center.x - cell * .06, center.y - cell * .2, cell * .12, cell * .4)
      .rect(center.x - cell * .2, center.y - cell * .06, cell * .4, cell * .12)
      .fill({ color: visual.rimColor });
  }
}

function regionEdgeStyle(visual: CellTerrainVisual | PortalTerrainVisual, cell: number) {
  if (visual.kind === "swamp") return null;
  if (visual.kind === "wall") return { color: visual.rimColor, width: Math.max(1.2, cell * 0.03), alpha: 0.6 };
  if (visual.kind === "cure") return { color: visual.rimColor, width: Math.max(2, cell * 0.06) };
  return { color: visual.rimColor, width: Math.max(1.5, cell * 0.04), alpha: 0.75 };
}

function drawVisibleMap(
  map: EffectMap,
  camera: LabCamera,
  paper: Graphics,
  terrain: Graphics,
  cliffs: Graphics,
  features: Graphics,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const bounds = visibleLabCells(camera, LAB_VIEWPORT, map);
  for (let r = bounds.r0; r < bounds.r1; r++) {
    for (let q = bounds.q0; q < bounds.q1; q++) {
      const coord = { q, r };
      const center = labCellCenter(camera, coord);
      const polygon = labCellPolygon(camera, coord);
      const seed = cellSeed(q, r);
      if (!atlasContains(map, q, r)) continue;
      if (isRevealed(map, q, r)) terrain.poly([...polygon], true).fill({ color: LAB_SCHEMATIC_STYLE.deck });
      else paper.poly([...polygon], true).fill({ color: LAB_SCHEMATIC_STYLE.fog });

      const visual = labTerrainVisual(map, q, r);
      if (visual.kind === "empty") continue;
      const edges = revealedRegionEdges(map, q, r);
      if (visual.kind === "abyss") {
        drawCliff(cliffs, visual, center, polygon, edges, cell, seed);
        continue;
      }
      drawTerrainMotif(terrain, visual, center, polygon, cell, seed);
      if (visual.kind !== "portal" && visual.sideEffectOverlay) drawEffectDots(features, center, cell, true);
      const edgeStyle = regionEdgeStyle(visual, cell);
      if (edgeStyle === null) continue;
      for (let direction = 0; direction < edges.length; direction++) {
        if (edges[direction] !== true) continue;
        const [start, end] = edgeEnds(polygon, direction);
        features.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke(edgeStyle);
      }
    }
  }
}

// ───────────────────────────── course overprint ─────────────────────────────

function coordKey(point: Vec2): number {
  return point.q * 65_536 + point.r;
}

/**
 * Solid purple legs between cell centres with gaps at control circles. Segments from trail index
 * `from` on are inked up to `progress`; returns the ink head while a committed leg is drawing.
 */
function drawLegs(
  course: Graphics,
  trail: readonly (Vec2 | null)[],
  nodes: ReadonlySet<number>,
  camera: LabCamera,
  gap: number,
  from: number,
  progress: number,
): PixelPoint | null {
  const inked = from < 0 ? 0 : progress * (trail.length - 1 - from);
  for (let index = 1; index < trail.length; index++) {
    const fromPoint = trail[index - 1];
    const toPoint = trail[index];
    if (fromPoint === null || fromPoint === undefined || toPoint === null || toPoint === undefined) continue;
    const fraction = from >= 0 && index - 1 >= from ? Math.min(1, inked - (index - 1 - from)) : 1;
    const a = labCellCenter(camera, fromPoint);
    if (fraction <= 0) return a;
    const b = labCellCenter(camera, toPoint);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const ux = (b.x - a.x) / length;
    const uy = (b.y - a.y) / length;
    const startTrim = nodes.has(coordKey(fromPoint)) ? gap : 0;
    const endTrim = nodes.has(coordKey(toPoint)) ? gap : 0;
    const end = Math.min(length - endTrim, length * fraction);
    if (end > startTrim) {
      course.moveTo(a.x + ux * startTrim, a.y + uy * startTrim).lineTo(a.x + ux * end, a.y + uy * end);
    }
    if (fraction < 1) return { x: a.x + ux * length * fraction, y: a.y + uy * length * fraction };
  }
  return null;
}

function drawDashedTrail(
  target: Graphics,
  points: readonly (Vec2 | null)[],
  nodes: ReadonlySet<number>,
  camera: LabCamera,
  gap: number,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const dash = Math.max(5, cell * 0.16);
  const stride = dash * 1.8;
  for (let index = 1; index < points.length; index++) {
    const fromPoint = points[index - 1];
    const toPoint = points[index];
    if (fromPoint === null || fromPoint === undefined || toPoint === null || toPoint === undefined) continue;
    const a = labCellCenter(camera, fromPoint);
    const b = labCellCenter(camera, toPoint);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const startTrim = nodes.has(coordKey(fromPoint)) ? gap : 0;
    const endTrim = index === points.length - 1 ? gap : 0;
    for (let offset = startTrim; offset < length - endTrim; offset += stride) {
      const s = offset / length;
      const e = Math.min(length - endTrim, offset + dash) / length;
      target.moveTo(a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s)
        .lineTo(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e);
    }
  }
  target.stroke({ color: LAB_SCHEMATIC_STYLE.candidate, width: Math.max(2, cell * 0.05), cap: "round" });
}

function drawCross(target: Graphics, center: PixelPoint, size: number, width: number): void {
  target.moveTo(center.x - size, center.y - size).lineTo(center.x + size, center.y + size)
    .moveTo(center.x + size, center.y - size).lineTo(center.x - size, center.y + size)
    .stroke({ color: LAB_SCHEMATIC_STYLE.failure, width, cap: "round" });
}

const LABEL_STYLE = {
  fontFamily: "\"Barlow Condensed\", \"Arial Narrow\", sans-serif",
  fontWeight: "600",
  fill: SHARED_SCHEMATIC_STYLE.course,
  // Paper knockout under overprinted numerals, as on a printed course.
  stroke: { color: SHARED_SCHEMATIC_STYLE.deck, width: 3, join: "round" },
} as const;

export async function createLabRenderer(_mm: MultiMap): Promise<LabRenderer> {
  const app = new Application();
  await app.init({
    autoStart: false,
    width: LAB_VIEWPORT.width,
    height: LAB_VIEWPORT.height,
    background: LAB_SCHEMATIC_STYLE.background,
    antialias: true,
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });

  const paper = new Graphics();
  const terrain = new Graphics();
  const grid = new Graphics();
  const cliffs = new Graphics();
  const features = new Graphics();
  const course = new Graphics();
  const marks = new Graphics();
  const contours = new Container();
  const contourChunks = new Map<number, Graphics>();
  let contourRelief: Int16Array | null = null;
  const mapLayers = [paper, terrain, grid, cliffs, features] as const;
  const labels = new Container();
  const labelPool: Text[] = [];
  app.stage.addChild(paper, terrain, contours, grid, cliffs, features, course, marks, labels);

  let last: { readonly mm: MultiMap; readonly drug: DrugState; readonly view: LabRenderView } | null = null;
  let lastTrail: readonly (Vec2 | null)[] | null = null;
  let legFrom = -1;
  let legProgress = 1;
  let legStartTime = -1;
  let frame = 0;
  let destroyed = false;

  const label = (index: number): Text => {
    let text = labelPool[index];
    if (text === undefined) {
      text = new Text({ text: "", style: { ...LABEL_STYLE, fontSize: 16 } });
      labels.addChild(text);
      labelPool[index] = text;
    }
    return text;
  };

  const paintCourse = (): void => {
    course.clear();
    marks.clear();
    let labelCount = 0;
    const map = last?.mm.maps[last.view.activeMap];
    if (last !== null && map !== undefined) {
      const { drug, view } = last;
      const camera = view.camera;
      const cell = LAB_CELL_PIXELS * camera.zoom;
      const radius = cell * 0.3;
      const lineWidth = Math.max(2, cell * 0.065);
      const crossWidth = Math.max(2.5, cell * 0.08);
      const controls = view.controls ?? [];
      const start = view.trail[0] ?? null;
      const nodes = new Set<number>(controls.map(coordKey));
      if (start !== null) nodes.add(coordKey(start));
      const animating = legFrom >= 0 && legProgress < 1;

      const head = drawLegs(course, view.trail, nodes, camera, radius, animating ? legFrom : -1, legProgress);
      course.stroke({ color: LAB_SCHEMATIC_STYLE.course, width: lineWidth, cap: "round" });

      if (start !== null) {
        const center = labCellCenter(camera, start);
        const next = view.trail.find((point, index) => index > 0 && point !== null && coordKey(point) !== coordKey(start));
        const toward = next === undefined || next === null ? null : labCellCenter(camera, next);
        const angle = toward === null ? -Math.PI / 2 : Math.atan2(toward.y - center.y, toward.x - center.x);
        const size = radius * 1.2;
        marks.moveTo(center.x + Math.cos(angle) * size, center.y + Math.sin(angle) * size);
        for (let corner = 1; corner < 3; corner++) {
          const theta = angle + corner * Math.PI * 2 / 3;
          marks.lineTo(center.x + Math.cos(theta) * size, center.y + Math.sin(theta) * size);
        }
        marks.closePath().stroke({ color: LAB_SCHEMATIC_STYLE.course, width: lineWidth, join: "round" });
      }

      const fontSize = Math.round(Math.max(12, 16 * camera.zoom));
      for (let index = 0; index < controls.length; index++) {
        const center = labCellCenter(camera, controls[index]!);
        marks.circle(center.x, center.y, radius);
        if (view.finish === true && index === controls.length - 1) marks.circle(center.x, center.y, radius * 0.66);
        const text = label(labelCount++);
        const value = String(index + 1);
        if (text.text !== value) text.text = value;
        if (text.style.fontSize !== fontSize) text.style.fontSize = fontSize;
        text.visible = true;
        text.position.set(center.x + radius * 0.8, center.y - radius * 0.95 - fontSize);
      }
      marks.stroke({ color: LAB_SCHEMATIC_STYLE.course, width: lineWidth });

      const position = drugDrawPoint(drug, view.activeMap);
      if (head !== null) {
        marks.circle(head.x, head.y, cell * 0.11).fill({ color: LAB_SCHEMATIC_STYLE.course });
      } else if (position !== undefined) {
        const center = labCellCenter(camera, position);
        if (drug.failed) drawCross(marks, center, radius * 0.75, crossWidth);
        else if (view.finish !== true) marks.circle(center.x, center.y, cell * 0.11).fill({ color: LAB_SCHEMATIC_STYLE.course });
      }

      const previewPos = view.previewDrug === undefined ? undefined : drugDrawPoint(view.previewDrug, view.activeMap);
      if (!animating && view.previewTrail !== undefined) drawDashedTrail(marks, view.previewTrail, nodes, camera, radius);
      if (!animating && previewPos !== undefined) {
        const center = labCellCenter(camera, previewPos);
        if (view.previewDrug?.failed === true) drawCross(marks, center, radius * 0.75, crossWidth);
        else {
          marks.circle(center.x, center.y, radius)
            .stroke({ color: LAB_SCHEMATIC_STYLE.candidate, width: Math.max(2, cell * 0.05) });
        }
      }
    }
    for (let index = labelCount; index < labelPool.length; index++) labelPool[index]!.visible = false;
  };

  const tick = (now: number): void => {
    frame = 0;
    if (destroyed) return;
    if (legStartTime < 0) legStartTime = now;
    const t = Math.min(1, (now - legStartTime) / LAB_LEG_DRAW_MS);
    legProgress = t >= 1 ? 1 : 1 - 2 ** (-10 * t);
    paintCourse();
    app.render();
    if (legProgress < 1) frame = requestAnimationFrame(tick);
    else legFrom = -1;
  };

  const densityObserver = new ResizeObserver(() => {
    const width = app.canvas.getBoundingClientRect().width;
    if (width === 0) return;
    const resolution = window.devicePixelRatio * Math.max(1, width / LAB_VIEWPORT.width);
    if (Math.abs(app.renderer.resolution - resolution) < .001) return;
    app.renderer.resize(LAB_VIEWPORT.width, LAB_VIEWPORT.height, resolution);
    app.render();
  });
  densityObserver.observe(app.canvas);
  // Control numbers use the display face; rebuild them once it has loaded.
  document.fonts.load("600 16px \"Barlow Condensed\"").then(() => {
    if (destroyed) return;
    for (const text of labelPool) text.destroy();
    labelPool.length = 0;
    paintCourse();
    app.render();
  }).catch(() => undefined);

  return {
    canvas: app.canvas,
    render: (mm, drug, view) => {
      for (const layer of mapLayers) layer.clear();
      // A new trial ink-draws its whole actual course once.
      const committed = lastTrail !== null && view.trail !== lastTrail && view.trail.length > 1;
      if (committed && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        legFrom = 0;
        legProgress = 0;
        legStartTime = -1;
        if (frame === 0) frame = requestAnimationFrame(tick);
      }
      lastTrail = view.trail;
      last = { mm, drug, view };
      const map = mm.maps[view.activeMap];
      if (map !== undefined) {
        if (map.elevation !== contourRelief) {
          contourRelief = map.elevation;
          for (const chunk of contourChunks.values()) chunk.destroy();
          contourChunks.clear();
        }
        const { camera } = view;
        const chunkSize = CONTOUR_STEP * CONTOUR_CHUNK;
        const halfW = LAB_VIEWPORT.width / 2 / camera.zoom;
        const halfH = LAB_VIEWPORT.height / 2 / camera.zoom;
        const bounds = hexBoardBounds(map.width, map.height, LAB_HEX_SIZE);
        const cx0 = Math.floor(Math.max(bounds.minX, camera.x - halfW) / chunkSize);
        const cx1 = Math.floor(Math.min(bounds.maxX, camera.x + halfW) / chunkSize);
        const cy0 = Math.floor(Math.max(bounds.minY, camera.y - halfH) / chunkSize);
        const cy1 = Math.floor(Math.min(bounds.maxY, camera.y + halfH) / chunkSize);
        for (const chunk of contourChunks.values()) chunk.visible = false;
        for (let cy = cy0; cy <= cy1; cy++) {
          for (let cx = cx0; cx <= cx1; cx++) {
            const key = cx * 4_096 + cy;
            let chunk = contourChunks.get(key);
            if (chunk === undefined) {
              chunk = new Graphics();
              drawContours(map, chunk, cx * CONTOUR_CHUNK, cy * CONTOUR_CHUNK);
              contours.addChild(chunk);
              contourChunks.set(key, chunk);
            }
            chunk.visible = true;
          }
        }
        contours.scale.set(view.camera.zoom);
        contours.position.set(
          LAB_VIEWPORT.width / 2 - view.camera.x * view.camera.zoom,
          LAB_VIEWPORT.height / 2 - view.camera.y * view.camera.zoom,
        );
        drawVisibleMap(map, view.camera, paper, terrain, cliffs, features);
        drawRevealedGrid(map, view.camera, grid);
      }
      paintCourse();
      app.render();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      if (frame !== 0) cancelAnimationFrame(frame);
      densityObserver.disconnect();
      app.stage.removeChildren();
      for (const layer of [...mapLayers, course, marks]) layer.destroy();
      contours.destroy({ children: true });
      labels.destroy({ children: true });
      app.destroy({ removeView: true });
    },
  };
}
