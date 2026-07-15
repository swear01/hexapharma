import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG,
  MAX_FACTORY_REPLAY_TICKS,
  MAX_GAME_FACTORY_CELLS,
  MAX_GAME_REPLAY_WORK,
  type FactoryLayout,
  type GameIntent,
  type GenOptions,
  type Template,
} from "./phase0_interfaces";
import { MAX_INTENT_TRACE } from "./game";
import { generate } from "./mapgen";
import { compileEntitledPrototype } from "./recipe";
import { estimateGameReplayWork } from "./replay-work";

const options: GenOptions = {
  seed: 14,
  nMaps: 2,
  width: 32,
  height: 32,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 2,
  difficulty: { min: 4, max: 12 },
};

function emptyLayout(width: number, height: number, source = false): FactoryLayout {
  const tiles: FactoryLayout["tiles"][number][] = Array.from(
    { length: width * height },
    () => ({ kind: "empty" }),
  );
  if (source) {
    tiles[0] = { kind: "source", dir: 0, period: 1 };
    tiles[1] = { kind: "sink" };
  }
  return { width, height, tiles, machines: [] };
}

function program(stepCount: number): Template {
  const entry = DEFAULT_CATALOG[0]!;
  return {
    steps: Array.from({ length: stepCount }, () => ({
      typeId: entry.typeId,
      path: entry.path,
    })),
  };
}

