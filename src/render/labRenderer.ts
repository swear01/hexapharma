import {
  Application,
  Assets,
  Container,
  Graphics,
  Sprite,
  TilingSprite,
  type Texture,
} from "pixi.js";
import type { DrugState, EffectMap, MultiMap, Vec2 } from "../sim/phase0_interfaces";
import {
  LAB_CELL_PIXELS,
  LAB_MIN_ZOOM,
  LAB_VIEWPORT,
  labGridKindForBoundary,
  labGridLineStyle,
  visibleLabCells,
  type LabCamera,
  type LabGridLineKind,
} from "./labCamera";
import { labAssetUrls } from "./labAssets";
import { revealedRegionEdges } from "./labRegions";
import { labTerrainVisual, type CellTerrainVisual, type PortalTerrainVisual } from "./labTerrain";

const BG = 0x111a1b;
const TOKEN_COLOR = 0x28a9d6;
const MAX_VISIBLE_CELLS =
  (Math.ceil(LAB_VIEWPORT.width / (LAB_CELL_PIXELS * LAB_MIN_ZOOM)) + 3) *
  (Math.ceil(LAB_VIEWPORT.height / (LAB_CELL_PIXELS * LAB_MIN_ZOOM)) + 3);

interface LabTextures {
  readonly substrate: Texture;
  readonly fog: Texture;
  readonly wall: Texture;
  readonly sideEffect: Texture;
  readonly cure: Texture;
  readonly drug: Texture;
  readonly halo: Texture;
}

async function loadLabTextures(): Promise<LabTextures> {
  const response = await fetch("/assets/lab/manifest.json");
  if (!response.ok) throw new Error(`Lab asset manifest request failed with ${response.status}`);
  const urls = labAssetUrls(await response.json());
  const [substrate, fog, wall, sideEffect, cure, drug, halo] = await Promise.all([
    Assets.load<Texture>(urls.substrate),
    Assets.load<Texture>(urls.fog),
    Assets.load<Texture>(urls.wall),
    Assets.load<Texture>(urls.sideEffect),
    Assets.load<Texture>(urls.cure),
    Assets.load<Texture>(urls.drug),
    Assets.load<Texture>(urls.halo),
  ]);
  return { substrate, fog, wall, sideEffect, cure, drug, halo };
}

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

function cellScreen(camera: LabCamera, x: number, y: number): Vec2 {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  return {
    x: LAB_VIEWPORT.width / 2 + (x - camera.x) * cell,
    y: LAB_VIEWPORT.height / 2 + (y - camera.y) * cell,
  };
}

function isRevealed(map: EffectMap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return map.fog[y * map.width + x] === 1;
}

function featureTexture(
  textures: LabTextures,
  kind: CellTerrainVisual["kind"] | PortalTerrainVisual["kind"],
): Texture | null {
  if (kind === "wall") return textures.wall;
  if (kind === "sideEffect") return textures.sideEffect;
  if (kind === "cure") return textures.cure;
  return null;
}

function drawGridKind(
  grid: Graphics,
  kind: LabGridLineKind,
  camera: LabCamera,
  bounds: ReturnType<typeof visibleLabCells>,
  origin: Vec2,
): void {
  const topLeft = cellScreen(camera, bounds.x0, bounds.y0);
  const bottomRight = cellScreen(camera, bounds.x1, bounds.y1);
  let drewLine = false;
  for (let x = bounds.x0; x <= bounds.x1; x++) {
    if (labGridKindForBoundary(x, origin.x) !== kind) continue;
    const screen = cellScreen(camera, x, bounds.y0);
    grid.moveTo(screen.x, topLeft.y).lineTo(screen.x, bottomRight.y);
    drewLine = true;
  }
  for (let y = bounds.y0; y <= bounds.y1; y++) {
    if (labGridKindForBoundary(y, origin.y) !== kind) continue;
    const screen = cellScreen(camera, bounds.x0, y);
    grid.moveTo(topLeft.x, screen.y).lineTo(bottomRight.x, screen.y);
    drewLine = true;
  }
  if (drewLine) grid.stroke(labGridLineStyle(kind, camera.zoom));
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
  const palette = [0x67e8f9, 0xf472b6, 0xfacc15, 0xa3e635, 0xc084fc] as const;
  return palette[hash % palette.length] ?? 0x67e8f9;
}

