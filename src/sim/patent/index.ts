/**
 * HexaPharma — patent (talent tree).
 *
 * Pure, deterministic unlock logic over a frozen patent tree. Cash is integer.
 * `unlockPatent` spends exactly the node cost and appends the id in unlock order;
 * it THROWS on any disallowed unlock (no silent no-op).
 */

import type {
  PatentNode,
  PatentState,
  CanUnlockFn,
  UnlockPatentFn,
  MachineTypeId,
} from "../phase0_interfaces";

/**
 * Default Phase 3 patent tree. A small talent tree with one of each effect kind
 * and a prerequisite chain (`new-map` requires `bench-2`).
 */
const PATENT_DEFINITIONS = [
  { id: "bench-2", cost: 120, researchCost: 2, requires: [], effect: { kind: "expandFactory", dw: 2, dh: 0 } },
  { id: "reveal-aid", cost: 80, researchCost: 1, requires: [], effect: { kind: "revealAid", amount: 3 } },
  { id: "skew-unlock", cost: 100, researchCost: 1, requires: [], effect: { kind: "unlockMachine", typeId: "skew" } },
  { id: "dilute-unlock", cost: 180, researchCost: 3, requires: ["bench-2"], effect: { kind: "unlockMachine", typeId: "dilute" } },
  { id: "new-map", cost: 300, researchCost: 5, requires: ["bench-2"], effect: { kind: "unlockMap" } },
  { id: "new-map-4", cost: 500, researchCost: 8, requires: ["new-map"], effect: { kind: "unlockMap" } },
] as const satisfies readonly PatentNode[];

export const DEFAULT_PATENTS: readonly PatentNode[] = Object.freeze(PATENT_DEFINITIONS.map(
  (node): PatentNode => Object.freeze({
  ...node,
  requires: Object.freeze([...node.requires]),
  effect: Object.freeze({ ...node.effect }) as PatentNode["effect"],
}),
));

/** Find a node by id, or undefined. */
function findNode(tree: readonly PatentNode[], id: string): PatentNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
  }
  return undefined;
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
}

function addEffectTotal(current: number, increment: number, label: string): number {
  if (current > Number.MAX_SAFE_INTEGER - increment) {
    throw new Error(`${label} aggregate must remain a safe integer`);
  }
  return current + increment;
}

function validateEffect(node: PatentNode): void {
  const effect = node.effect;
  if (effect === null || typeof effect !== "object") {
    throw new Error(`patent "${node.id}" effect must be an object`);
  }
  switch (effect.kind) {
    case "unlockMachine":
      if (typeof effect.typeId !== "string" || effect.typeId.length === 0) {
        throw new Error(`patent "${node.id}" machine type id must be a non-empty string`);
      }
      return;
    case "expandFactory":
      requireNonNegativeSafeInteger(effect.dw, `patent "${node.id}" effect dw`);
      requireNonNegativeSafeInteger(effect.dh, `patent "${node.id}" effect dh`);
      return;
    case "revealAid":
      requireNonNegativeSafeInteger(effect.amount, `patent "${node.id}" reveal amount`);
      return;
    case "unlockMap":
      return;
    default:
      throw new Error(`patent "${node.id}" has an unknown effect kind`);
  }
}

function validateTree(tree: readonly PatentNode[]): void {
  if (!Array.isArray(tree)) throw new Error("patent tree must be an array");

  const ids = new Set<string>();
  for (const node of tree) {
    if (node === null || typeof node !== "object") {
      throw new Error("patent tree nodes must be objects");
    }
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw new Error("patent id must be a non-empty string");
    }
    if (ids.has(node.id)) throw new Error(`patent tree has duplicate id "${node.id}"`);
    ids.add(node.id);
    requireNonNegativeSafeInteger(node.cost, `patent "${node.id}" cost`);
    requireNonNegativeSafeInteger(node.researchCost, `patent "${node.id}" researchCost`);
    if (!Array.isArray(node.requires)) {
      throw new Error(`patent "${node.id}" prerequisites must be an array`);
    }
    const requirements = new Set<string>();
    for (const required of node.requires) {
      if (typeof required !== "string" || required.length === 0) {
        throw new Error(`patent "${node.id}" prerequisite ids must be non-empty strings`);
      }
      if (requirements.has(required)) {
        throw new Error(`patent "${node.id}" has duplicate prerequisite "${required}"`);
      }
      requirements.add(required);
    }
    validateEffect(node);
  }

  for (const node of tree) {
    for (const required of node.requires) {
      if (!ids.has(required)) {
        throw new Error(`patent "${node.id}" has unknown prerequisite "${required}"`);
      }
    }
  }

  const resolved = new Set<string>();
  while (resolved.size < tree.length) {
    let progressed = false;
    for (const node of tree) {
      if (resolved.has(node.id)) continue;
      if (node.requires.every((required: string) => resolved.has(required))) {
        resolved.add(node.id);
        progressed = true;
      }
    }
    if (!progressed) throw new Error("patent tree contains a prerequisite cycle");
  }
}

