import type {
  DrugState,
  FactoryLayout,
  FactoryRuntime,
  FactoryState,
  HashFactoryFn,
  MultiMap,
  ReplayFactoryFn,
} from "./phase0_interfaces";
import { MAX_FACTORY_REPLAY_TICKS } from "./phase0_interfaces";
import { hashInit, hashU32 } from "./hash";
import { initFactory, snapshotFactory, stepFactory } from "./factory-sim";

function hashDrug(h: number, d: DrugState): number {
  let next = hashU32(h, d.pos.length);
  for (let i = 0; i < d.pos.length; i++) {
    const pos = d.pos[i];
    next = hashU32(next, pos?.x ?? 0);
    next = hashU32(next, pos?.y ?? 0);
  }
  return hashU32(next, d.failed ? 1 : 0);
}

function hashRuntime(s: FactoryRuntime): number {
  let h = hashInit();
  h = hashU32(h, s.tick | 0);
  h = hashU32(h, s.unitCount);
  for (let unitIndex = 0; unitIndex < s.unitCount; unitIndex++) {
    h = hashU32(h, s.unitIds[unitIndex] ?? 0);
    h = hashU32(h, s.unitX[unitIndex] ?? 0);
    h = hashU32(h, s.unitY[unitIndex] ?? 0);
    h = hashU32(h, s.unitProc[unitIndex] ?? 0);
    const machineId = s.unitMachineIds[unitIndex] ?? -1;
    h = hashU32(h, machineId < 0 ? 0 : machineId + 1);
    h = hashU32(h, s.unitProductionCosts[unitIndex] ?? 0);
    h = hashU32(h, s.mapCount);
    const base = unitIndex * s.mapCount;
    for (let mapIndex = 0; mapIndex < s.mapCount; mapIndex++) {
      h = hashU32(h, s.unitDrugX[base + mapIndex] ?? 0);
      h = hashU32(h, s.unitDrugY[base + mapIndex] ?? 0);
    }
    h = hashU32(h, s.unitFailed[unitIndex] === 0 ? 0 : 1);
  }

  h = hashU32(h, s.producedEvents.count);
  for (let eventIndex = 0; eventIndex < s.producedEvents.count; eventIndex++) {
    h = hashU32(h, s.producedEvents.ids[eventIndex] ?? 0);
    h = hashU32(h, s.producedEvents.productionCosts[eventIndex] ?? 0);
    h = hashU32(h, s.mapCount);
    const base = eventIndex * s.mapCount;
    for (let mapIndex = 0; mapIndex < s.mapCount; mapIndex++) {
      h = hashU32(h, s.producedEvents.drugX[base + mapIndex] ?? 0);
      h = hashU32(h, s.producedEvents.drugY[base + mapIndex] ?? 0);
    }
    h = hashU32(h, s.producedEvents.failed[eventIndex] === 0 ? 0 : 1);
  }

  h = hashU32(h, s.splitterCursors.length);
  for (let slot = 0; slot < s.splitterCursors.length; slot++) {
    h = hashU32(h, s.splitterCursors[slot] ?? 0);
  }
  h = hashU32(h, s.producedTotal);
  h = hashU32(h, s.deadlocked ? 1 : 0);
  h = hashU32(h, s.nextUnitId);
  return h >>> 0;
}

function hashSnapshot(s: FactoryState): number {
  let h = hashInit();
  h = hashU32(h, s.tick | 0);
  h = hashU32(h, s.units.length);
  for (let i = 0; i < s.units.length; i++) {
    const unit = s.units[i];
    if (unit === undefined) continue;
    h = hashU32(h, unit.id | 0);
    h = hashU32(h, unit.pos.x | 0);
    h = hashU32(h, unit.pos.y | 0);
    h = hashU32(h, unit.proc | 0);
    h = hashU32(h, (unit.machineId === null ? 0 : unit.machineId + 1) | 0);
    h = hashU32(h, unit.productionCost | 0);
    h = hashDrug(h, unit.drug);
  }

  h = hashU32(h, s.producedEvents.length);
  for (let i = 0; i < s.producedEvents.length; i++) {
    const product = s.producedEvents[i];
    if (product === undefined) continue;
    h = hashU32(h, product.id | 0);
    h = hashU32(h, product.productionCost | 0);
    h = hashDrug(h, product.drug);
  }

  h = hashU32(h, s.splitterCursors.length);
  for (let slot = 0; slot < s.splitterCursors.length; slot++) {
    h = hashU32(h, s.splitterCursors[slot] ?? 0);
  }
  h = hashU32(h, s.producedTotal);
  h = hashU32(h, s.deadlocked ? 1 : 0);
  h = hashU32(h, s.nextUnitId | 0);
  return h >>> 0;
}

export const hashFactory: HashFactoryFn = (state) =>
  "unitCount" in state ? hashRuntime(state) : hashSnapshot(state);

export const replayFactory: ReplayFactoryFn = (
  layout: FactoryLayout,
  mm: MultiMap,
  start: DrugState,
  ticks: number,
): FactoryState => {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > MAX_FACTORY_REPLAY_TICKS) {
    throw new Error(
      `factory replay: ticks must be a non-negative safe integer <= ${MAX_FACTORY_REPLAY_TICKS}`,
    );
  }
  const runtime = initFactory(layout, mm, start);
  for (let tick = 0; tick < ticks; tick++) stepFactory(layout, mm, runtime);
  return snapshotFactory(runtime);
};
