/**
 * HexaPharma — Phase 0 frozen contract.
 *
 * This file is the SPEC, owned by the architect/integrator. Agents implement
 * pure functions that satisfy these types + the invariants below; they MUST NOT
 * change the public types here without ownership handoff (see docs/module-ownership.md).
 *
 * Hard rules (enforced by eslint on src/sim/**): no Math.random (use rng),
 * no Date.now/performance.now, no render/UI/DOM imports. Discrete quantities are
 * integers; ratios (scale) are rationals (num/den), never floats.
 *
 * ───────────────────────────── Phase 0 invariants ─────────────────────────────
 * drug-graph:
 *   INV-1  translate: cell-by-cell sweep; stop one cell before a wall; if the path
 *          enters a hazard cell the whole drug fails; otherwise advance to vector end.
 *   INV-2  scale: each map's position is pulled toward that map's origin by the exact
 *          rational num/den (integer arithmetic only — no float drift).
 *   INV-3  swap: exchanges two maps' positions (pure relabel; no sweep, never fails).
 *   INV-4  orient: rotating a vector 4×90° returns the original vector.
 *   INV-5  orient: flipping twice returns the original vector.
 *   INV-6  evaluate: each map's FINAL position alone determines cure / side-effect;
 *          fully deterministic and reproducible.
 *   INV-7  rearrange-invariance: identical machine sequence + orientations + per-unit
 *          processing order ⇒ identical Outcome, regardless of belt layout
 *          (effect depends ONLY on the ordered steps, never on routing).
 *   INV-8  anti-copy: for most templates, synchronously rotating every translate step
 *          by +90° changes the Outcome (a blueprint cannot be blindly rotated/reused).
 * mapgen + solver:
 *   INV-9  constructive solvability: a generated level admits its constructed reference
 *          solution (evaluate(reference) cures the disease, not failed).
 *   INV-10 generation determinism: same seed ⇒ field-equal MultiMap + identical
 *          difficulty + identical base price.
 *   INV-11 difficulty bounds: every disease's difficulty lies within [min, max].
 *   INV-12 pricing consistency: same (difficulty, refCost) ⇒ same base price;
 *          base price is monotonically non-decreasing in difficulty.
 *   INV-13 solver soundness: a non-null Solution, when run through evaluate(), actually
 *          cures the requested targets and never fails.
 * core:
 *   INV-14 rng determinism: same seed ⇒ identical stream; snapshot()/restore() reproduce.
 *   INV-15 replay determinism: same seed + input trace ⇒ identical state hash.
 * ───────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────── identifiers ───────────────────────────────

export type DiseaseId = number;
export type SideEffectId = number;
export type MapIndex = number; // 0 .. N-1
export type MachineTypeId = string;

// ─────────────────────────────── geometry ───────────────────────────────

/** Integer grid coordinate. */
export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Square-grid orientation: `rot` × 90° clockwise, then optional mirror (`flip`). */
export type Rotation = 0 | 1 | 2 | 3;
export interface Orientation {
  readonly rot: Rotation;
  readonly flip: boolean;
}

export const IDENTITY: Orientation = { rot: 0, flip: false };

// ─────────────────────────────── cells / maps ───────────────────────────────

/** Cell feature codes stored in EffectMap.cell (a Uint8Array). */
export const CellKind = {
  Empty: 0,
  Wall: 1,
  Hazard: 2,
  SideEffect: 3,
  Cure: 4,
} as const;
export type CellKind = (typeof CellKind)[keyof typeof CellKind];

/**
 * One effect map = one ingredient/base. Flat arrays indexed by `y * width + x`.
 * Typed arrays keep storage deterministic and pool-friendly.
 */