function drawPortalMotif(
  terrain: Graphics,
  visual: PortalTerrainVisual,
  x: number,
  y: number,
  cell: number,
): void {
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  const markerColor = portalMarkerColor(visual.pairMarker);
  terrain.rect(x, y, cell, cell).fill({ color: visual.baseColor, alpha: 1 });
  terrain.circle(cx, cy, cell * 0.34).fill({ color: 0x050817, alpha: 1 });
  terrain.circle(cx, cy, cell * 0.34).stroke({ color: markerColor, width: Math.max(3, cell * 0.08) });
  terrain.circle(cx, cy, cell * 0.2).stroke({ color: visual.rimColor, width: Math.max(2, cell * 0.045), alpha: 0.9 });

  let hash = visual.role === "entry" ? 0x1357 : 0x2468;
  for (let index = 0; index < visual.pairMarker.length; index++) {
    hash = ((hash * 33) + visual.pairMarker.charCodeAt(index)) >>> 0;
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
  const length = Math.hypot(visual.direction.x, visual.direction.y);
  const dx = visual.direction.x / length;
  const dy = visual.direction.y / length;
  const px = -dy;
  const py = dx;
  const tipX = cx + dx * cell * 0.19;
  const tipY = cy + dy * cell * 0.19;
  terrain.moveTo(cx - dx * cell * 0.1, cy - dy * cell * 0.1)
    .lineTo(tipX, tipY)
    .stroke({ color: 0xffffff, width: Math.max(2, cell * 0.06) });
  terrain.moveTo(tipX, tipY)
    .lineTo(tipX - dx * cell * 0.13 + px * cell * 0.09, tipY - dy * cell * 0.13 + py * cell * 0.09)
    .lineTo(tipX - dx * cell * 0.13 - px * cell * 0.09, tipY - dy * cell * 0.13 - py * cell * 0.09)
    .lineTo(tipX, tipY)
    .fill({ color: 0xffffff });
  if (visual.role === "exit") {
    terrain.rect(cx - cell * 0.07, cy - cell * 0.07, cell * 0.14, cell * 0.14)
      .stroke({ color: markerColor, width: Math.max(2, cell * 0.04) });
  }
}

function drawTerrainMotif(
  terrain: Graphics,
  visual: CellTerrainVisual | PortalTerrainVisual,
  x: number,
  y: number,
  cell: number,
): void {
  if (visual.kind === "empty") return;
  if (visual.kind === "portal") {
    drawPortalMotif(terrain, visual, x, y, cell);
    return;
  }
  if (visual.kind === "wall") {
    terrain.rect(x, y, cell, cell).fill({ color: visual.baseColor, alpha: 1 });
    terrain.rect(x + 1, y + 1, cell - 2, cell - 2)
      .stroke({ color: visual.rimColor, width: Math.max(2, cell * 0.055), alpha: 0.95 });
    for (let row = 1; row <= 2; row++) {
      const lineY = y + (cell * row) / 3;
      terrain.moveTo(x, lineY).lineTo(x + cell, lineY)
        .stroke({ color: 0x596366, width: Math.max(1, cell * 0.035), alpha: 0.9 });
    }
    terrain.moveTo(x + cell * 0.5, y).lineTo(x + cell * 0.5, y + cell / 3)
      .moveTo(x + cell * 0.25, y + cell / 3).lineTo(x + cell * 0.25, y + (cell * 2) / 3)
      .moveTo(x + cell * 0.7, y + (cell * 2) / 3).lineTo(x + cell * 0.7, y + cell)
      .stroke({ color: 0x596366, width: Math.max(1, cell * 0.035), alpha: 0.9 });
    return;
  }
  if (visual.kind === "abyss") {
    terrain.rect(x, y, cell, cell).fill({ color: visual.baseColor, alpha: 1 });
    terrain.circle(x + cell / 2, y + cell / 2, cell * 0.37).fill({ color: 0x000000, alpha: 1 });
    terrain.circle(x + cell / 2, y + cell / 2, cell * 0.4)
      .stroke({ color: visual.rimColor, width: Math.max(3, cell * 0.075), alpha: 0.95 });
    terrain.circle(x + cell / 2, y + cell / 2, cell * 0.27)
      .stroke({ color: 0x24343d, width: Math.max(2, cell * 0.04), alpha: 0.8 });
    return;
  }
  terrain.rect(x, y, cell, cell).fill({ color: visual.baseColor, alpha: 0.82 });
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
  }
}

