export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface GridCell {
  readonly x: number;
  readonly y: number;
}

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface CameraBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface ZoomBounds {
  readonly minZoom: number;
  readonly maxZoom: number;
}

export interface ScreenRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface IntrinsicSize {
  readonly width: number;
  readonly height: number;
}

export interface GridGeometry {
  readonly cellSize: number;
  readonly origin: Point;
}

export interface EditorHistory<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
}

const MAX_HISTORY_LENGTH = 50;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
}

function requireOrderedRange(min: number, max: number, name: string): void {
  requireFinite(min, `${name}.min`);
  requireFinite(max, `${name}.max`);
  if (min > max) throw new RangeError(`${name}.min must not exceed ${name}.max`);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function requireCamera(camera: Camera): void {
  requireFinite(camera.x, "camera.x");
  requireFinite(camera.y, "camera.y");
  requireFinite(camera.zoom, "camera.zoom");
  if (camera.zoom <= 0) throw new RangeError("camera.zoom must be positive");
}

function requireZoomBounds(bounds: ZoomBounds): void {
  requireOrderedRange(bounds.minZoom, bounds.maxZoom, "zoom");
  if (bounds.minZoom <= 0) throw new RangeError("zoom.min must be positive");
}

export function clampCamera(camera: Camera, bounds: CameraBounds): Camera {
  requireCamera(camera);
  requireOrderedRange(bounds.minX, bounds.maxX, "camera.x");
  requireOrderedRange(bounds.minY, bounds.maxY, "camera.y");
  requireZoomBounds(bounds);
  return {
    x: clamp(camera.x, bounds.minX, bounds.maxX),
    y: clamp(camera.y, bounds.minY, bounds.maxY),
    zoom: clamp(camera.zoom, bounds.minZoom, bounds.maxZoom),
  };
}

export function zoomCameraAt(
  camera: Camera,
  cursor: Point,
  requestedZoom: number,
  bounds: ZoomBounds,
): Camera {
  requireCamera(camera);
  requireFinite(cursor.x, "cursor.x");
  requireFinite(cursor.y, "cursor.y");
  requireFinite(requestedZoom, "requestedZoom");
  requireZoomBounds(bounds);
  const zoom = clamp(requestedZoom, bounds.minZoom, bounds.maxZoom);
  const ratio = zoom / camera.zoom;
  return {
    x: cursor.x - (cursor.x - camera.x) * ratio,
    y: cursor.y - (cursor.y - camera.y) * ratio,
    zoom,
  };
}

export function panCamera(camera: Camera, delta: Point): Camera {
  requireCamera(camera);
  requireFinite(delta.x, "delta.x");
  requireFinite(delta.y, "delta.y");
  return { x: camera.x + delta.x, y: camera.y + delta.y, zoom: camera.zoom };
}

function requireCoordinates(
  rect: ScreenRect,
  intrinsic: IntrinsicSize,
  camera: Camera,
  grid: GridGeometry,
): void {
  requireCamera(camera);
  requireFinite(rect.left, "rect.left");
  requireFinite(rect.top, "rect.top");
  requireFinite(rect.width, "rect.width");
  requireFinite(rect.height, "rect.height");
  requireFinite(intrinsic.width, "intrinsic.width");
  requireFinite(intrinsic.height, "intrinsic.height");
  requireFinite(grid.cellSize, "grid.cellSize");
  requireFinite(grid.origin.x, "grid.origin.x");
  requireFinite(grid.origin.y, "grid.origin.y");
  if (rect.width <= 0 || rect.height <= 0) throw new RangeError("screen rect must have positive dimensions");
  if (intrinsic.width <= 0 || intrinsic.height <= 0) {
    throw new RangeError("canvas intrinsic size must have positive dimensions");
  }
  if (grid.cellSize <= 0) throw new RangeError("grid cellSize must be positive");
}

export function screenToGrid(
  screen: Point,
  rect: ScreenRect,
  intrinsic: IntrinsicSize,
  camera: Camera,
  grid: GridGeometry,
): GridCell {
  requireCoordinates(rect, intrinsic, camera, grid);
  requireFinite(screen.x, "screen.x");
  requireFinite(screen.y, "screen.y");
  const canvasX = (screen.x - rect.left) * intrinsic.width / rect.width;
  const canvasY = (screen.y - rect.top) * intrinsic.height / rect.height;
  const worldX = (canvasX - camera.x) / camera.zoom;
  const worldY = (canvasY - camera.y) / camera.zoom;
  return {
    x: Math.floor((worldX - grid.origin.x) / grid.cellSize),
    y: Math.floor((worldY - grid.origin.y) / grid.cellSize),
  };
}

export function gridCellCenterToScreen(
  cell: GridCell,
  rect: ScreenRect,
  intrinsic: IntrinsicSize,
  camera: Camera,
  grid: GridGeometry,
): Point {
  requireCoordinates(rect, intrinsic, camera, grid);
  requireFinite(cell.x, "cell.x");
  requireFinite(cell.y, "cell.y");
  const worldX = grid.origin.x + (cell.x + 0.5) * grid.cellSize;
  const worldY = grid.origin.y + (cell.y + 0.5) * grid.cellSize;
  const canvasX = worldX * camera.zoom + camera.x;
  const canvasY = worldY * camera.zoom + camera.y;
  return {
    x: rect.left + canvasX * rect.width / intrinsic.width,
    y: rect.top + canvasY * rect.height / intrinsic.height,
  };
}

function requireGridCell(cell: GridCell, name: string): void {
  if (!Number.isSafeInteger(cell.x) || !Number.isSafeInteger(cell.y)) {
    throw new RangeError(`${name} must contain safe integer coordinates`);
  }
}

export function rasterizeGridLine(
  start: GridCell,
  end: GridCell,
  firstAxis: "horizontal" | "vertical" = "horizontal",
): readonly GridCell[] {
  requireGridCell(start, "start");
  requireGridCell(end, "end");
  const cells: GridCell[] = [{ x: start.x, y: start.y }];
  let x = start.x;
  let y = start.y;
  const walkHorizontal = () => {
    const step = x < end.x ? 1 : -1;
    while (x !== end.x) {
      x += step;
      cells.push({ x, y });
    }
  };
  const walkVertical = () => {
    const step = y < end.y ? 1 : -1;
    while (y !== end.y) {
      y += step;
      cells.push({ x, y });
    }
  };
  if (firstAxis === "horizontal") {
    walkHorizontal();
    walkVertical();
  } else {
    walkVertical();
    walkHorizontal();
  }
  return cells;
}

export type BeltDirection = 0 | 1 | 2 | 3;

export function routeBeltGesture(
  existing: readonly GridCell[],
  end: GridCell,
  initialDirection: BeltDirection,
): readonly GridCell[] {
  requireGridCell(end, "end");
  const start = existing[0];
  if (start === undefined) return [{ x: end.x, y: end.y }];
  return rasterizeGridLine(
    start,
    end,
    initialDirection === 1 || initialDirection === 3 ? "vertical" : "horizontal",
  );
}

function directionBetween(from: GridCell, to: GridCell): BeltDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return 0;
  if (dx === 0 && dy === 1) return 1;
  if (dx === -1 && dy === 0) return 2;
  if (dx === 0 && dy === -1) return 3;
  throw new RangeError("belt gesture cells must be cardinal neighbors");
}

