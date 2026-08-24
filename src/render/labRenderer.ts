import { Application, Graphics } from "pixi.js";
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
import { hexToPixel, type PixelPoint } from "./hexProjection";
import { revealedRegionEdges } from "./labRegions";
import { labTerrainVisual, type CellTerrainVisual, type PortalTerrainVisual } from "./labTerrain";
import { SHARED_SCHEMATIC_STYLE } from "./schematicStyle";

export const LAB_SCHEMATIC_STYLE = Object.freeze({
  ...SHARED_SCHEMATIC_STYLE,
  candidate: 0xf3b45d,
  sideEffect: 0xde5fb1,
  fogGrid: 0x1f313d,
  wallDetail: 0x637078,
  abyssDetail: 0x24343d,
  sideEffectOutline: 0x51223f,
});

export interface LabRenderView {
  readonly activeMap: number;
  readonly camera: LabCamera;
  readonly trail: readonly (Vec2 | null)[];
  readonly previewTrail?: readonly (Vec2 | null)[];
  readonly previewDrug?: DrugState;
}

export interface LabRenderer {
  readonly canvas: HTMLCanvasElement;
  render(mm: MultiMap, drug: DrugState, view: LabRenderView): void;
  destroy(): void;
}

function isRevealed(map: EffectMap, q: number, r: number): boolean {
  if (!hexInBounds(map.width, map.height, q, r)) return false;
  return map.fog[hexIndex(map.width, q, r)] === 1;
}

export interface LabFeatureStyle {
  readonly targetRing: boolean;
}

export function labFeatureStyle(
  kind: CellTerrainVisual["kind"] | PortalTerrainVisual["kind"],
): LabFeatureStyle {
  return { targetRing: kind === "cure" };
}

function drawGridKind(
  grid: Graphics,
  kind: LabGridLineKind,
  camera: LabCamera,
  bounds: ReturnType<typeof visibleLabCells>,
  origin: Vec2,
): void {
  let drewCell = false;
  for (let r = bounds.r0; r < bounds.r1; r++) {
    for (let q = bounds.q0; q < bounds.q1; q++) {
      const isMajor = labGridKindForBoundary(q, origin.q) === "major"
        || labGridKindForBoundary(r, origin.r) === "major";
      if ((kind === "major") !== isMajor) continue;
      grid.poly([...labCellPolygon(camera, { q, r })], true);
      drewCell = true;
    }
  }
  if (drewCell) grid.stroke(labGridLineStyle(kind, camera.zoom));
}

function drawLabGrid(map: EffectMap, camera: LabCamera, grid: Graphics): void {
  const bounds = visibleLabCells(camera, LAB_VIEWPORT, map);
  drawGridKind(grid, "minor", camera, bounds, map.origin);
  drawGridKind(grid, "major", camera, bounds, map.origin);
}

