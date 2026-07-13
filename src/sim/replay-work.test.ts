import { describe, expect, it } from "vitest";
import { generate } from "./mapgen";
import {
  DEFAULT_CATALOG,
  MAX_GAME_FACTORY_CELLS,
  MAX_GAME_REPLAY_WORK,
  MAX_FACTORY_REPLAY_TICKS,
  type FactoryLayout,
  type GenOptions,
  type GameIntent,
} from "./phase0_interfaces";
import { MAX_INTENT_TRACE } from "./game";
import { estimateGameReplayWork } from "./replay-work";
import { compileEntitledPrototype, compileTemplate } from "./recipe";

const options: GenOptions = {
  seed: 14,
  nMaps: 2,
  width: 32,
  height: 32,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 2,
  difficulty: { min: 4, max: 12 },
};

function emptyLayout(width: number, height: number): FactoryLayout {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ kind: "empty" as const })),
    machines: [],
  };
}

describe("game replay work", () => {
  it("accepts a single ingredient layer", () => {
    expect(estimateGameReplayWork({ ...options, nMaps: 1, diseaseCount: 1 }, [])).toBeGreaterThan(0);
  });

  it("keeps the production entitled seed-14 route within the 100k-tick replay budget", () => {
    const productionOptions: GenOptions = {
      ...options,
      nMaps: 1,
      width: 63,
      height: 63,
      diseaseCount: 1,
    };
    const recipe = generate(productionOptions).diseases[0]!.reference;
    const layout = compileEntitledPrototype(recipe, 24, 12).layout;
    const trace: readonly GameIntent[] = [
      { kind: "setProductionLayout", layout },
      { kind: "productionTicks", ticks: MAX_FACTORY_REPLAY_TICKS },
    ];

    expect(estimateGameReplayWork(productionOptions, trace)).toBeLessThanOrEqual(
      MAX_GAME_REPLAY_WORK,
    );
  });

  it("prices Production carrier capacity, area scans, and active-width arbitration exactly", () => {
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
    const cold = width * height * 16 + width * height * 4;
    const carriers = 2;
    const sources = 1;
    const perTick =
      width * height +
      4 * carriers +
      (carriers + sources) * (carriers + sources);

    expect(estimateGameReplayWork(options, [
      { kind: "setProductionLayout", layout },
      { kind: "productionTicks", ticks: 10 },
    ])).toBe(mapCells * 32 + cold + cold + perTick * 10);
  });

  it("charges exact Production geometry instead of recompiling a smaller route", () => {
    const recipe = generate(options).diseases[0]!.reference;
    const packed = compileTemplate(recipe);
    const width = packed.width + 8;
    const height = packed.height + 5;
    const tiles: FactoryLayout["tiles"][number][] = Array.from(
      { length: width * height },
      () => ({ kind: "empty" }),
    );
    for (let y = 0; y < packed.height; y++) {
      for (let x = 0; x < packed.width; x++) {
        tiles[y * width + x] = packed.tiles[y * packed.width + x]!;
      }
    }
    const exact = { width, height, tiles, machines: packed.machines };
    const packedWork = estimateGameReplayWork(options, [
      { kind: "setProductionLayout", layout: packed },
      { kind: "productionTicks", ticks: 100 },
    ]);
    const exactWork = estimateGameReplayWork(options, [
      { kind: "setProductionLayout", layout: exact },
      { kind: "productionTicks", ticks: 100 },
    ]);
    expect(exactWork).toBeGreaterThan(packedWork);
  });

  it("charges route derivation, map evaluation, and first-product analysis across transfers", () => {
    const width = 24;
    const height = 12;
    const tiles: FactoryLayout["tiles"][number][] = Array.from(
      { length: width * height },
      () => ({ kind: "empty" }),
    );
    tiles[0] = { kind: "source", dir: 0, period: 1 };
    tiles[1] = { kind: "sink" };
    const layout: FactoryLayout = { width, height, tiles, machines: [] };
    const mapCells = options.nMaps * options.width * options.height;
    const coldWork = width * height * 16 + width * height * 4;
    const outcomeTicks = width * height + 16;
    const outcomeWidth = width * height + 1;
    const expected =
      mapCells * 32 +
      coldWork +
      (coldWork + mapCells * 4) +
      (coldWork + mapCells * 4 + outcomeWidth * outcomeWidth * outcomeTicks);

    expect(estimateGameReplayWork(options, [
      { kind: "setResearchLayout", layout },
      { kind: "sendResearchToPilot" },
      { kind: "sendPilotToProduction" },
    ])).toBe(expected);
  });

  it("rejects aggregate replay whose repeated Pilot validations exceed the cap", () => {
    const width = 24;
    const height = 12;
    const layout = emptyLayout(width, height);
    const trace: GameIntent[] = [
      { kind: "setResearchLayout", layout },
      { kind: "sendResearchToPilot" },
    ];
    for (let validation = 0; validation < 4; validation++) {
      trace.push({ kind: "sendPilotToProduction" });
    }

    expect(estimateGameReplayWork(options, trace)).toBeGreaterThan(MAX_GAME_REPLAY_WORK);
  });

  it("saturates oversized Pilot first-product analysis with capped arithmetic", () => {
    const width = 64;
    const height = MAX_GAME_FACTORY_CELLS / width;
    const tiles: FactoryLayout["tiles"][number][] = Array.from(
      { length: width * height },
      () => ({ kind: "empty" }),
    );
    tiles[0] = { kind: "source", dir: 0, period: 1 };
    tiles[1] = { kind: "sink" };
    const layout: FactoryLayout = { width, height, tiles, machines: [] };

    expect(estimateGameReplayWork(options, [
      { kind: "setResearchLayout", layout },
      { kind: "sendResearchToPilot" },
      { kind: "sendPilotToProduction" },
    ])).toBe(MAX_GAME_REPLAY_WORK + 1);
  });

  it("retains the quadratic active-width bound for a carrier-dense Production floor", () => {
    const width = 24;
    const height = 12;
    const tiles: FactoryLayout["tiles"][number][] = Array.from(
      { length: width * height },
      () => ({ kind: "belt", dir: 0 }),
    );
    tiles[0] = { kind: "source", dir: 0, period: 1 };
    tiles[tiles.length - 1] = { kind: "sink" };
    const layout: FactoryLayout = { width, height, tiles, machines: [] };

    expect(estimateGameReplayWork(options, [
      { kind: "setProductionLayout", layout },
      { kind: "productionTicks", ticks: 1_200 },
    ])).toBeGreaterThan(MAX_GAME_REPLAY_WORK);
  });

  it("charges each Research action for route validation and map traversal", () => {
    const maximumMaps: GenOptions = {
      ...options,
      nMaps: 4,
      width: 32,
      height: 32,
      diseaseCount: 4,
    };
    const layout = emptyLayout(1, 1);
    const trace: GameIntent[] = [{ kind: "setResearchLayout", layout }];
    for (let index = 1; index < MAX_INTENT_TRACE; index++) {
      trace.push(index % 3 === 0
        ? { kind: "beginResearchShot" }
        : index % 3 === 1
          ? { kind: "advanceResearchShot" }
          : { kind: "abortResearchShot" });
    }

    expect(estimateGameReplayWork(maximumMaps, trace)).toBeGreaterThan(50_000_000);
  });

  it("keeps Research, Pilot, and Production profiles independent until an explicit transfer", () => {
    const production = emptyLayout(4, 3);
    const research = emptyLayout(8, 3);
    const pilot = emptyLayout(10, 3);
    const mapCells = options.nMaps * options.width * options.height;
    const productionCold = 4 * 3 * 20;
    const researchCold = 8 * 3 * 20;
    const pilotCold = 10 * 3 * 20;
    const productionPerTick = 4 * 3;

    expect(estimateGameReplayWork(options, [
      { kind: "setProductionLayout", layout: production },
      { kind: "setResearchLayout", layout: research },
      { kind: "setPilotLayout", layout: pilot },
      { kind: "abortResearchShot" },
      { kind: "productionTicks", ticks: 10 },
      { kind: "resetProduction" },
    ])).toBe(
      mapCells * 32 +
      productionCold + researchCold + pilotCold + 1 +
      productionCold + productionPerTick * 10 + productionCold,
    );
  });

  it("expands all three facility profiles for the shared-floor patent", () => {
    const layout = emptyLayout(4, 3);
    const mapCells = options.nMaps * options.width * options.height;
    const currentCold = 4 * 3 * 20;
    const expandedCold = 6 * 3 * 20;

    expect(estimateGameReplayWork(options, [
      { kind: "setResearchLayout", layout },
      { kind: "setPilotLayout", layout },
      { kind: "setProductionLayout", layout },
      { kind: "unlockPatent", id: "bench-2" },
    ])).toBe(
      mapCells * 32 + 3 * currentCold + 262_144 + 3 * expandedCold,
    );
  });

  it("charges every 63x63 layer across the complete one-to-four patent path", () => {
    const oneLayer = { ...options, nMaps: 1, width: 63, height: 63, diseaseCount: 1 };
    const layout = emptyLayout(1, 1);
    const trace: readonly GameIntent[] = [
      { kind: "unlockPatent", id: "new-map" },
      { kind: "setResearchLayout", layout },
      { kind: "beginResearchShot" },
      { kind: "unlockPatent", id: "new-map-4" },
      { kind: "setResearchLayout", layout },
      { kind: "beginResearchShot" },
      { kind: "unlockPatent", id: "deep-map-4" },
      { kind: "setResearchLayout", layout },
      { kind: "beginResearchShot" },
    ];
    const cells = 63 * 63;
    const cold = 20;
    const expected =
      cells * 32 +
      (262_144 + 2 * cells * 32) + cold + cold + 2 * cells * 4 +
      (262_144 + 3 * cells * 32) + cold + cold + 3 * cells * 4 +
      (262_144 + 4 * cells * 32) + cold + cold + 4 * cells * 4;
    expect(estimateGameReplayWork(oneLayer, trace)).toBe(expected);
  });
});
