import { describe, it, expect } from "vitest";
import type { PatentNode, PatentState } from "../phase0_interfaces";
import {
  DEFAULT_PATENTS,
  canUnlock,
  unlockPatent,
  activeEffects,
} from "./index";

const empty: PatentState = { unlocked: [] };

const customRoot: PatentNode = {
  id: "root",
  cost: 1,
  researchCost: 0,
  requires: [],
  effect: { kind: "revealAid", amount: 1 },
};

const customChild: PatentNode = {
  id: "child",
  cost: 2,
  researchCost: 1,
  requires: ["root"],
  effect: { kind: "unlockMap" },
};

const validCustomTree: readonly PatentNode[] = [customRoot, customChild];

function costOf(id: string): number {
  const node = DEFAULT_PATENTS.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no such test node ${id}`);
  return node.cost;
}

function researchOf(id: string): number {
  const node = DEFAULT_PATENTS.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no such test node ${id}`);
  return node.researchCost;
}

describe("DEFAULT_PATENTS tree", () => {
  it("has unique ids", () => {
    const ids = DEFAULT_PATENTS.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every requires references a real node", () => {
    const ids = new Set(DEFAULT_PATENTS.map((n) => n.id));
    for (const node of DEFAULT_PATENTS) {
      for (const req of node.requires) {
        expect(ids.has(req)).toBe(true);
      }
    }
  });

  it("contains one of each effect kind and a prereq chain", () => {
    const kinds = new Set(DEFAULT_PATENTS.map((n) => n.effect.kind));
    expect(kinds).toEqual(
      new Set(["expandFactory", "revealAid", "unlockMachine", "unlockMap"]),
    );
    const newMap = DEFAULT_PATENTS.find((n) => n.id === "new-map");
    expect(newMap?.requires).toContain("bench-2");
  });
});

describe("canUnlock", () => {
  it("false for unknown id", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, 99999, 99999, "does-not-exist")).toBe(false);
  });

  it("false when too poor", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, costOf("bench-2") - 1, 99999, "bench-2")).toBe(false);
  });

  it("false when a prerequisite is missing", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, 99999, 99999, "new-map")).toBe(false);
  });

  it("false when already unlocked", () => {
    const state: PatentState = { unlocked: ["bench-2"] };
    expect(canUnlock(DEFAULT_PATENTS, state, 99999, 99999, "bench-2")).toBe(false);
  });

  it("true when all conditions satisfied", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, costOf("bench-2"), researchOf("bench-2"), "bench-2")).toBe(true);
  });

  it("true at exactly the cost (boundary)", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, costOf("reveal-aid"), researchOf("reveal-aid"), "reveal-aid")).toBe(true);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("throws when cash is not a safe integer: %s", (cash) => {
    expect(() => canUnlock(DEFAULT_PATENTS, empty, cash, 100, "bench-2")).toThrow(/cash.*safe integer/i);
  });

  it.each([
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("throws when research is not a non-negative safe integer: %s", (research) => {
    expect(() => canUnlock(DEFAULT_PATENTS, empty, 100, research, "bench-2")).toThrow(
      /research.*non-negative safe integer/i,
    );
  });

  it("allows a negative safe-integer cash balance and reports unaffordable", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, -1, 100, "bench-2")).toBe(false);
  });
});

