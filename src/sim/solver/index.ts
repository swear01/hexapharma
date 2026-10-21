import type {
  MultiMap,
  DrugState,
  Machine,
  MachineCatalogEntry,
  Template,
  DiseaseId,
  Solution,
  SolveFn,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import {
  evaluate,
  PATH_OUT_STRIDE,
  turnHeading,
  validateDrugState,
  validateEffectMap,
  validateMachinePath,
  walkValidatedPathInto,
} from "../drug-graph";
import { hashInts } from "../hash";

// Dev/test-only search. NEVER wire into an in-game auto-solver (D14). INV-13.

/** A concrete machine paired with the catalog cost it should bill. */
interface ConcreteMachine {
  readonly machine: Machine;
  readonly cost: number;
}

/**
 * Confirm that every requested disease has at least one Cure cell. Cure regions
 * may contain several cells; goal checks accept any cell carrying the target id.
 */
function hasCureRegions(mm: MultiMap, targets: readonly DiseaseId[]): boolean {
  for (const target of targets) {
    let found = false;
    for (let mapIndex = 0; mapIndex < mm.maps.length && !found; mapIndex++) {
      const map = mm.maps[mapIndex];
      if (map === undefined) continue;
      for (let index = 0; index < map.cell.length; index++) {
        if (map.cell[index] === CellKind.Cure && map.cureId[index] === target) {
          found = true;
          break;
        }
      }
    }
    if (!found) return false;
  }
  return true;
}

function expandCatalog(catalog: readonly MachineCatalogEntry[]): ConcreteMachine[] {
  const out: ConcreteMachine[] = [];
  for (const entry of catalog) {
    if (!Array.isArray(entry.path) || entry.path.length < 1) continue;
    out.push({ machine: { typeId: entry.typeId, path: entry.path, turn: entry.turn }, cost: entry.cost });
  }
  return out;
}

/**
 * Deterministic, collision-proof visited key for a DrugState's search state
 * (heading + per-map cell and swamp offset). The numeric FNV hash is the primary
 * key; we suffix the exact signature so two states that merely
 * collide in the hash are never conflated — soundness must not depend on luck.
 */
function positionKey(state: DrugState): string {
  const ints: number[] = [state.heading];
  for (let index = 0; index < state.pos.length; index++) {
    const p = state.pos[index]!;
    const o = state.offset[index]!;
    ints.push(p.q, p.r, o.q, o.r);
  }
  const h = hashInts(ints);
  // Suffix the exact (heading, cell, offset) signature so distinct states that merely
  // collide in the FNV hash are never conflated — soundness/minimality must not depend on luck.
  return `${h}:${ints.join(",")}`;
}

/** True once every target is present at one of the drug's final map positions. */
function isGoal(mm: MultiMap, s: DrugState, targets: readonly DiseaseId[]): boolean {
  if (s.failed) return false;
  for (const target of targets) {
    let cured = false;
    for (let mapIndex = 0; mapIndex < mm.maps.length; mapIndex++) {
      const map = mm.maps[mapIndex];
      const position = s.pos[mapIndex];
      if (map === undefined || position === undefined) continue;
      const index = position.r * map.width + position.q;
      if (map.cell[index] === CellKind.Cure && map.cureId[index] === target) {
        cured = true;
        break;
      }
    }
    if (!cured) return false;
  }
  return true;
}

/** applyStep over pre-validated maps and machines (validation once per solve, not per expansion). */
function applyValidatedStep(mm: MultiMap, s: DrugState, machine: Machine, out: Int32Array): DrugState {
  if (s.failed) return s;
  const pos = new Array<DrugState["pos"][number]>(mm.maps.length);
  const offset = new Array<DrugState["offset"][number]>(mm.maps.length);
  let failed = false;
  for (let mapIndex = 0; mapIndex < mm.maps.length; mapIndex++) {
    const from = s.pos[mapIndex]!;
    const fromOffset = s.offset[mapIndex]!;
    walkValidatedPathInto(
      mm.maps[mapIndex]!,
      from.q,
      from.r,
      fromOffset.q,
      fromOffset.r,
      s.heading,
      machine,
      out,
      0,
    );
    pos[mapIndex] = { q: out[0]!, r: out[1]! };
    offset[mapIndex] = { q: out[2]!, r: out[3]! };
    if (out[4] === 1) failed = true;
  }
  return { pos, offset, heading: failed ? s.heading : turnHeading(s.heading, machine.turn), failed };
}

interface QueueNode {
  readonly state: DrugState;
  /** Concrete machines applied so far, in order. */
  readonly path: readonly ConcreteMachine[];
  readonly cost: number;
}

export const solve: SolveFn = (mm, start, opts) => {
  if (!hasCureRegions(mm, opts.targets)) return null;

  const machines = expandCatalog(opts.catalog);
  for (const map of mm.maps) validateEffectMap(map);
  for (const cm of machines) validateMachinePath(cm.machine);
  validateDrugState(mm, start);
  const walkOut = new Int32Array(PATH_OUT_STRIDE);

  // The start may already be the goal (zero-step solution).
  if (isGoal(mm, start, opts.targets)) {
    return finalize(mm, start, [], opts.targets);
  }

  if (opts.maxDepth <= 0) return null;

  // BFS over DrugState (heading, cells, offsets). Each depth keeps the cheapest path per state and the
  // cheapest goal, with fixed expansion order breaking equal-cost ties.
  const visited = new Set<string>();
  visited.add(positionKey(start));

  let frontier: QueueNode[] = [{ state: start, path: [], cost: 0 }];
  let depth = 0;

  while (frontier.length > 0 && depth < opts.maxDepth) {
    const next: QueueNode[] = [];
    const nextIndexByKey = new Map<string, number>();
    let bestGoal: QueueNode | null = null;
    for (const cur of frontier) {
      for (const cm of machines) {
        const child = applyValidatedStep(mm, cur.state, cm.machine, walkOut);
        if (child.failed) continue; // never expand a spoiled drug
        const key = positionKey(child);
        if (visited.has(key)) continue;
        const path = [...cur.path, cm];
        const candidate: QueueNode = { state: child, path, cost: cur.cost + cm.cost };
        if (isGoal(mm, child, opts.targets)) {
          if (bestGoal === null || candidate.cost < bestGoal.cost) bestGoal = candidate;
          continue;
        }
        const nextIndex = nextIndexByKey.get(key);
        if (nextIndex === undefined) {
          nextIndexByKey.set(key, next.length);
          next.push(candidate);
        } else if (candidate.cost < next[nextIndex]!.cost) {
          next[nextIndex] = candidate;
        }
      }
    }
    if (bestGoal !== null) return finalize(mm, start, bestGoal.path, opts.targets);
    for (const node of next) visited.add(positionKey(node.state));
    frontier = next;
    depth++;
  }

  return null;
};

/** True when the full fixed path bends rather than behaving as a straight shove. */
function isShapedStep(machine: Machine): boolean {
  if (machine.path.length < 2) return false;
  const first = machine.path[0];
  if (first === undefined) return false;
  for (let index = 1; index < machine.path.length; index++) {
    const direction = machine.path[index];
    if (direction !== undefined && direction !== first) return true;
  }
  return false;
}

/**
 * Build + verify the Solution. The verification re-runs evaluate() and asserts
 * INV-13 (the returned template cures all targets and never fails). cost is the
 * summed catalog cost of the chosen machines.
 *
 * difficulty is a deterministic composite of the shortest, lowest-cost path:
 *   difficulty = steps + diversityBonus + shapedPathBonus
 *     steps           = minimal BFS depth (dominant term).
 *     diversityBonus  = (distinct typeIds used) − 1.
 *     shapedPathBonus = 2 if any full machine path bends; else 0.
 * A straight single-machine-type solution stays at difficulty == steps;
 * a zero-step solution stays at 0.
 */
function finalize(
  mm: MultiMap,
  start: DrugState,
  path: readonly ConcreteMachine[],
  targets: readonly DiseaseId[],
): Solution {
  const template: Template = { steps: path.map((cm) => cm.machine) };
  const cost = path.reduce((acc, cm) => acc + cm.cost, 0);

  const steps = path.length;
  const distinctTypes = new Set(path.map((cm) => cm.machine.typeId));
  const diversityBonus = steps === 0 ? 0 : distinctTypes.size - 1;
  const shapedPathBonus = path.some((cm) => isShapedStep(cm.machine)) ? 2 : 0;
  const difficulty = steps + diversityBonus + shapedPathBonus;

  // INV-13 soundness assertion: the result must actually cure the targets safely.
  const out = evaluate(mm, start, template);
  if (out.failed) {
    throw new Error("solver invariant violation (INV-13): returned template fails");
  }
  const cured = new Set(out.cured);
  for (const target of targets) {
    if (!cured.has(target)) {
      throw new Error(
        `solver invariant violation (INV-13): target ${target} not in cured set`,
      );
    }
  }

  return { template, difficulty, cost };
}
