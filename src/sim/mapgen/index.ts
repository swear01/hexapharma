/**
 * HexaPharma — mapgen.
 *
 * Constructive level generation with genuine CROSS-MAP TENSION + per-disease
 * difficulty scoring + pricing. Satisfies INV-9 (constructive solvability),
 * INV-10 (generation determinism), INV-11 (difficulty bounds), INV-12 (pricing
 * consistency) and the NEW cross-map tension invariant: every accepted level has
 * at least one disease whose canonical solver solution must DECOUPLE the maps.
 *
 * All randomness flows from `makeRng(opts.seed)` — no Math.random / Date.now.
 *
 * Tension construction (construct-then-verify):
 *   1. Each map gets a DISTINCT origin. Distinct origins are what make decoupling
 *      possible at all: the drug starts at the same cell on every map, so a forward
 *      / reverse / perpendicular / offset translate moves every map's position
 *      IDENTICALLY — positions can only ever diverge through a `scale` (each map
 *      pulled toward ITS OWN origin) or a `swap` (after a wall has already split
 *      them). With one shared origin the two positions stay equal forever and no
 *      decoupling solution can exist.
 *   2. For every disease's cure cell (cx,cy) on its map A, a HAZARD is dropped at
 *      the SAME coordinate (cx,cy) on every OTHER map — the cell where a naive
 *      forward push (which moves all maps in lock-step) would land the drug while
 *      it chases map A's cure. The naive lock-step approach therefore spoils the
 *      drug on the other map; the only way to cure is to decouple (a `scale` /
 *      `swap` / non-forward translate) so the other map's position is elsewhere.
 *   3. We VERIFY with the solver oracle: the level is solvable for every disease,
 *      every difficulty lands in [min,max], INV-9 holds (the solver template, run
 *      through `evaluate`, cures and never fails), and the TENSION PREDICATE holds
 *      (≥1 disease's canonical solution contains a decoupling step). Otherwise the
 *      attempt is rejected; generation is a bounded, deterministic reject loop.
 *
 * `DiseaseSpec.difficulty`/`cost`/`reference` all come from the solver's canonical
 * solution, so they agree by construction.
 */