describe("patent input authority", () => {
  it("rejects duplicate tree ids instead of using the first match", () => {
    const tree: readonly PatentNode[] = [customRoot, { ...customRoot }];
    expect(() => canUnlock(tree, empty, 100, 100, "root")).toThrow(/duplicate.*root/i);
    expect(() => unlockPatent(tree, empty, 100, 100, "root")).toThrow(/duplicate.*root/i);
  });

  it("rejects unknown and duplicate prerequisites in the tree", () => {
    const unknown: readonly PatentNode[] = [
      customRoot,
      { ...customChild, requires: ["missing"] },
    ];
    const duplicated: readonly PatentNode[] = [
      customRoot,
      { ...customChild, requires: ["root", "root"] },
    ];
    expect(() => canUnlock(unknown, empty, 100, 100, "root")).toThrow(/unknown prerequisite.*missing/i);
    expect(() => canUnlock(duplicated, empty, 100, 100, "root")).toThrow(/duplicate prerequisite.*root/i);
  });

  it("rejects prerequisite cycles in the tree", () => {
    const tree: readonly PatentNode[] = [
      { ...customRoot, requires: ["child"] },
      customChild,
    ];
    expect(() => canUnlock(tree, empty, 100, 100, "root")).toThrow(/cycle/i);
  });

  it("rejects invalid node costs", () => {
    const invalidCashCost: readonly PatentNode[] = [
      { ...customRoot, cost: -1 },
    ];
    const invalidResearchCost: readonly PatentNode[] = [
      { ...customRoot, researchCost: 0.5 },
    ];
    expect(() => canUnlock(invalidCashCost, empty, 100, 100, "root")).toThrow(
      /cost.*non-negative safe integer/i,
    );
    expect(() => canUnlock(invalidResearchCost, empty, 100, 100, "root")).toThrow(
      /researchCost.*non-negative safe integer/i,
    );
  });

  it("rejects unknown, duplicate, and prerequisite-out-of-order unlocked state", () => {
    expect(() => canUnlock(validCustomTree, { unlocked: ["missing"] }, 100, 100, "root")).toThrow(
      /unknown unlocked patent.*missing/i,
    );
    expect(() => canUnlock(validCustomTree, { unlocked: ["root", "root"] }, 100, 100, "child")).toThrow(
      /duplicate unlocked patent.*root/i,
    );
    expect(() => canUnlock(validCustomTree, { unlocked: ["child", "root"] }, 100, 100, "root")).toThrow(
      /child.*before prerequisite.*root/i,
    );
  });
});

describe("unlockPatent", () => {
  it("spends exactly the cost and appends the id", () => {
    const cash = 500;
    const res = unlockPatent(DEFAULT_PATENTS, empty, cash, 100, "bench-2");
    expect(res.cash).toBe(cash - costOf("bench-2"));
    expect(res.research).toBe(100 - researchOf("bench-2"));
    expect(res.patents.unlocked).toEqual(["bench-2"]);
  });

  it("is order-stable (unlock order preserved)", () => {
    let state: PatentState = empty;
    let cash = 1000;
    let research = 100;
    for (const id of ["reveal-aid", "bench-2", "skew-unlock"]) {
      const res = unlockPatent(DEFAULT_PATENTS, state, cash, research, id);
      state = res.patents;
      cash = res.cash;
      research = res.research;
    }
    expect(state.unlocked).toEqual(["reveal-aid", "bench-2", "skew-unlock"]);
  });

  it("does not mutate the input state", () => {
    const before: PatentState = { unlocked: [] };
    unlockPatent(DEFAULT_PATENTS, before, 500, 100, "bench-2");
    expect(before.unlocked).toEqual([]);
  });

  it("throws on unknown id", () => {
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 99999, 99999, "nope")).toThrow(/unknown/);
  });

  it("throws when too poor", () => {
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 0, 99999, "bench-2")).toThrow(/cash/);
  });

  it("throws when prereq missing", () => {
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 99999, 99999, "new-map")).toThrow(/requires/);
  });

  it("throws when already unlocked", () => {
    const state: PatentState = { unlocked: ["bench-2"] };
    expect(() => unlockPatent(DEFAULT_PATENTS, state, 99999, 99999, "bench-2")).toThrow(/already/);
  });
});

