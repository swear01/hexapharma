import {
  Application,
  Assets,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  TilingSprite,
  type Texture,
} from "pixi.js";
import type { DrugState, EffectMap, MultiMap, Vec2 } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";
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

const CELL_COLOR: Record<number, number> = {
  [CellKind.Empty]: 0xdce4dc,
  [CellKind.Wall]: 0x344340,
  [CellKind.Hazard]: 0xb83d35,
  [CellKind.SideEffect]: 0x80519a,
  [CellKind.Cure]: 0x2b9d72,
};

const BG = 0x111a1b;
const TOKEN_COLOR = 0x28a9d6;
const MAX_VISIBLE_CELLS =
  (Math.ceil(LAB_VIEWPORT.width / (LAB_CELL_PIXELS * LAB_MIN_ZOOM)) + 3) *
  (Math.ceil(LAB_VIEWPORT.height / (LAB_CELL_PIXELS * LAB_MIN_ZOOM)) + 3);

interface LabTextures {
  readonly substrate: Texture;
  readonly fog: Texture;
  readonly wall: Texture;
  readonly hazard: Texture;
  readonly sideEffect: Texture;
  readonly cure: Texture;
  readonly drug: Texture;
  readonly halo: Texture;
}

async function loadLabTextures(): Promise<LabTextures> {
  const response = await fetch("/assets/lab/manifest.json");
  if (!response.ok) throw new Error(`Lab asset manifest request failed with ${response.status}`);
  const urls = labAssetUrls(await response.json());
  const [substrate, fog, wall, hazard, sideEffect, cure, drug, halo] = await Promise.all([
    Assets.load<Texture>(urls.substrate),
    Assets.load<Texture>(urls.fog),
    Assets.load<Texture>(urls.wall),
    Assets.load<Texture>(urls.hazard),
    Assets.load<Texture>(urls.sideEffect),
    Assets.load<Texture>(urls.cure),
    Assets.load<Texture>(urls.drug),
    Assets.load<Texture>(urls.halo),
  ]);
  return { substrate, fog, wall, hazard, sideEffect, cure, drug, halo };
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

function featureTexture(textures: LabTextures, kind: number): Texture | null {
  if (kind === CellKind.Wall) return textures.wall;
  if (kind === CellKind.Hazard) return textures.hazard;
  if (kind === CellKind.SideEffect) return textures.sideEffect;
  if (kind === CellKind.Cure) return null;
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

function drawVisibleMap(
  map: EffectMap,
  camera: LabCamera,
  textures: LabTextures,
  terrain: Graphics,
  featureSprites: readonly Sprite[],
  revealMask: Graphics,
): void {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  const bounds = visibleLabCells(camera, LAB_VIEWPORT, map);
  let featureIndex = 0;
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const screen = cellScreen(camera, x, y);
      const revealed = isRevealed(map, x, y);
      if (!revealed) continue;

      revealMask.rect(screen.x - 2, screen.y - 2, cell + 4, cell + 4).fill(0xffffff);

      const kind = map.cell[y * map.width + x] ?? CellKind.Empty;
      if (kind !== CellKind.Empty) {
        terrain.rect(screen.x, screen.y, cell, cell).fill({
          color: CELL_COLOR[kind] ?? CELL_COLOR[CellKind.Empty],
          alpha: kind === CellKind.Cure ? 0.3 : 0.2,
        });
      }
      const texture = featureTexture(textures, kind);
      const sprite = texture === null ? undefined : featureSprites[featureIndex++];
      if (sprite !== undefined && texture !== null) {
        sprite.texture = texture;
        sprite.visible = true;
        sprite.anchor.set(0.5);
        sprite.x = screen.x + cell / 2;
        sprite.y = screen.y + cell / 2;
        sprite.width = cell * (kind === CellKind.Wall ? 1.08 : 0.88);
        sprite.height = cell * (kind === CellKind.Wall ? 1.08 : 0.88);
        sprite.rotation = ((x * 7 + y * 11) & 3) * Math.PI / 2;
      }
      if (kind !== CellKind.Empty) {
        const edges = revealedRegionEdges(map, x, y);
        const edgeStyle = {
          color: kind === CellKind.Cure ? 0x75f0b8 : (CELL_COLOR[kind] ?? 0xffffff),
          width: Math.max(2, cell * (kind === CellKind.Cure ? 0.07 : 0.045)),
          alpha: kind === CellKind.Cure ? 0.9 : 0.7,
        };
        if (edges.top) terrain.moveTo(screen.x, screen.y).lineTo(screen.x + cell, screen.y).stroke(edgeStyle);
        if (edges.right) terrain.moveTo(screen.x + cell, screen.y).lineTo(screen.x + cell, screen.y + cell).stroke(edgeStyle);
        if (edges.bottom) terrain.moveTo(screen.x, screen.y + cell).lineTo(screen.x + cell, screen.y + cell).stroke(edgeStyle);
        if (edges.left) terrain.moveTo(screen.x, screen.y).lineTo(screen.x, screen.y + cell).stroke(edgeStyle);
      }
    }
  }
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

  const fogBackdrop = TilingSprite.from(textures.fog, {
    width: LAB_VIEWPORT.width,
    height: LAB_VIEWPORT.height,
  });
  fogBackdrop.tileScale.set(0.42);
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
  const revealMask = new Graphics();
  const revealBlur = new BlurFilter({ strength: 6, quality: 2 });
  revealMask.filters = [revealBlur];
  substrate.mask = revealMask;
  const token = new Graphics();
  const haloArt = new Sprite(textures.halo);
  haloArt.visible = false;
  const tokenArt = new Sprite(textures.drug);
  tokenArt.visible = false;
  const previewToken = new Graphics();
  const previewTokenArt = new Sprite(textures.drug);
  previewTokenArt.visible = false;
  app.stage.addChild(
    fogBackdrop,
    substrate,
    revealMask,
    grid,
    terrain,
    route,
    previewRoute,
    featureLayer,
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
      revealMask.clear();
      const map = mm.maps[view.activeMap];
      if (map === undefined) return;
      const cell = LAB_CELL_PIXELS * view.camera.zoom;
      substrate.tilePosition.set(
        LAB_VIEWPORT.width / 2 - view.camera.x * cell,
        LAB_VIEWPORT.height / 2 - view.camera.y * cell,
      );
      substrate.tileScale.set(0.42 * view.camera.zoom);
      fogBackdrop.tilePosition.copyFrom(substrate.tilePosition);
      fogBackdrop.tileScale.copyFrom(substrate.tileScale);
      drawLabGrid(map, view.camera, grid);
      drawVisibleMap(map, view.camera, textures, terrain, featureSprites, revealMask);
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
      fogBackdrop.destroy();
      substrate.mask = null;
      substrate.destroy();
      grid.destroy();
      terrain.destroy();
      route.destroy();
      previewRoute.destroy();
      featureLayer.destroy({ children: true });
      revealMask.filters = null;
      revealBlur.destroy();
      revealMask.destroy();
      token.destroy();
      haloArt.destroy();
      tokenArt.destroy();
      previewToken.destroy();
      previewTokenArt.destroy();
      app.destroy({ removeView: true });
    },
  };
}
