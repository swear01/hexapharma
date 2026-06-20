import type {
  MultiMap,
  DrugState,
  FactoryLayout,
  FactoryState,
  HashFactoryFn,
  ReplayFactoryFn,
} from "./phase0_interfaces";
import { hashInit, hashU32 } from "./hash";
import { initFactory, stepFactory } from "./factory-sim";

// Deterministic whole-sim state + replay (INV-15).
//
// hashFactory folds the entire observable FactoryState into a 32-bit FNV-1a hash:
// tick, then every unit (id, pos, each map position + failed flag, proc, machineId),
// then the produced drugs (positions + failed), then deadlocked + nextUnitId.
// Iteration follows the state's own (deterministic, id-sorted) ordering, so two equal
// runs hash equal. machineId is folded as machineId+1 so null (-> 0) is distinct from id 0.

/** Fold a DrugState (every map's pos + the failed flag) into the running hash. */
function hashDrug(h: number, d: DrugState): number {
  let x = hashU32(h, d.pos.length);
  for (const p of d.pos) {
    x = hashU32(x, p.x | 0);
    x = hashU32(x, p.y | 0);
  }
  return hashU32(x, d.failed ? 1 : 0);
}

export const hashFactory: HashFactoryFn = (s) => {
  let h = hashInit();
  h = hashU32(h, s.tick | 0);

  h = hashU32(h, s.units.length);
  for (const u of s.units) {
    h = hashU32(h, u.id | 0);
    h = hashU32(h, u.pos.x | 0);
    h = hashU32(h, u.pos.y | 0);
    h = hashU32(h, u.proc | 0);
    h = hashU32(h, (u.machineId === null ? 0 : u.machineId + 1) | 0);
    h = hashDrug(h, u.drug);
  }

  h = hashU32(h, s.produced.length);
  for (const d of s.produced) h = hashDrug(h, d);

  h = hashU32(h, s.deadlocked ? 1 : 0);
  h = hashU32(h, s.nextUnitId | 0);

  return h >>> 0;
};

export const replayFactory: ReplayFactoryFn = (
  layout: FactoryLayout,
  mm: MultiMap,
  start: DrugState,
  ticks: number,
): FactoryState => {
  let s = initFactory(layout, mm, start);
  for (let i = 0; i < ticks; i++) {
    s = stepFactory(layout, mm, s);
  }
  return s;
};