export interface EffectMap {
  readonly width: number;
  readonly height: number;
  /** Scale-to-origin target for this map. */
  readonly origin: Vec2;
  /** The drug's starting position on this map. */
  readonly start: Vec2;
  /** length width*height; values are CellKind. */
  readonly cell: Uint8Array;
  /** length width*height; DiseaseId at Cure cells, else -1. */
  readonly cureId: Int16Array;
  /** length width*height; SideEffectId at SideEffect cells, else -1. */
  readonly sideEffectId: Int16Array;
  /** length width*height; 0 = fogged/hidden, 1 = revealed. */
  readonly fog: Uint8Array;
}

/** The static geometry of a level: N effect maps (N = 2..4). */
export interface MultiMap {
  readonly maps: readonly EffectMap[];
}

/** Dynamic per-drug state: one position per map + a sticky failure flag. */
export interface DrugState {
  readonly pos: readonly Vec2[]; // length N
  readonly failed: boolean; // true once a sweep has entered a hazard
}

// ─────────────────────────────── machines / transforms ───────────────────────────────

/**
 * How a translate machine's physical orientation maps to its effect direction.
 * Heterogeneous relations are what stop a finished blueprint from being blindly
 * rotated onto a new target (INV-8). The four classes match design D11 (順/逆/垂直/偏移):
 *  - "forward":       effect delta = orient(delta, o)
 *  - "reverse":       effect delta = orient(negate(delta), o)
 *  - "perpendicular": effect delta = orient(perpCW(delta), o)         where perpCW(x,y) = (-y, x)
 *  - "offset":        effect delta = orient(skew(delta), o)           where skew(x,y) = (x - y, x + y)
 *                     (a +45° diagonal skew: an axis delta like (a,0) becomes the diagonal (a,a),
 *                      so offset machines move the drug diagonally — the sweep is supercover.)
 */
export type TranslateRelation = "forward" | "reverse" | "perpendicular" | "offset";

export type Transform =
  | {
      readonly kind: "translate";
      readonly delta: Vec2;
      readonly relation: TranslateRelation;
    }
  | {
      /** Pull every map's position toward its origin by num/den. Requires 0 < num < den. */
      readonly kind: "scale";
      readonly num: number;
      readonly den: number;
    }
  | {
      /** Swap the drug's positions on maps a and b. Requires a !== b and both in range. */
      readonly kind: "swap";
      readonly a: MapIndex;
      readonly b: MapIndex;
    };

/** A machine = an oriented transform applied uniformly to ALL maps in one step. */
export interface Machine {
  readonly typeId: MachineTypeId;
  readonly transform: Transform;
  /** Meaningful only for translate; ignored by scale/swap. */
  readonly orientation: Orientation;
}

/** A recipe = an ordered sequence of machine steps (each carries its own orientation). */
export interface Template {
  readonly steps: readonly Machine[];
}

/** Result of running a template from a start state. */
export interface Outcome {
  readonly failed: boolean;
  readonly final: readonly Vec2[]; // final position per map
  readonly cured: readonly DiseaseId[]; // diseases whose node a final position landed on
  readonly sideEffects: readonly SideEffectId[]; // side-effect ids landed on
}

// ─────────────────────────────── drug-graph API ───────────────────────────────

/** Rotate/mirror a vector about the origin per orientation. INV-4, INV-5. */
export type OrientFn = (v: Vec2, o: Orientation) => Vec2;

/** The effective translation a translate-machine applies, combining relation + orientation. */
export type EffectiveDeltaFn = (
  delta: Vec2,
  relation: TranslateRelation,
  o: Orientation,
) => Vec2;

/** Drug state at the start of a level: pos = each map's start, failed = false. */
export type InitialStateFn = (mm: MultiMap) => DrugState;

/** Apply one machine to all maps with sweep semantics. INV-1, INV-2, INV-3. */
export type ApplyStepFn = (mm: MultiMap, s: DrugState, m: Machine) => DrugState;

/** Apply a whole template in order. */
export type ApplyTemplateFn = (mm: MultiMap, start: DrugState, t: Template) => DrugState;

/** Evaluate a template into a cure/side-effect/failure outcome. INV-6, INV-7. */
export type EvaluateFn = (mm: MultiMap, start: DrugState, t: Template) => Outcome;

