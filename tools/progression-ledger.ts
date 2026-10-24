import { quoteProductionBuild } from "../src/sim/construction";
import { nextUnitPrice, premiumGross } from "../src/sim/economy";
import {
  DEFAULT_STARTING_CASH,
  SIDE_EFFECT_PENALTY,
  applyGameIntent,
  createGameState,
  cureRegionPrice,
  shippingContracts,
} from "../src/sim/game";
import { generate } from "../src/sim/mapgen";
import { activeEffects, DEFAULT_PATENTS } from "../src/sim/patent";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  type GameState,
  type GenOptions,
  type Template,
} from "../src/sim/phase0_interfaces";
import { compileEntitledPrototype, withSourceBase } from "../src/sim/recipe";
import { pathToFileURL } from "node:url";

export const REFERENCE_PROGRESSION_SEEDS = Object.freeze([14, 15, 1, 42, 100]);
export const PROGRESSION_SEEDS = Object.freeze([...new Set([
  ...Array.from({ length: 32 }, (_, seed) => seed),
  ...REFERENCE_PROGRESSION_SEEDS,
])]);
export const PRODUCTION_TICKS_PER_DISEASE = 1_500;
export const PROGRESSION_RETRY_BUDGET = 100;

const OPTIONS = Object.freeze({
  nMaps: 3,
  width: 49,
  height: 49,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 6,
  difficulty: Object.freeze({ min: 4, max: 12 }),
});

export interface ProgressionEntry {
  readonly disease: number;
  readonly cashBefore: number;
  readonly researchCost: number;
  readonly buildCost: number;
  readonly gross: number;
  readonly net: number;
  readonly sold: number;
  readonly demandRemaining: number;
  readonly minimumCash: number;
}

export interface ProgressionLedger {
  readonly seed: number;
  readonly entries: readonly ProgressionEntry[];
  readonly completed: boolean;
  readonly blockedAction: string | null;
  readonly finalCash: number;
  readonly minimumCash: number;
  readonly completedContracts: number;
  readonly everyDiseasePositiveNet: boolean;
}

function options(seed: number): GenOptions {
  return { seed, ...OPTIONS };
}

function unlock(game: GameState, id: string): GameState {
  return applyGameIntent(game, { kind: "setPatent", id, enabled: true });
}

/** Technology switches still off for the reference's machines and its base. */
export function unlocksFor(reference: Template, owned: readonly string[], base = 0): readonly string[] {
  const needed: string[] = [];
  const baseNode = DEFAULT_PATENTS.find((candidate) =>
    candidate.effect.kind === "unlockBase" && candidate.effect.base === base);
  if (baseNode !== undefined && !owned.includes(baseNode.id)) needed.push(baseNode.id);
  for (const step of reference.steps) {
    const node = DEFAULT_PATENTS.find((candidate) =>
      candidate.effect.kind === "unlockMachine" && candidate.effect.typeId === step.typeId);
    if (node !== undefined && !owned.includes(node.id) && !needed.includes(node.id)) needed.push(node.id);
  }
  return needed;
}

export function progressionLedger(seed: number, startingCash = DEFAULT_STARTING_CASH): ProgressionLedger {
  const level = generate(options(seed));
  let game = createGameState(options(seed), startingCash);
  let minimumCash = game.economy.cash;
  const entries: ProgressionEntry[] = [];

  for (const disease of level.diseases) {
    const cashBefore = game.economy.cash;
    const patentIds = unlocksFor(disease.reference, game.patents.unlocked, disease.map);
    try {
      for (const id of patentIds) game = unlock(game, id);
      minimumCash = Math.min(minimumCash, game.economy.cash);

      game = applyGameIntent(game, { kind: "runResearchTrial", program: disease.reference, base: disease.map });
      minimumCash = Math.min(minimumCash, game.economy.cash);
      if (!game.research.lastTrial?.outcome.cured.includes(disease.id)) {
        throw new Error(`reference did not cure disease ${disease.id}`);
      }
      const researchCost = game.research.lastTrial.cost;
      const referencePrice = cureRegionPrice(disease, game.research.lastTrial.outcome);
      const effects = activeEffects(DEFAULT_PATENTS, game.patents);
      const layout = withSourceBase(compileEntitledPrototype(
        disease.reference,
        BASE_GAME_FACTORY_WIDTH + effects.factoryDw,
        BASE_GAME_FACTORY_HEIGHT + effects.factoryDh,
      ).layout, disease.map);
      const buildCost = quoteProductionBuild(game.production.layout, layout);
      game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
      minimumCash = Math.min(minimumCash, game.economy.cash);
      game = applyGameIntent(game, { kind: "productionTicks", ticks: PRODUCTION_TICKS_PER_DISEASE });

      let gross = 0;
      let net = 0;
      let sold = 0;
      for (const product of [...game.inventory]) {
        if (!product.outcome.cured.includes(disease.id)) continue;
        const alreadySold = game.economy.sold.find((entry) => entry.disease === disease.id)?.count ?? 0;
        const demand = nextUnitPrice(cureRegionPrice(disease, product.outcome), alreadySold);
        const revenue = product.outcome.premium.includes(disease.id) ? premiumGross(demand) : demand;
        const cost = product.productionCost + product.outcome.sideEffects.length * SIDE_EFFECT_PENALTY;
        if (revenue <= cost) continue;
        const before = game.economy.cash;
        game = applyGameIntent(game, {
          kind: "sellProduct",
          productId: product.inventoryId,
          disease: disease.id,
        });
        gross += revenue;
        net += game.economy.cash - before;
        sold++;
      }
      const alreadySold = game.economy.sold.find((entry) => entry.disease === disease.id)?.count ?? 0;
      let demandRemaining = 0;
      for (let count = alreadySold; nextUnitPrice(referencePrice, count) > researchCost; count++) {
        demandRemaining++;
      }
      entries.push({
        disease: disease.id,
        cashBefore,
        researchCost,
        buildCost,
        gross,
        net,
        sold,
        demandRemaining,
        minimumCash,
      });
    } catch (error) {
      return {
        seed,
        entries,
        completed: false,
        blockedAction: error instanceof Error ? error.message : String(error),
        finalCash: game.economy.cash,
        minimumCash,
        completedContracts: shippingContracts(game).filter((contract) => contract.completed).length,
        everyDiseasePositiveNet: entries.every((entry) => entry.net > 0),
      };
    }
  }
  const completedContracts = shippingContracts(game).filter((contract) => contract.completed).length;
  const everyDiseasePositiveNet = entries.length === OPTIONS.diseaseCount && entries.every((entry) => entry.net > 0);
  const completed = completedContracts === OPTIONS.diseaseCount && everyDiseasePositiveNet;
  return {
    seed,
    entries,
    completed,
    blockedAction: completed
      ? null
      : "every authoritative shipping contract with positive net was not completed",
    finalCash: game.economy.cash,
    minimumCash,
    completedContracts,
    everyDiseasePositiveNet,
  };
}

export function progressionExitCode(ledgers: readonly ProgressionLedger[]): 0 | 1 {
  return ledgers.some((ledger) =>
    !ledger.completed ||
    ledger.completedContracts !== OPTIONS.diseaseCount ||
    !ledger.everyDiseasePositiveNet ||
    ledger.minimumCash < PROGRESSION_RETRY_BUDGET
  ) ? 1 : 0;
}

export function main(): void {
  const ledgers = PROGRESSION_SEEDS.map((seed) => progressionLedger(seed));
  for (const ledger of ledgers) console.log(JSON.stringify(ledger));
  process.exitCode = progressionExitCode(ledgers);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
