/**
 * HexaPharma — Phase 0 frozen contract.
 *
 * This file is the SPEC, owned by the architect/integrator. Agents implement
 * pure functions that satisfy these types + the invariants below; they MUST NOT
 * change the public types here without ownership handoff (see docs/module-ownership.md).
 *
 * Hard rules (enforced by eslint on src/sim/**): no Math.random (use rng),
 * no Date.now/performance.now, no render/UI/DOM imports. Discrete quantities are
 * integers.
 *
 * ───────────────────────────── Phase 0 invariants ─────────────────────────────
 * drug-graph:
 *   INV-1  path: machines apply their complete cardinal-unit path independently on
 *          every map. Wall/OOB cancel one delta; Abyss fails; Swamp costs 2 energy.
 *   INV-2  portal: entering a Portal records entry + same-map exit, then continues.
 *   INV-3  every machine always traverses its complete fixed catalog path.
 *   INV-4  evaluate: each map's FINAL position alone determines cure / side-effect;
 *          fully deterministic and reproducible.
 *   INV-5  rearrange-invariance: identical machine sequence + per-unit
 *          processing order ⇒ identical Outcome, regardless of belt layout
 *          (effect depends ONLY on the ordered steps, never on routing).
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

/** Physical square-grid rotation: `rot` × 90° clockwise. */
export type Rotation = 0 | 1 | 2 | 3;

/** A single cardinal, unit-length chemical path delta. */
export type CardinalDelta =
  | { readonly x: -1; readonly y: 0 }
  | { readonly x: 1; readonly y: 0 }
  | { readonly x: 0; readonly y: -1 }
  | { readonly x: 0; readonly y: 1 };

/** A machine's fixed chemical route, applied in array order. */
export type PathStamp = readonly CardinalDelta[];

// ─────────────────────────────── cells / maps ───────────────────────────────

/** Cell feature codes stored in EffectMap.cell (a Uint8Array). */
export const CellKind = {
  Empty: 0,
  Wall: 1,
  Abyss: 2,
  Swamp: 3,
  Portal: 4,
  SideEffect: 5,
  Cure: 6,
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
  /** length width*height; globally unique SideEffectId at SideEffect cells, else -1. */
  readonly sideEffectId: Int32Array;
  /** length width*height; same-map destination index at Portal cells, else -1. */
  readonly portalTo: Int32Array;
  /** length width*height; 0 = fogged/hidden, 1 = revealed. */
  readonly fog: Uint8Array;
}

/** The static geometry of a level: N effect maps (N = 1..4). */
export interface MultiMap {
  readonly maps: readonly EffectMap[];
}

/** Dynamic per-drug state: one position per map + a sticky failure flag. */
export interface DrugState {
  readonly pos: readonly Vec2[]; // length N
  readonly failed: boolean; // true once a path has entered an abyss
}

// ─────────────────────────────── machines / paths ───────────────────────────────

/** A complete fixed chemical path, applied to every map. */
export interface Machine {
  readonly typeId: MachineTypeId;
  readonly path: PathStamp;
}

/** A recipe = an ordered sequence of fixed chemical path steps. */
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

/** Drug state at the start of a level: pos = each map's start, failed = false. */
export type InitialStateFn = (mm: MultiMap) => DrugState;

/** Apply one machine path independently to all maps. INV-1..3. */
export type ApplyStepFn = (mm: MultiMap, s: DrugState, m: Machine) => DrugState;

/** Apply a whole template in order. */
export type ApplyTemplateFn = (mm: MultiMap, start: DrugState, t: Template) => DrugState;

/** Evaluate a template into a cure/side-effect/failure outcome. INV-4, INV-5. */
export type EvaluateFn = (mm: MultiMap, start: DrugState, t: Template) => Outcome;

/** Reveal fog along every entered path cell (research experimentation). Returns a new MultiMap. */
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

