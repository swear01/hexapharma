import type { EffectMap, HexCoord, HexDir, Machine } from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { HEX_DQ, HEX_DR } from "../hex";
import { validateEffectMap, validateMachinePath } from "./validation";

/** Output slots written by the `*Into` walkers: q, r, offsetQ, offsetR, failed. */
export const PATH_OUT_STRIDE = 5;

export interface PathWalkResult {
  readonly pos: HexCoord;
  readonly offset: HexCoord;
  readonly failed: boolean;
  /** Cell after every applied (non-cancelled) delta, plus each portal exit. */
  readonly entered: readonly HexCoord[];
  /** Doubled-unit point `2 * cell + offset` matching each `entered` cell. */
  readonly points: readonly HexCoord[];
}

function inBounds(map: EffectMap, q: number, r: number): boolean {
  return q >= 0 && r >= 0 && q < map.width && r < map.height;
}

/** Squared Euclidean distance (×4, axial metric) from doubled point (pq, pr) to cell (q, r). */
function doubledDistance(pq: number, pr: number, q: number, r: number): number {
  const dq = pq - 2 * q;
  const dr = pr - 2 * r;
  return dq * dq + dq * dr + dr * dr;
}

/**
 * The cell containing doubled point (pq, pr), searched among cell (q, r) and its six
 * neighbours (every reachable point lies within one cell of the current one). Ties at
 * edge midpoints prefer the current cell, then E, SE, SW, W, NW, NE. Returns the
 * direction (0..5) of the chosen neighbour, or -1 for the current cell.
 */
export function cellOfDoubledPoint(pq: number, pr: number, q: number, r: number): number {
  let best = -1;
  let bestDistance = doubledDistance(pq, pr, q, r);
  for (let dir = 0; dir < 6; dir++) {
    const distance = doubledDistance(pq, pr, q + HEX_DQ[dir]!, r + HEX_DR[dir]!);
    if (distance < bestDistance) {
      best = dir;
      bestDistance = distance;
    }
  }
  return best;
}

function walkPathCore(
  map: EffectMap,
  fromQ: number,
  fromR: number,
  fromOffsetQ: number,
  fromOffsetR: number,
  heading: number,
  machine: Machine,
  entered: HexCoord[] | null,
  points: HexCoord[] | null,
  out: Int32Array,
  outOffset: number,
): void {
  let q = fromQ;
  let r = fromR;
  // Doubled-unit point P = 2 * cell + offset.
  let pq = 2 * q + fromOffsetQ;
  let pr = 2 * r + fromOffsetR;
  let failed = 0;

  for (let stepIndex = 0; stepIndex < machine.path.length; stepIndex++) {
    const relative = machine.path[stepIndex];
    if (relative === undefined) throw new Error("drug graph: validated path is missing a direction");
    const dir = (((relative + heading) % 6) + 6) % 6;
    const scale = map.cell[r * map.width + q] === CellKind.Swamp ? 1 : 2;
    const nextPQ = pq + HEX_DQ[dir]! * scale;
    const nextPR = pr + HEX_DR[dir]! * scale;
    // From a cell centre a full step lands exactly on the neighbour's centre.
    const towards = scale === 2 && pq === 2 * q && pr === 2 * r ? dir : cellOfDoubledPoint(nextPQ, nextPR, q, r);
    const targetQ = towards < 0 ? q : q + HEX_DQ[towards]!;
    const targetR = towards < 0 ? r : r + HEX_DR[towards]!;
    if (!inBounds(map, targetQ, targetR)) continue;

    const cellIndex = targetR * map.width + targetQ;
    const kind = map.cell[cellIndex];
    if (kind === CellKind.Wall) continue;

    q = targetQ;
    r = targetR;
    if (towards >= 0 && kind !== CellKind.Swamp) {
      // Leaving onto a non-swamp cell realigns to its centre.
      pq = 2 * q;
      pr = 2 * r;
    } else {
      pq = nextPQ;
      pr = nextPR;
    }
    if (entered !== null) entered.push({ q, r });
    if (points !== null) points.push({ q: pq, r: pr });

    if (kind === CellKind.Abyss) {
      failed = 1;
      break;
    }

    if (towards >= 0 && kind === CellKind.Portal) {
      const destination = map.portalTo[cellIndex];
      if (destination === undefined) {
        throw new Error("drug graph: validated portal has no destination");
      }
      q = destination % map.width;
      r = Math.floor(destination / map.width);
      pq = 2 * q;
      pr = 2 * r;
      if (entered !== null) entered.push({ q, r });
      if (points !== null) points.push({ q: pq, r: pr });
    }
  }

  out[outOffset] = q;
  out[outOffset + 1] = r;
  out[outOffset + 2] = pq - 2 * q;
  out[outOffset + 3] = pr - 2 * r;
  out[outOffset + 4] = failed;
}

function validateOutputRange(out: Int32Array, outOffset: number): void {
  if (
    !Number.isSafeInteger(outOffset) ||
    outOffset < 0 ||
    outOffset + PATH_OUT_STRIDE > out.length
  ) {
    throw new Error("drug graph: path output range is outside the buffer");
  }
}

/**
 * Walk one heading-relative machine path from cell (fromQ, fromR) plus doubled offset and
 * write `[q, r, offsetQ, offsetR, failed]` at `out[outOffset..]`. Caller must validate the
 * EffectMap, Machine and start point once before using this in a hot loop.
 */
export function walkValidatedPathInto(
  map: EffectMap,
  fromQ: number,
  fromR: number,
  fromOffsetQ: number,
  fromOffsetR: number,
  heading: number,
  machine: Machine,
  out: Int32Array,
  outOffset: number,
): void {
  validateOutputRange(out, outOffset);
  walkPathCore(map, fromQ, fromR, fromOffsetQ, fromOffsetR, heading, machine, null, null, out, outOffset);
}

export function walkPathInto(
  map: EffectMap,
  fromQ: number,
  fromR: number,
  fromOffsetQ: number,
  fromOffsetR: number,
  heading: number,
  machine: Machine,
  out: Int32Array,
  outOffset: number,
): void {
  validateEffectMap(map);
  validateMachinePath(machine);
  walkValidatedPathInto(map, fromQ, fromR, fromOffsetQ, fromOffsetR, heading, machine, out, outOffset);
}

export function walkPath(
  map: EffectMap,
  from: HexCoord,
  machine: Machine,
  heading: HexDir,
  offset: HexCoord,
): PathWalkResult {
  validateEffectMap(map);
  validateMachinePath(machine);
  return walkValidatedPath(map, from, machine, heading, offset);
}

/** `walkPath` without the per-call EffectMap / Machine validation; the caller validates once. */
export function walkValidatedPath(
  map: EffectMap,
  from: HexCoord,
  machine: Machine,
  heading: HexDir,
  offset: HexCoord,
): PathWalkResult {
  const entered: HexCoord[] = [];
  const points: HexCoord[] = [];
  const out = new Int32Array(PATH_OUT_STRIDE);
  walkPathCore(map, from.q, from.r, offset.q, offset.r, heading, machine, entered, points, out, 0);
  return {
    pos: { q: out[0]!, r: out[1]! },
    offset: { q: out[2]!, r: out[3]! },
    failed: out[4] === 1,
    entered,
    points,
  };
}
