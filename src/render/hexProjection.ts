import { hexDistance, type HexCoord } from "../sim/hex";

export interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

export interface PixelBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const SQRT_3 = Math.sqrt(3);

export function hexToPixel(q: number, r: number, size: number): PixelPoint {
  return { x: SQRT_3 * size * (q + r / 2), y: 1.5 * size * r };
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function roundAxial(q: number, r: number): HexCoord {
  const s = -q - r;
  let roundedQ = Math.round(q);
  let roundedR = Math.round(r);
  const roundedS = Math.round(s);
  const qError = Math.abs(roundedQ - q);
  const rError = Math.abs(roundedR - r);
  const sError = Math.abs(roundedS - s);
  if (qError > rError && qError > sError) roundedQ = -roundedR - roundedS;
  else if (rError > sError) roundedR = -roundedQ - roundedS;
  return { q: cleanZero(roundedQ), r: cleanZero(roundedR) };
}

export function pixelToHex(x: number, y: number, size: number): HexCoord {
  return roundAxial((SQRT_3 * x / 3 - y / 3) / size, (2 * y / 3) / size);
}

export function hexPolygon(cx: number, cy: number, size: number): readonly PixelPoint[] {
  const halfWidth = SQRT_3 * size / 2;
  return [
    { x: cx, y: cy - size },
    { x: cx + halfWidth, y: cy - size / 2 },
    { x: cx + halfWidth, y: cy + size / 2 },
    { x: cx, y: cy + size },
    { x: cx - halfWidth, y: cy + size / 2 },
    { x: cx - halfWidth, y: cy - size / 2 },
  ];
}

export function hexBoardBounds(width: number, height: number, size: number): PixelBounds {
  const last = hexToPixel(width - 1, height - 1, size);
  const halfWidth = SQRT_3 * size / 2;
  return { minX: -halfWidth, minY: -size, maxX: last.x + halfWidth, maxY: last.y + size };
}

export function hexLine(start: HexCoord, end: HexCoord): readonly HexCoord[] {
  const distance = hexDistance(start.q, start.r, end.q, end.r);
  if (distance === 0) return [{ q: start.q, r: start.r }];
  const line: HexCoord[] = [];
  for (let step = 0; step <= distance; step++) {
    const ratio = step / distance;
    line.push(roundAxial(
      start.q + (end.q - start.q) * ratio,
      start.r + (end.r - start.r) * ratio,
    ));
  }
  return line;
}
