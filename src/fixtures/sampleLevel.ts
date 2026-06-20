/**
 * HexaPharma — Phase 1 sample Lab level (hand-built, 2 maps, 9×9).
 *
 * Two effect maps share start (0,0) and origin (0,0). A single translate sequence
 * moves the drug identically on both maps, so each map carries its Cure cell at the
 * SAME coordinate (4,2): pushing east to x=4 then south to y=2 lands the drug on
 * both cures at once, curing disease 0 (map 0) and disease 1 (map 1) together.
 *
 * Every map shows all four non-empty cell features (Wall, Hazard, SideEffect, Cure)
 * plus a Cure, and ships fully fogged — the Lab reveals it via revealAlong.
 *
 * Solvability is proven by src/fixtures/sampleLevel.test.ts (solve() is non-null).
 */
import type {
  EffectMap,
  MultiMap,
  DrugState,
  DiseaseId,
  MachineCatalogEntry,
} from "../sim/phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { initialState } from "../sim/drug-graph";

const W = 9;
const H = 9;

const idx = (x: number, y: number): number => y * W + x;

interface Feature {
  readonly x: number;
  readonly y: number;
  readonly kind: CellKind;
  /** DiseaseId for a Cure cell. */
  readonly cure?: DiseaseId;
  /** SideEffectId for a SideEffect cell. */
  readonly side?: number;
}

/** Build one fully-fogged 9×9 EffectMap from an explicit feature list. */
function buildMap(features: readonly Feature[]): EffectMap {
  const len = W * H;
  const cell = new Uint8Array(len);
  const cureId = new Int16Array(len).fill(-1);
  const sideEffectId = new Int16Array(len).fill(-1);
  for (const f of features) {
    const i = idx(f.x, f.y);
    cell[i] = f.kind;
    if (f.cure !== undefined) cureId[i] = f.cure;
    if (f.side !== undefined) sideEffectId[i] = f.side;
  }
  return {
    width: W,
    height: H,
    origin: { x: 0, y: 0 },
    start: { x: 0, y: 0 },
    cell,
    cureId,
    sideEffectId,
    fog: new Uint8Array(len), // fully fogged
  };
}

// Solution route (kept clear of Wall/Hazard on BOTH maps):
//   (0,0)→(1,0)→(2,0)→(3,0)→(4,0)→(4,1)→(4,2)
// i.e. push east ×4 then push south ×2 (the solver may also use push2 doubles).

// Map 0 — disease 0 cured at (4,2).
const map0 = buildMap([
  { x: 4, y: 2, kind: CellKind.Cure, cure: 0 },
  // Walls
  { x: 6, y: 0, kind: CellKind.Wall },
  { x: 6, y: 1, kind: CellKind.Wall },
  { x: 6, y: 2, kind: CellKind.Wall },
  { x: 2, y: 4, kind: CellKind.Wall },
  { x: 3, y: 4, kind: CellKind.Wall },
  // Hazards
  { x: 1, y: 2, kind: CellKind.Hazard },
  { x: 7, y: 5, kind: CellKind.Hazard },
  { x: 4, y: 6, kind: CellKind.Hazard },
  // Side effects
  { x: 1, y: 4, kind: CellKind.SideEffect, side: 100 },
  { x: 6, y: 4, kind: CellKind.SideEffect, side: 101 },
  { x: 2, y: 6, kind: CellKind.SideEffect, side: 102 },
]);

// Map 1 — disease 1 cured at (4,2).
const map1 = buildMap([
  { x: 4, y: 2, kind: CellKind.Cure, cure: 1 },
  // Walls
  { x: 0, y: 5, kind: CellKind.Wall },
  { x: 1, y: 5, kind: CellKind.Wall },
  { x: 7, y: 7, kind: CellKind.Wall },
  { x: 6, y: 2, kind: CellKind.Wall },
  // Hazards
  { x: 2, y: 2, kind: CellKind.Hazard },
  { x: 5, y: 1, kind: CellKind.Hazard },
  { x: 7, y: 3, kind: CellKind.Hazard },
  // Side effects
  { x: 3, y: 5, kind: CellKind.SideEffect, side: 200 },
  { x: 6, y: 6, kind: CellKind.SideEffect, side: 201 },
  { x: 1, y: 7, kind: CellKind.SideEffect, side: 202 },
]);

export const mm: MultiMap = { maps: [map0, map1] };

export const start: DrugState = initialState(mm);

/** The diseases the player must cure to WIN. */
export const targets: readonly DiseaseId[] = [0, 1];

/** Machine palette for the Lab. */
export const catalog: readonly MachineCatalogEntry[] = DEFAULT_CATALOG;