/** Reveal fog along every sweep path of a template (lab experimentation). Returns a new MultiMap. */
export type RevealAlongFn = (mm: MultiMap, start: DrugState, t: Template) => MultiMap;

// ─────────────────────────────── rng API ───────────────────────────────

/** Serializable PRNG snapshot. */
export interface RngState {
  readonly s: number;
}

/** The only randomness source in the sim. Deterministic, pure-by-state. INV-14. */
export interface Rng {
  /** Next unsigned 32-bit integer. */
  u32(): number;
  /** Next integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Next float in [0, 1), derived from u32 (never Math.random). */
  float(): number;
  /** Deterministic independent child stream. */
  fork(): Rng;
  /** Snapshot current internal state. */
  snapshot(): RngState;
}

export type MakeRngFn = (seed: number) => Rng;
export type RestoreRngFn = (state: RngState) => Rng;

// ─────────────────────────────── solver API ───────────────────────────────

/** A machine type the solver/mapgen may use, with its processing cost. */
export interface MachineCatalogEntry {
  readonly typeId: MachineTypeId;
  readonly transform: Transform;
  readonly cost: number;
  /** If true (translate only), the search may rotate/flip this machine. */
  readonly orientable: boolean;
}

export interface SolveOptions {
  readonly catalog: readonly MachineCatalogEntry[];
  /** Maximum number of steps to search. */
  readonly maxDepth: number;
  /** Diseases that must all be cured by the returned template. */
  readonly targets: readonly DiseaseId[];
}

export interface Solution {
  readonly template: Template;
  /** Search-derived difficulty score (e.g. min solution length + branching pressure). */
  readonly difficulty: number;
  /** Sum of step costs of the reference solution. */
  readonly cost: number;
}

/** Dev/test-only search. NEVER wire into an in-game auto-solver (D14). INV-13. */
export type SolveFn = (mm: MultiMap, start: DrugState, opts: SolveOptions) => Solution | null;

// ─────────────────────────────── mapgen API ───────────────────────────────

export interface DiseaseSpec {
  readonly id: DiseaseId;
  readonly map: MapIndex;
  readonly node: Vec2;
  readonly difficulty: number;
  readonly basePrice: number;
  /** A constructed/known solution (existence proof — INV-9). */
  readonly reference: Template;
}

export interface GenOptions {
  readonly seed: number;
  readonly nMaps: number; // 2..4
  readonly width: number;
  readonly height: number;
  readonly catalog: readonly MachineCatalogEntry[];
  readonly diseaseCount: number;
  readonly difficulty: { readonly min: number; readonly max: number };
}

export interface GeneratedLevel {
  readonly seed: number;
  readonly mm: MultiMap;
  readonly start: DrugState;
  readonly diseases: readonly DiseaseSpec[];
}

/** Constructive generation + per-disease difficulty scoring + pricing. INV-9..12. */
export type GenerateFn = (opts: GenOptions) => GeneratedLevel;

/** Base price from difficulty (exponential) + reference production cost. INV-12. */
export type DifficultyToBasePriceFn = (difficulty: number, refCost: number) => number;

// ─────────────────────────────── shared data ───────────────────────────────

/**
 * Default Phase 0 machine catalog. Frozen shared data so CLI, solver, mapgen and
 * tests all agree. Orientable translate entries expand to all 4 rotations (+flip)
 * during search, so axis-specific variants are unnecessary.
 */
export const DEFAULT_CATALOG: readonly MachineCatalogEntry[] = [
  { typeId: "push", transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" }, cost: 1, orientable: true },
  { typeId: "push2", transform: { kind: "translate", delta: { x: 2, y: 0 }, relation: "forward" }, cost: 2, orientable: true },
  { typeId: "pull", transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "reverse" }, cost: 1, orientable: true },
  { typeId: "shear", transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "perpendicular" }, cost: 2, orientable: true },
  { typeId: "skew", transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "offset" }, cost: 2, orientable: true },
  { typeId: "dilute", transform: { kind: "scale", num: 1, den: 2 }, cost: 3, orientable: false },
  { typeId: "swap01", transform: { kind: "swap", a: 0, b: 1 }, cost: 1, orientable: false },
];

