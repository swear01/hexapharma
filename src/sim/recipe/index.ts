import type {
  Dir,
  DrugState,
  DiseaseId,
  SideEffectId,
  MultiMap,
  Outcome,
  FactoryTile,
  FactoryLayout,
  FactoryMachineDef,
  CompileTemplateFn,
  FactoryOutcomeFn,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
import { replayFactory } from "../state";

// ════════════════════════════════ recipe ════════════════════════════════
//
// compileTemplate lays a Template as a single straight horizontal line on row 0:
//
//   source(E) , machine_0 , machine_1 , ... , machine_{k-1} , sink
//
// The source emits every tick (period 1) eastward; each machine takes its in
// from the west and sends its out to the east, so a unit flows strictly
// left→right and traverses the machines in template order before the sink.
// Machines sit back-to-back (no belt tiles) — this is one valid layout; the
// rearrange-invariance tests prove that inserting belts or routing detours that
// preserve machine order never changes the effect (INV-7 at the factory level).
//
// factoryOutcome runs the compiled layout via replayFactory until one unit
// reaches the sink (bounded tick cap), then reads that unit's final DrugState
// against the maps to produce the cure/side-effect/failure Outcome.

const E: Dir = 0;
const W: Dir = 2;

function catalogCost(typeId: string): number {
  for (const entry of DEFAULT_CATALOG) {
    if (entry.typeId === typeId) return entry.cost;
  }
  return 0;
}

export const compileTemplate: CompileTemplateFn = (template) => {
  const k = template.steps.length;
  // source + k machines + sink, all on one row.
  const width = k + 2;
  const tiles: FactoryTile[] = new Array<FactoryTile>(width);

  tiles[0] = { kind: "source", dir: E, period: 1 };

  for (let i = 0; i < k; i++) {
    const step = template.steps[i];
    if (step === undefined) {
      tiles[i + 1] = { kind: "empty" };
      continue;
    }
    const def: FactoryMachineDef = {
      typeId: step.typeId,
      transform: step.transform,
      orientation: step.orientation,
      cost: catalogCost(step.typeId),
      speed: 1,
    };
    tiles[i + 1] = { kind: "machine", def, inDir: W, outDir: E };
  }

  tiles[width - 1] = { kind: "sink" };

  return { width, height: 1, tiles };
};

/** Read a final DrugState against the maps into an Outcome (mirrors drug-graph.evaluate). */
function outcomeOf(mm: MultiMap, drug: DrugState): Outcome {
  const finalPos = drug.pos;
  if (drug.failed) {
    return { failed: true, final: finalPos, cured: [], sideEffects: [] };
  }

  const cured: DiseaseId[] = [];
  const sideEffects: SideEffectId[] = [];
  for (let i = 0; i < mm.maps.length; i++) {
    const map = mm.maps[i];
    const p = finalPos[i];
    if (map === undefined || p === undefined) continue;
    const idx = p.y * map.width + p.x;
    const kind = map.cell[idx];
    if (kind === CellKind.Cure) {
      const id = map.cureId[idx];
      if (id !== undefined && id >= 0) cured.push(id);
    } else if (kind === CellKind.SideEffect) {
      const id = map.sideEffectId[idx];
      if (id !== undefined && id >= 0) sideEffects.push(id);
    }
  }

  return { failed: false, final: finalPos, cured, sideEffects };
}

/**
 * Bounded tick budget: every machine has speed 1, the line is `width` tiles, and
 * the source emits every tick, so the first unit reaches the sink in O(width)
 * ticks. We pad generously to absorb any belt detours in non-compiled layouts.
 */
function tickCap(layout: FactoryLayout): number {
  return (layout.width + layout.height) * 4 + 8;
}

export const factoryOutcome: FactoryOutcomeFn = (layout, mm, start) => {
  const cap = tickCap(layout);
  const final = replayFactory(layout, mm, start, cap);
  const produced = final.produced;
  const first = produced[0];
  if (first === undefined) {
    // No unit reached the sink within the cap (a compiled line always produces).
    return { failed: true, final: [], cured: [], sideEffects: [] };
  }
  return outcomeOf(mm, first);
};