function portalMarkerColor(marker: string): number {
  let hash = 0;
  for (let index = 0; index < marker.length; index++) {
    hash = ((hash * 31) + marker.charCodeAt(index)) >>> 0;
  }
  const palette = [
    LAB_SCHEMATIC_STYLE.flow,
    LAB_SCHEMATIC_STYLE.sideEffect,
    LAB_SCHEMATIC_STYLE.candidate,
    LAB_SCHEMATIC_STYLE.cure,
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
  terrain.circle(cx, cy, cell * 0.34).fill({ color: LAB_SCHEMATIC_STYLE.background, alpha: 1 });
  terrain.circle(cx, cy, cell * 0.34).stroke({ color: markerColor, width: Math.max(3, cell * 0.08) });
  terrain.circle(cx, cy, cell * 0.2).stroke({ color: visual.rimColor, width: Math.max(2, cell * 0.045), alpha: 0.9 });

  let hash = visual.role === "entry" ? 0x1357 : 0x2468;
  for (let index = 0; index < marker.length; index++) {
    hash = ((hash * 33) + marker.charCodeAt(index)) >>> 0;
  }
  const notchCount = 2 + (hash % 4);
  for (let index = 0; index < notchCount; index++) {
    const angle = ((index + (hash % 7) / 7) / notchCount) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    terrain.moveTo(cx + dx * cell * 0.27, cy + dy * cell * 0.27)
      .lineTo(cx + dx * cell * 0.39, cy + dy * cell * 0.39)
      .stroke({ color: markerColor, width: Math.max(2, cell * 0.055) });
  }

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

function drawTerrainMotif(
  terrain: Graphics,
  visual: CellTerrainVisual | PortalTerrainVisual,
  center: PixelPoint,
  polygon: readonly PixelPoint[],
  cell: number,
): void {
  if (visual.kind === "empty") return;
  if (visual.kind === "portal") {
    drawPortalMotif(terrain, visual, center, polygon, cell);
    return;
  }
  const x = center.x - cell / 2;
  const y = center.y - cell / 2;
  if (visual.kind === "wall") {
    terrain.poly([...polygon], true).fill({ color: visual.baseColor, alpha: 1 });
    terrain.poly([...polygon], true)
      .stroke({ color: visual.rimColor, width: Math.max(2, cell * 0.055), alpha: 0.95 });
    for (let row = 1; row <= 2; row++) {
      const lineY = y + (cell * row) / 3;
      terrain.moveTo(x, lineY).lineTo(x + cell, lineY)
        .stroke({ color: LAB_SCHEMATIC_STYLE.wallDetail, width: Math.max(1, cell * 0.035), alpha: 0.72 });
    }
    terrain.moveTo(x + cell * 0.5, y).lineTo(x + cell * 0.5, y + cell / 3)
      .moveTo(x + cell * 0.25, y + cell / 3).lineTo(x + cell * 0.25, y + (cell * 2) / 3)
      .moveTo(x + cell * 0.7, y + (cell * 2) / 3).lineTo(x + cell * 0.7, y + cell)
      .stroke({ color: LAB_SCHEMATIC_STYLE.wallDetail, width: Math.max(1, cell * 0.035), alpha: 0.72 });
    return;
  }
  if (visual.kind === "abyss") {
    terrain.poly([...polygon], true).fill({ color: visual.baseColor, alpha: 1 });
    terrain.circle(x + cell / 2, y + cell / 2, cell * 0.37).fill({ color: LAB_SCHEMATIC_STYLE.background, alpha: 1 });
    terrain.circle(x + cell / 2, y + cell / 2, cell * 0.4)
      .stroke({ color: visual.rimColor, width: Math.max(3, cell * 0.075), alpha: 0.95 });
    terrain.circle(x + cell / 2, y + cell / 2, cell * 0.27)
      .stroke({ color: LAB_SCHEMATIC_STYLE.abyssDetail, width: Math.max(2, cell * 0.04), alpha: 0.8 });
    terrain.circle(x + cell / 2, y + cell / 2, cell * 0.1)
      .fill({ color: LAB_SCHEMATIC_STYLE.flow, alpha: 0.28 });
    return;
  }
  terrain.poly([...polygon], true).fill({ color: visual.baseColor, alpha: 0.82 });
  if (visual.kind === "swamp") {
    for (let line = 0; line < 3; line++) {
      const lineY = y + cell * (0.25 + line * 0.25);
      const offset = line % 2 === 0 ? 0 : cell * 0.12;
      terrain.moveTo(x + cell * 0.08 + offset, lineY)
        .bezierCurveTo(
          x + cell * 0.3 + offset,
          lineY - cell * 0.1,
          x + cell * 0.55 + offset,
          lineY + cell * 0.1,
          x + cell * 0.88,
          lineY,
        )
        .stroke({ color: visual.rimColor, width: Math.max(2, cell * 0.055), alpha: 0.78 });
    }
    return;
  }
  if (visual.kind === "sideEffect") {
    const cx = x + cell / 2;
    const cy = y + cell / 2;
    terrain.circle(cx, cy, cell * 0.21)
      .stroke({ color: visual.rimColor, width: Math.max(2, cell * 0.055), alpha: 0.92 });
    for (let index = 0; index < 3; index++) {
      const angle = index * Math.PI * 2 / 3 - Math.PI / 2;
      const nodeX = cx + Math.cos(angle) * cell * 0.24;
      const nodeY = cy + Math.sin(angle) * cell * 0.24;
      terrain.moveTo(cx, cy).lineTo(nodeX, nodeY)
        .stroke({ color: visual.rimColor, width: Math.max(1.5, cell * 0.035), alpha: 0.8 });
      terrain.circle(nodeX, nodeY, cell * 0.065).fill({ color: visual.rimColor, alpha: 0.95 });
    }
    return;
  }
  if (visual.kind === "cure") {
    const cx = x + cell / 2;
    const cy = y + cell / 2;
    terrain.circle(cx, cy, cell * 0.27)
      .stroke({ color: visual.rimColor, width: Math.max(2, cell * 0.055), alpha: 0.96 });
    terrain.circle(cx, cy, cell * 0.1).fill({ color: visual.rimColor, alpha: 0.96 });
    terrain.moveTo(cx - cell * 0.17, cy).lineTo(cx + cell * 0.17, cy)
      .moveTo(cx, cy - cell * 0.17).lineTo(cx, cy + cell * 0.17)
      .stroke({ color: LAB_SCHEMATIC_STYLE.structure, width: Math.max(1.5, cell * 0.035), alpha: 0.9 });
  }
}

function drawVisibleMap(
  map: EffectMap,
  camera: LabCamera,
  terrain: Graphics,
  featureOverlay: Graphics,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const bounds = visibleLabCells(camera, LAB_VIEWPORT, map);
  for (let r = bounds.r0; r < bounds.r1; r++) {
    for (let q = bounds.q0; q < bounds.q1; q++) {
      const coord = { q, r };
      const center = labCellCenter(camera, coord);
      const polygon = labCellPolygon(camera, coord);
      const revealed = isRevealed(map, q, r);
      terrain.poly([...polygon], true)
        .fill({ color: revealed ? LAB_SCHEMATIC_STYLE.deck : LAB_SCHEMATIC_STYLE.background });
      if (!revealed) terrain.poly([...polygon], true)
        .stroke({ color: LAB_SCHEMATIC_STYLE.fogGrid, width: 1, alpha: 0.32 });

      const visual = labTerrainVisual(map, q, r);
      drawTerrainMotif(terrain, visual, center, polygon, cell);
      if (labFeatureStyle(visual.kind).targetRing) {
        featureOverlay.circle(center.x, center.y, cell * 0.37)
          .stroke({ color: LAB_SCHEMATIC_STYLE.structure, width: Math.max(2, cell * 0.04), alpha: 0.9 });
      }
      if (visual.kind !== "portal" && visual.sideEffectOverlay) {
        featureOverlay.circle(center.x + cell * 0.28, center.y - cell * 0.28, cell * 0.12)
          .fill({ color: LAB_SCHEMATIC_STYLE.sideEffect, alpha: 0.98 });
        featureOverlay.circle(center.x + cell * 0.28, center.y - cell * 0.28, cell * 0.17)
          .stroke({ color: LAB_SCHEMATIC_STYLE.sideEffectOutline, width: Math.max(2, cell * 0.04), alpha: 0.98 });
      }
      if (visual.kind !== "empty") {
        const edges = revealedRegionEdges(map, q, r);
        const edgeStyle = {
          color: visual.rimColor,
          width: Math.max(2, cell * (visual.kind === "cure" ? 0.07 : 0.045)),
          alpha: visual.kind === "cure" ? 0.9 : 0.7,
        };
        for (let direction = 0; direction < edges.length; direction++) {
          if (edges[direction] !== true) continue;
          const start = polygon[(direction + 1) % 6]!;
          const end = polygon[(direction + 2) % 6]!;
          terrain.moveTo(start.x, start.y).lineTo(end.x, end.y).stroke(edgeStyle);
        }
      }
    }
  }
}

function drawToken(
  pos: Vec2,
  camera: LabCamera,
  token: Graphics,
  failed: boolean,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const { x: cx, y: cy } = labCellCenter(camera, pos);
  const color = failed ? LAB_SCHEMATIC_STYLE.failure : LAB_SCHEMATIC_STYLE.flow;
  token.circle(cx, cy, cell * 0.42).stroke({ color, width: 2, alpha: 0.28 });
  token.circle(cx, cy, cell * 0.31).fill({ color: LAB_SCHEMATIC_STYLE.background, alpha: 0.96 })
    .stroke({ color: LAB_SCHEMATIC_STYLE.structure, width: Math.max(2, cell * 0.045), alpha: 0.96 });
  token.roundRect(cx - cell * 0.11, cy - cell * 0.22, cell * 0.22, cell * 0.44, cell * 0.11)
    .fill({ color, alpha: failed ? 0.35 : 0.9 })
    .stroke({ color: LAB_SCHEMATIC_STYLE.structure, width: Math.max(1.5, cell * 0.035), alpha: 0.96 });
  token.moveTo(cx - cell * 0.1, cy).lineTo(cx + cell * 0.1, cy)
    .stroke({ color: LAB_SCHEMATIC_STYLE.structure, width: Math.max(1.5, cell * 0.03), alpha: 0.9 });
}

function drawTrail(
  points: readonly (Vec2 | null)[],
  camera: LabCamera,
  route: Graphics,
  preview = false,
): void {
  if (points.length < 2) return;
  const cell = LAB_CELL_PIXELS * camera.zoom;
  let drawing = false;
  let previous: Vec2 | null = null;
  for (const world of points) {
    if (world === null) {
      drawing = false;
      previous = null;
      continue;
    }
    const { x, y } = labCellCenter(camera, world);
    if (drawing && previous !== null && preview) {
      const { x: x0, y: y0 } = labCellCenter(camera, previous);
      const dx = x - x0;
      const dy = y - y0;
      const length = Math.hypot(dx, dy);
      const dash = Math.max(5, cell * 0.16);
      const stride = dash * 1.75;
      for (let offset = 0; offset < length; offset += stride) {
        const a = offset / length;
        const b = Math.min(length, offset + dash) / length;
        route.moveTo(x0 + dx * a, y0 + dy * a);
        route.lineTo(x0 + dx * b, y0 + dy * b);
      }
    } else if (drawing) {
      route.lineTo(x, y);
    } else {
      route.moveTo(x, y);
    }
    drawing = true;
    previous = world;
  }
  route.stroke({
    color: preview ? LAB_SCHEMATIC_STYLE.candidate : LAB_SCHEMATIC_STYLE.flow,
    width: Math.max(3, cell * (preview ? 0.075 : 0.09)),
    alpha: preview ? 0.94 : 0.62,
  });
}

export interface LabPreviewTargetBadge {
  readonly dx: number;
  readonly dy: number;
  readonly radius: number;
  readonly strokeWidth: number;
}

export function labPreviewTargetBadge(cell: number): LabPreviewTargetBadge {
  return {
    dx: cell * 0.3,
    dy: cell * -0.3,
    radius: Math.max(4, cell * 0.13),
    strokeWidth: Math.max(2, cell * 0.045),
  };
}

function drawPreviewToken(
  pos: Vec2,
  camera: LabCamera,
  token: Graphics,
  failed: boolean,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const { x: cx, y: cy } = labCellCenter(camera, pos);
  const color = failed ? LAB_SCHEMATIC_STYLE.failure : LAB_SCHEMATIC_STYLE.candidate;
  token.circle(cx, cy, cell * 0.38).fill({ color, alpha: 0.18 });
  token.circle(cx, cy, cell * 0.34).stroke({ color, width: 3, alpha: 0.96 });
  const badge = labPreviewTargetBadge(cell);
  const badgeX = cx + badge.dx;
  const badgeY = cy + badge.dy;
  const arm = badge.radius * 0.48;
  token.circle(badgeX, badgeY, badge.radius)
    .fill({ color: LAB_SCHEMATIC_STYLE.background, alpha: 0.96 })
    .stroke({ color, width: badge.strokeWidth, alpha: 1 });
  token.moveTo(badgeX - arm, badgeY).lineTo(badgeX + arm, badgeY)
    .moveTo(badgeX, badgeY - arm).lineTo(badgeX, badgeY + arm)
    .stroke({ color, width: badge.strokeWidth, alpha: 1 });
  token.roundRect(cx - cell * 0.1, cy - cell * 0.2, cell * 0.2, cell * 0.4, cell * 0.1)
    .fill({ color, alpha: 0.35 })
    .stroke({ color: LAB_SCHEMATIC_STYLE.structure, width: Math.max(1.5, cell * 0.03), alpha: 0.7 });
}

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

  const grid = new Graphics();
  const terrain = new Graphics();
  const route = new Graphics();
  const previewRoute = new Graphics();
  const featureOverlay = new Graphics();
  const token = new Graphics();
  const previewToken = new Graphics();
  app.stage.addChild(
    terrain,
    featureOverlay,
    grid,
    route,
    previewRoute,
    token,
    previewToken,
  );
  let destroyed = false;

  return {
    canvas: app.canvas,
    render: (mm, drug, view) => {
      grid.clear();
      terrain.clear();
      featureOverlay.clear();
      route.clear();
      previewRoute.clear();
      token.clear();
      previewToken.clear();
      const map = mm.maps[view.activeMap];
      if (map === undefined) return;
      drawLabGrid(map, view.camera, grid);
      drawVisibleMap(map, view.camera, terrain, featureOverlay);
      drawTrail(view.trail, view.camera, route);
      if (view.previewTrail !== undefined) drawTrail(view.previewTrail, view.camera, previewRoute, true);
      const pos = drug.pos[view.activeMap];
      if (pos !== undefined) drawToken(pos, view.camera, token, drug.failed);
      const previewPos = view.previewDrug?.pos[view.activeMap];
      if (previewPos !== undefined) {
        drawPreviewToken(previewPos, view.camera, previewToken, view.previewDrug?.failed ?? false);
      }
      app.render();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      app.stage.removeChildren();
      grid.destroy();
      terrain.destroy();
      route.destroy();
      previewRoute.destroy();
      featureOverlay.destroy();
      token.destroy();
      previewToken.destroy();
      app.destroy({ removeView: true });
    },
  };
}