/** A machine type's immutable full path and processing attributes. */
export interface MachineCatalogEntry {
  readonly typeId: MachineTypeId;
  readonly path: PathStamp;
  readonly cost: number;
  /** Fixed ticks to process one unit in the factory. */
  readonly speed: number;
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
  readonly nMaps: number; // 1..4
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
 * tests all agree. Paths are fixed chemical routes; physical footprint rotation
 * never rotates these deltas.
 */
function deepFreezeData<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeData(child);
    Object.freeze(value);
  }
  return value;
}

const EAST: CardinalDelta = { x: 1, y: 0 };
const WEST: CardinalDelta = { x: -1, y: 0 };
const NORTH: CardinalDelta = { x: 0, y: -1 };
const SOUTH: CardinalDelta = { x: 0, y: 1 };

export const DEFAULT_CATALOG: readonly MachineCatalogEntry[] = deepFreezeData([
  { typeId: "push", path: [EAST, EAST, SOUTH], cost: 2, speed: 2 },
  {
    typeId: "push2",
    path: [EAST, NORTH, EAST, SOUTH, EAST, SOUTH, EAST],
    cost: 6,
    speed: 7,
  },
  { typeId: "pull", path: [WEST, WEST, NORTH], cost: 2, speed: 3 },
  { typeId: "shear", path: [NORTH, NORTH, EAST, SOUTH], cost: 4, speed: 5 },
  { typeId: "skew", path: [SOUTH, EAST, SOUTH, WEST, SOUTH, EAST], cost: 5, speed: 6 },
  {
    typeId: "dilute",
    path: [EAST, SOUTH, WEST, NORTH, EAST, SOUTH, WEST, NORTH],
    cost: 6,
    speed: 8,
  },
  {
    typeId: "settle",
    path: [SOUTH, SOUTH, EAST, EAST, NORTH, NORTH, NORTH, WEST, WEST],
    cost: 7,
    speed: 9,
  },
]);

// ═══════════════════════════════ Phase 2 — factory (spatial packing + throughput) ═══════════════════════════════
// Tick-based deterministic sim. A "unit" is a drug in transit carrying its multi-map
// DrugState. Machines are MULTI-CELL, MULTI-PORT placed entities (in FactoryLayout.machines,
// NOT tiles); belts / splitters / mergers route units between machine ports → real
// fan-out/fan-in so parallel machines actually raise throughput.
// Invariants: mass conservation, no spawn/vanish, throughput consistency (steady-state
// output = real bottleneck under parallelism), deadlock detection, determinism (INV-15).
//
// EFFECT vs PACKING: a machine's `def.path` determines the DRUG EFFECT; its `footRot`
// only rotates the footprint/ports for spatial packing and NEVER changes the effect.

/** Cardinal direction on the square grid (y-down): 0=E, 1=S, 2=W, 3=N. */
export type Dir = 0 | 1 | 2 | 3;
export const MAX_TEMPLATE_STEPS = 256;
export const MAX_FACTORY_CELLS = 65_536;
export const MAX_FACTORY_MACHINES = 65_536;
export const MAX_MACHINE_SHAPE_CELLS = 256;
export const MAX_MACHINE_PORTS = 256;
export const MAX_FACTORY_PORTS = 262_144;
export const MAX_FACTORY_REPLAY_TICKS = 100_000;
export const MAX_FACTORY_ANALYSIS_WORK = 100_000_000;
export const MAX_GAME_INVENTORY_PRODUCTS = 24_500;
export const MAX_BULK_SALE_PRODUCTS = 100_000;
export const MAX_GAME_FACTORY_CELLS = 4_096;
export const MAX_GAME_FACTORY_DIMENSION = 256;
export const BASE_GAME_FACTORY_WIDTH = 24;
export const BASE_GAME_FACTORY_HEIGHT = 12;
export const MAX_GAME_MAP_CELLS = 4_096;
export const MAX_GAME_MAP_DIMENSION = 64;
export const MAX_GAME_REPLAY_WORK = 100_000_000;
export const MAX_REWIND_HISTORY_REPLAY_TICKS = 12_000;
export const MAX_REWIND_HISTORY_TRACE_ENTRIES = 8_192;
export const MAX_REWIND_HISTORY_REPLAY_WORK = 100_000_000;

