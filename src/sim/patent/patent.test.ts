import { describe, it, expect } from "vitest";
import type { PatentNode, PatentState } from "../phase0_interfaces";
import { DEFAULT_PATENTS, activeEffects, setPatent } from "./index";

const empty: PatentState = { unlocked: [] };

const validCustomTree: readonly PatentNode[] = [
  { id: "root", effect: { kind: "revealAid", amount: 1 } },
  { id: "child", effect: { kind: "expandFactory", dw: 0, dh: 1 } },
];

describe("DEFAULT_PATENTS", () => {
  it("has unique ids", () => {
    const ids = DEFAULT_PATENTS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains only single-Atlas effects", () => {
    const kinds = new Set(DEFAULT_PATENTS.map((n) => n.effect.kind));
    expect(kinds).toEqual(
      new Set(["expandFactory", "revealAid", "unlockMachine", "unlockRouting"]),
    );
    expect(DEFAULT_PATENTS).not.toHaveProperty("unlockMap");
  });
});

describe("setPatent", () => {
  it("turns any node on with no cost or prerequisite, in switch order", () => {
    let state = setPatent(DEFAULT_PATENTS, empty, "crane-unlock", true);
    state = setPatent(DEFAULT_PATENTS, state, "floor-depth", true);
    expect(state.unlocked).toEqual(["crane-unlock", "floor-depth"]);
  });

  it("turns a node off and keeps the others in order", () => {
    const state: PatentState = { unlocked: ["bench-2", "reveal-aid", "zigzag-unlock"] };
    expect(setPatent(DEFAULT_PATENTS, state, "reveal-aid", false).unlocked).toEqual(["bench-2", "zigzag-unlock"]);
  });

  it("does not mutate the input state", () => {
    const before: PatentState = { unlocked: [] };
    setPatent(DEFAULT_PATENTS, before, "bench-2", true);
    expect(before.unlocked).toEqual([]);
  });

  it("throws on an unknown id or a no-op switch", () => {
    expect(() => setPatent(DEFAULT_PATENTS, empty, "nope", true)).toThrow(/unknown/);
    expect(() => setPatent(DEFAULT_PATENTS, empty, "bench-2", false)).toThrow(/already off/);
    expect(() => setPatent(DEFAULT_PATENTS, { unlocked: ["bench-2"] }, "bench-2", true)).toThrow(/already on/);
  });

  it("rejects duplicate ids in the tree", () => {
    const tree: readonly PatentNode[] = [validCustomTree[0]!, validCustomTree[0]!];
    expect(() => setPatent(tree, empty, "root", true)).toThrow(/duplicate.*root/i);
  });
});

describe("activeEffects", () => {
  it("empty state grants nothing", () => {
    expect(activeEffects(DEFAULT_PATENTS, empty)).toEqual({
      factoryDw: 0,
      factoryDh: 0,
      revealAid: 0,
      unlockedMachines: [],
      routing: false,
    });
  });

  it("aggregates all switched-on effects", () => {
    const state: PatentState = {
      unlocked: ["bench-2", "reveal-aid", "split-merge", "zigzag-unlock", "loop-unlock", "floor-depth", "field-survey"],
    };
    const eff = activeEffects(DEFAULT_PATENTS, state);
    expect(eff.factoryDw).toBe(2);
    expect(eff.factoryDh).toBe(2);
    expect(eff.revealAid).toBe(7);
    expect(eff.unlockedMachines).toEqual(["zigzag", "loop"]);
    expect(eff.routing).toBe(true);
  });

  it("unlockedMachines follow switch order", () => {
    const tree: readonly PatentNode[] = [
      { id: "m-a", effect: { kind: "unlockMachine", typeId: "alpha" } },
      { id: "m-b", effect: { kind: "unlockMachine", typeId: "beta" } },
    ];
    expect(activeEffects(tree, { unlocked: ["m-b", "m-a"] }).unlockedMachines).toEqual(["beta", "alpha"]);
  });

  it("throws on an unknown or duplicated id instead of ignoring it or applying it twice", () => {
    expect(() => activeEffects(validCustomTree, { unlocked: ["missing"] })).toThrow(/unknown unlocked patent.*missing/i);
    expect(() => activeEffects(validCustomTree, { unlocked: ["root", "root"] })).toThrow(/duplicate unlocked patent.*root/i);
  });

  it("rejects aggregate effect totals that exceed the safe-integer range", () => {
    const tree: readonly PatentNode[] = [
      { id: "wide-a", effect: { kind: "expandFactory", dw: Number.MAX_SAFE_INTEGER, dh: 0 } },
      { id: "wide-b", effect: { kind: "expandFactory", dw: Number.MAX_SAFE_INTEGER, dh: 0 } },
    ];
    expect(() => activeEffects(tree, { unlocked: ["wide-a", "wide-b"] })).toThrow(/aggregate.*safe integer/i);
  });
});