function drawVisibleMap(
  map: EffectMap,
  camera: LabCamera,
  textures: LabTextures,
  terrain: Graphics,
  featureSprites: readonly Sprite[],
  fogMask: Graphics,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const bounds = visibleLabCells(camera, LAB_VIEWPORT, map);
  let featureIndex = 0;
  let drewFog = false;
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const screen = cellScreen(camera, x, y);
      const revealed = isRevealed(map, x, y);
      if (!revealed) {
        fogMask.rect(screen.x, screen.y, cell, cell);
        drewFog = true;
      }

      const visual = labTerrainVisual(map, x, y);
      drawTerrainMotif(terrain, visual, screen.x, screen.y, cell);
      const texture = featureTexture(textures, visual.kind);
      const sprite = texture === null ? undefined : featureSprites[featureIndex++];
      if (sprite !== undefined && texture !== null) {
        sprite.texture = texture;
        sprite.visible = true;
        sprite.anchor.set(0.5);
        sprite.x = screen.x + cell / 2;
        sprite.y = screen.y + cell / 2;
        sprite.width = cell * (visual.kind === "wall" ? 1.08 : 0.88);
        sprite.height = cell * (visual.kind === "wall" ? 1.08 : 0.88);
        sprite.alpha = visual.kind === "wall" ? 0.48 : 0.88;
        sprite.rotation = visual.kind === "wall"
          ? ((x * 7 + y * 11) & 3) * Math.PI / 2
          : 0;
      }
      if (visual.kind !== "empty") {
        const edges = revealedRegionEdges(map, x, y);
        const edgeStyle = {
          color: visual.rimColor,
          width: Math.max(2, cell * (visual.kind === "cure" ? 0.07 : 0.045)),
          alpha: visual.kind === "cure" ? 0.9 : 0.7,
        };
        if (edges.top) terrain.moveTo(screen.x, screen.y).lineTo(screen.x + cell, screen.y).stroke(edgeStyle);
        if (edges.right) terrain.moveTo(screen.x + cell, screen.y).lineTo(screen.x + cell, screen.y + cell).stroke(edgeStyle);
        if (edges.bottom) terrain.moveTo(screen.x, screen.y + cell).lineTo(screen.x + cell, screen.y + cell).stroke(edgeStyle);
        if (edges.left) terrain.moveTo(screen.x, screen.y).lineTo(screen.x, screen.y + cell).stroke(edgeStyle);
      }
    }
  }
  if (drewFog) fogMask.fill(0xffffff);
}

function drawToken(
  pos: Vec2,
  camera: LabCamera,
  token: Graphics,
  art: Sprite,
  haloArt: Sprite,
  failed: boolean,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const screen = cellScreen(camera, pos.x, pos.y);
  const cx = screen.x + cell / 2;
  const cy = screen.y + cell / 2;
  token.circle(cx, cy, cell * 0.25 + 4).fill({ color: 0xffffff, alpha: 0.92 });
  token.circle(cx, cy, cell * 0.25).fill({ color: failed ? 0x171717 : TOKEN_COLOR, alpha: 0.46 });
  art.visible = true;
  art.anchor.set(0.5);
  art.x = cx;
  art.y = cy;
  art.width = cell * 0.66;
  art.height = cell * 0.66;
  art.tint = failed ? 0x444444 : 0xffffff;
  haloArt.visible = !failed;
  haloArt.anchor.set(0.5);
  haloArt.x = cx;
  haloArt.y = cy;
  haloArt.width = cell * 1.15;
  haloArt.height = cell * 1.15;
  haloArt.alpha = 0.52;
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
    const point = cellScreen(camera, world.x, world.y);
    const x = point.x + cell / 2;
    const y = point.y + cell / 2;
    if (drawing && previous !== null && preview) {
      const from = cellScreen(camera, previous.x, previous.y);
      const x0 = from.x + cell / 2;
      const y0 = from.y + cell / 2;
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
    color: preview ? 0xffb968 : TOKEN_COLOR,
    width: Math.max(3, cell * (preview ? 0.075 : 0.09)),
    alpha: preview ? 0.94 : 0.62,
  });
}

function drawPreviewToken(
  pos: Vec2,
  camera: LabCamera,
  token: Graphics,
  art: Sprite,
  failed: boolean,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const screen = cellScreen(camera, pos.x, pos.y);
  const cx = screen.x + cell / 2;
  const cy = screen.y + cell / 2;
  token.circle(cx, cy, cell * 0.38).fill({ color: failed ? 0xee6b6b : 0xffb968, alpha: 0.18 });
  token.circle(cx, cy, cell * 0.34).stroke({ color: failed ? 0xee6b6b : 0xffb968, width: 3, alpha: 0.96 });
  art.visible = true;
  art.anchor.set(0.5);
  art.x = cx;
  art.y = cy;
  art.width = cell * 0.66;
  art.height = cell * 0.66;
  art.tint = failed ? 0xee6b6b : 0xffd7a4;
  art.alpha = 0.62;
}

