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
  LAB_VIEWPORT,
  visibleLabCells,
  type LabCamera,
} from "./labCamera";
import { labAssetUrls } from "./labAssets";

const CELL_COLOR: Record<number, number> = {
  [CellKind.Empty]: 0xdce4dc,
  [CellKind.Wall]: 0x344340,
  [CellKind.Hazard]: 0xb83d35,
  [CellKind.SideEffect]: 0x80519a,
  [CellKind.Cure]: 0x2b9d72,
};

const BG = 0x111a1b;
const TOKEN_COLOR = 0x28a9d6;
const MAX_VISIBLE_CELLS = 320;

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
  if (kind === CellKind.Cure) return textures.cure;
  return null;
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
        terrain.circle(screen.x + cell / 2, screen.y + cell / 2, cell * 0.44).fill({
          color: CELL_COLOR[kind] ?? CELL_COLOR[CellKind.Empty],
          alpha: 0.22,
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
      if (kind === CellKind.Cure) {
        const cx = screen.x + cell / 2;
        const cy = screen.y + cell / 2;
        terrain.circle(cx, cy, cell * 0.3).stroke({ color: 0xeafff5, width: 3 });
        terrain.circle(cx, cy, cell * 0.1).fill({ color: 0xeafff5 });
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

function drawTrail(points: readonly (Vec2 | null)[], camera: LabCamera, route: Graphics): void {
  if (points.length < 2) return;
  const cell = LAB_CELL_PIXELS * camera.zoom;
  let drawing = false;
  for (const world of points) {
    if (world === null) {
      drawing = false;
      continue;
    }
    const point = cellScreen(camera, world.x, world.y);
    if (drawing) route.lineTo(point.x + cell / 2, point.y + cell / 2);
    else route.moveTo(point.x + cell / 2, point.y + cell / 2);
    drawing = true;
  }
  route.stroke({ color: TOKEN_COLOR, width: Math.max(3, cell * 0.09), alpha: 0.72 });
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
  const terrain = new Graphics();
  const route = new Graphics();
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
  app.stage.addChild(fogBackdrop, substrate, revealMask, terrain, route, featureLayer, haloArt, token, tokenArt);
  let destroyed = false;

  return {
    canvas: app.canvas,
    render: (mm, drug, view) => {
      terrain.clear();
      route.clear();
      token.clear();
      haloArt.visible = false;
      tokenArt.visible = false;
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
      drawVisibleMap(map, view.camera, textures, terrain, featureSprites, revealMask);
      drawTrail(view.trail, view.camera, route);
      const pos = drug.pos[view.activeMap];
      if (pos !== undefined) drawToken(pos, view.camera, token, tokenArt, haloArt, drug.failed);
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      app.stage.removeChildren();
      fogBackdrop.destroy();
      substrate.mask = null;
      substrate.destroy();
      terrain.destroy();
      route.destroy();
      featureLayer.destroy({ children: true });
      revealMask.filters = null;
      revealBlur.destroy();
      revealMask.destroy();
      token.destroy();
      haloArt.destroy();
      tokenArt.destroy();
      app.destroy({ removeView: true });
    },
  };
}