import type {
  Vec2,
  EffectMap,
  MultiMap,
  Orientation,
  Rotation,
  MachineCatalogEntry,
  DiseaseSpec,
  GenerateFn,
  DifficultyToBasePriceFn,
  MapIndex,
  DiseaseId,
  Solution,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { effectiveDelta, evaluate, initialState } from "../drug-graph";
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
  readonly delta: Vec2; // effective delta (axis-aligned, positive component)
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
  /** Cells that must never be overwritten (start, cures, tension hazards). */
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

// ───────────────────────────── catalog inspection ─────────────────────────────

/**
 * Enumerate the catalog's translate machines as concrete axis-aligned movers with
 * a strictly-positive single component (pure +x or +y motion), deduped by effective
 * delta. The generator only needs to know that SOME forward motion exists (so the
 * cure is reachable and the difficulty lever has range); a catalog with no such
 * mover cannot host an axis-grid level and is rejected up front.
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
      const positiveX = eff.x > 0 && eff.y === 0;
      const positiveY = eff.y > 0 && eff.x === 0;
      if (!positiveX && !positiveY) continue;
      const key = `${eff.x},${eff.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ delta: eff });
    }
  }
  return out;
}

/** Largest positive step available on an axis (0 if none). */
function maxStep(movers: readonly AxisMover[], axis: "x" | "y"): number {
  let best = 0;
  for (const mv of movers) {
    const v = axis === "x" ? (mv.delta.y === 0 ? mv.delta.x : 0) : mv.delta.x === 0 ? mv.delta.y : 0;
    if (v > best) best = v;
  }
  return best;
}

// ───────────────────────────── origins ─────────────────────────────

/**
 * Distinct per-map origins — the lever that makes decoupling possible (a `scale`
 * pulls each map toward a DIFFERENT origin, so positions diverge). The drug always
 * starts at (0,0); origins walk the OTHER three corners so map 0 (origin (0,0)) and
 * every other map disagree. With more maps than corners the pattern repeats on the
 * interior, which still keeps neighbouring origins distinct enough to decouple.
 */
function originFor(mapIndex: MapIndex, width: number, height: number): Vec2 {
  const corners: readonly Vec2[] = [
    { x: 0, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
  ];
  const c = corners[mapIndex % corners.length];
  return c ?? { x: 0, y: 0 };
}

// ───────────────────────────── cure-cell selection ─────────────────────────────

/**
 * Pick an interior cure cell. The cell's distance from the start sets the base
 * step count; the tension hazard + decoupling requirement add the rest. We keep
 * the cell strictly interior (never the start, never a border-degenerate cell) and
 * far enough from the start that the minimal solution needs at least a couple of
 * steps. The solver is the final difficulty arbiter — out-of-band picks are simply
 * rejected by the bounded loop, so this only has to be a sensible, in-range guess.
 */
function pickCureCell(
  rng: Rng,
  width: number,
  height: number,
  sx: number,
  sy: number,
): Vec2 {
  // Stay inside [1, dim-1) and at least one full +x/+y step from the start so the
  // forward-only endpoint (cx,cy) is a real, distinct cell to trap on the other map.
  const loX = Math.min(sx, width - 2);
  const loY = Math.min(sy, height - 2);
  const x = loX + rng.int(Math.max(1, width - 1 - loX));
  const y = loY + rng.int(Math.max(1, height - 1 - loY));
  return { x, y };
}

// ───────────────────────────── scatter ─────────────────────────────

/**
 * Scatter Walls, Hazards and SideEffect cells at a modest density on non-protected,
 * Empty cells. Densities are deliberately light: the level must stay solvable for
 * the solver re-check (the tension hazards already supply the core obstacle), and
 * an over-dense map just wastes attempts. Side-effect ids cycle deterministically.
 */
function scatter(rng: Rng, map: ScratchMap, sideEffectBase: number): void {
  const len = map.width * map.height;
  const wallCount = Math.floor(len * 0.04);
  const hazardCount = Math.floor(len * 0.03);
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
    if (map.protectedCells[i] === 1) continue;
    if (map.cell[i] !== CellKind.Empty) continue;
    map.cell[i] = CellKind.SideEffect;
    map.sideEffectId[i] = nextSide;
    nextSide += 1;
  }
}

// ───────────────────────────── tension predicate ─────────────────────────────

/**
 * A "decoupling step" is a move that can make the maps' positions diverge: a swap,
 * a scale, or a translate whose relation is reverse / perpendicular / offset. A
 * forward-only lock-step solution contains NONE of these — so a solution that does
 * contain one had to break the maps apart, which is exactly the cross-map tension
 * we require. (This mirrors the solver's own `decouplingBonus` classification.)
 */
function solutionDecouples(sol: Solution): boolean {
  return sol.template.steps.some((m) => {
    const t = m.transform;
    if (t.kind === "swap" || t.kind === "scale") return true;
    return (
      t.kind === "translate" &&
      (t.relation === "reverse" || t.relation === "perpendicular" || t.relation === "offset")
    );
  });
}

// ───────────────────────────── generation ─────────────────────────────

const MAX_ATTEMPTS = 400;

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

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // 1. fresh empty maps for this attempt, each with its DISTINCT origin.
    const scratch: ScratchMap[] = [];
    for (let i = 0; i < nMaps; i++) {
      scratch.push(makeScratch(width, height, start, originFor(i, width, height)));
    }

    // 2. place one cure per disease (round-robin maps); protect each cure cell.
    interface Built {
      readonly id: DiseaseId;
      readonly map: MapIndex;
      readonly node: Vec2;
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

      const cell = pickCureCell(rng, width, height, sx, sy);
      const i = idx(width, cell.x, cell.y);
      // Never stack two cures on one cell or on the start.
      if ((cell.x === start.x && cell.y === start.y) || map.cell[i] !== CellKind.Empty) {
        ok = false;
        break;
      }

      map.cell[i] = CellKind.Cure;
      map.cureId[i] = d;
      map.protectedCells[i] = 1;
      built.push({ id: d, map: mapIndex, node: cell });
    }
    if (!ok) continue;

    // 3. CROSS-MAP TENSION: trap the naive lock-step endpoint of each cure on every
    //    OTHER map. A forward push toward map A's cure moves every map to (cx,cy);
    //    the hazard there spoils the drug unless the solution decouples the maps.
    for (const b of built) {
      const i = idx(width, b.node.x, b.node.y);
      for (let mi = 0; mi < nMaps; mi++) {
        if (mi === b.map) continue;
        const other = scratch[mi];
        if (other === undefined) continue;
        if (other.protectedCells[i] === 1) continue; // never a start/cure/existing trap
        if (other.cell[i] !== CellKind.Empty) continue;
        other.cell[i] = CellKind.Hazard;
        other.protectedCells[i] = 1;
      }
    }

    // 4. scatter light non-protected features.
    let sideBase = 0;
    for (const map of scratch) {
      scatter(rng, map, sideBase);
      sideBase += map.width * map.height; // disjoint id ranges per map (cosmetic)
    }

    // Freeze to a real MultiMap for the drug-graph + solver.
    const mm: MultiMap = { maps: scratch.map(freezeMap) };
    const start0 = initialState(mm);

    // 5. SCORE + VERIFY each disease with the canonical solver.
    const diseases: DiseaseSpec[] = [];
    let good = true;
    let decouplingCount = 0;
    for (const b of built) {
      // Cap the search just past `max`: any disease needing more steps returns null
      // and is rejected, keeping the (W·H)^N BFS tractable; in-band diseases are
      // unaffected. (+2 headroom so a difficulty of exactly `max` is still found,
      // since difficulty can exceed step count via diversity/decoupling bonuses.)
      const sol = solve(mm, start0, {
        catalog,
        maxDepth: difficulty.max + 2,
        targets: [b.id],
      });
      if (sol === null || sol.difficulty < difficulty.min || sol.difficulty > difficulty.max) {
        good = false;
        break;
      }
      // INV-9: the canonical solution actually cures the disease and never fails.
      const out = evaluate(mm, start0, sol.template);
      if (out.failed || !out.cured.includes(b.id)) {
        good = false;
        break;
      }
      if (solutionDecouples(sol)) decouplingCount += 1;
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
    if (!good) continue;

    // 6. TENSION PREDICATE: at least one disease's canonical solution must decouple.
    if (decouplingCount < 1) continue;

    return { seed: opts.seed, mm, start: start0, diseases };
  }

  throw new Error(
    `mapgen.generate: no level satisfied difficulty [${difficulty.min},${difficulty.max}] ` +
      `with cross-map tension (≥1 decoupling disease) for seed=${opts.seed} within ${MAX_ATTEMPTS} attempts ` +
      `(nMaps=${nMaps}, ${width}x${height}, diseaseCount=${diseaseCount})`,
  );
};