describe("prereq chain (new-map requires bench-2)", () => {
  it("cannot unlock new-map before bench-2", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, 99999, 99999, "new-map")).toBe(false);
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 99999, 99999, "new-map")).toThrow();
  });

  it("can unlock new-map after bench-2", () => {
    const afterBench = unlockPatent(DEFAULT_PATENTS, empty, 99999, 99999, "bench-2");
    expect(canUnlock(DEFAULT_PATENTS, afterBench.patents, afterBench.cash, afterBench.research, "new-map")).toBe(true);
    const res = unlockPatent(DEFAULT_PATENTS, afterBench.patents, afterBench.cash, afterBench.research, "new-map");
    expect(res.patents.unlocked).toEqual(["bench-2", "new-map"]);
  });
});

describe("determinism", () => {
  it("same inputs produce field-equal outputs", () => {
    const a = unlockPatent(DEFAULT_PATENTS, empty, 500, 100, "skew-unlock");
    const b = unlockPatent(DEFAULT_PATENTS, empty, 500, 100, "skew-unlock");
    expect(a).toEqual(b);
    expect(canUnlock(DEFAULT_PATENTS, empty, 100, 100, "skew-unlock")).toBe(
      canUnlock(DEFAULT_PATENTS, empty, 100, 100, "skew-unlock"),
    );
  });
});

describe("activeEffects", () => {
  it("empty state grants nothing", () => {
    expect(activeEffects(DEFAULT_PATENTS, empty)).toEqual({
      factoryDw: 0,
      factoryDh: 0,
      revealAid: 0,
      unlockedMachines: [],
      newMapUnlocked: false,
    });
  });

  it("aggregates all unlocked effects", () => {
    const state: PatentState = {
      unlocked: ["bench-2", "reveal-aid", "skew-unlock", "dilute-unlock", "new-map"],
    };
    const eff = activeEffects(DEFAULT_PATENTS, state);
    expect(eff.factoryDw).toBe(2);
    expect(eff.factoryDh).toBe(0);
    expect(eff.revealAid).toBe(3);
    expect(eff.unlockedMachines).toEqual(["skew", "dilute"]);
    expect(eff.newMapUnlocked).toBe(true);
  });

  it("unlockedMachines follow unlock order", () => {
    const tree: readonly PatentNode[] = [
      { id: "m-a", cost: 0, researchCost: 0, requires: [], effect: { kind: "unlockMachine", typeId: "alpha" } },
      { id: "m-b", cost: 0, researchCost: 0, requires: [], effect: { kind: "unlockMachine", typeId: "beta" } },
    ];
    expect(activeEffects(tree, { unlocked: ["m-b", "m-a"] }).unlockedMachines).toEqual([
      "beta",
      "alpha",
    ]);
  });

  it("throws on an unknown unlocked id instead of silently ignoring it", () => {
    expect(() => activeEffects(validCustomTree, { unlocked: ["missing"] })).toThrow(
      /unknown unlocked patent.*missing/i,
    );
  });

  it("throws on duplicate unlocked ids instead of applying an effect twice", () => {
    expect(() => activeEffects(validCustomTree, { unlocked: ["root", "root"] })).toThrow(
      /duplicate unlocked patent.*root/i,
    );
  });

  it("throws when an unlocked patent appears before its prerequisite", () => {
    expect(() => activeEffects(validCustomTree, { unlocked: ["child", "root"] })).toThrow(
      /child.*before prerequisite.*root/i,
    );
  });

  it("rejects aggregate effect totals that exceed the safe-integer range", () => {
    const tree: readonly PatentNode[] = [
      {
        id: "wide-a",
        cost: 0,
        researchCost: 0,
        requires: [],
        effect: { kind: "expandFactory", dw: Number.MAX_SAFE_INTEGER, dh: 0 },
      },
      {
        id: "wide-b",
        cost: 0,
        researchCost: 0,
        requires: [],
        effect: { kind: "expandFactory", dw: Number.MAX_SAFE_INTEGER, dh: 0 },
      },
    ];
    expect(() => activeEffects(tree, { unlocked: ["wide-a", "wide-b"] })).toThrow(
      /aggregate.*safe integer/i,
    );
  });
});
