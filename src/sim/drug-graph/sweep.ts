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

/**
 * Walk an integer line from `from` to `target` one cell at a time using
 * deterministic Bresenham, applying drug-sweep rules to each entered cell:
 *  - out of bounds OR Wall  -> STOP; rest at the last valid cell; failed stays as-is.
 *  - Hazard                 -> mark failed; STOP after entering it.
 *  - otherwise              -> advance and continue.
 * Reaching `target` unobstructed rests at `target`.
 *
 * NOTE (Phase 0): on pure diagonals Bresenham may pass through a shared edge and
 * skip the orthogonally-adjacent corner cells; that is accepted for Phase 0. For
 * axis-aligned vectors this reduces to straight stepping with no skips.
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

  let x = from.x;
  let y = from.y;
  let err = adx - ady;

  // Bound the loop by the Chebyshev distance to the target; we break out on
  // arrival or obstruction, so this is a safety ceiling, not the exit path.
  const maxSteps = Math.max(adx, ady);
  for (let step = 0; step < maxSteps; step++) {
    const e2 = 2 * err;
    if (e2 > -ady) {
      err -= ady;
      x += sx;
    }
    if (e2 < adx) {
      err += adx;
      y += sy;
    }

    if (!inBounds(map, x, y) || cellAt(map, x, y) === CellKind.Wall) {
      // Stop before the obstruction; rest at the last valid cell.
      return { pos, failed: false, entered };
    }

    const here: Vec2 = { x, y };
    entered.push(here);
    pos = here;

    if (cellAt(map, x, y) === CellKind.Hazard) {
      return { pos, failed: true, entered };
    }
  }

  return { pos, failed: false, entered };
}
