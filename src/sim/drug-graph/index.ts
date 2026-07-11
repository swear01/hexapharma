import type {
  Vec2,
  EffectMap,
  MultiMap,
  DrugState,
  Machine,
  InitialStateFn,
  ApplyStepFn,
  ApplyTemplateFn,
  EvaluateFn,
  RevealAlongFn,
  DiseaseId,
  SideEffectId,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { effectiveDelta } from "./orient";
import { sweep, type SweepResult } from "./sweep";

export { orient, effectiveDelta } from "./orient";

function addVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Pull `pos` toward `origin` by num/den, truncating toward zero (no floats kept). */
function scaleTarget(pos: Vec2, origin: Vec2, num: number, den: number): Vec2 {
  // `+ 0` canonicalizes any -0 from Math.trunc back to 0.
  return {
    x: pos.x + Math.trunc(((origin.x - pos.x) * num) / den) + 0,
    y: pos.y + Math.trunc(((origin.y - pos.y) * num) / den) + 0,
  };
}

/**
 * Run one machine across all maps, returning the next DrugState plus the cells
 * entered on each map's sweep (parallel to mm.maps; empty arrays for swap or for
 * an already-failed/short-circuited step). Shared by applyStep + revealAlong so
 * they never diverge.
 */
export interface PreviewStepResult {
  readonly next: DrugState;
  readonly trails: readonly (readonly Vec2[])[];
}

export function previewStep(
  mm: MultiMap,
  s: DrugState,
  m: Machine,
): PreviewStepResult {
  const n = mm.maps.length;
  const empties: readonly Vec2[][] = mm.maps.map(() => []);

  // A spoiled drug ignores every further machine.
  if (s.failed) return { next: s, trails: empties };

  const t = m.transform;

  if (t.kind === "swap") {
    // Pure relabel; no sweep, never fails. Invalid indices violate Transform authority.
    const a = t.a;
    const b = t.b;
    if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a === b) {
      throw new Error("drug graph: swap requires distinct safe-integer map indices");
    }
    if (a < 0 || b < 0 || a >= n || b >= n) {
      throw new Error("drug graph: swap index is outside the active map range");
    }
    const pa = s.pos[a];
    const pb = s.pos[b];
    if (pa === undefined || pb === undefined) throw new Error("drug graph: swap state is missing a map position");
    const pos = s.pos.slice();
    pos[a] = pb;
    pos[b] = pa;
    return { next: { pos, failed: false }, trails: empties };
  }

  const nextPos: Vec2[] = new Array<Vec2>(n);
  const trails: Vec2[][] = new Array<Vec2[]>(n);
  let anyFailed = false;

  for (let i = 0; i < n; i++) {
    const map = mm.maps[i];
    const from = s.pos[i];
    if (map === undefined || from === undefined) {
      // Defensive: keep arrays aligned even on a malformed MultiMap/state.
      nextPos[i] = from ?? { x: 0, y: 0 };
      trails[i] = [];
      continue;
    }

    const target: Vec2 =
      t.kind === "translate"
        ? addVec(from, effectiveDelta(t.delta, t.relation, m.orientation))
        : scaleTarget(from, map.origin, t.num, t.den);

    const res: SweepResult = sweep(map, from, target);
    nextPos[i] = res.pos;
    trails[i] = res.entered.slice();
    if (res.failed) anyFailed = true;
  }

  return { next: { pos: nextPos, failed: anyFailed }, trails };
}

export const initialState: InitialStateFn = (mm) => ({
  pos: mm.maps.map((m) => m.start),
  failed: false,
});

export const applyStep: ApplyStepFn = (mm, s, m) => previewStep(mm, s, m).next;

export const applyTemplate: ApplyTemplateFn = (mm, start, t) =>
  t.steps.reduce((s, m) => applyStep(mm, s, m), start);

export const evaluate: EvaluateFn = (mm, start, t) => {
  const final = applyTemplate(mm, start, t);
  const finalPos = final.pos;

  if (final.failed) {
    // A spoiled drug cures nothing; still report where it ended up.
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
};

export const revealAlong: RevealAlongFn = (mm, start, t) => {
  const n = mm.maps.length;
  // Per-map copies of the fog arrays; we mutate only these copies.
  const fogs: Uint8Array[] = mm.maps.map((m) => Uint8Array.from(m.fog));

  let s: DrugState = start;
  for (const m of t.steps) {
    const { next, trails } = previewStep(mm, s, m);
    for (let i = 0; i < n; i++) {
      const map = mm.maps[i];
      const fog = fogs[i];
      const trail = trails[i];
      if (map === undefined || fog === undefined || trail === undefined) continue;
      for (const c of trail) {
        const idx = c.y * map.width + c.x;
        if (idx >= 0 && idx < fog.length) fog[idx] = 1;
      }
    }
    s = next;
  }

  const maps: EffectMap[] = mm.maps.map((m, i) => {
    const fog = fogs[i];
    return fog === undefined ? m : { ...m, fog };
  });
  return { maps };
};
