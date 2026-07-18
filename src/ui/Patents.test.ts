import { describe, expect, it } from "vitest";
import { DEFAULT_PATENTS } from "../sim/patent";
import {
  patentCostLabel,
  patentEffectSummary,
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
    expect(patentCostLabel(DEFAULT_PATENTS[0]!)).toBe("120 cash · 2 Knowledge");
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
});