export function orientBeltGesture(
  cells: readonly GridCell[],
  fallback: BeltDirection,
): readonly BeltDirection[] {
  if (!Number.isSafeInteger(fallback) || fallback < 0 || fallback > 3) {
    throw new RangeError("belt gesture fallback direction is invalid");
  }
  for (const cell of cells) requireGridCell(cell, "cell");
  if (cells.length === 0) return [];
  const directions: BeltDirection[] = [];
  for (let index = 0; index < cells.length; index++) {
    const current = cells[index]!;
    const next = cells[index + 1];
    if (next !== undefined) {
      directions.push(directionBetween(current, next));
      continue;
    }
    const previous = cells[index - 1];
    directions.push(previous === undefined ? fallback : directionBetween(previous, current));
  }
  return directions;
}

export function appendUniqueCells(
  existing: readonly GridCell[],
  additions: readonly GridCell[],
): readonly GridCell[] {
  const result: GridCell[] = [];
  const seen = new Set<string>();
  for (const cell of [...existing, ...additions]) {
    requireGridCell(cell, "cell");
    const key = `${cell.x},${cell.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cell);
  }
  return result;
}

export function createEditorHistory<T>(initial: T): EditorHistory<T> {
  return { past: [], present: initial, future: [] };
}

export function pushEditorHistory<T>(history: EditorHistory<T>, value: T): EditorHistory<T> {
  if (Object.is(history.present, value)) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY_LENGTH),
    present: value,
    future: [],
  };
}

export function undoEditorHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  if (history.past.length === 0) return history;
  const index = history.past.length - 1;
  const previous = history.past[index] as T;
  return {
    past: history.past.slice(0, index),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redoEditorHistory<T>(history: EditorHistory<T>): EditorHistory<T> {
  if (history.future.length === 0) return history;
  const next = history.future[0] as T;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}

export interface CommitReconciliation {
  readonly pendingKeys: readonly string[];
  readonly applyIncoming: boolean;
  readonly resetHistory: boolean;
}

export function reconcilePendingCommit(
  pendingKeys: readonly string[],
  incomingKey: string,
): CommitReconciliation {
  const index = pendingKeys.indexOf(incomingKey);
  if (index < 0) {
    return { pendingKeys: [], applyIncoming: true, resetHistory: true };
  }
  const remaining = pendingKeys.slice(index + 1);
  return {
    pendingKeys: remaining,
    applyIncoming: remaining.length === 0,
    resetHistory: false,
  };
}
