import type {
  Dir,
  Rotation,
  DrugState,
  DiseaseId,
  SideEffectId,
  MultiMap,
  Outcome,
  FactoryTile,
  FactoryLayout,
  PlacedMachine,
  FactoryMachineDef,
  CompileTemplateFn,
  FactoryOutcomeFn,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG, SHAPE_1x1 } from "../phase0_interfaces";
import { replayFactory } from "../state";

// ════════════════════════════════ recipe ════════════════════════════════
//
// compileTemplate lays a Template as a straight 1×1-machine line on row 0:
//
//   source , belt , m0 , belt , m1 , belt , ... , m_{k-1} , belt , sink
//
// Each machine is a 1×1 PlacedMachine (in `machines[]`; its cell is an "empty"
// tile) taking input from the west belt and emitting east. This is the recipe's
// canonical *logical* realization — guaranteed valid + simple. The real shaped
// (Tetris) packing is the player's job in the Factory UI; rearrange-invariance
// (INV-7) means belt routing / spacing never changes the effect — only machine
// order + each machine's drug orientation do.
//
// factoryOutcome runs the layout via replayFactory until a unit reaches the sink,
// then reads its final DrugState into a cure/side-effect/failure Outcome.

const E: Dir = 0;

function catalogCost(typeId: string): number {
  for (const entry of DEFAULT_CATALOG) {
    if (entry.typeId === typeId) return entry.cost;
  }
  return 0;
}

export const compileTemplate: CompileTemplateFn = (template) => {
  const k = template.steps.length;
  // width = source + (belt, machine)*k + belt + sink = 2k + 3.
  const width = 2 * k + 3;
  const tiles: FactoryTile[] = new Array<FactoryTile>(width).fill({ kind: "empty" });
  const machines: PlacedMachine[] = [];

  tiles[0] = { kind: "source", dir: E, period: 1 };
  for (let i = 0; i < k; i++) {
    const beltX = 1 + 2 * i;
    const machX = 2 + 2 * i;
    tiles[beltX] = { kind: "belt", dir: E };
    tiles[machX] = { kind: "empty" }; // machine cell (machine lives in machines[])
    const step = template.steps[i];
    if (step !== undefined) {
      const def: FactoryMachineDef = {
        typeId: step.typeId,
        transform: step.transform,
        orientation: step.orientation,
        cost: catalogCost(step.typeId),
        speed: 1,
      };
      machines.push({
        id: i,
        def,
        anchor: { x: machX, y: 0 },
        footRot: 0 as Rotation,
        shape: SHAPE_1x1,
      });
    }
  }
  tiles[width - 2] = { kind: "belt", dir: E };
  tiles[width - 1] = { kind: "sink" };

  return { width, height: 1, tiles, machines };
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

/** Generous bounded tick budget: speed-1 machines on a width-O(k) line produce in O(width) ticks. */
function tickCap(layout: FactoryLayout): number {
  return (layout.width + layout.height) * 6 + 16;
}

export const factoryOutcome: FactoryOutcomeFn = (layout, mm, start) => {
  const final = replayFactory(layout, mm, start, tickCap(layout));
  const first = final.produced[0];
  if (first === undefined) {
    return { failed: true, final: [], cured: [], sideEffects: [] };
  }
  return outcomeOf(mm, first);
};
