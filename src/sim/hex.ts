export interface HexCoord {
  readonly q: number;
  readonly r: number;
}

export type HexDir = 0 | 1 | 2 | 3 | 4 | 5;
export type HexRotation = HexDir;

export const HEX_DIRS: readonly HexDir[] = Object.freeze([0, 1, 2, 3, 4, 5]);
export const HEX_DQ: readonly number[] = Object.freeze([1, 0, -1, -1, 0, 1]);
export const HEX_DR: readonly number[] = Object.freeze([0, 1, 1, 0, -1, -1]);

export function oppositeHexDir(dir: HexDir): HexDir {
  return ((dir + 3) % 6) as HexDir;
}

export function rotateHexCoord(coord: HexCoord, rotation: HexRotation): HexCoord {
  let q = coord.q;
  let r = coord.r;
  for (let turn = 0; turn < rotation; turn++) {
    const nextQ = -r;
    const nextR = q + r;
    q = Object.is(nextQ, -0) ? 0 : nextQ;
    r = Object.is(nextR, -0) ? 0 : nextR;
  }
  return { q, r };
}

export function hexDistance(aQ: number, aR: number, bQ: number, bR: number): number {
  const dq = bQ - aQ;
  const dr = bR - aR;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
}

export function hexInBounds(
  width: number,
  height: number,
  q: number,
  r: number,
): boolean {
  return q >= 0 && r >= 0 && q < width && r < height;
}

export function hexIndex(width: number, q: number, r: number): number {
  return r * width + q;
}
