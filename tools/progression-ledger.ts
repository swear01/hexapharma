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
import { compileEntitledPrototype } from "../src/sim/recipe";
import { pathToFileURL } from "node:url";

export const REFERENCE_PROGRESSION_SEEDS = Object.freeze([14, 15, 1, 42, 100]);
export const PROGRESSION_SEEDS = Object.freeze([...new Set([
  ...Array.from({ length: 32 }, (_, seed) => seed),
  ...REFERENCE_PROGRESSION_SEEDS,
])]);
export const PRODUCTION_TICKS_PER_DISEASE = 1_500;
export const PROGRESSION_RETRY_BUDGET = 100;

const OPTIONS = Object.freeze({
  nMaps: 1,
  width: 49,
  height: 49,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 4,
  difficulty: Object.freeze({ min: 4, max: 12 }),
});

export interface ProgressionEntry {
  readonly disease: number;
  readonly cashBefore: number;
  readonly unlockCost: number;
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
  readonly finalResearch: number;
  readonly minimumCash: number;
  readonly completedContracts: number;
  readonly everyDiseasePositiveNet: boolean;
}

function options(seed: number): GenOptions {
  return { seed, ...OPTIONS };
}

function unlock(game: GameState, id: string): GameState {
  return applyGameIntent(game, { kind: "unlockPatent", id });
}

/** Patents (prerequisites first) still needed for the reference's machines. */
export function unlocksFor(reference: Template, owned: readonly string[]): readonly string[] {
  const needed: string[] = [];
  const add = (id: string): void => {
    if (owned.includes(id) || needed.includes(id)) return;
    for (const required of DEFAULT_PATENTS.find((node) => node.id === id)!.requires) add(required);
    needed.push(id);
  };
  for (const step of reference.steps) {
    const node = DEFAULT_PATENTS.find((candidate) =>
      candidate.effect.kind === "unlockMachine" && candidate.effect.typeId === step.typeId);
    if (node !== undefined) add(node.id);
  }
  return needed;
}

function patentCost(id: string): number {
  return DEFAULT_PATENTS.find((node) => node.id === id)!.cost;
}

export function progressionLedger(seed: number, startingCash = DEFAULT_STARTING_CASH): ProgressionLedger {
  const level = generate(options(seed));
  let game = createGameState(options(seed), startingCash, 0);
  let minimumCash = game.economy.cash;
  const entries: ProgressionEntry[] = [];

  for (const disease of level.diseases) {
    const cashBefore = game.economy.cash;
    const patentIds = unlocksFor(disease.reference, game.patents.unlocked);
    const unlockCost = patentIds.reduce((total, id) => total + patentCost(id), 0);
    try {
      for (const id of patentIds) game = unlock(game, id);
      minimumCash = Math.min(minimumCash, game.economy.cash);

      game = applyGameIntent(game, { kind: "runResearchTrial", program: disease.reference });
      minimumCash = Math.min(minimumCash, game.economy.cash);
      if (!game.research.lastTrial?.outcome.cured.includes(disease.id)) {
        throw new Error(`reference did not cure disease ${disease.id}`);
      }
      const researchCost = game.research.lastTrial.cost;
      const referencePrice = cureRegionPrice(disease, game.research.lastTrial.outcome);
      const effects = activeEffects(DEFAULT_PATENTS, game.patents);
      const layout = compileEntitledPrototype(
        disease.reference,
        BASE_GAME_FACTORY_WIDTH + effects.factoryDw,
        BASE_GAME_FACTORY_HEIGHT + effects.factoryDh,
      ).layout;
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
        unlockCost,
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
        finalResearch: game.economy.research,
        minimumCash,
        completedContracts: shippingContracts(game).filter((contract) => contract.completed).length,
        everyDiseasePositiveNet: entries.every((entry) => entry.net > 0),
      };
    }
  }
  const completedContracts = shippingContracts(game).filter((contract) => contract.completed).length;
  const everyDiseasePositiveNet = entries.length === 4 && entries.every((entry) => entry.net > 0);
  return {
    seed,
    entries,
    completed: completedContracts === 4 && everyDiseasePositiveNet,
    blockedAction: completedContracts === 4 && everyDiseasePositiveNet
      ? null
      : "four authoritative shipping contracts with positive net were not completed",
    finalCash: game.economy.cash,
    finalResearch: game.economy.research,
    minimumCash,
    completedContracts,
    everyDiseasePositiveNet,
  };
}

export function progressionExitCode(ledgers: readonly ProgressionLedger[]): 0 | 1 {
  return ledgers.some((ledger) =>
    !ledger.completed ||
    ledger.completedContracts !== 4 ||
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