function validateState(tree: readonly PatentNode[], state: PatentState): void {
  if (state === null || typeof state !== "object" || !Array.isArray(state.unlocked)) {
    throw new Error("patent state unlocked must be an array");
  }
  const unlocked = new Set<string>();
  for (const id of state.unlocked) {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("unlocked patent ids must be non-empty strings");
    }
    const node = findNode(tree, id);
    if (node === undefined) throw new Error(`unknown unlocked patent "${id}"`);
    if (unlocked.has(id)) throw new Error(`duplicate unlocked patent "${id}"`);
    for (const required of node.requires) {
      if (!unlocked.has(required)) {
        throw new Error(`patent "${id}" appears before prerequisite "${required}"`);
      }
    }
    unlocked.add(id);
  }
}

function validateInputs(
  tree: readonly PatentNode[],
  state: PatentState,
  cash: number,
  research: number,
  id: string,
): void {
  validateTree(tree);
  validateState(tree, state);
  if (!Number.isSafeInteger(cash)) throw new Error("cash must be a safe integer");
  requireNonNegativeSafeInteger(research, "research");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("patent id must be a non-empty string");
  }
}

/**
 * True iff the node exists, is not already unlocked, all prerequisites are in
 * `state.unlocked`, and `cash >= node.cost`.
 */
export const canUnlock: CanUnlockFn = (tree, state, cash, research, id) => {
  validateInputs(tree, state, cash, research, id);
  const node = findNode(tree, id);
  if (node === undefined) return false;
  if (state.unlocked.includes(id)) return false;
  for (const req of node.requires) {
    if (!state.unlocked.includes(req)) return false;
  }
  return cash >= node.cost && research >= node.researchCost;
};

/** Reason a node cannot be unlocked, for a clear error message. */
function blockReason(
  tree: readonly PatentNode[],
  state: PatentState,
  cash: number,
  research: number,
  id: string,
): string {
  const node = findNode(tree, id);
  if (node === undefined) return `unknown patent "${id}"`;
  if (state.unlocked.includes(id)) return `patent "${id}" already unlocked`;
  for (const req of node.requires) {
    if (!state.unlocked.includes(req)) {
      return `patent "${id}" requires "${req}", which is not unlocked`;
    }
  }
  if (cash < node.cost) return `patent "${id}" costs ${node.cost} but only ${cash} cash available`;
  return `patent "${id}" costs ${node.researchCost} research but only ${research} available`;
}

/**
 * Unlock a node. Returns the new PatentState (id appended, order = unlock order)
 * and the remaining cash. Throws if the unlock is not allowed.
 */
export const unlockPatent: UnlockPatentFn = (tree, state, cash, research, id) => {
  if (!canUnlock(tree, state, cash, research, id)) {
    throw new Error(`cannot unlock ${blockReason(tree, state, cash, research, id)}`);
  }
  const node = findNode(tree, id) as PatentNode;
  return {
    patents: { unlocked: [...state.unlocked, id] },
    cash: cash - node.cost,
    research: research - node.researchCost,
  };
};

/** Summary of the effects granted by the currently-unlocked patents. */
export interface ActiveEffects {
  /** Total factory width expansion from all unlocked expandFactory nodes. */
  readonly factoryDw: number;
  /** Total factory height expansion from all unlocked expandFactory nodes. */
  readonly factoryDh: number;
  /** Total reveal-aid amount from all unlocked revealAid nodes. */
  readonly revealAid: number;
  /** Machine typeIds unlocked, in unlock order. */
  readonly unlockedMachines: readonly MachineTypeId[];
  /** True if any unlockMap node is unlocked. */
  readonly newMapUnlocked: boolean;
}

/** Summarize the effects of the unlocked patents (cold path, UI helper). */
export function activeEffects(tree: readonly PatentNode[], state: PatentState): ActiveEffects {
  validateTree(tree);
  validateState(tree, state);
  let factoryDw = 0;
  let factoryDh = 0;
  let revealAid = 0;
  const unlockedMachines: MachineTypeId[] = [];
  let newMapUnlocked = false;

  for (const id of state.unlocked) {
    const node = findNode(tree, id) as PatentNode;
    const e = node.effect;
    switch (e.kind) {
      case "expandFactory":
        factoryDw = addEffectTotal(factoryDw, e.dw, "factory width expansion");
        factoryDh = addEffectTotal(factoryDh, e.dh, "factory height expansion");
        break;
      case "revealAid":
        revealAid = addEffectTotal(revealAid, e.amount, "reveal aid");
        break;
      case "unlockMachine":
        unlockedMachines.push(e.typeId);
        break;
      case "unlockMap":
        newMapUnlocked = true;
        break;
    }
  }

  return { factoryDw, factoryDh, revealAid, unlockedMachines, newMapUnlocked };
}
