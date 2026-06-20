import type {
  Vec2,
  MultiMap,
  DrugState,
  Machine,
  Orientation,
  Rotation,
  MachineCatalogEntry,
  Template,
  DiseaseId,
  MapIndex,
  Solution,
  SolveFn,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { applyStep, effectiveDelta, evaluate } from "../drug-graph";
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

const ALL_ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];

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
 * Expand the catalog into concrete machines in a FIXED, deterministic order.
 *  - translate + orientable: all rot∈{0,1,2,3} × flip∈{false,true}, but DEDUPE by
 *    the resulting effectiveDelta (axis-aligned deltas collapse many orientations).
 *  - everything else: one machine with the identity orientation.
 * Determinism: catalog order is preserved; within an entry, orientations are
 * emitted in (rot ascending, flip false-before-true) order; first occurrence of
 * each distinct effectiveDelta wins.
 */
function expandCatalog(catalog: readonly MachineCatalogEntry[]): ConcreteMachine[] {
  const out: ConcreteMachine[] = [];
  for (const entry of catalog) {
    const t = entry.transform;
    if (t.kind === "translate" && entry.orientable) {
      const seen = new Set<string>();
      for (const rot of ALL_ROTATIONS) {
        for (const flip of [false, true]) {
          const orientation: Orientation = { rot, flip };
          const eff = effectiveDelta(t.delta, t.relation, orientation);
          const key = `${eff.x},${eff.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({
            machine: { typeId: entry.typeId, transform: t, orientation },
            cost: entry.cost,
          });
        }
      }
    } else {
      out.push({
        machine: { typeId: entry.typeId, transform: t, orientation: { rot: 0, flip: false } },
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

/**
 * Build + verify the Solution. The verification re-runs evaluate() and asserts
 * INV-13 (the returned template cures all targets and never fails). difficulty is
 * the minimal step count (BFS depth at first reach); cost is the summed catalog
 * cost of the chosen machines.
 */
function finalize(
  mm: MultiMap,
  start: DrugState,
  path: readonly ConcreteMachine[],
  targets: readonly DiseaseId[],
): Solution {
  const template: Template = { steps: path.map((cm) => cm.machine) };
  const cost = path.reduce((acc, cm) => acc + cm.cost, 0);
  const difficulty = path.length;

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