// ═══════════════════════════════ Phase 2 — factory ═══════════════════════════════
// Tick-based, deterministic belt+machine simulation. A "unit" is a drug in transit
// carrying its multi-map DrugState; machines apply their drug-graph transform to it.
// Invariants: mass conservation, no spawn/vanish, throughput consistency
// (steady-state output rate = bottleneck machine rate), deadlock detection,
// determinism (replay → identical hash, INV-15).

/** Cardinal direction on the square grid (y-down): 0=E, 1=S, 2=W, 3=N. */
export type Dir = 0 | 1 | 2 | 3;

/** A machine as placed in the factory: a drug-transform + throughput attributes. */
export interface FactoryMachineDef {
  readonly typeId: MachineTypeId;
  readonly transform: Transform; // applied to a unit's DrugState when processing completes
  readonly orientation: Orientation; // for translate
  readonly cost: number; // processing cost charged per unit produced
  readonly speed: number; // ticks to process one unit (integer >= 1; larger = slower = bottleneck)
}

/**
 * A factory grid tile. Machines are 1×1 in Phase 2 (footprint/shape comes later).
 * `source` emits one fresh unit (carrying the level's start DrugState) every `period`
 * ticks out of its `dir` side; `sink` consumes arriving units (their final DrugState
 * is recorded as produced output).
 */
export type FactoryTile =
  | { readonly kind: "empty" }
  | { readonly kind: "belt"; readonly dir: Dir }
  | { readonly kind: "source"; readonly dir: Dir; readonly period: number }
  | { readonly kind: "sink" }
  | { readonly kind: "machine"; readonly def: FactoryMachineDef; readonly inDir: Dir; readonly outDir: Dir };

export interface FactoryLayout {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly FactoryTile[]; // length width*height; index = y*width + x
}

/** A drug in transit. `proc` = ticks already spent in the current machine (0 on belts). */
export interface Unit {
  readonly id: number;
  readonly pos: Vec2;
  readonly drug: DrugState;
  readonly proc: number;
}

export interface FactoryState {
  readonly tick: number;
  readonly units: readonly Unit[];
  readonly nextUnitId: number;
  /** Final DrugState of every unit that has reached a sink, in arrival order. */
  readonly produced: readonly DrugState[];
  /** True once the sim detects no unit can make progress and buffers are blocked. */
  readonly deadlocked: boolean;
}

/** Build the initial factory state (tick 0, no units) for a layout + level. */
export type InitFactoryFn = (layout: FactoryLayout, mm: MultiMap, start: DrugState) => FactoryState;

/** Advance the factory one tick: deterministic, pure (returns a new state). */
export type StepFactoryFn = (layout: FactoryLayout, mm: MultiMap, s: FactoryState) => FactoryState;

/** Steady-state throughput report. */
export interface ThroughputReport {
  /** Units produced per tick at steady state (rational: num/den). */
  readonly rateNum: number;
  readonly rateDen: number;
  /** typeId of the limiting (slowest effective) machine stage, or null if none. */
  readonly bottleneck: MachineTypeId | null;
}

export type AnalyzeThroughputFn = (layout: FactoryLayout) => ThroughputReport;

// ── state.ts: deterministic whole-sim state + replay (INV-15) ──

/** A recorded input event for replay (factory layout is fixed; events drive the run). */
export interface ReplayInput {
  readonly ticks: number; // advance this many ticks
}

/** Deterministic content hash of a FactoryState (for replay equality, INV-15). */
export type HashFactoryFn = (s: FactoryState) => number;

