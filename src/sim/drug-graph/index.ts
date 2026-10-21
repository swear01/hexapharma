import type {
  ApplyStepFn,
  ApplyTemplateFn,
  DiseaseId,
  DrugState,
  EffectMap,
  EvaluateFn,
  HexCoord,
  HexDir,
  InitialStateFn,
  Machine,
  MultiMap,
  RevealAlongFn,
  SideEffectId,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { HEX_DQ, HEX_DR } from "../hex";
import { walkPath } from "./path";
import { validateEffectMap, validateMachinePath } from "./validation";

export {
  cellOfDoubledPoint,
  PATH_OUT_STRIDE,
  walkPath,
  walkPathInto,
  walkValidatedPathInto,
  type PathWalkResult,
} from "./path";
export {
  validateEffectMap,
  validateMachinePath,
  validateMachineTurn,
  validatePathStamp,
} from "./validation";

export interface PreviewStepResult {
  readonly next: DrugState;
  /** Per map: cells entered by this step, in order (fog reveal). */
  readonly trails: readonly (readonly HexCoord[])[];
  /** Per map: doubled-unit points (2·cell + offset) matching `trails` (half-step drawing). */
  readonly points: readonly (readonly HexCoord[])[];
}

/** Heading after a machine turn: `(heading + turn) mod 6`. */
export function turnHeading(heading: number, turn: number): HexDir {
  return ((((heading + turn) % 6) + 6) % 6) as HexDir;
}

/** True for the zero vector or one of the six unit axial directions. */
export function isDrugOffset(offset: HexCoord): boolean {
  if (offset.q === 0 && offset.r === 0) return true;
  for (let dir = 0; dir < 6; dir++) {
    if (offset.q === HEX_DQ[dir] && offset.r === HEX_DR[dir]) return true;
  }
  return false;
}

/**
 * Structural validity of a drug against its maps: in-bounds cells, heading 0..5, and an
 * offset that is zero off-swamp and zero-or-unit inside a Swamp cell.
 */
export function validateDrugState(mm: MultiMap, state: DrugState): void {
  if (state.pos.length !== mm.maps.length || state.offset.length !== mm.maps.length) {
    throw new Error("drug graph: state position/offset count must match map count");
  }
  if (!Number.isSafeInteger(state.heading) || state.heading < 0 || state.heading > 5) {
    throw new Error("drug graph: state heading must be a hex direction in 0..5");
  }
  if (typeof state.failed !== "boolean") {
    throw new Error("drug graph: state failed flag must be boolean");
  }
  for (let index = 0; index < state.pos.length; index++) {
    const position = state.pos[index];
    const offset = state.offset[index];
    const map = mm.maps[index];
    if (position === undefined || offset === undefined || map === undefined) {
      throw new Error("drug graph: state is missing a map position");
    }
    if (
      !Number.isSafeInteger(position.q) ||
      !Number.isSafeInteger(position.r) ||
      !Number.isSafeInteger(offset.q) ||
      !Number.isSafeInteger(offset.r)
    ) {
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
    const swamp = map.cell[position.r * map.width + position.q] === CellKind.Swamp;
    if (!isDrugOffset(offset) || (!swamp && (offset.q !== 0 || offset.r !== 0))) {
      throw new Error("drug graph: state offset must be zero off-swamp and at most one half step");
    }
  }
}

export function previewStep(mm: MultiMap, state: DrugState, machine: Machine): PreviewStepResult {
  validateMachinePath(machine);
  for (const map of mm.maps) validateEffectMap(map);
  validateDrugState(mm, state);

  const emptyTrails: HexCoord[][] = mm.maps.map(() => []);
  if (state.failed) return { next: state, trails: emptyTrails, points: emptyTrails };

  const positions: HexCoord[] = new Array<HexCoord>(mm.maps.length);
  const offsets: HexCoord[] = new Array<HexCoord>(mm.maps.length);
  const trails: HexCoord[][] = new Array<HexCoord[]>(mm.maps.length);
  const points: HexCoord[][] = new Array<HexCoord[]>(mm.maps.length);
  let failed = false;

  for (let index = 0; index < mm.maps.length; index++) {
    const map = mm.maps[index];
    const from = state.pos[index];
    const offset = state.offset[index];
    if (map === undefined || from === undefined || offset === undefined) {
      throw new Error("drug graph: validated map/state arrays diverged");
    }
    const result = walkPath(map, from, machine, state.heading, offset);
    positions[index] = result.pos;
    offsets[index] = result.offset;
    trails[index] = result.entered.slice();
    points[index] = result.points.slice();
    if (result.failed) failed = true;
  }

  const heading = failed ? state.heading : turnHeading(state.heading, machine.turn);
  return { next: { pos: positions, offset: offsets, heading, failed }, trails, points };
}

export const initialState: InitialStateFn = (mm) => {
  for (const map of mm.maps) validateEffectMap(map);
  return {
    pos: mm.maps.map((map) => ({ q: map.start.q, r: map.start.r })),
    offset: mm.maps.map(() => ({ q: 0, r: 0 })),
    heading: 0,
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
