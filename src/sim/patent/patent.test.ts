import { describe, it, expect } from "vitest";
import type { PatentNode, PatentState } from "../phase0_interfaces";
import {
  DEFAULT_PATENTS,
  canUnlock,
  unlockPatent,
  activeEffects,
} from "./index";

const empty: PatentState = { unlocked: [] };

function costOf(id: string): number {
  const node = DEFAULT_PATENTS.find((n) => n.id === id);
  if (node === undefined) throw new Error(`no such test node ${id}`);
  return node.cost;
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
    expect(canUnlock(DEFAULT_PATENTS, empty, 99999, "does-not-exist")).toBe(false);
  });

  it("false when too poor", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, costOf("bench-2") - 1, "bench-2")).toBe(false);
  });

  it("false when a prerequisite is missing", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, 99999, "new-map")).toBe(false);
  });

  it("false when already unlocked", () => {
    const state: PatentState = { unlocked: ["bench-2"] };
    expect(canUnlock(DEFAULT_PATENTS, state, 99999, "bench-2")).toBe(false);
  });

  it("true when all conditions satisfied", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, costOf("bench-2"), "bench-2")).toBe(true);
  });

  it("true at exactly the cost (boundary)", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, costOf("reveal-aid"), "reveal-aid")).toBe(true);
  });
});

describe("unlockPatent", () => {
  it("spends exactly the cost and appends the id", () => {
    const cash = 500;
    const res = unlockPatent(DEFAULT_PATENTS, empty, cash, "bench-2");
    expect(res.cash).toBe(cash - costOf("bench-2"));
    expect(res.patents.unlocked).toEqual(["bench-2"]);
  });

  it("is order-stable (unlock order preserved)", () => {
    let state: PatentState = empty;
    let cash = 1000;
    for (const id of ["reveal-aid", "bench-2", "skew-unlock"]) {
      const res = unlockPatent(DEFAULT_PATENTS, state, cash, id);
      state = res.patents;
      cash = res.cash;
    }
    expect(state.unlocked).toEqual(["reveal-aid", "bench-2", "skew-unlock"]);
  });

  it("does not mutate the input state", () => {
    const before: PatentState = { unlocked: [] };
    unlockPatent(DEFAULT_PATENTS, before, 500, "bench-2");
    expect(before.unlocked).toEqual([]);
  });

  it("throws on unknown id", () => {
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 99999, "nope")).toThrow(/unknown/);
  });

  it("throws when too poor", () => {
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 0, "bench-2")).toThrow(/cash/);
  });

  it("throws when prereq missing", () => {
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 99999, "new-map")).toThrow(/requires/);
  });

  it("throws when already unlocked", () => {
    const state: PatentState = { unlocked: ["bench-2"] };
    expect(() => unlockPatent(DEFAULT_PATENTS, state, 99999, "bench-2")).toThrow(/already/);
  });
});

describe("prereq chain (new-map requires bench-2)", () => {
  it("cannot unlock new-map before bench-2", () => {
    expect(canUnlock(DEFAULT_PATENTS, empty, 99999, "new-map")).toBe(false);
    expect(() => unlockPatent(DEFAULT_PATENTS, empty, 99999, "new-map")).toThrow();
  });

  it("can unlock new-map after bench-2", () => {
    const afterBench = unlockPatent(DEFAULT_PATENTS, empty, 99999, "bench-2");
    expect(canUnlock(DEFAULT_PATENTS, afterBench.patents, afterBench.cash, "new-map")).toBe(true);
    const res = unlockPatent(DEFAULT_PATENTS, afterBench.patents, afterBench.cash, "new-map");
    expect(res.patents.unlocked).toEqual(["bench-2", "new-map"]);
  });
});

describe("determinism", () => {
  it("same inputs produce field-equal outputs", () => {
    const a = unlockPatent(DEFAULT_PATENTS, empty, 500, "skew-unlock");
    const b = unlockPatent(DEFAULT_PATENTS, empty, 500, "skew-unlock");
    expect(a).toEqual(b);
    expect(canUnlock(DEFAULT_PATENTS, empty, 100, "skew-unlock")).toBe(
      canUnlock(DEFAULT_PATENTS, empty, 100, "skew-unlock"),
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
      { id: "m-a", cost: 0, requires: [], effect: { kind: "unlockMachine", typeId: "alpha" } },
      { id: "m-b", cost: 0, requires: [], effect: { kind: "unlockMachine", typeId: "beta" } },
    ];
    expect(activeEffects(tree, { unlocked: ["m-b", "m-a"] }).unlockedMachines).toEqual([
      "beta",
      "alpha",
    ]);
  });
});
