/**
 * HexaPharma — mapgen.
 *
 * Constructive level generation + per-disease difficulty scoring + pricing.
 * Satisfies INV-9 (constructive solvability), INV-10 (generation determinism),
 * INV-11 (difficulty bounds) and INV-12 (pricing consistency).
 *
 * All randomness flows from `makeRng(opts.seed)` — no Math.random / Date.now.
 * The generator is a bounded reject-sampling loop: it CONSTRUCTS a reference
 * solution for every disease (existence proof), scatters non-blocking features,
 * verifies the reference still cures via `evaluate`, then scores each disease
 * with the canonical `solve` and accepts only when every difficulty lands in
 * [min, max].
 */
import type {
  Vec2,
  EffectMap,
  MultiMap,
  Machine,
  Orientation,
  Rotation,
  Template,
  MachineCatalogEntry,
  DiseaseSpec,
  GenerateFn,
  DifficultyToBasePriceFn,
  MapIndex,
  DiseaseId,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { applyStep, effectiveDelta, evaluate, initialState } from "../drug-graph";
import { solve } from "../solver";
import { makeRng } from "../rng";
import type { Rng } from "../phase0_interfaces";

// ───────────────────────────── pricing (INV-12) ─────────────────────────────

/**
 * Base price = exponential in difficulty + a linear term in reference cost.
 * Deterministic, integer, and monotonically NON-decreasing in BOTH arguments
 * (the exponential base > 1 and both coefficients are positive). Pure leaf math
 * (Math.pow / Math.round are allowed here per the module brief).
 */
export const difficultyToBasePrice: DifficultyToBasePriceFn = (difficulty, refCost) =>
  Math.round(10 * Math.pow(1.7, difficulty) + 3 * refCost);

// ───────────────────────────── small helpers ─────────────────────────────

const ALL_ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

const idx = (w: number, x: number, y: number): number => y * w + x;

/** A catalog translate machine reduced to one concrete oriented effective delta. */
interface AxisMover {
  readonly machine: Machine;
  readonly delta: Vec2; // effective delta (axis-aligned, positive component)
  readonly cost: number;
}

/** A fully-mutable scratch map we fill during one generation attempt. */
interface ScratchMap {
  readonly width: number;
  readonly height: number;
  readonly origin: Vec2;
  readonly start: Vec2;
  readonly cell: Uint8Array;
  readonly cureId: Int16Array;
  readonly sideEffectId: Int16Array;
  /** Cells that must never receive a Wall/Hazard (reference path, start, cures). */
  readonly protectedCells: Uint8Array;
}

function makeScratch(width: number, height: number, start: Vec2, origin: Vec2): ScratchMap {
  const len = width * height;
  const m: ScratchMap = {
    width,
    height,
    origin,
    start,
    cell: new Uint8Array(len),
    cureId: new Int16Array(len).fill(-1),
    sideEffectId: new Int16Array(len).fill(-1),
    protectedCells: new Uint8Array(len),
  };
  // The start cell is always protected.
  m.protectedCells[idx(width, start.x, start.y)] = 1;
  return m;
}

function freezeMap(m: ScratchMap): EffectMap {
  return {
    width: m.width,
    height: m.height,
    origin: m.origin,
    start: m.start,
    cell: m.cell,
    cureId: m.cureId,
    sideEffectId: m.sideEffectId,
    // Every level ships fully fogged (lab experimentation reveals it).
    fog: new Uint8Array(m.width * m.height),
  };
}

function inBounds(m: { width: number; height: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < m.width && y < m.height;
}

// ───────────────────────────── catalog inspection ─────────────────────────────

/**
 * Enumerate the catalog's translate machines as concrete axis-aligned movers with
 * a strictly-positive single component (i.e. pure +x or +y motion). Orientable
 * entries are expanded across all 4 rotations (+ flip); non-orientable translate
 * entries are taken at identity. Deduped by effective delta, deterministic order.
 *
 * These are the only movers the constructive reacher uses, which keeps the
 * reference path inside the positive quadrant and makes its length predictable.
 */
function axisMovers(catalog: readonly MachineCatalogEntry[]): AxisMover[] {
  const out: AxisMover[] = [];
  const seen = new Set<string>();
  for (const entry of catalog) {
    const t = entry.transform;
    if (t.kind !== "translate") continue;
    const orientations: Orientation[] = entry.orientable
      ? ALL_ROTATIONS.flatMap((rot) => [
          { rot, flip: false },
          { rot, flip: true },
        ])
      : [{ rot: 0, flip: false }];
    for (const orientation of orientations) {
      const eff = effectiveDelta(t.delta, t.relation, orientation);
      // Keep only pure +x or pure +y movers (one axis zero, the other > 0).
      const positiveX = eff.x > 0 && eff.y === 0;
      const positiveY = eff.y > 0 && eff.x === 0;
      if (!positiveX && !positiveY) continue;
      const key = `${eff.x},${eff.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        machine: { typeId: entry.typeId, transform: t, orientation },
        delta: eff,
        cost: entry.cost,
      });
    }
  }
  return out;
}

/** Largest positive +x step available (0 if none). */
function maxStep(movers: readonly AxisMover[], axis: "x" | "y"): number {
  let best = 0;
  for (const mv of movers) {
    const v = axis === "x" ? (mv.delta.y === 0 ? mv.delta.x : 0) : mv.delta.x === 0 ? mv.delta.y : 0;
    if (v > best) best = v;
  }
  return best;
}

/**
 * Build the cheapest/shortest reference reaching (cx,cy) from (0,0) using the
 * available +x/+y movers. Greedy by largest step that does not overshoot per
 * axis; this is optimal for the default catalog (unit + double steps) and yields
 * the canonical minimal step count. Returns null if the target is unreachable
 * exactly with the available axis movers.
 */
function buildReference(movers: readonly AxisMover[], cx: number, cy: number): Template | null {
  const steps: Machine[] = [];
  // Sort candidate steps per axis descending by step size (deterministic; ties by
  // lower cost then by typeId for stability).
  const xMovers = movers
    .filter((mv) => mv.delta.y === 0 && mv.delta.x > 0)
    .sort((a, b) => b.delta.x - a.delta.x || a.cost - b.cost || a.machine.typeId.localeCompare(b.machine.typeId));
  const yMovers = movers
    .filter((mv) => mv.delta.x === 0 && mv.delta.y > 0)
    .sort((a, b) => b.delta.y - a.delta.y || a.cost - b.cost || a.machine.typeId.localeCompare(b.machine.typeId));

  let x = 0;
  while (x < cx) {
    const remaining = cx - x;
    const pick = xMovers.find((mv) => mv.delta.x <= remaining);
    if (pick === undefined) return null;
    steps.push(pick.machine);
    x += pick.delta.x;
  }
  let y = 0;
  while (y < cy) {
    const remaining = cy - y;
    const pick = yMovers.find((mv) => mv.delta.y <= remaining);
    if (pick === undefined) return null;
    steps.push(pick.machine);
    y += pick.delta.y;
  }
  return { steps };
}

// ───────────────────────────── target selection ─────────────────────────────

/**
 * Pick a cure cell whose canonical minimal step count (ceil(cx/sx)+ceil(cy/sy)
 * for unit/double-step catalogs) targets a difficulty drawn from [min,max], using
 * the rng. Returns a candidate (cx,cy) inside the grid, or null if no cell fits.
 *
 * The position is the difficulty lever: on an open map the solver's min-step
 * distance from (0,0) is exactly ceil(cx/sx)+ceil(cy/sy) where sx/sy are the
 * largest +x/+y steps. We draw a difficulty D in range, split it across the two
 * axes, and convert each axis budget into a coordinate. Walls/hazards are scattered
 * AFTER this and only ever raise the measured difficulty, so the solver re-check
 * (and reject) keeps every accepted disease within [min,max].
 */
function pickCureCell(
  rng: Rng,
  width: number,
  height: number,
  sx: number,
  sy: number,
  diff: { readonly min: number; readonly max: number },
): Vec2 | null {
  // Highest difficulty the grid can physically hold with these step sizes.
  const maxX = width - 1;
  const maxY = height - 1;
  const capX = Math.ceil(maxX / sx);
  const capY = Math.ceil(maxY / sy);
  const cap = capX + capY;
  const lo = Math.max(diff.min, 1);
  const hi = Math.min(diff.max, cap);
  if (hi < lo) return null;

  const D = lo + rng.int(hi - lo + 1);

  // Split D into an x-budget and a y-budget such that each is realizable.
  // x-budget in [max(0, D-capY), min(D, capX)].
  const xLo = Math.max(0, D - capY);
  const xHi = Math.min(D, capX);
  if (xHi < xLo) return null;
  const bx = xLo + rng.int(xHi - xLo + 1);
  const by = D - bx;

  // Convert an axis budget b (number of steps) into a coordinate whose minimal
  // step count is exactly b: any value in ((b-1)*s, b*s], clamped to the grid.
  const coord = (b: number, s: number, maxC: number): number => {
    if (b <= 0) return 0;
    const cellLo = (b - 1) * s + 1; // smallest coord needing b steps
    const cellHi = Math.min(b * s, maxC); // largest coord needing b steps (in grid)
    if (cellHi < cellLo) return -1;
    return cellLo + rng.int(cellHi - cellLo + 1);
  };

  const cx = coord(bx, sx, maxX);
  const cy = coord(by, sy, maxY);
  if (cx < 0 || cy < 0) return null;
  return { x: cx, y: cy };
}

// ───────────────────────────── reference path tracing ─────────────────────────────

/**
 * Mark every cell ENTERED by `t` (on every map) as protected, so later scatter
 * never drops a Wall/Hazard on the reference route. We replay the template over a
 * frozen view of the (still empty) scratch maps with the real drug-graph
 * `applyStep`, recording the swept segment between each pair of rest points.
 * Because the template is axis-aligned from (0,0) and all maps share start/origin,
 * the route is identical on every map; protecting all maps is still correct and
 * cheap on the cold generation path.
 */
function protectReferencePath(scratch: readonly ScratchMap[], t: Template): void {
  const mm: MultiMap = { maps: scratch.map(freezeMap) };
  let s = initialState(mm);
  for (const m of t.steps) {
    const prev = s.pos;
    s = applyStep(mm, s, m);
    const cur = s.pos;
    for (let i = 0; i < scratch.length; i++) {
      const map = scratch[i];
      const a = prev[i];
      const b = cur[i];
      if (map === undefined || a === undefined || b === undefined) continue;
      protectSegment(map, a, b);
    }
  }
}

/** Protect the axis-aligned (or single-cell) segment from a to b inclusive. */
function protectSegment(map: ScratchMap, a: Vec2, b: Vec2): void {
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  // Inclusive walk; bounded by Chebyshev distance.
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  protectCell(map, x, y);
  for (let k = 0; k < steps; k++) {
    x += dx;
    y += dy;
    protectCell(map, x, y);
  }
}

function protectCell(map: ScratchMap, x: number, y: number): void {
  if (inBounds(map, x, y)) map.protectedCells[idx(map.width, x, y)] = 1;
}

// ───────────────────────────── scatter ─────────────────────────────

/**
 * Scatter Walls, Hazards and SideEffect cells at a modest density on non-protected,
 * non-cure, non-start cells. Walls/Hazards never touch a protected cell (would
 * break the reference); SideEffects may sit on any non-cure/non-start cell.
 * Side-effect ids cycle deterministically.
 */
function scatter(rng: Rng, map: ScratchMap, sideEffectBase: number): void {
  const len = map.width * map.height;
  // Densities chosen to keep the level open enough that the solver re-check
  // accepts often, while still adding obstacles/decoration.
  const wallCount = Math.floor(len * 0.06);
  const hazardCount = Math.floor(len * 0.05);
  const sideCount = Math.floor(len * 0.05);

  const placeBlocking = (count: number, kind: number): void => {
    for (let n = 0; n < count; n++) {
      const x = rng.int(map.width);
      const y = rng.int(map.height);
      const i = idx(map.width, x, y);
      if (map.protectedCells[i] === 1) continue;
      if (map.cell[i] !== CellKind.Empty) continue;
      map.cell[i] = kind;
    }
  };

  placeBlocking(wallCount, CellKind.Wall);
  placeBlocking(hazardCount, CellKind.Hazard);

  let nextSide = sideEffectBase;
  for (let n = 0; n < sideCount; n++) {
    const x = rng.int(map.width);
    const y = rng.int(map.height);
    const i = idx(map.width, x, y);
    // SideEffects may overwrite Empty only; never a cure/start/wall/hazard, and
    // never a protected cell on the reference route (keeps the route clean to read).
    if (map.protectedCells[i] === 1) continue;
    if (map.cell[i] !== CellKind.Empty) continue;
    map.cell[i] = CellKind.SideEffect;
    map.sideEffectId[i] = nextSide;
    nextSide += 1;
  }
}

// ───────────────────────────── generation ─────────────────────────────

const MAX_ATTEMPTS = 300;

export const generate: GenerateFn = (opts) => {
  const rng = makeRng(opts.seed);
  const { nMaps, width, height, catalog, diseaseCount, difficulty } = opts;

  const movers = axisMovers(catalog);
  const sx = maxStep(movers, "x");
  const sy = maxStep(movers, "y");
  if (sx <= 0 || sy <= 0) {
    throw new Error(
      `mapgen.generate: catalog has no positive +x/+y translate movers; cannot construct references (seed=${opts.seed})`,
    );
  }

  const start: Vec2 = { x: 0, y: 0 };
  const origin: Vec2 = { x: 0, y: 0 };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. fresh empty maps for this attempt.
    const scratch: ScratchMap[] = [];
    for (let i = 0; i < nMaps; i++) scratch.push(makeScratch(width, height, start, origin));

    // 2. construct a reference + cure cell for every disease (round-robin maps).
    interface Built {
      readonly id: DiseaseId;
      readonly map: MapIndex;
      readonly node: Vec2;
      readonly reference: Template;
    }
    const built: Built[] = [];
    let ok = true;

    for (let d = 0; d < diseaseCount && ok; d++) {
      const mapIndex = d % nMaps;
      const map = scratch[mapIndex];
      if (map === undefined) {
        ok = false;
        break;
      }

      const cell = pickCureCell(rng, width, height, sx, sy, difficulty);
      if (cell === null) {
        ok = false;
        break;
      }
      const i = idx(width, cell.x, cell.y);
      // Never stack two cures on one cell or on the start.
      if ((cell.x === start.x && cell.y === start.y) || map.cell[i] !== CellKind.Empty) {
        ok = false;
        break;
      }

      const reference = buildReference(movers, cell.x, cell.y);
      if (reference === null) {
        ok = false;
        break;
      }

      // Place the cure, protect it, and protect the reference route on all maps.
      map.cell[i] = CellKind.Cure;
      map.cureId[i] = d;
      map.protectedCells[i] = 1;
      built.push({ id: d, map: mapIndex, node: cell, reference });
    }
    if (!ok) continue;

    // Protect every reference route (on every map) BEFORE scattering obstacles.
    for (const b of built) protectReferencePath(scratch, b.reference);

    // 3. scatter non-blocking features off the protected routes.
    let sideBase = 0;
    for (const map of scratch) {
      scatter(rng, map, sideBase);
      sideBase += map.width * map.height; // disjoint id ranges per map (cosmetic)
    }

    // Freeze to a real MultiMap for the drug-graph + solver.
    const mm: MultiMap = { maps: scratch.map(freezeMap) };
    const start0 = initialState(mm);

    // 4. VERIFY INV-9: each reference still cures its disease and never fails.
    let solvable = true;
    for (const b of built) {
      const out = evaluate(mm, start0, b.reference);
      if (out.failed || !out.cured.includes(b.id)) {
        solvable = false;
        break;
      }
    }
    if (!solvable) continue;

    // 5. SCORE each disease with the canonical solver; require all in [min,max].
    const diseases: DiseaseSpec[] = [];
    let inRange = true;
    for (const b of built) {
      // BFS returns the shortest solution; we only need to know whether the true
      // difficulty is ≤ max. Capping at max + 1 keeps the search tractable: any
      // disease that needs more steps simply returns null here and is rejected,
      // and accepted difficulties (all ≤ max) are unaffected.
      const sol = solve(mm, start0, {
        catalog,
        maxDepth: difficulty.max + 1,
        targets: [b.id],
      });
      if (sol === null || sol.difficulty < difficulty.min || sol.difficulty > difficulty.max) {
        inRange = false;
        break;
      }
      diseases.push({
        id: b.id,
        map: b.map,
        node: b.node,
        difficulty: sol.difficulty,
        basePrice: difficultyToBasePrice(sol.difficulty, sol.cost),
        // Canonical reference: the SOLVER's solution, so difficulty/cost/reference agree.
        reference: sol.template,
      });
    }
    if (!inRange) continue;

    return { seed: opts.seed, mm, start: start0, diseases };
  }

  throw new Error(
    `mapgen.generate: no level satisfied difficulty [${difficulty.min},${difficulty.max}] for seed=${opts.seed} within ${MAX_ATTEMPTS} attempts ` +
      `(nMaps=${nMaps}, ${width}x${height}, diseaseCount=${diseaseCount})`,
  );
};
