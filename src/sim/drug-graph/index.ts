import type {
  ApplyStepFn,
  ApplyTemplateFn,
  DiseaseId,
  DrugState,
  EffectMap,
  EvaluateFn,
  HexCoord,
  InitialStateFn,
  Machine,
  MultiMap,
  RevealAlongFn,
  SideEffectId,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { walkPath } from "./path";
import { validateEffectMap, validateMachinePath } from "./validation";

export {
  walkPath,
  walkPathInto,
  walkValidatedPathInto,
  type PathWalkResult,
} from "./path";
export { validateEffectMap, validateMachinePath, validatePathStamp } from "./validation";

export interface PreviewStepResult {
  readonly next: DrugState;
  readonly trails: readonly (readonly HexCoord[])[];
}

function validateState(mm: MultiMap, state: DrugState): void {
  if (state.pos.length !== mm.maps.length) {
    throw new Error("drug graph: state position count must match map count");
  }
  for (let index = 0; index < state.pos.length; index++) {
    const position = state.pos[index];
    const map = mm.maps[index];
    if (position === undefined || map === undefined) {
      throw new Error("drug graph: state is missing a map position");
    }
    if (!Number.isSafeInteger(position.q) || !Number.isSafeInteger(position.r)) {
      throw new Error("drug graph: state positions must be safe-integer coordinates");
    }
    if (
      position.q < 0 ||
      position.r < 0 ||
      position.q >= map.width ||
      position.r >= map.height
    ) {
      throw new Error("drug graph: state position is outside its map");
    }
  }
}

export function previewStep(mm: MultiMap, state: DrugState, machine: Machine): PreviewStepResult {
  validateMachinePath(machine);
  for (const map of mm.maps) validateEffectMap(map);
  validateState(mm, state);

  const emptyTrails: HexCoord[][] = mm.maps.map(() => []);
  if (state.failed) return { next: state, trails: emptyTrails };

  const positions: HexCoord[] = new Array<HexCoord>(mm.maps.length);
  const trails: HexCoord[][] = new Array<HexCoord[]>(mm.maps.length);
  let failed = false;

  for (let index = 0; index < mm.maps.length; index++) {
    const map = mm.maps[index];
    const from = state.pos[index];
    if (map === undefined || from === undefined) {
      throw new Error("drug graph: validated map/state arrays diverged");
    }
    const result = walkPath(map, from, machine);
    positions[index] = result.pos;
    trails[index] = result.entered.slice();
    if (result.failed) failed = true;
  }

  return { next: { pos: positions, failed }, trails };
}

export const initialState: InitialStateFn = (mm) => {
  for (const map of mm.maps) validateEffectMap(map);
  return {
    pos: mm.maps.map((map) => ({ q: map.start.q, r: map.start.r })),
    failed: false,
  };
};

export const applyStep: ApplyStepFn = (mm, state, machine) =>
  previewStep(mm, state, machine).next;

export const applyTemplate: ApplyTemplateFn = (mm, start, template) => {
  let state = start;
  for (const machine of template.steps) state = applyStep(mm, state, machine);
  return state;
};

export const evaluate: EvaluateFn = (mm, start, template) => {
  const state = applyTemplate(mm, start, template);
  if (state.failed) {
    return { failed: true, final: state.pos, cured: [], sideEffects: [] };
  }

  const cured: DiseaseId[] = [];
  const sideEffects: SideEffectId[] = [];
  for (let mapIndex = 0; mapIndex < mm.maps.length; mapIndex++) {
    const map = mm.maps[mapIndex];
    const position = state.pos[mapIndex];
    if (map === undefined || position === undefined) {
      throw new Error("drug graph: evaluated map/state arrays diverged");
    }
    const cellIndex = position.r * map.width + position.q;
    const kind = map.cell[cellIndex];
    if (kind === CellKind.Cure) {
      const diseaseId = map.cureId[cellIndex];
      if (diseaseId !== undefined && diseaseId >= 0) cured.push(diseaseId);
    }
    const sideEffectId = map.sideEffectId[cellIndex];
    if (sideEffectId !== undefined && sideEffectId >= 0) sideEffects.push(sideEffectId);
  }

  return { failed: false, final: state.pos, cured, sideEffects };
};

export const revealAlong: RevealAlongFn = (mm, start, template) => {
  const fogs = mm.maps.map((map) => Uint8Array.from(map.fog));
  let state = start;

  for (const machine of template.steps) {
    const preview = previewStep(mm, state, machine);
    for (let mapIndex = 0; mapIndex < mm.maps.length; mapIndex++) {
      const map = mm.maps[mapIndex];
      const fog = fogs[mapIndex];
      const trail = preview.trails[mapIndex];
      if (map === undefined || fog === undefined || trail === undefined) {
        throw new Error("drug graph: reveal map/trail arrays diverged");
      }
      for (const position of trail) fog[position.r * map.width + position.q] = 1;
    }
    state = preview.next;
  }

  const maps: EffectMap[] = mm.maps.map((map, index) => {
    const fog = fogs[index];
    if (fog === undefined) throw new Error("drug graph: reveal fog array is missing");
    return { ...map, fog };
  });
  return { maps };
};