/** A machine as placed in the factory: a chemical path + throughput attributes. */
export interface FactoryMachineDef {
  readonly typeId: MachineTypeId;
  readonly path: PathStamp;
  readonly cost: number; // processing cost charged per unit produced
  readonly speed: number; // ticks to process one unit (integer >= 1; larger = slower = bottleneck)
}

/** A port on a machine's LOCAL cell, facing `side` (the side units enter/leave through). */
export interface Port {
  readonly cell: Vec2;
  readonly side: Dir;
}

/** A machine's spatial template in LOCAL coords (anchor at (0,0)), before placement. */
export interface MachineShape {
  readonly cells: readonly Vec2[]; // occupied cells
  readonly inPorts: readonly Port[]; // entry ports
  readonly outPorts: readonly Port[]; // exit ports
}

/**
 * A machine placed on the factory grid. `footRot` rotates the footprint cells + ports
 * about the anchor (0..3 quarter-turns) for spatial packing ONLY; it never rotates
 * the chemical path in `def.path`.
 * Phase 2: one unit in process per machine at a time (capacity 1) — parallelism comes
 * from placing multiple machines fed by a splitter.
 */
export interface PlacedMachine {
  readonly id: number;
  readonly def: FactoryMachineDef;
  readonly anchor: Vec2; // world cell of the shape's local (0,0)
  readonly footRot: Rotation; // packing rotation of the footprint/ports (not the effect)
  readonly shape: MachineShape;
}

/**
 * Belt-grid tiles. Machines are NOT tiles — they live in `FactoryLayout.machines` and
 * occupy cells via their (rotated) footprint. `source` emits a fresh unit every `period`
 * ticks out its `dir` side; `sink` consumes arriving units. A `splitter` routes its one
 * input to its outputs round-robin (deterministic); a `merger` pulls from its inputs by
 * fixed priority (inDirs order). Belts/splitters/mergers/sinks accept from any incoming
 * side they declare; capacity is 1 unit per tile (the belt throughput cap).
 */
export type FactoryTile =
  | { readonly kind: "empty" }
  | { readonly kind: "belt"; readonly dir: Dir }
  | { readonly kind: "splitter"; readonly inDir: Dir; readonly outDirs: readonly Dir[] }
  | { readonly kind: "merger"; readonly inDirs: readonly Dir[]; readonly outDir: Dir }
  | { readonly kind: "source"; readonly dir: Dir; readonly period: number }
  | { readonly kind: "sink" };

export interface FactoryLayout {
  readonly width: number;
  readonly height: number;
  readonly tiles: readonly FactoryTile[]; // length width*height; index = y*width + x
  readonly machines: readonly PlacedMachine[]; // multi-cell machines occupying grid cells
}

/**
 * A drug in transit. On a belt: `machineId = null`, `proc = 0`, `pos` = the belt cell.
 * Inside a machine: `machineId` = that machine's id, `proc` counts up to its `speed`,
 * `pos` = the machine's (world) input-port cell it entered through. On completion the
 * path is applied once and the unit leaves via an output port onto the belt.
 */
export interface Unit {
  readonly id: number;
  readonly pos: Vec2;
  readonly drug: DrugState;
  readonly proc: number;
  readonly machineId: number | null;
  /** Sum of machine processing costs actually incurred by this physical unit. */
  readonly productionCost: number;
}

/** One physical unit that reached a sink. */
export interface ProducedUnit {
  readonly id: number;
  readonly drug: DrugState;
  readonly productionCost: number;
}

/** Fixed-capacity, allocation-free product events written by the most recent tick. */
export interface FactoryProductEventBuffer {
  readonly capacity: number;
  readonly mapCount: number;
  count: number;
  readonly ids: Int32Array;
  readonly productionCosts: Int32Array;
  readonly failed: Uint8Array;
  /** Flat `[eventIndex * mapCount + mapIndex]` positions. */
  readonly drugX: Int32Array;
  readonly drugY: Int32Array;
}

