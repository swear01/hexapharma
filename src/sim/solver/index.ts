import type {
  Vec2,
  MultiMap,
  DrugState,
  Machine,
  MachineCatalogEntry,
  Template,
  DiseaseId,
  MapIndex,
  Solution,
  SolveFn,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { applyStep, evaluate } from "../drug-graph";
import { hashInts } from "../hash";

// Dev/test-only search. NEVER wire into an in-game auto-solver (D14). INV-13.

/** A target's cure node: which map it lives on and at which cell. */
interface CureNode {
  readonly target: DiseaseId;
  readonly map: MapIndex;
  readonly pos: Vec2;
}

/** A concrete machine paired with the catalog cost it should bill. */
interface ConcreteMachine {
  readonly machine: Machine;
  readonly cost: number;
}

/**
 * Locate every target's cure node by scanning all maps for the Cure cell whose
 * cureId matches. Returns null if any target has no cure node, or if two targets
 * resolve to the SAME map at DIFFERENT cells (a single drug holds one position
 * per map, so that joint goal is unsatisfiable — see the cross-map constraint).
 */
function findCureNodes(mm: MultiMap, targets: readonly DiseaseId[]): CureNode[] | null {
  const nodes: CureNode[] = [];
  for (const target of targets) {
    let found: CureNode | null = null;
    for (let mi = 0; mi < mm.maps.length; mi++) {
      const map = mm.maps[mi];
      if (map === undefined) continue;
      const cell = map.cell;
      const cureId = map.cureId;
      for (let i = 0; i < cell.length; i++) {
        if (cell[i] === CellKind.Cure && cureId[i] === target) {
          const x = i % map.width;
          const y = (i - x) / map.width;
          found = { target, map: mi, pos: { x, y } };
          break;
        }
      }
      if (found !== null) break;
    }
    if (found === null) return null; // target has no cure node anywhere
    nodes.push(found);
  }

  // Two distinct targets on the same map at different cells ⇒ no single-drug solution.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      if (a === undefined || b === undefined) continue;
      if (a.map === b.map && (a.pos.x !== b.pos.x || a.pos.y !== b.pos.y)) {
        return null;
      }
    }
  }
  return nodes;
}

/**
 * Expand every immutable machine stamp into its legal calibration prefixes in a
 * fixed order. Chemical paths cannot rotate or mirror; calibration only chooses
 * how much of the authored stamp is executed.
 */
function expandCatalog(catalog: readonly MachineCatalogEntry[]): ConcreteMachine[] {
  const out: ConcreteMachine[] = [];
  for (const entry of catalog) {
    if (!Array.isArray(entry.path) || entry.path.length < 1) continue;
    for (let stroke = 1; stroke <= entry.path.length; stroke++) {
      out.push({
        machine: { typeId: entry.typeId, path: entry.path, stroke },
        cost: entry.cost,
      });
    }
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

/** True once every target's map position equals its cure node and the drug is alive. */
function isGoal(s: DrugState, nodes: readonly CureNode[]): boolean {
  if (s.failed) return false;
  for (const node of nodes) {
    const p = s.pos[node.map];
    if (p === undefined || p.x !== node.pos.x || p.y !== node.pos.y) return false;
  }
  return true;
}

interface QueueNode {
  readonly state: DrugState;
  /** Concrete machines applied so far, in order. */
  readonly path: readonly ConcreteMachine[];
}

export const solve: SolveFn = (mm, start, opts) => {
  const nodes = findCureNodes(mm, opts.targets);
  if (nodes === null) return null;

  const machines = expandCatalog(opts.catalog);

  // The start may already be the goal (zero-step solution).
  if (isGoal(start, nodes)) {
    return finalize(mm, start, [], opts.targets);
  }

  if (opts.maxDepth <= 0) return null;

  // BFS over DrugState; FIFO + fixed expansion order ⇒ identical Solution each run.
  // Visited is keyed by position signature, so the search is bounded by the number
  // of reachable position-tuples (~(W·H)^N), not by branching^depth.
  const visited = new Set<string>();
  visited.add(positionKey(start.pos));

  let frontier: QueueNode[] = [{ state: start, path: [] }];
  let depth = 0;

  while (frontier.length > 0 && depth < opts.maxDepth) {
    const next: QueueNode[] = [];
    for (const cur of frontier) {
      for (const cm of machines) {
        const child = applyStep(mm, cur.state, cm.machine);
        if (child.failed) continue; // never expand a spoiled drug
        const key = positionKey(child.pos);
        if (visited.has(key)) continue;
        visited.add(key);
        const path = [...cur.path, cm];
        if (isGoal(child, nodes)) {
          return finalize(mm, start, path, opts.targets);
        }
        next.push({ state: child, path });
      }
    }
    frontier = next;
    depth++;
  }

  return null;
};

/** True when the active prefix bends rather than behaving as a straight shove. */
function isShapedStep(machine: Machine): boolean {
  if (machine.stroke < 2) return false;
  const first = machine.path[0];
  if (first === undefined) return false;
  for (let index = 1; index < machine.stroke; index++) {
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
 * difficulty is a deterministic composite of the single chosen (first-BFS) path:
 *   difficulty = steps + diversityBonus + shapedPathBonus
 *     steps           = minimal BFS depth (dominant term).
 *     diversityBonus  = (distinct typeIds used) − 1.
 *     shapedPathBonus = 2 if any active machine prefix bends; else 0.
 * A straight-prefix single-machine-type solution stays at difficulty == steps;
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
