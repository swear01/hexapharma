import type { HexCoord } from "../sim/hex";
import {
  hexBoardBounds,
  hexPolygon,
  hexToPixel,
  pixelToHex,
  type PixelPoint,
} from "./hexProjection";

export const LAB_VIEWPORT = { width: 832, height: 512 } as const;
export const LAB_CELL_PIXELS = 40;
export const LAB_MIN_ZOOM = 0.75;
export const LAB_MAX_ZOOM = 2.25;

export type LabGridLineKind = "minor" | "major";

export interface LabGridLineStyle {
  readonly color: number;
  readonly alpha: number;
  readonly width: number;
}

export interface LabCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

export interface VisibleLabCells {
  readonly q0: number;
  readonly r0: number;
  readonly q1: number;
  readonly r1: number;
}

const LAB_HEX_SIZE = LAB_CELL_PIXELS / 2;

export function labGridKindForBoundary(coordinate: number, originCoordinate: number): LabGridLineKind {
  return (coordinate - (originCoordinate - 2)) % 5 === 0 ? "major" : "minor";
}

export function labGridLineStyle(kind: LabGridLineKind, zoom: number): LabGridLineStyle {
  const normalizedZoom = Math.min(1, Math.max(0, (zoom - LAB_MIN_ZOOM) / (1 - LAB_MIN_ZOOM)));
  if (kind === "major") {
    return { color: 0x89959d, alpha: 0.07 + normalizedZoom * 0.03, width: 1 };
  }
  return { color: 0x89959d, alpha: 0.025 + normalizedZoom * 0.025, width: 1 };
}

export function labWorldToRelativeCell(cell: HexCoord, origin: HexCoord): HexCoord {
  return { q: cell.q - origin.q, r: cell.r - origin.r };
}

export function focusLabCamera(cell: HexCoord): LabCamera {
  const center = hexToPixel(cell.q, cell.r, LAB_HEX_SIZE);
  return { ...center, zoom: 1 };
}

export function clampLabCamera(camera: LabCamera, viewport: Size, map: Size): LabCamera {
  const zoom = Math.min(LAB_MAX_ZOOM, Math.max(LAB_MIN_ZOOM, camera.zoom));
  const bounds = hexBoardBounds(map.width, map.height, LAB_HEX_SIZE);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const halfW = viewport.width / zoom / 2;
  const halfH = viewport.height / zoom / 2;
  const minX = Math.min(centerX, bounds.minX + halfW);
  const maxX = Math.max(centerX, bounds.maxX - halfW);
  const minY = Math.min(centerY, bounds.minY + halfH);
  const maxY = Math.max(centerY, bounds.maxY - halfH);
  return {
    x: Math.min(maxX, Math.max(minX, camera.x)),
    y: Math.min(maxY, Math.max(minY, camera.y)),
    zoom,
  };
}

function labScreenToProjected(
  camera: LabCamera,
  viewport: Size,
  screen: PixelPoint,
): PixelPoint {
  return {
    x: camera.x + (screen.x - viewport.width / 2) / camera.zoom,
    y: camera.y + (screen.y - viewport.height / 2) / camera.zoom,
  };
}

export function labScreenToWorld(
  camera: LabCamera,
  viewport: Size,
  screen: PixelPoint,
): HexCoord {
  const projected = labScreenToProjected(camera, viewport, screen);
  return pixelToHex(projected.x, projected.y, LAB_HEX_SIZE);
}

export function labCellCenter(camera: LabCamera, cell: HexCoord): PixelPoint {
  const projected = hexToPixel(cell.q, cell.r, LAB_HEX_SIZE);
  return {
    x: LAB_VIEWPORT.width / 2 + (projected.x - camera.x) * camera.zoom,
    y: LAB_VIEWPORT.height / 2 + (projected.y - camera.y) * camera.zoom,
  };
}

export function labCellPolygon(camera: LabCamera, cell: HexCoord): readonly PixelPoint[] {
  const center = labCellCenter(camera, cell);
  return hexPolygon(center.x, center.y, LAB_HEX_SIZE * camera.zoom);
}

export function panLabCamera(
  camera: LabCamera,
  dxPixels: number,
  dyPixels: number,
  viewport: Size,
  map: Size,
): LabCamera {
  return clampLabCamera(
    { ...camera, x: camera.x - dxPixels / camera.zoom, y: camera.y - dyPixels / camera.zoom },
    viewport,
    map,
  );
}

export function zoomLabCameraAt(
  camera: LabCamera,
  requestedZoom: number,
  screen: PixelPoint,
  viewport: Size,
  map: Size,
): LabCamera {
  const zoom = Math.min(LAB_MAX_ZOOM, Math.max(LAB_MIN_ZOOM, requestedZoom));
  const before = labScreenToProjected(camera, viewport, screen);
  const candidate = { ...camera, zoom };
  const after = labScreenToProjected(candidate, viewport, screen);
  return clampLabCamera(
    { x: candidate.x + before.x - after.x, y: candidate.y + before.y - after.y, zoom },
    viewport,
    map,
  );
}

export function visibleLabCells(camera: LabCamera, viewport: Size, map: Size): VisibleLabCells {
  const corners = [
    { x: 0, y: 0 },
    { x: viewport.width, y: 0 },
    { x: 0, y: viewport.height },
    { x: viewport.width, y: viewport.height },
  ].map((point) => labScreenToWorld(camera, viewport, point));
  const q = corners.map((point) => point.q);
  const r = corners.map((point) => point.r);
  return {
    q0: Math.max(0, Math.min(...q) - 2),
    r0: Math.max(0, Math.min(...r) - 2),
    q1: Math.min(map.width, Math.max(...q) + 3),
    r1: Math.min(map.height, Math.max(...r) + 3),
  };
}

export function labTrailsForFrames(
  frames: readonly { readonly pos: readonly HexCoord[] }[],
  mapCount: number,
  breakBefore: readonly boolean[] = [],
): readonly (readonly (HexCoord | null)[])[] {
  const trails: (HexCoord | null)[][] = Array.from({ length: mapCount }, () => []);
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex]!;
    for (let map = 0; map < mapCount; map++) {
      const point = frame.pos[map];
      if (point !== undefined) {
        if (breakBefore[frameIndex] === true) trails[map]!.push(null);
        trails[map]!.push({ q: point.q, r: point.r });
      }
    }
  }
  return trails;
}