/**
 * Mutable fixed-capacity factory runtime. Every array is allocated by init/restore and
 * reused by every tick. Active units occupy dense slots `[0, unitCount)` in id order.
 */
export interface FactoryRuntime {
  readonly capacity: number;
  readonly mapCount: number;
  readonly unitIds: Int32Array;
  readonly unitX: Int32Array;
  readonly unitY: Int32Array;
  readonly unitProc: Int32Array;
  /** Placed machine id, or -1 while on the belt grid. */
  readonly unitMachineIds: Int32Array;
  readonly unitProductionCosts: Int32Array;
  readonly unitFailed: Uint8Array;
  /** Flat `[unitIndex * mapCount + mapIndex]` positions. */
  readonly unitDrugX: Int32Array;
  readonly unitDrugY: Int32Array;
  /** Next output index for each splitter, in row-major splitter order. */
  readonly splitterCursors: Int32Array;
  readonly producedEvents: FactoryProductEventBuffer;
  tick: number;
  unitCount: number;
  nextUnitId: number;
  /** Cumulative physical units that reached a sink. */
  producedTotal: number;
  deadlocked: boolean;
}

/** Cold, serializable snapshot. Product events cover only the most recent tick. */
export interface FactoryState {
  readonly tick: number;
  readonly units: readonly Unit[];
  readonly nextUnitId: number;
  readonly producedTotal: number;
  /** Cold copy of per-splitter round-robin cursors, in row-major splitter order. */
  readonly splitterCursors: readonly number[];
  readonly producedEvents: readonly ProducedUnit[];
  /** True once the sim detects no unit can make progress and buffers are blocked. */
  readonly deadlocked: boolean;
}

/** Allocate a fixed-capacity runtime at tick 0. This is a cold boundary. */
export type InitFactoryFn = (layout: FactoryLayout, mm: MultiMap, start: DrugState) => FactoryRuntime;

/** Advance the mutable runtime one tick without allocating. */
export type StepFactoryFn = (
  layout: FactoryLayout,
  mm: MultiMap,
  runtime: FactoryRuntime,
) => void;

/** Allocate an immutable/serializable view of the mutable runtime (cold boundary). */
export type SnapshotFactoryFn = (runtime: FactoryRuntime) => FactoryState;

/** Reconstruct a fixed-capacity runtime from a cold snapshot. */
export type RestoreFactoryFn = (
  layout: FactoryLayout,
  mm: MultiMap,
  start: DrugState,
  snapshot: FactoryState,
) => FactoryRuntime;

/** Copy one product event as `[id, cost, failed, x0, y0, ...]` into caller storage. */
export type CopyFactoryProductEventFn = (
  runtime: FactoryRuntime,
  eventIndex: number,
  out: Int32Array,
  outOffset: number,
) => void;

/** Steady-state throughput report (MEASURED by simulating a window — not a heuristic). */
export interface ThroughputReport {
  /** Units produced per tick at steady state (rational: num/den, reduced). */
  readonly rateNum: number;
  readonly rateDen: number;
  /** id of the limiting machine (highest sustained occupancy), or null if none/source-limited. */
  readonly bottleneck: number | null;
  /** typeId of the limiting machine, for display. */
  readonly bottleneckType: MachineTypeId | null;
}

/** Measure steady-state throughput + bottleneck by running the sim a bounded window. */
export type AnalyzeThroughputFn = (layout: FactoryLayout, mm: MultiMap) => ThroughputReport;

// ── state.ts: deterministic whole-sim state + replay (INV-15) ──

/** A recorded input event for replay (factory layout is fixed; events drive the run). */
export interface ReplayInput {
  readonly ticks: number; // advance this many ticks
}

/** Deterministic content hash of a live runtime or cold snapshot (INV-15). */
export type HashFactoryFn = (s: FactoryState | FactoryRuntime) => number;

/** Run `ticks` ticks from init and return the final state — same inputs ⇒ same hash. */
export type ReplayFactoryFn = (
  layout: FactoryLayout,
  mm: MultiMap,
  start: DrugState,
  ticks: number,
) => FactoryState;

