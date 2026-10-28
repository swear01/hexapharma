import { describe, expect, it } from "vitest";
import { DEFAULT_PATENTS } from "../sim/patent";
import { PATENT_TREE, patentEffectSummary, patentSwitchWarning, patentTitle, visiblePatentTree } from "./Patents";

describe("Patent destructive confirmation", () => {
  it("warns only when a factory expansion will reset commissioned Production", () => {
    const expansion = DEFAULT_PATENTS.find((node) => node.effect.kind === "expandFactory")!;
    const scanner = DEFAULT_PATENTS.find((node) => node.effect.kind === "revealAid")!;

    expect(patentSwitchWarning(expansion, false)).toBeNull();
    expect(patentSwitchWarning(scanner, true)).toBeNull();
    expect(patentSwitchWarning(expansion, true)).toMatch(/runtime.*waste.*reset/i);
  });
});

describe("Technology tree", () => {
  it("places every node exactly once", () => {
    expect([...PATENT_TREE.flat()].sort()).toEqual(DEFAULT_PATENTS.map((node) => node.id).sort());
  });

  it("offers base switches only for bases the level has", () => {
    const ids = (baseCount: number) => visiblePatentTree(baseCount).map((branch) => branch.map((node) => node.id));
    expect(ids(1)).not.toContainEqual(expect.arrayContaining(["oil-base"]));
    expect(ids(1)).toHaveLength(PATENT_TREE.length - 1);
    expect(ids(2).at(-1)).toEqual(["oil-base"]);
    expect(ids(3)).toEqual(PATENT_TREE);
  });
});

describe("Technology copy", () => {
  it("gives every node a short player-facing name instead of exposing its internal id", () => {
    expect(DEFAULT_PATENTS.map((node) => patentTitle(node.id))).toEqual([
      "Wider factory floor",
      "Deeper factory floor",
      "Trail scanner",
      "Field survey optics",
      "Split / Merge",
      "Zigzag still",
      "Loop vat",
      "Straight drive",
      "Crane arm",
      "Oil base",
      "Ethanol base",
    ]);
    for (const node of DEFAULT_PATENTS) {
      expect(patentTitle(node.id)).not.toBe(node.id);
    }
  });

  it("uses readable effect summaries and omits empty totals", () => {
    expect(patentEffectSummary({
      factoryDw: 0,
      factoryDh: 0,
      revealAid: 0,
      unlockedMachines: [],
      routing: false,
      unlockedBases: [],
    })).toEqual([]);
    expect(patentEffectSummary({
      factoryDw: 2,
      factoryDh: 3,
      revealAid: 4,
      unlockedMachines: ["zigzag", "loop"],
      unlockedBases: [2, 1],
      routing: true,
    })).toEqual([
      "Factory +2 columns",
      "Factory +3 rows",
      "Research scan radius +4 cells",
      "Splitter and Merger on",
      "Oil and Ethanol on",
      "2 machines on",
    ]);
  });
});
