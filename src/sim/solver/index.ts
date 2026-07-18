import type {
  Vec2,
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
import { applyStep, evaluate } from "../drug-graph";
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
    out.push({ machine: { typeId: entry.typeId, path: entry.path }, cost: entry.cost });
  }
  return out;
}

/**
 * Deterministic, collision-proof visited key for a DrugState's positions.
 * The numeric FNV hash (hashInts, folding each map's x then y) is the spec's
 * primary key; we suffix the exact (x,y) signature so two states that merely
 * collide in the hash are never conflated — soundness must not depend on luck.
 */
function positionKey(pos: readonly Vec2[]): string {
  const ints: number[] = [];
  for (const p of pos) {
    ints.push(p.x, p.y);
  }
  const h = hashInts(ints);
  // Suffix the exact (x,y) signature so distinct states that merely collide in the
  // FNV hash are never conflated — soundness/minimality must not depend on luck.
  return `${h}:${pos.map((p) => `${p.x},${p.y}`).join("|")}`;
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
      const index = position.y * map.width + position.x;
      if (map.cell[index] === CellKind.Cure && map.cureId[index] === target) {
        cured = true;
        break;
      }
    }
    if (!cured) return false;
  }
  return true;
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

  // The start may already be the goal (zero-step solution).
  if (isGoal(mm, start, opts.targets)) {
    return finalize(mm, start, [], opts.targets);
  }

  if (opts.maxDepth <= 0) return null;

  // BFS over DrugState. Each depth keeps the cheapest path per position and the
  // cheapest goal, with fixed expansion order breaking equal-cost ties.
  const visited = new Set<string>();
  visited.add(positionKey(start.pos));

  let frontier: QueueNode[] = [{ state: start, path: [], cost: 0 }];
  let depth = 0;

  while (frontier.length > 0 && depth < opts.maxDepth) {
    const next: QueueNode[] = [];
    const nextIndexByKey = new Map<string, number>();
    let bestGoal: QueueNode | null = null;
    for (const cur of frontier) {
      for (const cm of machines) {
        const child = applyStep(mm, cur.state, cm.machine);
        if (child.failed) continue; // never expand a spoiled drug
        const key = positionKey(child.pos);
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
    for (const node of next) visited.add(positionKey(node.state.pos));
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
    const delta = machine.path[index];
    if (delta !== undefined && (delta.x !== first.x || delta.y !== first.y)) return true;
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
