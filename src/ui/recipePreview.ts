import type { DrugState, EffectMap, Machine, MultiMap, Vec2 } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";
import { previewStep } from "../sim/drug-graph";

export type RecipeTrailPoint = Readonly<Vec2> | null;

export interface RecipePreview {
  readonly frames: readonly DrugState[];
  readonly trails: readonly (readonly RecipeTrailPoint[])[];
  /** Zero-based index of the first step that failed, or null when every step stayed valid. */
  readonly failedStep: number | null;
  readonly final: DrugState;
}

export interface FogSafeRecipePreview extends RecipePreview {
  /** First step whose public result depends on at least one unknown cell. */
  readonly uncertainStep: number | null;
}

function ownPoint(point: Vec2): Readonly<Vec2> {
  return Object.freeze({ x: point.x, y: point.y });
}

function ownState(state: DrugState): DrugState {
  return Object.freeze({
    pos: Object.freeze(state.pos.map(ownPoint)),
    failed: state.failed,
  });
}

export function buildRecipePreview(
  mm: MultiMap,
  start: DrugState,
  steps: readonly Machine[],
): RecipePreview {
  let current = ownState(start);
  const frames: DrugState[] = [current];
  const trails: RecipeTrailPoint[][] = Array.from({ length: mm.maps.length }, (_, mapIndex) => {
    const point = current.pos[mapIndex];
    return point === undefined ? [] : [ownPoint(point)];
  });
  let failedStep: number | null = null;

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const machine = steps[stepIndex];
    if (machine === undefined) continue;
    const wasFailed = current.failed;
    const preview = previewStep(mm, current, machine);
    const next = ownState(preview.next);

    if (!wasFailed) {
      if (machine.transform.kind === "swap") {
        for (let mapIndex = 0; mapIndex < trails.length; mapIndex++) {
          const point = next.pos[mapIndex];
          if (point === undefined) continue;
          trails[mapIndex]!.push(null, ownPoint(point));
        }
      } else {
        for (let mapIndex = 0; mapIndex < trails.length; mapIndex++) {
          const entered = preview.trails[mapIndex];
          if (entered === undefined) continue;
          for (const point of entered) trails[mapIndex]!.push(ownPoint(point));
        }
      }
    }
    if (failedStep === null && !wasFailed && next.failed) failedStep = stepIndex;
    current = next;
    frames.push(current);
  }

  const immutableFrames = Object.freeze(frames);
  const immutableTrails = Object.freeze(
    trails.map((trail) => Object.freeze(trail)),
  );
  return Object.freeze({
    frames: immutableFrames,
    trails: immutableTrails,
    failedStep,
    final: immutableFrames[immutableFrames.length - 1]!,
  });
}

export function maskRecipeTrailForFog(
  map: EffectMap,
  trail: readonly RecipeTrailPoint[],
): readonly RecipeTrailPoint[] {
  return Object.freeze(trail.map((point): RecipeTrailPoint => {
    if (point === null) return null;
    if (point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height) {
      return null;
    }
    return map.fog[point.y * map.width + point.x] === 1 ? ownPoint(point) : null;
  }));
}

function fogSafeMap(mm: MultiMap): MultiMap {
  return {
    maps: mm.maps.map((map): EffectMap => {
      const cell = Uint8Array.from(map.cell);
      for (let index = 0; index < cell.length; index++) {
        if (map.fog[index] !== 1) cell[index] = CellKind.Empty;
      }
      return { ...map, cell };
    }),
  };
}

function isKnown(map: EffectMap, point: Vec2): boolean {
  if (point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height) return false;
  return map.fog[point.y * map.width + point.x] === 1;
}

export function buildFogSafeRecipePreview(
  mm: MultiMap,
  start: DrugState,
  steps: readonly Machine[],
): FogSafeRecipePreview {
  const safeMap = fogSafeMap(mm);
  let current = ownState(start);
  const frames: DrugState[] = [current];
  const trails: RecipeTrailPoint[][] = Array.from({ length: mm.maps.length }, (_, mapIndex) => {
    const point = current.pos[mapIndex];
    const map = mm.maps[mapIndex];
    return point === undefined || map === undefined || !isKnown(map, point) ? [] : [ownPoint(point)];
  });
  let failedStep: number | null = null;
  let uncertainStep: number | null = null;

  for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
    const machine = steps[stepIndex];
    if (machine === undefined) continue;
    const wasFailed = current.failed;
    const preview = previewStep(safeMap, current, machine);
    let uncertain = false;

    if (!wasFailed && machine.transform.kind === "swap") {
      for (let mapIndex = 0; mapIndex < trails.length; mapIndex++) {
        const map = mm.maps[mapIndex];
        const point = preview.next.pos[mapIndex];
        if (map === undefined || point === undefined || !isKnown(map, point)) {
          uncertain = true;
          continue;
        }
        trails[mapIndex]!.push(null, ownPoint(point));
      }
    } else if (!wasFailed) {
      for (let mapIndex = 0; mapIndex < trails.length; mapIndex++) {
        const map = mm.maps[mapIndex];
        const entered = preview.trails[mapIndex];
        if (map === undefined || entered === undefined) continue;
        for (const point of entered) {
          if (!isKnown(map, point)) {
            uncertain = true;
            break;
          }
          trails[mapIndex]!.push(ownPoint(point));
        }
      }
    }

    if (uncertain) {
      uncertainStep = stepIndex;
      break;
    }

    const next = ownState(preview.next);
    if (failedStep === null && !wasFailed && next.failed) failedStep = stepIndex;
    current = next;
    frames.push(current);
  }

  const immutableFrames = Object.freeze(frames);
  const immutableTrails = Object.freeze(trails.map((trail) => Object.freeze(trail)));
  return Object.freeze({
    frames: immutableFrames,
    trails: immutableTrails,
    failedStep,
    uncertainStep,
    final: immutableFrames[immutableFrames.length - 1]!,
  });
}
