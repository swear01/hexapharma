/**
 * HexaPharma — Technology switches.
 *
 * Pure, deterministic on/off state over a frozen node list. Every node is an
 * independent free switch while the game is in testing (D42); `setPatent`
 * THROWS on an unknown id or a no-op switch.
 */

import type { MapIndex, PatentNode, PatentState, MachineTypeId } from "../phase0_interfaces";

const PATENT_DEFINITIONS = [
  { id: "bench-2", effect: { kind: "expandFactory", dw: 2, dh: 0 } },
  { id: "floor-depth", effect: { kind: "expandFactory", dw: 0, dh: 2 } },
  { id: "reveal-aid", effect: { kind: "revealAid", amount: 3 } },
  { id: "field-survey", effect: { kind: "revealAid", amount: 4 } },
  { id: "split-merge", effect: { kind: "unlockRouting" } },
  { id: "zigzag-unlock", effect: { kind: "unlockMachine", typeId: "zigzag" } },
  { id: "loop-unlock", effect: { kind: "unlockMachine", typeId: "loop" } },
  { id: "straight-unlock", effect: { kind: "unlockMachine", typeId: "straight" } },
  { id: "crane-unlock", effect: { kind: "unlockMachine", typeId: "crane" } },
  { id: "oil-base", effect: { kind: "unlockBase", base: 1 } },
  { id: "ethanol-base", effect: { kind: "unlockBase", base: 2 } },
] as const satisfies readonly PatentNode[];

export const DEFAULT_PATENTS: readonly PatentNode[] = Object.freeze(PATENT_DEFINITIONS.map(
  (node): PatentNode => Object.freeze({ ...node, effect: Object.freeze({ ...node.effect }) as PatentNode["effect"] }),
));

function findNode(tree: readonly PatentNode[], id: string): PatentNode | undefined {
  return tree.find((node) => node.id === id);
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
    case "unlockRouting":
      return;
    case "unlockBase":
      requireNonNegativeSafeInteger(effect.base, `patent "${node.id}" base`);
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
    validateEffect(node);
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
    if (findNode(tree, id) === undefined) throw new Error(`unknown unlocked patent "${id}"`);
    if (unlocked.has(id)) throw new Error(`duplicate unlocked patent "${id}"`);
    unlocked.add(id);
  }
}

/** Turn one node on (appended) or off (removed). Throws on an unknown id or when it is already in that state. */
export function setPatent(
  tree: readonly PatentNode[],
  state: PatentState,
  id: string,
  enabled: boolean,
): PatentState {
  validateTree(tree);
  validateState(tree, state);
  if (findNode(tree, id) === undefined) throw new Error(`unknown patent "${id}"`);
  if (state.unlocked.includes(id) === enabled) {
    throw new Error(`patent "${id}" is already ${enabled ? "on" : "off"}`);
  }
  return { unlocked: enabled ? [...state.unlocked, id] : state.unlocked.filter((owned) => owned !== id) };
}

/** Summary of the effects granted by the currently-unlocked patents. */
export interface ActiveEffects {
  /** Total factory width expansion from all unlocked expandFactory nodes. */
  readonly factoryDw: number;
  /** Total factory height expansion from all unlocked expandFactory nodes. */
  readonly factoryDh: number;
  /** Extra sensor radius applied only while an actual Research trail runs. */
  readonly revealAid: number;
  /** Machine typeIds unlocked, in unlock order. */
  readonly unlockedMachines: readonly MachineTypeId[];
  /** Splitter and Merger tiles may be built. */
  readonly routing: boolean;
  /** Bases (map indices) switched on beyond Saline (base 0, always available), in unlock order. */
  readonly unlockedBases: readonly MapIndex[];
}

/** Summarize the effects of the unlocked patents (cold path, UI helper). */
export function activeEffects(tree: readonly PatentNode[], state: PatentState): ActiveEffects {
  validateTree(tree);
  validateState(tree, state);
  let factoryDw = 0;
  let factoryDh = 0;
  let revealAid = 0;
  let routing = false;
  const unlockedMachines: MachineTypeId[] = [];
  const unlockedBases: MapIndex[] = [];

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
      case "unlockRouting":
        routing = true;
        break;
      case "unlockBase":
        unlockedBases.push(e.base);
        break;
    }
  }

  return { factoryDw, factoryDh, revealAid, unlockedMachines, routing, unlockedBases };
}
