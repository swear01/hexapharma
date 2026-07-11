import type { Vec2, EffectMap } from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";

export interface SweepResult {
  /** Final resting cell after the walk. */
  readonly pos: Vec2;
  /** True iff the path entered a Hazard cell (drug spoiled). */
  readonly failed: boolean;
  /**
   * Cells ENTERED after `from`, in walk order — including the hazard cell that
   * failed the sweep, but never the out-of-bounds/wall cell that merely stopped it.
   */
  readonly entered: readonly Vec2[];
}

function inBounds(map: EffectMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** Cell kind at (x,y); callers must ensure in-bounds. */
function cellAt(map: EffectMap, x: number, y: number): number {
  const v = map.cell[y * map.width + x];
  // noUncheckedIndexedAccess: in-bounds indices are always populated, but guard.
  return v ?? CellKind.Wall;
}

function enterStatus(map: EffectMap, x: number, y: number): number {
  if (!inBounds(map, x, y)) return 0;
  const kind = cellAt(map, x, y);
  if (kind === CellKind.Wall) return 0;
  return kind === CellKind.Hazard ? 2 : 1;
}

export function sweepInto(
  map: EffectMap,
  fromX: number,
  fromY: number,
  targetX: number,
  targetY: number,
  out: Int32Array,
  outOffset: number,
): void {
  let posX = fromX;
  let posY = fromY;
  const dx = targetX - fromX;
  const dy = targetY - fromY;
  if (dx === 0 && dy === 0) {
    out[outOffset] = posX;
    out[outOffset + 1] = posY;
    out[outOffset + 2] = 0;
    return;
  }

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  let x = fromX;
  let y = fromY;
  let tMaxX = ady;
  let tMaxY = adx;
  let nx = adx;
  let ny = ady;

  while (nx > 0 || ny > 0) {
    if (nx > 0 && (ny === 0 || tMaxX < tMaxY)) {
      x += sx;
      const status = enterStatus(map, x, y);
      if (status === 0) break;
      posX = x;
      posY = y;
      if (status === 2) {
        out[outOffset] = posX;
        out[outOffset + 1] = posY;
        out[outOffset + 2] = 1;
        return;
      }
      tMaxX += ady;
      nx -= 1;
    } else if (ny > 0 && (nx === 0 || tMaxY < tMaxX)) {
      y += sy;
      const status = enterStatus(map, x, y);
      if (status === 0) break;
      posX = x;
      posY = y;
      if (status === 2) {
        out[outOffset] = posX;
        out[outOffset + 1] = posY;
        out[outOffset + 2] = 1;
        return;
      }
      tMaxY += adx;
      ny -= 1;
    } else {
      const gxX = x + sx;
      const gxY = y;
      let status = enterStatus(map, gxX, gxY);
      if (status === 0) break;
      posX = gxX;
      posY = gxY;
      if (status === 2) {
        out[outOffset] = posX;
        out[outOffset + 1] = posY;
        out[outOffset + 2] = 1;
        return;
      }

      const gyX = x;
      const gyY = y + sy;
      status = enterStatus(map, gyX, gyY);
      if (status === 0) break;
      posX = gyX;
      posY = gyY;
      if (status === 2) {
        out[outOffset] = posX;
        out[outOffset + 1] = posY;
        out[outOffset + 2] = 1;
        return;
      }

      x += sx;
      y += sy;
      status = enterStatus(map, x, y);
      if (status === 0) break;
      posX = x;
      posY = y;
      if (status === 2) {
        out[outOffset] = posX;
        out[outOffset + 1] = posY;
        out[outOffset + 2] = 1;
        return;
      }
      tMaxX += ady;
      tMaxY += adx;
      nx -= 1;
      ny -= 1;
    }
  }

  out[outOffset] = posX;
  out[outOffset + 1] = posY;
  out[outOffset + 2] = 0;
}

/**
 * Apply the drug-sweep rule to one entered cell, mutating `entered`/`pos`/`failed`.
 * Returns a status describing whether the walk should continue.
 */
type EnterStatus = "advance" | "stop" | "fail";

/**
 * Walk an integer line from `from` to `target` one cell at a time using a
 * deterministic SUPERCOVER traversal (every grid cell the straight segment
 * between the two cell centers passes through), applying drug-sweep rules to
 * each entered cell in order:
 *  - out of bounds OR Wall  -> STOP; rest at the last valid cell; failed stays as-is.
 *  - Hazard                 -> mark failed; STOP after entering it.
 *  - otherwise              -> advance and continue.
 * Reaching `target` unobstructed rests at `target`.
 *
 * Corner convention (perfect-diagonal lattice crossings): both orthogonally
 * grazed cells are visited BEFORE the diagonal cell, in deterministic order
 * (the x-step neighbor, then the y-step neighbor). A hazard in either grazed
 * cell fails the drug; a wall/OOB in either grazed cell stops the sweep before
 * the diagonal (you cannot squeeze diagonally between two blocking corners).
 *
 * For axis-aligned vectors this reduces to straight stepping with no grazed
 * neighbors, byte-identical to the old straight-stepping behavior.
 */
export function sweep(map: EffectMap, from: Vec2, target: Vec2): SweepResult {
  const entered: Vec2[] = [];
  let pos: Vec2 = from;

  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (dx === 0 && dy === 0) return { pos, failed: false, entered };

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);

  // Try to enter a single cell, recording it and updating pos/failed.
  // Returns the resulting walk status without mutating on a stop.
  const enter = (x: number, y: number): EnterStatus => {
    if (!inBounds(map, x, y) || cellAt(map, x, y) === CellKind.Wall) return "stop";
    const here: Vec2 = { x, y };
    entered.push(here);
    pos = here;
    return cellAt(map, x, y) === CellKind.Hazard ? "fail" : "advance";
  };

  let x = from.x;
  let y = from.y;

  // Supercover via integer cross-multiplication. We track how far along x and
  // along y the next cell boundary lies, scaled by (adx*ady) to stay integral:
  //   tMaxX = (steps taken in x + 1) * ady   — distance to next vertical boundary
  //   tMaxY = (steps taken in y + 1) * adx   — distance to next horizontal boundary
  // Equality (tMaxX === tMaxY) is an exact lattice-corner crossing.
  let tMaxX = ady; // after 1 x-step
  let tMaxY = adx; // after 1 y-step
  let nx = adx; // remaining x steps
  let ny = ady; // remaining y steps

  while (nx > 0 || ny > 0) {
    if (nx > 0 && (ny === 0 || tMaxX < tMaxY)) {
      // Cross a vertical boundary first: pure x step.
      x += sx;
      const st = enter(x, y);
      if (st === "stop") return { pos, failed: false, entered };
      if (st === "fail") return { pos, failed: true, entered };
      tMaxX += ady;
      nx--;
    } else if (ny > 0 && (nx === 0 || tMaxY < tMaxX)) {
      // Cross a horizontal boundary first: pure y step.
      y += sy;
      const st = enter(x, y);
      if (st === "stop") return { pos, failed: false, entered };
      if (st === "fail") return { pos, failed: true, entered };
      tMaxY += adx;
      ny--;
    } else {
      // Exact lattice-corner crossing. Conservatively graze BOTH orthogonal
      // neighbors (x-step neighbor first, then y-step neighbor) before the
      // diagonal cell. A wall/OOB in either grazed cell blocks the squeeze.
      const gxX = x + sx;
      const gxY = y;
      const gyX = x;
      const gyY = y + sy;

      const sxStatus = enter(gxX, gxY);
      if (sxStatus === "stop") return { pos, failed: false, entered };
      if (sxStatus === "fail") return { pos, failed: true, entered };

      const syStatus = enter(gyX, gyY);
      if (syStatus === "stop") return { pos, failed: false, entered };
      if (syStatus === "fail") return { pos, failed: true, entered };

      // Both corners clear: step diagonally into the shared cell.
      x += sx;
      y += sy;
      const st = enter(x, y);
      if (st === "stop") return { pos, failed: false, entered };
      if (st === "fail") return { pos, failed: true, entered };

      tMaxX += ady;
      tMaxY += adx;
      nx--;
      ny--;
    }
  }

  return { pos, failed: false, entered };
}