// ── recipe: Template ↔ factory line ──

/** Compile a recipe template into a packed, belt-routed source→machines→sink layout. */
export type CompileTemplateFn = (template: Template) => FactoryLayout;

/** Run a layout to completion for one unit and report its cure/side-effect Outcome. */
export type FactoryOutcomeFn = (layout: FactoryLayout, mm: MultiMap, start: DrugState) => Outcome;

// ── shared machine shapes (footprint + ports per machine type) ──

const SH_E: Dir = 0;
const SH_S: Dir = 1;
const SH_W: Dir = 2;

/** 1×1 cell, in on the west side, out on the east side. */
export const SHAPE_1x1: MachineShape = deepFreezeData({
  cells: [{ x: 0, y: 0 }],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 0, y: 0 }, side: SH_E }],
});
/** 2×1 horizontal: in west of left cell, out east of right cell. */
export const SHAPE_2x1: MachineShape = deepFreezeData({
  cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 1, y: 0 }, side: SH_E }],
});
/** L-tromino: in west of (0,0), out south of (1,1). */
export const SHAPE_L: MachineShape = deepFreezeData({
  cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 1, y: 1 }, side: SH_S }],
});
/** 2×2 block: in west of (0,0), out east of (1,0). */
export const SHAPE_2x2: MachineShape = deepFreezeData({
  cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 1, y: 0 }, side: SH_E }],
});