/** Run `ticks` ticks from init and return the final state — same inputs ⇒ same hash. */
export type ReplayFactoryFn = (
  layout: FactoryLayout,
  mm: MultiMap,
  start: DrugState,
  ticks: number,
) => FactoryState;

// ── recipe: Template ↔ factory line ──

/** Compile a recipe template into a straight source→machines→sink line. */
export type CompileTemplateFn = (template: Template) => FactoryLayout;

/** Run a layout to completion for one unit and report its cure/side-effect Outcome. */
export type FactoryOutcomeFn = (layout: FactoryLayout, mm: MultiMap, start: DrugState) => Outcome;

// ═══════════════════════════════ Phase 3 — economy / patent / save ═══════════════════════════════

// ── economy ──
// Anti-degeneracy: per-disease revenue DIMINISHES with prior sales (so spamming
// one drug self-limits), while different diseases sell independently (parallel
// demand rewards diversifying). All integer/deterministic.

/** Cumulative units sold for one disease (drives diminishing returns). */
export interface SoldCount {
  readonly disease: DiseaseId;
  readonly count: number;
}

export interface EconomyState {
  readonly cash: number;
  readonly sold: readonly SoldCount[]; // per-disease cumulative sales (deterministic order)
}

/** Net for selling ONE produced unit that cures `disease`. */
export interface SaleResult {
  readonly econ: EconomyState;
  readonly revenue: number; // gross paid for this unit (after per-disease diminishing)
  readonly net: number; // revenue − productionCost − sideEffectPenalty
}

/**
 * Sell one produced unit. Gross revenue for the Nth unit of a disease is
 * basePrice scaled by a diminishing factor in N (monotonically non-increasing,
 * with a floor); net subtracts productionCost + sideEffectPenalty. Updates cash + sold.
 * A failed/uncured unit earns nothing (caller passes a valid cure).
 */
export type SellUnitFn = (
  econ: EconomyState,
  disease: DiseaseId,
  basePrice: number,
  productionCost: number,
  sideEffectPenalty: number,
) => SaleResult;

/** Gross price the next (count-th) unit of a disease would fetch — for UI/preview. */
export type NextUnitPriceFn = (basePrice: number, alreadySold: number) => number;

// ── patent (talent tree) ──

export type PatentEffect =
  | { readonly kind: "unlockMachine"; readonly typeId: MachineTypeId }
  | { readonly kind: "expandFactory"; readonly dw: number; readonly dh: number }
  | { readonly kind: "revealAid"; readonly amount: number }
  | { readonly kind: "unlockMap" }; // unlock a new ingredient map (go deeper)

export interface PatentNode {
  readonly id: string;
  readonly cost: number; // cash to unlock
  readonly requires: readonly string[]; // prerequisite node ids
  readonly effect: PatentEffect;
}

export interface PatentState {
  readonly unlocked: readonly string[]; // node ids, in unlock order
}

export type CanUnlockFn = (tree: readonly PatentNode[], state: PatentState, cash: number, id: string) => boolean;

/** Unlock a node: returns new PatentState + cash spent (throws/no-ops if not allowed — define). */
export type UnlockPatentFn = (
  tree: readonly PatentNode[],
  state: PatentState,
  cash: number,
  id: string,
) => { patents: PatentState; cash: number };

// ── top-level game state + save ──

/**
 * Whole-game state. The current level is stored as its seed + GenOptions and
 * regenerated deterministically on load (mapgen is seed-pure), so save never has
 * to serialize typed arrays. One save = one seed (D12).
 */
export interface GameState {
  readonly genOptions: GenOptions; // regenerates the current MultiMap + diseases
  readonly economy: EconomyState;
  readonly patents: PatentState;
  readonly factory: FactoryLayout; // current production line
  readonly rng: RngState; // for any further seeded draws (e.g. next map)
}

/** Serialize/deserialize a GameState. Round-trip: deserialize(serialize(g)) deep-equals g. */
export type SerializeGameFn = (g: GameState) => string;
export type DeserializeGameFn = (s: string) => GameState;
