import { describe, expect, it } from "vitest";
import type { Machine } from "../sim/phase0_interfaces";
import { createRecipeEditor, recipeEditorReducer } from "./recipeEditor";

const push = (rot: 0 | 1 | 2 | 3 = 0, flip = false): Machine => ({
  typeId: "push",
  transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "forward" },
  orientation: { rot, flip },
});
const pull = (): Machine => ({
  typeId: "pull",
  transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "reverse" },
  orientation: { rot: 0, flip: false },
});
const dilute = (): Machine => ({
  typeId: "dilute",
  transform: { kind: "scale", num: 1, den: 2 },
  orientation: { rot: 0, flip: false },
});

describe("recipe editor held placement", () => {
  it("picks without history, clamps insertion hover, and commits repeatedly", () => {
    const initial = createRecipeEditor([push()]);
    const picked = recipeEditorReducer(initial, { type: "pick", machine: pull() });
    expect(picked).toMatchObject({ selectedIndex: null, insertionIndex: 1 });
    expect(picked.past).toEqual([]);

    const hovered = recipeEditorReducer(picked, { type: "hoverInsertion", index: 99 });
    expect(hovered.insertionIndex).toBe(1);
    const once = recipeEditorReducer(hovered, { type: "commitHeld" });
    expect(once.steps.map((machine) => machine.typeId)).toEqual(["push", "pull"]);
    expect(once.held?.typeId).toBe("pull");
    expect(once.insertionIndex).toBe(2);
    expect(once.past).toHaveLength(1);

    const twice = recipeEditorReducer(once, { type: "commitHeld", index: -20 });
    expect(twice.steps.map((machine) => machine.typeId)).toEqual(["pull", "push", "pull"]);
    expect(twice.insertionIndex).toBe(1);
    expect(twice.past).toHaveLength(2);
    expect(initial.steps).toHaveLength(1);
  });

  it("keeps held and selection mutually exclusive and cancel clears all transient targets", () => {
    const held = recipeEditorReducer(createRecipeEditor([push()]), { type: "pick", machine: pull() });
    const selected = recipeEditorReducer(held, { type: "select", index: 8 });
    expect(selected).toMatchObject({ selectedIndex: 0, held: null, insertionIndex: null });
    expect(selected.past).toEqual([]);

    const repicked = recipeEditorReducer(selected, { type: "pick", machine: pull() });
    expect(repicked.selectedIndex).toBeNull();
    const cancelled = recipeEditorReducer(repicked, { type: "cancel" });
    expect(cancelled).toMatchObject({ selectedIndex: null, held: null, insertionIndex: null });
    expect(cancelled.past).toEqual([]);
  });
});

describe("recipe editor orientation", () => {
  it("rotates and flips held translates without recipe history", () => {
    const held = recipeEditorReducer(createRecipeEditor(), { type: "pick", machine: push() });
    const rotated = recipeEditorReducer(held, { type: "rotate" });
    const flipped = recipeEditorReducer(rotated, { type: "flip" });
    expect(flipped.held?.orientation).toEqual({ rot: 1, flip: true });
    expect(flipped.steps).toEqual([]);
    expect(flipped.past).toEqual([]);
  });

  it("mutates selected translates through history and ignores non-translates", () => {
    const selected = recipeEditorReducer(createRecipeEditor([push(), dilute()]), {
      type: "select",
      index: 0,
    });
    const rotated = recipeEditorReducer(selected, { type: "rotate" });
    expect(rotated.steps[0]?.orientation.rot).toBe(1);
    expect(rotated.past).toHaveLength(1);

    const scaleSelected = recipeEditorReducer(rotated, { type: "select", index: 1 });
    expect(recipeEditorReducer(scaleSelected, { type: "flip" })).toBe(scaleSelected);
  });
});

describe("recipe editor mutations and history", () => {
  it("removes, clears, replaces, undoes, redoes, and clears a redo branch", () => {
    const selected = recipeEditorReducer(createRecipeEditor([push(), pull()]), {
      type: "select",
      index: 1,
    });
    const removed = recipeEditorReducer(selected, { type: "removeSelected" });
    expect(removed.steps.map((machine) => machine.typeId)).toEqual(["push"]);
    expect(removed.selectedIndex).toBe(0);

    const cleared = recipeEditorReducer(removed, { type: "clear" });
    expect(cleared.steps).toEqual([]);
    const undone = recipeEditorReducer(cleared, { type: "undo" });
    expect(undone.steps.map((machine) => machine.typeId)).toEqual(["push"]);
    expect(undone.selectedIndex).toBe(0);
    const redone = recipeEditorReducer(undone, { type: "redo" });
    expect(redone.steps).toEqual([]);

    const back = recipeEditorReducer(redone, { type: "undo" });
    const replaced = recipeEditorReducer(back, { type: "replace", steps: [dilute()] });
    expect(replaced.steps[0]?.typeId).toBe("dilute");
    expect(replaced.future).toEqual([]);
    expect(recipeEditorReducer(replaced, { type: "redo" })).toBe(replaced);
  });

  it("moves by insertion slots with clamped indices and adjusts the selected index", () => {
    const state = createRecipeEditor([push(), pull(), dilute()]);
    const movedLast = recipeEditorReducer(state, { type: "move", from: -5, toInsertionIndex: 99 });
    expect(movedLast.steps.map((machine) => machine.typeId)).toEqual(["pull", "dilute", "push"]);
    expect(movedLast.selectedIndex).toBe(2);
    expect(movedLast.past).toHaveLength(1);

    const noOp = recipeEditorReducer(movedLast, { type: "move", from: 2, toInsertionIndex: 3 });
    expect(noOp).toBe(movedLast);
  });

  it("does not record hover, select, pick, cancel, or no-op recipe mutations", () => {
    const initial = createRecipeEditor([push()]);
    const selected = recipeEditorReducer(initial, { type: "select", index: null });
    const hovered = recipeEditorReducer(selected, { type: "hoverInsertion", index: 0 });
    const noRemove = recipeEditorReducer(hovered, { type: "removeSelected" });
    const sameReplace = recipeEditorReducer(noRemove, { type: "replace", steps: [push()] });
    expect(sameReplace.past).toEqual([]);
    expect(recipeEditorReducer(sameReplace, { type: "commitHeld" })).toBe(sameReplace);
  });

  it("resets recipe authority and history for a newly generated level", () => {
    const edited = recipeEditorReducer(createRecipeEditor([push()]), { type: "clear" });
    const reset = recipeEditorReducer(edited, { type: "reset", steps: [pull()] });
    expect(reset).toEqual(createRecipeEditor([pull()]));
    expect(recipeEditorReducer(reset, { type: "undo" })).toBe(reset);
  });
});