describe("game replay work", () => {
  it("accepts one to four Atlas layers and rejects invalid map authority", () => {
    for (let nMaps = 1; nMaps <= 4; nMaps++) {
      expect(estimateGameReplayWork({ ...options, nMaps, diseaseCount: nMaps }, []))
        .toBe(nMaps * options.width * options.height * 32);
    }
    expect(() => estimateGameReplayWork({ ...options, nMaps: 5 }, [])).toThrow(/map dimensions/i);
  });

  it("charges ResearchProgram validation and only completed path steps", () => {
    const mapCells = options.nMaps * options.width * options.height;
    const value = program(3);
    expect(estimateGameReplayWork(options, [
      { kind: "setResearchProgram", program: value },
      { kind: "beginResearchShot" },
      { kind: "advanceResearchShot" },
      { kind: "abortResearchShot" },
    ])).toBe(
      mapCells * 32 +
      mapCells * 7 +
      mapCells * 7 +
      mapCells * 5 +
      1
    );
  });

  it("profiles the always-present empty Production floor before its first build", () => {
    const mapCells = options.nMaps * options.width * options.height;
    const area = 24 * 12;
    expect(estimateGameReplayWork(options, [
      { kind: "productionTicks", ticks: 1 },
    ])).toBe(mapCells * 32 + area * 20 + area);
  });

  it("bounds an adversarial Research trace using program step count", () => {
    const maximumMaps = { ...options, nMaps: 4, diseaseCount: 4 };
    const trace: GameIntent[] = [{ kind: "setResearchProgram", program: program(256) }];
    for (let index = 1; index < MAX_INTENT_TRACE; index++) {
      trace.push(index % 3 === 0
        ? { kind: "beginResearchShot" }
        : index % 3 === 1
          ? { kind: "advanceResearchShot" }
          : { kind: "abortResearchShot" });
    }
    expect(estimateGameReplayWork(maximumMaps, trace)).toBeGreaterThan(50_000_000);
  });

  it("prices Production area, carrier capacity, and arbitration exactly", () => {
    const width = 4;
    const height = 3;
    const tiles: FactoryLayout["tiles"][number][] = Array.from(
      { length: width * height },
      () => ({ kind: "empty" }),
    );
    tiles[0] = { kind: "source", dir: 0, period: 1 };
    tiles[1] = { kind: "belt", dir: 0 };
    tiles[2] = { kind: "belt", dir: 0 };
    tiles[3] = { kind: "sink" };
    const layout: FactoryLayout = { width, height, tiles, machines: [] };
    const mapCells = options.nMaps * options.width * options.height;
    const cold = width * height * 20;
    const carriers = 2;
    const sources = 1;
    const perTick = width * height + 4 * carriers + (carriers + sources) ** 2;

    expect(estimateGameReplayWork(options, [
      { kind: "buildProductionLayout", layout },
      { kind: "productionTicks", ticks: 10 },
    ])).toBe(mapCells * 32 + cold + cold + perTick * 10);
  });

  it("charges direct Production construction without any Research contract", () => {
    const layout = emptyLayout(24, 12, true);
    const area = layout.width * layout.height;
    const mapCells = options.nMaps * options.width * options.height;
    const cold = area * 20;

    expect(estimateGameReplayWork(options, [
      { kind: "setResearchProgram", program: program(2) },
      { kind: "setPilotLayout", layout },
      { kind: "buildProductionLayout", layout },
    ])).toBe(mapCells * 32 + mapCells * 6 + cold + cold);
  });

  it("keeps Pilot and Production profiles independent", () => {
    const production = emptyLayout(4, 3);
    const pilot = emptyLayout(10, 3);
    const mapCells = options.nMaps * options.width * options.height;
    const productionCold = 4 * 3 * 20;
    const pilotCold = 10 * 3 * 20;
    const productionPerTick = 4 * 3;

    expect(estimateGameReplayWork(options, [
      { kind: "buildProductionLayout", layout: production },
      { kind: "setResearchProgram", program: program(1) },
      { kind: "setPilotLayout", layout: pilot },
      { kind: "abortResearchShot" },
      { kind: "productionTicks", ticks: 10 },
      { kind: "resetProduction" },
    ])).toBe(
      mapCells * 32 + productionCold + mapCells * 5 + pilotCold + 1 +
      productionCold + productionPerTick * 10 + productionCold
    );
  });

  it("expands only spatial Pilot and Production profiles for the bench patent", () => {
    const layout = emptyLayout(4, 3);
    const mapCells = options.nMaps * options.width * options.height;
    const currentCold = 4 * 3 * 20;
    const expandedCold = 6 * 3 * 20;

    expect(estimateGameReplayWork(options, [
      { kind: "setResearchProgram", program: program(1) },
      { kind: "setPilotLayout", layout },
      { kind: "buildProductionLayout", layout },
      { kind: "unlockPatent", id: "bench-2" },
    ])).toBe(
      mapCells * 32 + mapCells * 5 + 2 * currentCold + 262_144 + 2 * expandedCold
    );
  });

  it("does not charge first-product analysis when building a Pilot layout in Production", () => {
    const width = 64;
    const height = MAX_GAME_FACTORY_CELLS / width;
    const layout = emptyLayout(width, height, true);
    const mapCells = options.nMaps * options.width * options.height;
    const cold = width * height * 20;
    expect(estimateGameReplayWork(options, [
      { kind: "setPilotLayout", layout },
      { kind: "buildProductionLayout", layout },
    ])).toBe(mapCells * 32 + cold + cold);
  });

  it("keeps the canonical generated route within the replay cap", () => {
    const productionOptions = { ...options, nMaps: 1, width: 63, height: 63, diseaseCount: 1 };
    const recipe = generate(productionOptions).diseases[0]!.reference;
    const layout = compileEntitledPrototype(recipe, 24, 12).layout;
    expect(estimateGameReplayWork(productionOptions, [
      { kind: "buildProductionLayout", layout },
      { kind: "productionTicks", ticks: MAX_FACTORY_REPLAY_TICKS },
    ])).toBeLessThanOrEqual(MAX_GAME_REPLAY_WORK);
  });

  it("charges floor-depth as a factory expansion without resetting Research", () => {
    const layout = emptyLayout(4, 3);
    const trace: readonly GameIntent[] = [
      { kind: "setResearchProgram", program: program(1) },
      { kind: "setPilotLayout", layout },
      { kind: "buildProductionLayout", layout },
      { kind: "unlockPatent", id: "floor-depth" },
      { kind: "beginResearchShot" },
    ];
    const withExpansion = estimateGameReplayWork(options, trace);
    const withoutExpansion = estimateGameReplayWork(options, trace.filter(
      (intent) => intent.kind !== "unlockPatent",
    ));
    expect(withExpansion).toBeGreaterThan(withoutExpansion);
  });
});