export async function createLabRenderer(_mm: MultiMap): Promise<LabRenderer> {
  const textures = await loadLabTextures();
  const app = new Application();
  await app.init({
    width: LAB_VIEWPORT.width,
    height: LAB_VIEWPORT.height,
    background: BG,
    antialias: true,
    resolution: window.devicePixelRatio,
    autoDensity: true,
  });

  const fogOverlay = TilingSprite.from(textures.fog, {
    width: LAB_VIEWPORT.width,
    height: LAB_VIEWPORT.height,
  });
  fogOverlay.tileScale.set(0.42);
  fogOverlay.alpha = 0.78;
  const substrate = TilingSprite.from(textures.substrate, {
    width: LAB_VIEWPORT.width,
    height: LAB_VIEWPORT.height,
  });
  substrate.tileScale.set(0.42);
  substrate.alpha = 0.82;
  const grid = new Graphics();
  const terrain = new Graphics();
  const route = new Graphics();
  const previewRoute = new Graphics();
  const featureLayer = new Container();
  const featureSprites: Sprite[] = [];
  for (let i = 0; i < MAX_VISIBLE_CELLS; i++) {
    const feature = new Sprite(textures.wall);
    feature.visible = false;
    featureSprites.push(feature);
    featureLayer.addChild(feature);
  }
  const fogMask = new Graphics();
  fogOverlay.mask = fogMask;
  const token = new Graphics();
  const haloArt = new Sprite(textures.halo);
  haloArt.visible = false;
  const tokenArt = new Sprite(textures.drug);
  tokenArt.visible = false;
  const previewToken = new Graphics();
  const previewTokenArt = new Sprite(textures.drug);
  previewTokenArt.visible = false;
  app.stage.addChild(
    substrate,
    fogOverlay,
    fogMask,
    terrain,
    featureLayer,
    grid,
    route,
    previewRoute,
    haloArt,
    token,
    tokenArt,
    previewToken,
    previewTokenArt,
  );
  let destroyed = false;

  return {
    canvas: app.canvas,
    render: (mm, drug, view) => {
      grid.clear();
      terrain.clear();
      route.clear();
      previewRoute.clear();
      token.clear();
      previewToken.clear();
      haloArt.visible = false;
      tokenArt.visible = false;
      previewTokenArt.visible = false;
      for (const sprite of featureSprites) sprite.visible = false;
      fogMask.clear();
      const map = mm.maps[view.activeMap];
      if (map === undefined) return;
      const cell = LAB_CELL_PIXELS * view.camera.zoom;
      substrate.tilePosition.set(
        LAB_VIEWPORT.width / 2 - view.camera.x * cell,
        LAB_VIEWPORT.height / 2 - view.camera.y * cell,
      );
      substrate.tileScale.set(0.42 * view.camera.zoom);
      fogOverlay.tilePosition.copyFrom(substrate.tilePosition);
      fogOverlay.tileScale.copyFrom(substrate.tileScale);
      drawLabGrid(map, view.camera, grid);
      drawVisibleMap(map, view.camera, textures, terrain, featureSprites, fogMask);
      drawTrail(view.trail, view.camera, route);
      if (view.previewTrail !== undefined) drawTrail(view.previewTrail, view.camera, previewRoute, true);
      const pos = drug.pos[view.activeMap];
      if (pos !== undefined) drawToken(pos, view.camera, token, tokenArt, haloArt, drug.failed);
      const previewPos = view.previewDrug?.pos[view.activeMap];
      if (previewPos !== undefined) {
        drawPreviewToken(previewPos, view.camera, previewToken, previewTokenArt, view.previewDrug?.failed ?? false);
      }
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      app.stage.removeChildren();
      fogOverlay.mask = null;
      fogOverlay.destroy();
      substrate.destroy();
      grid.destroy();
      terrain.destroy();
      route.destroy();
      previewRoute.destroy();
      featureLayer.destroy({ children: true });
      fogMask.destroy();
      token.destroy();
      haloArt.destroy();
      tokenArt.destroy();
      previewToken.destroy();
      previewTokenArt.destroy();
      app.destroy({ removeView: true });
    },
  };
}
