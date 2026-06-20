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
export const DEFAULT_PATENTS: readonly PatentNode[] = [
  { id: "bench-2", cost: 120, requires: [], effect: { kind: "expandFactory", dw: 2, dh: 0 } },
  { id: "reveal-aid", cost: 80, requires: [], effect: { kind: "revealAid", amount: 3 } },
  { id: "skew-unlock", cost: 100, requires: [], effect: { kind: "unlockMachine", typeId: "skew" } },
  { id: "dilute-unlock", cost: 180, requires: ["bench-2"], effect: { kind: "unlockMachine", typeId: "dilute" } },
  { id: "new-map", cost: 300, requires: ["bench-2"], effect: { kind: "unlockMap" } },
];

/** Find a node by id, or undefined. */
function findNode(tree: readonly PatentNode[], id: string): PatentNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
  }
  return undefined;
}

/**
 * True iff the node exists, is not already unlocked, all prerequisites are in
 * `state.unlocked`, and `cash >= node.cost`.
 */
export const canUnlock: CanUnlockFn = (tree, state, cash, id) => {
  const node = findNode(tree, id);
  if (node === undefined) return false;
  if (state.unlocked.includes(id)) return false;
  for (const req of node.requires) {
    if (!state.unlocked.includes(req)) return false;
  }
  return cash >= node.cost;
};

/** Reason a node cannot be unlocked, for a clear error message. */
function blockReason(tree: readonly PatentNode[], state: PatentState, cash: number, id: string): string {
  const node = findNode(tree, id);
  if (node === undefined) return `unknown patent "${id}"`;
  if (state.unlocked.includes(id)) return `patent "${id}" already unlocked`;
  for (const req of node.requires) {
    if (!state.unlocked.includes(req)) {
      return `patent "${id}" requires "${req}", which is not unlocked`;
    }
  }
  return `patent "${id}" costs ${node.cost} but only ${cash} cash available`;
}

/**
 * Unlock a node. Returns the new PatentState (id appended, order = unlock order)
 * and the remaining cash. Throws if the unlock is not allowed.
 */
export const unlockPatent: UnlockPatentFn = (tree, state, cash, id) => {
  if (!canUnlock(tree, state, cash, id)) {
    throw new Error(`cannot unlock ${blockReason(tree, state, cash, id)}`);
  }
  const node = findNode(tree, id) as PatentNode;
  return {
    patents: { unlocked: [...state.unlocked, id] },
    cash: cash - node.cost,
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
  let factoryDw = 0;
  let factoryDh = 0;
  let revealAid = 0;
  const unlockedMachines: MachineTypeId[] = [];
  let newMapUnlocked = false;

  for (const id of state.unlocked) {
    const node = findNode(tree, id);
    if (node === undefined) continue;
    const e = node.effect;
    switch (e.kind) {
      case "expandFactory":
        factoryDw += e.dw;
        factoryDh += e.dh;
        break;
      case "revealAid":
        revealAid += e.amount;
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
