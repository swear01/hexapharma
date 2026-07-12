export const LAB_VIEWPORT = { width: 704, height: 512 } as const;
export const LAB_CELL_PIXELS = 40;
export const LAB_MIN_ZOOM = 0.75;
export const LAB_MAX_ZOOM = 2.25;

export type LabGridLineKind = "minor" | "major" | "origin";

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

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

export interface VisibleLabCells {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function labGridKindForBoundary(coordinate: number): Exclude<LabGridLineKind, "origin"> {
  return coordinate % 5 === 0 ? "major" : "minor";
}

export function labGridLineStyle(kind: LabGridLineKind, zoom: number): LabGridLineStyle {
  const normalizedZoom = Math.min(1, Math.max(0, (zoom - LAB_MIN_ZOOM) / (1 - LAB_MIN_ZOOM)));
  if (kind === "origin") {
    return { color: 0x7ce5d1, alpha: 0.48 + normalizedZoom * 0.06, width: 2.25 };
  }
  if (kind === "major") {
    return { color: 0xb2c9c4, alpha: 0.2 + normalizedZoom * 0.05, width: 1.4 };
  }
  return { color: 0xa4b6b2, alpha: 0.055 + normalizedZoom * 0.055, width: 1 };
}

export function focusLabCamera(cell: Point): LabCamera {
  return { x: cell.x + 0.5, y: cell.y + 0.5, zoom: 1 };
}

export function clampLabCamera(camera: LabCamera, viewport: Size, map: Size): LabCamera {
  const zoom = Math.min(LAB_MAX_ZOOM, Math.max(LAB_MIN_ZOOM, camera.zoom));
  const cell = LAB_CELL_PIXELS * zoom;
  const halfW = viewport.width / cell / 2;
  const halfH = viewport.height / cell / 2;
  const minX = Math.min(map.width / 2, halfW);
  const maxX = Math.max(map.width / 2, map.width - halfW);
  const minY = Math.min(map.height / 2, halfH);
  const maxY = Math.max(map.height / 2, map.height - halfH);
  return {
    x: Math.min(maxX, Math.max(minX, camera.x)),
    y: Math.min(maxY, Math.max(minY, camera.y)),
    zoom,
  };
}

export function labScreenToWorld(camera: LabCamera, viewport: Size, screen: Point): Point {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  return {
    x: camera.x + (screen.x - viewport.width / 2) / cell,
    y: camera.y + (screen.y - viewport.height / 2) / cell,
  };
}

export function panLabCamera(
  camera: LabCamera,
  dxPixels: number,
  dyPixels: number,
  viewport: Size,
  map: Size,
): LabCamera {
  const cell = LAB_CELL_PIXELS * camera.zoom;
  return clampLabCamera(
    { ...camera, x: camera.x - dxPixels / cell, y: camera.y - dyPixels / cell },
    viewport,
    map,
  );
}

export function zoomLabCameraAt(
  camera: LabCamera,
  requestedZoom: number,
  screen: Point,
  viewport: Size,
  map: Size,
): LabCamera {
  const zoom = Math.min(LAB_MAX_ZOOM, Math.max(LAB_MIN_ZOOM, requestedZoom));
  const before = labScreenToWorld(camera, viewport, screen);
  const candidate = { ...camera, zoom };
  const after = labScreenToWorld(candidate, viewport, screen);
  return clampLabCamera(
    { x: candidate.x + before.x - after.x, y: candidate.y + before.y - after.y, zoom },
    viewport,
    map,
  );
}

export function visibleLabCells(camera: LabCamera, viewport: Size, map: Size): VisibleLabCells {
  const topLeft = labScreenToWorld(camera, viewport, { x: 0, y: 0 });
  const bottomRight = labScreenToWorld(camera, viewport, {
    x: viewport.width,
    y: viewport.height,
  });
  return {
    x0: Math.max(0, Math.floor(topLeft.x) - 1),
    y0: Math.max(0, Math.floor(topLeft.y) - 1),
    x1: Math.min(map.width, Math.ceil(bottomRight.x) + 1),
    y1: Math.min(map.height, Math.ceil(bottomRight.y) + 1),
  };
}

export function labTrailsForFrames(
  frames: readonly { readonly pos: readonly Point[] }[],
  mapCount: number,
  breakBefore: readonly boolean[] = [],
): readonly (readonly (Point | null)[])[] {
  const trails: (Point | null)[][] = Array.from({ length: mapCount }, () => []);
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const frame = frames[frameIndex]!;
    for (let map = 0; map < mapCount; map++) {
      const point = frame.pos[map];
      if (point !== undefined) {
        if (breakBefore[frameIndex] === true) trails[map]!.push(null);
        trails[map]!.push({ x: point.x, y: point.y });
      }
    }
  }
  return trails;
}
