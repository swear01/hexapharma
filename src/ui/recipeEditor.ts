import type { Machine, Rotation } from "../sim/phase0_interfaces";

export interface RecipeEditorSnapshot {
  readonly steps: readonly Machine[];
  readonly selectedIndex: number | null;
}

export interface RecipeEditorState {
  readonly steps: readonly Machine[];
  readonly selectedIndex: number | null;
  readonly held: Machine | null;
  readonly insertionIndex: number | null;
  readonly past: readonly RecipeEditorSnapshot[];
  readonly future: readonly RecipeEditorSnapshot[];
}

export type RecipeEditorAction =
  | { readonly type: "pick"; readonly machine: Machine }
  | { readonly type: "hoverInsertion"; readonly index: number | null }
  | { readonly type: "commitHeld"; readonly index?: number }
  | { readonly type: "select"; readonly index: number | null }
  | { readonly type: "rotate" }
  | { readonly type: "flip" }
  | { readonly type: "removeSelected" }
  | { readonly type: "clear" }
  | { readonly type: "move"; readonly from: number; readonly toInsertionIndex: number }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "cancel" }
  | { readonly type: "reset"; readonly steps?: readonly Machine[] }
  | { readonly type: "replace"; readonly steps: readonly Machine[] };

const MAX_HISTORY = 50;

function clampIndex(value: number, max: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(max, Math.max(0, integer));
}

function snapshot(state: RecipeEditorState): RecipeEditorSnapshot {
  return { steps: state.steps, selectedIndex: state.selectedIndex };
}

function commitMutation(
  state: RecipeEditorState,
  steps: readonly Machine[],
  selectedIndex: number | null,
  held: Machine | null = null,
  insertionIndex: number | null = null,
): RecipeEditorState {
  return {
    steps,
    selectedIndex,
    held,
    insertionIndex,
    past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
    future: [],
  };
}

function sameMachine(a: Machine, b: Machine): boolean {
  if (a.typeId !== b.typeId || a.transform.kind !== b.transform.kind) return false;
  if (a.orientation.rot !== b.orientation.rot || a.orientation.flip !== b.orientation.flip) return false;
  if (a.transform.kind === "translate" && b.transform.kind === "translate") {
    return a.transform.relation === b.transform.relation &&
      a.transform.delta.x === b.transform.delta.x &&
      a.transform.delta.y === b.transform.delta.y;
  }
  if (a.transform.kind === "scale" && b.transform.kind === "scale") {
    return a.transform.num === b.transform.num && a.transform.den === b.transform.den;
  }
  if (a.transform.kind === "swap" && b.transform.kind === "swap") {
    return a.transform.a === b.transform.a && a.transform.b === b.transform.b;
  }
  return false;
}

function sameSteps(a: readonly Machine[], b: readonly Machine[]): boolean {
  return a.length === b.length && a.every((machine, index) => {
    const other = b[index];
    return other !== undefined && sameMachine(machine, other);
  });
}

function orient(machine: Machine, action: "rotate" | "flip"): Machine {
  if (machine.transform.kind !== "translate") return machine;
  return {
    ...machine,
    orientation: action === "rotate"
      ? { ...machine.orientation, rot: ((machine.orientation.rot + 1) % 4) as Rotation }
      : { ...machine.orientation, flip: !machine.orientation.flip },
  };
}

export function createRecipeEditor(steps: readonly Machine[] = []): RecipeEditorState {
  return {
    steps: [...steps],
    selectedIndex: null,
    held: null,
    insertionIndex: null,
    past: [],
    future: [],
  };
}

export function recipeEditorReducer(
  state: RecipeEditorState,
  action: RecipeEditorAction,
): RecipeEditorState {
  switch (action.type) {
    case "pick":
      return {
        ...state,
        selectedIndex: null,
        held: action.machine,
        insertionIndex: state.steps.length,
      };
    case "hoverInsertion": {
      if (state.held === null) return state;
      const insertionIndex = action.index === null
        ? null
        : clampIndex(action.index, state.steps.length);
      if (insertionIndex === state.insertionIndex) return state;
      return { ...state, insertionIndex };
    }
    case "commitHeld": {
      if (state.held === null) return state;
      const requested = action.index ?? state.insertionIndex ?? state.steps.length;
      const index = clampIndex(requested, state.steps.length);
      const steps = [...state.steps];
      steps.splice(index, 0, state.held);
      return commitMutation(state, steps, null, state.held, index + 1);
    }
    case "select": {
      if (action.index === null) {
        if (state.selectedIndex === null) return state;
        return { ...state, selectedIndex: null };
      }
      const selectedIndex = state.steps.length === 0
        ? null
        : clampIndex(action.index, state.steps.length - 1);
      if (
        selectedIndex === state.selectedIndex &&
        state.held === null &&
        state.insertionIndex === null
      ) return state;
      return { ...state, selectedIndex, held: null, insertionIndex: null };
    }
    case "rotate":
    case "flip": {
      if (state.held !== null) {
        const held = orient(state.held, action.type);
        return held === state.held ? state : { ...state, held };
      }
      if (state.selectedIndex === null) return state;
      const machine = state.steps[state.selectedIndex];
      if (machine === undefined) return state;
      const changed = orient(machine, action.type);
      if (changed === machine) return state;
      const steps = [...state.steps];
      steps[state.selectedIndex] = changed;
      return commitMutation(state, steps, state.selectedIndex);
    }
    case "removeSelected": {
      if (state.selectedIndex === null || state.steps[state.selectedIndex] === undefined) return state;
      const steps = [...state.steps];
      steps.splice(state.selectedIndex, 1);
      const selectedIndex = steps.length === 0 ? null : Math.min(state.selectedIndex, steps.length - 1);
      return commitMutation(state, steps, selectedIndex);
    }
    case "clear":
      return state.steps.length === 0 ? state : commitMutation(state, [], null);
    case "move": {
      if (state.steps.length === 0) return state;
      const from = clampIndex(action.from, state.steps.length - 1);
      const insertion = clampIndex(action.toInsertionIndex, state.steps.length);
      const target = insertion > from ? insertion - 1 : insertion;
      if (target === from) return state;
      const steps = [...state.steps];
      const [machine] = steps.splice(from, 1);
      if (machine === undefined) return state;
      steps.splice(target, 0, machine);
      return commitMutation(state, steps, target);
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (previous === undefined) return state;
      return {
        steps: previous.steps,
        selectedIndex: previous.selectedIndex,
        held: null,
        insertionIndex: null,
        past: state.past.slice(0, -1),
        future: [snapshot(state), ...state.future],
      };
    }
    case "redo": {
      const next = state.future[0];
      if (next === undefined) return state;
      return {
        steps: next.steps,
        selectedIndex: next.selectedIndex,
        held: null,
        insertionIndex: null,
        past: [...state.past, snapshot(state)].slice(-MAX_HISTORY),
        future: state.future.slice(1),
      };
    }
    case "cancel":
      return state.selectedIndex === null && state.held === null && state.insertionIndex === null
        ? state
        : { ...state, selectedIndex: null, held: null, insertionIndex: null };
    case "reset":
      return createRecipeEditor(action.steps);
    case "replace":
      return sameSteps(state.steps, action.steps)
        ? state
        : commitMutation(state, [...action.steps], null);
  }
}
