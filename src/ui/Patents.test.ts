import { describe, expect, it } from "vitest";
import { DEFAULT_PATENTS } from "../sim/patent";
import {
  patentCostLabel,
  patentContractRequirement,
  patentEffectSummary,
  patentGroup,
  patentShortfall,
  patentTitle,
  patentUnlockWarning,
} from "./Patents";

describe("Patent destructive confirmation", () => {
  it("warns only when a factory expansion will reset commissioned Production", () => {
    const expansion = DEFAULT_PATENTS.find((node) => node.effect.kind === "expandFactory")!;
    const scanner = DEFAULT_PATENTS.find((node) => node.effect.kind === "revealAid")!;

    expect(patentUnlockWarning(expansion, false)).toBeNull();
    expect(patentUnlockWarning(scanner, true)).toBeNull();
    expect(patentUnlockWarning(expansion, true)).toMatch(/runtime.*waste.*reset/i);
  });
});

describe("Technology copy", () => {
  it("gives every node a short player-facing name instead of exposing its internal id", () => {
    expect(DEFAULT_PATENTS.map((node) => patentTitle(node.id))).toEqual([
      "Wider factory floor",
      "Trail scanner",
      "Zigzag still",
      "Loop vat",
      "Deeper factory floor",
      "Field survey optics",
      "Settler path",
    ]);
    for (const node of DEFAULT_PATENTS) {
      expect(patentTitle(node.id)).not.toBe(node.id);
    }
  });

  it("uses the HUD resource name for Technology costs", () => {
    expect(patentCostLabel(DEFAULT_PATENTS[0]!)).toBe("$120 · 2 Knowledge");
    expect(patentCostLabel(DEFAULT_PATENTS[1]!)).not.toMatch(/R&D/i);
  });

  it("uses readable effect summaries and omits empty totals", () => {
    expect(patentEffectSummary({
      factoryDw: 0,
      factoryDh: 0,
      revealAid: 0,
      unlockedMachines: [],
    })).toEqual([]);
    expect(patentEffectSummary({
      factoryDw: 2,
      factoryDh: 3,
      revealAid: 4,
      unlockedMachines: ["skew", "dilute"],
    })).toEqual([
      "Factory +2 columns",
      "Factory +3 rows",
      "Research scan radius +4 cells",
      "2 machines unlocked",
    ]);
  });

  it("names an incomplete shipping contract that gates a machine patent", () => {
    expect(patentContractRequirement("skew-unlock", [
      { disease: 0, sold: 2, quota: 3, completed: false },
    ])).toBe("Ship 1 more for Disease 1 contract (2/3)");
    expect(patentContractRequirement("skew-unlock", [
      { disease: 0, sold: 3, quota: 3, completed: true },
    ])).toBeNull();
    expect(patentContractRequirement("dilute-unlock", []))
      .toBe("Disease 2 contract unavailable");
    expect(patentContractRequirement("reveal-aid", [])).toBeNull();
  });
});

describe("Technology availability", () => {
  const node = (id: string) => DEFAULT_PATENTS.find((candidate) => candidate.id === id)!;

  it("names only the resource that is actually short", () => {
    expect(patentShortfall(node("bench-2"), 500, 0)).toBe("Need 2 more Knowledge");
    expect(patentShortfall(node("bench-2"), 100, 5)).toBe("Need $20 more cash");
    expect(patentShortfall(node("bench-2"), 100, 1)).toBe("Need $20 more cash and 1 more Knowledge");
    expect(patentShortfall(node("bench-2"), 120, 2)).toBeNull();
  });

  it("groups nodes by what blocks them", () => {
    expect(patentGroup(node("bench-2"), [], null)).toBe("available");
    expect(patentGroup(node("skew-unlock"), [], "Ship 3 more for Disease 1 contract (0/3)")).toBe("contract");
    expect(patentGroup(node("dilute-unlock"), [], "Ship 3 more for Disease 2 contract (0/3)")).toBe("requires");
    expect(patentGroup(node("dilute-unlock"), ["bench-2"], "Ship 3 more for Disease 2 contract (0/3)")).toBe("contract");
    expect(patentGroup(node("bench-2"), ["bench-2"], null)).toBe("owned");
  });
});