/** Compact three-cell pump body. */
export const SHAPE_PUMP: MachineShape = deepFreezeData({
  cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 1, y: 0 }, side: SH_E }],
});
/** Four-cell return chamber with ports on opposite corners. */
export const SHAPE_RETURN: MachineShape = deepFreezeData({
  cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 1, y: 1 }, side: SH_E }],
});
/** Long-bed reactor: a conspicuous eight-cell throughput bottleneck. */
export const SHAPE_LONG_BED: MachineShape = deepFreezeData({
  cells: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
  ],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 3, y: 1 }, side: SH_E }],
});
/** Five-cell centrifuge with a south-facing discharge. */
export const SHAPE_CENTRIFUGE: MachineShape = deepFreezeData({
  cells: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
    { x: 2, y: 1 }, { x: 2, y: 2 },
  ],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 2, y: 2 }, side: SH_S }],
});
/** Six-cell diagonal reactor whose silhouette exposes its offset effect. */
export const SHAPE_SKEW: MachineShape = deepFreezeData({
  cells: [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
    { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 },
  ],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 3, y: 2 }, side: SH_E }],
});
/** Seven-cell vat; broad rather than long so it packs differently from reactors. */
export const SHAPE_VAT: MachineShape = deepFreezeData({
  cells: [
    { x: 0, y: 0 }, { x: 1, y: 0 },
    { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
    { x: 0, y: 2 }, { x: 1, y: 2 },
  ],
  inPorts: [{ cell: { x: 0, y: 1 }, side: SH_W }],
  outPorts: [{ cell: { x: 2, y: 1 }, side: SH_E }],
});

/** Seven-cell U-settler; the open chamber makes its return path legible in packing. */
export const SHAPE_SETTLER: MachineShape = deepFreezeData({
  cells: [
    { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 },
    { x: 1, y: 2 },
    { x: 2, y: 2 }, { x: 2, y: 1 }, { x: 2, y: 0 },
  ],
  inPorts: [{ cell: { x: 0, y: 0 }, side: SH_W }],
  outPorts: [{ cell: { x: 2, y: 0 }, side: SH_E }],
});

/** Canonical footprint per machine type (each type has a fixed shape, Big-Pharma style). */
export const DEFAULT_SHAPES: Readonly<Record<MachineTypeId, MachineShape>> = deepFreezeData({
  push: SHAPE_PUMP,
  push2: SHAPE_LONG_BED,
  pull: SHAPE_RETURN,
  shear: SHAPE_CENTRIFUGE,
  skew: SHAPE_SKEW,
  dilute: SHAPE_VAT,
  settle: SHAPE_SETTLER,
});

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
  /** Research points earned by selling physical products. */
  readonly research: number;
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
  | { readonly kind: "revealAid"; readonly amount: number };

export interface PatentNode {
  readonly id: string;
  readonly cost: number; // cash to unlock
  readonly researchCost: number;
  readonly requires: readonly string[]; // prerequisite node ids
  readonly effect: PatentEffect;
}

export interface PatentState {
  readonly unlocked: readonly string[]; // node ids, in unlock order
}

export type CanUnlockFn = (
  tree: readonly PatentNode[],
  state: PatentState,
  cash: number,
  research: number,
  id: string,
) => boolean;

/** Unlock a node: returns new PatentState + cash spent (throws/no-ops if not allowed — define). */
export type UnlockPatentFn = (
  tree: readonly PatentNode[],
  state: PatentState,
  cash: number,
  research: number,
  id: string,
) => { patents: PatentState; cash: number; research: number };

// ── top-level game state + save ──

/**
 * Whole-game state. The current level is stored as its seed + GenOptions and
 * regenerated deterministically on load; only mutable typed state such as fog is
 * serialized. One save = one current seed/configuration identity (D12).
 */
export interface InventoryProduct extends ProducedUnit {
  /** Save-global id; factory unit ids restart when a line is reset. */
  readonly inventoryId: number;
  readonly outcome: Outcome;
}

/** Immutable run origin used to verify that a persisted input trace reproduces the save. */
export interface GameOrigin {
  readonly genOptions: GenOptions;
  readonly cash: number;
  readonly research: number;
}

export interface ResearchShot {
  /** Number of programmed machine paths whose effects have already completed. */
  readonly step: number;
  /** The physical drug state after `step` completed effects. */
  readonly drug: DrugState;
  /** Cash charged exactly once when this shot began. */
  readonly cost: number;
}

export interface ResearchFacilityState {
  readonly program: Template;
  readonly shot: ResearchShot | null;
  readonly lastOutcome: Outcome | null;
}

export interface PilotFacilityState {
  readonly layout: FactoryLayout | null;
}

export interface ProductionFacilityState {
  readonly layout: FactoryLayout;
  readonly runtime: FactoryRuntime;
  readonly waste: number;
}

/** Every authoritative whole-game state transition; consecutive factory ticks are normalized. */
export type GameIntent =
  | { readonly kind: "setResearchProgram"; readonly program: Template }
  | { readonly kind: "beginResearchShot" }
  | { readonly kind: "advanceResearchShot" }
  | { readonly kind: "abortResearchShot" }
  | { readonly kind: "setPilotLayout"; readonly layout: FactoryLayout }
  | { readonly kind: "buildProductionLayout"; readonly layout: FactoryLayout }
  | { readonly kind: "productionTicks"; readonly ticks: number }
  | { readonly kind: "resetProduction" }
  | { readonly kind: "sellProduct"; readonly productId: number; readonly disease: number }
  | { readonly kind: "sellProducts"; readonly productIds: readonly number[]; readonly disease: number }
  | { readonly kind: "unlockPatent"; readonly id: string };

export interface GameState {
  readonly origin: GameOrigin;
  readonly intentTrace: readonly GameIntent[];
  /** Cumulative factory ticks represented by `intentTrace`; bounded for save replay validation. */
  readonly replayTicks: number;
  readonly genOptions: GenOptions; // regenerates the current MultiMap + diseases
  readonly economy: EconomyState;
  readonly patents: PatentState;
  readonly research: ResearchFacilityState;
  readonly pilot: PilotFacilityState;
  readonly production: ProductionFacilityState;
  readonly inventory: readonly InventoryProduct[];
  readonly nextInventoryId: number;
  /** Persistent exploration state, one typed array per effect map. */
  readonly fog: readonly Uint8Array[];
  readonly rng: RngState; // for any further seeded draws (e.g. next map)
}

/** Serialize/deserialize a GameState. Round-trip: deserialize(serialize(g)) deep-equals g. */
export type SerializeGameFn = (g: GameState) => string;
export type DeserializeGameFn = (s: string) => GameState;
