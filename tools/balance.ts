/**
 * HexaPharma — balance sweep tool.
 *
 *   npm run balance [count]   # sweep `count` seeds (default 100)
 *
 * Generates a level per seed at the shipped three-base config and, per disease (on its own base), collects:
 *   - constructed-reference complexity, solver minimum depth and gap,
 *   - reference region price, constructed-reference cost and step count,
 *   - compiled-reference steady throughput rate (from analyzeThroughput),
 *   - a simple first-unit net profit/tick ≈ rate × (reference region price − actual recipe cost),
 *   - every cure region's reach-difficulty price, and machine usage in the references.
 *
 * It then reports seed/content diversity, constructed-reference vs dev-solver
 * depth, bootstrap affordability/packability, and profit/tick outliers.
 *
 * Tool-only: console.log + Math.* are fine here (this never runs in the sim core).
 */
import { diseaseCatalogCount, generateWithDiagnostics } from "../src/sim/mapgen/index";
import { compileEntitledPrototype, compileTemplate } from "../src/sim/recipe/index";
import { analyzeThroughput } from "../src/sim/factory-sim/index";
import { solve } from "../src/sim/solver/index";
import { quoteProductionBuild } from "../src/sim/construction/index";
import { DEFAULT_STARTING_CASH, cureRegionPrice } from "../src/sim/game";
import { PATH_OUT_STRIDE, baseView, evaluate, initialState, turnHeading, walkValidatedPathInto } from "../src/sim/drug-graph";
import { HEX_DQ, HEX_DR } from "../src/sim/hex";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  type FactoryLayout,
  type GeneratedLevel,
  type GenOptions,
  type MachineCatalogEntry,
  type Template,
} from "../src/sim/phase0_interfaces";
import { pathToFileURL } from "node:url";
import {
  PROGRESSION_RETRY_BUDGET,
  PROGRESSION_SEEDS,
  progressionLedger,
} from "./progression-ledger";

export const MAX_BALANCE_SEEDS = 100_000;
export const BALANCE_CONFIG = Object.freeze({
  nMaps: 3,
  width: 49,
  height: 49,
  diseaseCount: 6,
  difficulty: Object.freeze({ min: 4, max: 12 }),
});

function requireSweepCount(count: number): void {
  if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_BALANCE_SEEDS) {
    throw new Error(`balance count must be an integer from 1 to ${MAX_BALANCE_SEEDS}`);
  }
}

export interface Sample {
  readonly seed: number;
  readonly diseaseId: number;
  readonly difficulty: number;
  /** Price of the region the constructed reference lands on. */
  readonly basePrice: number;
  /** Every cure region of this disease: kind + price. */
  readonly regions: readonly { readonly kind: string; readonly price: number; readonly capped: boolean }[];
  readonly referenceTypes: readonly string[];
  readonly cost: number;
  readonly refSteps: number;
  readonly solverMinSteps: number;
  readonly solverMinCost: number;
  readonly referenceGap: number;
  readonly referenceCostGap: number;
  readonly referenceSignature: string;
  readonly cureMap: number;
  readonly cureQ: number;
  readonly cureR: number;
  readonly rateNum: number;
  readonly rateDen: number;
  /** First-unit net profit/tick; float is reporting-only, never sim state. */
  readonly profitPerTick: number;
  /** Fewest machines to land on one of this disease's ★ (tier-2) cells: its catalog tier / full catalog. */
  readonly premiumTierSteps: number | null;
  readonly premiumFullSteps: number | null;
}

export const PREMIUM_REACH_DEPTH = 12;

/**
 * Dev-only BFS over (cell, swamp offset, heading) from the level start: the fewest machines from
 * `catalog` whose actual endpoint is a ★ Cure of `diseaseId` (null if none within `maxDepth`).
 */
export function premiumReachSteps(
  level: GeneratedLevel,
  diseaseId: number,
  catalog: readonly MachineCatalogEntry[],
  maxDepth = PREMIUM_REACH_DEPTH,
): number | null {
  const map = level.mm.maps[0];
  if (level.mm.maps.length !== 1 || map === undefined || !(map.cureTier instanceof Uint8Array)) return null;
  const isGoal = (cell: number) => map.cureTier[cell] === 2 && map.cureId[cell] === diseaseId;
  let hasGoal = false;
  for (let cell = 0; cell < map.cell.length; cell++) if (isGoal(cell)) hasGoal = true;
  if (!hasGoal) return null;
  const machines = catalog.map((entry) => ({ typeId: entry.typeId, path: entry.path, turn: entry.turn }));
  const seen = new Uint8Array(map.cell.length * 42);
  const root = (map.start.r * map.width + map.start.q) * 42;
  seen[root] = 1;
  let layer = [root];
  const out = new Int32Array(PATH_OUT_STRIDE);
  for (let depth = 1; depth <= maxDepth && layer.length > 0; depth++) {
    const next: number[] = [];
    for (const state of layer) {
      const heading = state % 6;
      const slot = Math.floor(state / 6) % 7;
      const cell = Math.floor(state / 42);
      for (const machine of machines) {
        walkValidatedPathInto(
          map,
          cell % map.width,
          Math.floor(cell / map.width),
          slot === 0 ? 0 : HEX_DQ[slot - 1]!,
          slot === 0 ? 0 : HEX_DR[slot - 1]!,
          heading,
          machine,
          out,
          0,
        );
        if (out[4] === 1) continue;
        const landed = out[1]! * map.width + out[0]!;
        if (isGoal(landed)) return depth;
        const nslot = out[2] === 0 && out[3] === 0 ? 0 : 1 + HEX_DQ.findIndex((q, index) => q === out[2] && HEX_DR[index] === out[3]);
        const nstate = landed * 42 + nslot * 6 + turnHeading(heading, machine.turn);
        if (seen[nstate] === 1) continue;
        seen[nstate] = 1;
        next.push(nstate);
      }
    }
    layer = next;
  }
  return null;
}

export interface BootstrapSample {
  readonly seed: number;
  readonly researchCost: number;
  readonly constructionQuote: number;
  readonly bootstrapCash: number;
  readonly startingCash: number;
  readonly firstUnitCleanNet: number;
  readonly canReachFirstSale: boolean;
}

export interface DiversityReport {
  readonly seedCount: number;
  readonly uniqueReferenceSignatures: number;
  readonly uniqueCureSets: number;
}

export interface SweepFailure {
  readonly seed: number;
  readonly error: string;
}

export interface SweepResult {
  readonly samples: Sample[];
  readonly bootstraps: BootstrapSample[];
  readonly diversity: DiversityReport;
  readonly failed: SweepFailure[];
}

export interface SweepOverrides {
  readonly generate?: (options: GenOptions) => GeneratedLevel;
  readonly compileTemplate?: typeof compileTemplate;
  readonly analyzeThroughput?: typeof analyzeThroughput;
  readonly solve?: typeof solve;
  readonly compileEntitledPrototype?: typeof compileEntitledPrototype;
  readonly quoteProductionBuild?: typeof quoteProductionBuild;
  readonly startingCash?: number;
  readonly catalog?: readonly MachineCatalogEntry[];
}

function optsFor(seed: number, catalog: readonly MachineCatalogEntry[] = DEFAULT_CATALOG): GenOptions {
  return {
    seed,
    ...BALANCE_CONFIG,
    catalog,
  };
}

function emptyFactory(width: number, height: number): FactoryLayout {
  return {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ kind: "empty" as const })),
    machines: [],
  };
}

function templateSignature(template: Template): string {
  return template.steps.map((step) => step.typeId).join(",");
}


function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function fmt(n: number, digits = 2): string {
  return n.toFixed(digits);
}

export function minMax(values: readonly number[]): { readonly min: number; readonly max: number } {
  if (values.length === 0) return { min: 0, max: 0 };
  let min = values[0]!;
  let max = values[0]!;
  for (let index = 1; index < values.length; index++) {
    const value = values[index]!;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

export function referenceCost(
  steps: readonly { readonly typeId: string }[],
  catalog: readonly MachineCatalogEntry[] = DEFAULT_CATALOG,
): number {
  let cost = 0;
  for (const step of steps) {
    const entry = catalog.find((candidate) => candidate.typeId === step.typeId);
    if (entry === undefined) {
      throw new Error(`unknown machine type in reference: "${step.typeId}"`);
    }
    cost += entry.cost;
  }
  return cost;
}

export function sweep(count: number, overrides: SweepOverrides = {}): SweepResult {
  requireSweepCount(count);
  let pricing: ReturnType<typeof generateWithDiagnostics>["diagnostics"]["pricing"] = [];
  const generateLevel = overrides.generate ?? ((options: GenOptions) => {
    const result = generateWithDiagnostics(options);
    pricing = result.diagnostics.pricing;
    return result.level;
  });
  const compile = overrides.compileTemplate ?? compileTemplate;
  const throughput = overrides.analyzeThroughput ?? analyzeThroughput;
  const findMinimum = overrides.solve ?? solve;
  const compileEntitled = overrides.compileEntitledPrototype ?? compileEntitledPrototype;
  const quoteBuild = overrides.quoteProductionBuild ?? quoteProductionBuild;
  const startingCash = overrides.startingCash ?? DEFAULT_STARTING_CASH;
  const catalog = overrides.catalog ?? DEFAULT_CATALOG;
  const samples: Sample[] = [];
  const bootstraps: BootstrapSample[] = [];
  const failed: SweepFailure[] = [];
  const referenceSignatures = new Set<string>();
  const cureSets = new Set<string>();
  let seedCount = 0;
  for (let seed = 1; seed <= count; seed++) {
    try {
      pricing = [];
      const level = generateLevel(optsFor(seed, catalog));
      const seedSamples: Sample[] = [];
      let seedBootstrap: BootstrapSample | null = null;
      for (const disease of level.diseases) {
        const view = baseView(level.mm, disease.map);
        const baseLevel = { ...level, mm: view, start: initialState(view) };
        const layout = compile(disease.reference);
        const report = throughput(layout, level.mm);
        if (
          !Number.isSafeInteger(report.rateNum) ||
          report.rateNum < 0 ||
          !Number.isSafeInteger(report.rateDen) ||
          report.rateDen <= 0
        ) {
          throw new Error(`invalid throughput rate ${report.rateNum}/${report.rateDen}`);
        }
        const cost = referenceCost(disease.reference.steps, catalog);
        const availableCount = diseaseCatalogCount(disease.id, catalog.length);
        const referencePrice = cureRegionPrice(disease, evaluate(baseLevel.mm, baseLevel.start, disease.reference));
        const minimum = findMinimum(baseLevel.mm, baseLevel.start, {
          catalog: catalog.slice(0, availableCount),
          maxDepth: disease.reference.steps.length,
          targets: [disease.id],
        });
        if (minimum === null) {
          throw new Error(`dev solver could not reproduce disease ${disease.id} reference`);
        }
        const solverMinSteps = minimum.template.steps.length;
        const rate = report.rateNum / report.rateDen;
        seedSamples.push({
          seed,
          diseaseId: disease.id,
          difficulty: disease.difficulty,
          basePrice: referencePrice,
          regions: disease.regions.map((region) => ({
            kind: pricing.find((entry) => entry.id === region.id)?.kind ?? "unknown",
            price: region.price,
            capped: region.capped,
          })),
          referenceTypes: disease.reference.steps.map((step) => step.typeId),
          cost,
          refSteps: disease.reference.steps.length,
          solverMinSteps,
          solverMinCost: minimum.cost,
          referenceGap: disease.reference.steps.length - solverMinSteps,
          referenceCostGap: cost - minimum.cost,
          referenceSignature: templateSignature(disease.reference),
          cureMap: disease.map,
          cureQ: disease.node.q,
          cureR: disease.node.r,
          rateNum: report.rateNum,
          rateDen: report.rateDen,
          profitPerTick: rate * (referencePrice - cost),
          premiumTierSteps: premiumReachSteps(baseLevel, disease.id, catalog.slice(0, availableCount)),
          premiumFullSteps: premiumReachSteps(baseLevel, disease.id, catalog),
        });
        if (disease.id === 0) {
          const proposed = compileEntitled(
            disease.reference,
            BASE_GAME_FACTORY_WIDTH,
            BASE_GAME_FACTORY_HEIGHT,
          ).layout;
          const constructionQuote = quoteBuild(
            emptyFactory(BASE_GAME_FACTORY_WIDTH, BASE_GAME_FACTORY_HEIGHT),
            proposed,
          );
          const bootstrapCash = cost + constructionQuote;
          const firstUnitCleanNet = referencePrice - cost;
          seedBootstrap = {
            seed,
            researchCost: cost,
            constructionQuote,
            bootstrapCash,
            startingCash,
            firstUnitCleanNet,
            canReachFirstSale: startingCash >= bootstrapCash && firstUnitCleanNet > 0,
          };
        }
      }
      if (seedBootstrap === null) throw new Error("generated level has no disease 0 bootstrap");
      samples.push(...seedSamples);
      bootstraps.push(seedBootstrap);
      seedCount++;
      for (const sample of seedSamples) referenceSignatures.add(sample.referenceSignature);
      cureSets.add(seedSamples.map((sample) =>
        `${sample.cureMap}:${sample.cureQ},${sample.cureR}`,
      ).join("|"));
    } catch (err) {
      failed.push({ seed, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    samples,
    bootstraps,
    diversity: {
      seedCount,
      uniqueReferenceSignatures: referenceSignatures.size,
      uniqueCureSets: cureSets.size,
    },
    failed,
  };
}

export function diversityFailures(result: SweepResult): string[] {
  const { diversity } = result;
  if (diversity.seedCount < 8) return [];
  const failures: string[] = [];
  if (diversity.uniqueReferenceSignatures < diversity.seedCount) {
    failures.push(
      `reference diversity too low: ${diversity.uniqueReferenceSignatures} unique for ${diversity.seedCount} seeds`,
    );
  }
  if (diversity.uniqueCureSets < Math.ceil(diversity.seedCount * 0.75)) {
    failures.push(`cure-set diversity too low: ${diversity.uniqueCureSets} unique for ${diversity.seedCount} seeds`);
  }
  return failures;
}

export function bootstrapFailures(result: SweepResult): string[] {
  return result.bootstraps
    .filter((bootstrap) => !bootstrap.canReachFirstSale)
    .map((bootstrap) =>
      `seed=${bootstrap.seed} cannot reach first sale: ` +
      `research ${bootstrap.researchCost} + build ${bootstrap.constructionQuote} = ` +
      `${bootstrap.bootstrapCash} from ${bootstrap.startingCash}, net ${bootstrap.firstUnitCleanNet}`,
    );
}

export function puzzleBlockerFailures(result: SweepResult): string[] {
  return result.samples
    .filter((sample) => sample.solverMinSteps <= 1)
    .map((sample) =>
      `seed=${sample.seed} disease=${sample.diseaseId} trivial cure depth=${sample.solverMinSteps}`,
    );
}

export function puzzleTuningFlags(result: SweepResult): string[] {
  const flags: string[] = [];
  for (const sample of result.samples) {
    if (sample.referenceGap >= 4 && sample.refSteps >= sample.solverMinSteps * 2) {
      flags.push(
        `seed=${sample.seed} disease=${sample.diseaseId} extreme reference gap ` +
        `${sample.refSteps}-${sample.solverMinSteps}=${sample.referenceGap}`,
      );
    }
  }
  return flags;
}

export function puzzleQualityFailures(result: SweepResult): string[] {
  return [...puzzleBlockerFailures(result), ...puzzleTuningFlags(result)];
}

export function sweepExitCode(result: SweepResult): 0 | 1 {
  return result.samples.length === 0 ||
    result.failed.length > 0 ||
    diversityFailures(result).length > 0 ||
    bootstrapFailures(result).length > 0 ||
    puzzleBlockerFailures(result).length > 0
    ? 1
    : 0;
}

function printDifficultyHistogram(samples: readonly Sample[]): void {
  const counts = new Map<number, number>();
  for (const s of samples) counts.set(s.difficulty, (counts.get(s.difficulty) ?? 0) + 1);
  const diffs = [...counts.keys()].sort((a, b) => a - b);
  console.log("constructed-reference complexity histogram (not solver minimum depth):");
  const max = Math.max(1, ...[...counts.values()]);
  for (const d of diffs) {
    const c = counts.get(d) ?? 0;
    const bar = "#".repeat(Math.round((c / max) * 40));
    console.log(`  d=${String(d).padStart(2)} | ${String(c).padStart(4)} ${bar}`);
  }
}

function printPriceByDifficulty(samples: readonly Sample[]): void {
  const byDiff = new Map<number, number[]>();
  for (const s of samples) {
    const arr = byDiff.get(s.difficulty) ?? [];
    arr.push(s.basePrice);
    byDiff.set(s.difficulty, arr);
  }
  const diffs = [...byDiff.keys()].sort((a, b) => a - b);
  console.log("\nreference region price grouped by constructed-reference complexity:");
  for (const d of diffs) {
    const prices = byDiff.get(d) ?? [];
    const med = median(prices);
    const { min: lo, max: hi } = minMax(prices);
    console.log(
      `  d=${String(d).padStart(2)} | n=${String(prices.length).padStart(4)} ` +
        `min=${String(lo).padStart(6)} median=${String(med).padStart(7)} max=${String(hi).padStart(6)}`,
    );
  }
}

/** Per disease: region price spread, capped searches, and whether a hard region outprices every easy one. */
export function regionPriceReport(samples: readonly Sample[]): {
  readonly lines: string[];
  readonly orderingFailures: string[];
} {
  const lines: string[] = [];
  const orderingFailures: string[] = [];
  const diseases = [...new Set(samples.map((sample) => sample.diseaseId))].sort((a, b) => a - b);
  for (const disease of diseases) {
    const prices: number[] = [];
    let capped = 0;
    for (const sample of samples) {
      if (sample.diseaseId !== disease) continue;
      for (const region of sample.regions) {
        prices.push(region.price);
        if (region.capped) capped++;
      }
      const easy = sample.regions.filter((region) => region.kind === "easy").map((region) => region.price);
      const hard = sample.regions.filter((region) => region.kind === "hard").map((region) => region.price);
      if (easy.length > 0 && hard.length > 0 && minMax(hard).max <= minMax(easy).max) {
        orderingFailures.push(
          `seed=${sample.seed} disease=${disease} hard max ${minMax(hard).max} <= easy max ${minMax(easy).max}`,
        );
      }
    }
    const { min, max } = minMax(prices);
    lines.push(
      `  disease ${disease}: regions=${prices.length} min=${min} median=${fmt(median(prices), 1)} max=${max} capped=${capped}`,
    );
  }
  return { lines, orderingFailures };
}

function printRegionPrices(samples: readonly Sample[]): void {
  const report = regionPriceReport(samples);
  console.log("\nregion prices by reach difficulty (per disease, every region):");
  for (const line of report.lines) console.log(line);
  console.log(`  hard-region max ≤ easy-region max: ${report.orderingFailures.length} disease sample(s)`);
  for (const failure of report.orderingFailures) console.log(`    ${failure}`);
}

function printMachineUsage(samples: readonly Sample[], catalog: readonly MachineCatalogEntry[]): void {
  console.log("\nmachine usage in constructed references:");
  for (const entry of catalog) {
    let steps = 0;
    let references = 0;
    for (const sample of samples) {
      const uses = sample.referenceTypes.filter((typeId) => typeId === entry.typeId).length;
      steps += uses;
      if (uses > 0) references++;
    }
    console.log(`  ${entry.typeId.padEnd(9)} steps=${String(steps).padStart(5)} references=${String(references).padStart(4)}`);
  }
}

function printDiversity(result: SweepResult): void {
  const report = result.diversity;
  console.log("\nseed/content diversity:");
  console.log(
    `  unique references=${report.uniqueReferenceSignatures}  ` +
      `unique cure sets=${report.uniqueCureSets}  successful seeds=${report.seedCount}`,
  );
}

function printPuzzleQuality(samples: readonly Sample[]): void {
  const minimums = samples.map((sample) => sample.solverMinSteps);
  const gaps = samples.map((sample) => sample.referenceGap);
  const minimumCosts = samples.map((sample) => sample.solverMinCost);
  const costGaps = samples.map((sample) => sample.referenceCostGap);
  const minimumRange = minMax(minimums);
  const gapRange = minMax(gaps);
  const minimumCostRange = minMax(minimumCosts);
  const costGapRange = minMax(costGaps);
  console.log("\ndev-solver puzzle check:");
  console.log(
    `  minimum depth min=${minimumRange.min} median=${fmt(median(minimums), 1)} max=${minimumRange.max}`,
  );
  console.log(`  reference−minimum gap min=${gapRange.min} median=${fmt(median(gaps), 1)} max=${gapRange.max}`);
  console.log(
    `  shortest-path cost min=${minimumCostRange.min} median=${fmt(median(minimumCosts), 1)} ` +
      `max=${minimumCostRange.max}`,
  );
  console.log(
    `  reference−shortest cost gap min=${costGapRange.min} ` +
      `median=${fmt(median(costGaps), 1)} max=${costGapRange.max}`,
  );
}

function printPremiumReach(samples: readonly Sample[]): void {
  const tier = samples.map((sample) => sample.premiumTierSteps).filter((steps): steps is number => steps !== null);
  const full = samples.map((sample) => sample.premiumFullSteps).filter((steps): steps is number => steps !== null);
  console.log(`\n★ (tier-2) reachability (dev BFS over cell/offset/heading, ≤${PREMIUM_REACH_DEPTH} machines):`);
  console.log(
    `  disease's catalog tier: ${tier.length}/${samples.length} reachable` +
      (tier.length > 0 ? `  min=${minMax(tier).min} median=${fmt(median(tier), 1)} max=${minMax(tier).max}` : ""),
  );
  console.log(
    `  full catalog:           ${full.length}/${samples.length} reachable` +
      (full.length > 0 ? `  min=${minMax(full).min} median=${fmt(median(full), 1)} max=${minMax(full).max}` : ""),
  );
}

function printBootstrap(bootstraps: readonly BootstrapSample[]): void {
  console.log("\ndisease-0 bootstrap (Research + entitled 24×12 Production build → first clean sale):");
  for (const bootstrap of bootstraps) {
    console.log(
      `  seed=${bootstrap.seed} research=${bootstrap.researchCost} ` +
        `build=${bootstrap.constructionQuote} total=${bootstrap.bootstrapCash}/` +
        `${bootstrap.startingCash} first-net=${bootstrap.firstUnitCleanNet} ` +
        `${bootstrap.canReachFirstSale ? "OK" : "BLOCKED"}`,
    );
  }
}

function printProfitSpread(samples: readonly Sample[]): void {
  const profits = samples.map((s) => s.profitPerTick);
  const { min: lo, max: hi } = minMax(profits);
  const med = median(profits);
  console.log("\nfirst-unit net profit/tick spread (rate × (reference region price − production cost)):");
  console.log(`  min=${fmt(lo)}  median=${fmt(med)}  max=${fmt(hi)}  (n=${profits.length})`);

  // Degeneracy flag: a disease whose profit/tick dwarfs the median by a large
  // factor is a "狂產單一藥" risk (§8). Flag profit/tick ≥ 3× the median.
  const FLAG_FACTOR = 3;
  const threshold = med * FLAG_FACTOR;
  const outliers = samples
    .filter((s) => med > 0 && s.profitPerTick >= threshold)
    .sort((a, b) => b.profitPerTick - a.profitPerTick);
  console.log(`\ndegeneracy flags (profit/tick ≥ ${FLAG_FACTOR}× median = ${fmt(threshold)}):`);
  if (outliers.length === 0) {
    console.log("  none — no single disease dominates profit/tick.");
  } else {
    for (const o of outliers) {
      console.log(
        `  FLAG seed=${o.seed} disease=${o.diseaseId} difficulty=${o.difficulty} ` +
          `basePrice=${o.basePrice} rate=${o.rateNum}/${o.rateDen} profit/tick=${fmt(o.profitPerTick)} ` +
          `(${fmt(o.profitPerTick / med)}× median)`,
      );
    }
  }
}

export function runBalance(count: number, overrides: SweepOverrides = {}): 0 | 1 {
  requireSweepCount(count);
  console.log(
    `HexaPharma balance sweep — ${count} seeds (` +
      `nMaps ${BALANCE_CONFIG.nMaps}, ${BALANCE_CONFIG.width}×${BALANCE_CONFIG.height}, ` +
      `diseaseCount ${BALANCE_CONFIG.diseaseCount}, ` +
      `band [${BALANCE_CONFIG.difficulty.min},${BALANCE_CONFIG.difficulty.max}])\n`,
  );
  const result = sweep(count, overrides);
  const { samples, failed } = result;

  for (const failure of failed) {
    console.error(`FAILED seed=${failure.seed}: ${failure.error}`);
  }

  if (samples.length === 0) {
    console.error("no diseases generated; nothing to report.");
    if (failed.length > 0) console.error(`${failed.length} seed(s) failed generation or analysis.`);
    return 1;
  }

  console.log(
    `generated ${samples.length} diseases from ${count - failed.length}/${count} seeds` +
      (failed.length > 0 ? ` (${failed.length} seed(s) failed generation or analysis)` : "") +
      ".\n",
  );

  printDifficultyHistogram(samples);
  printPriceByDifficulty(samples);
  printProfitSpread(samples);
  printRegionPrices(samples);
  printMachineUsage(samples, overrides.catalog ?? DEFAULT_CATALOG);
  printDiversity(result);
  printPuzzleQuality(samples);
  printPremiumReach(samples);
  printBootstrap(result.bootstraps);
  console.log(`\nsix-disease legal progression ($${PROGRESSION_RETRY_BUDGET} retry/build allowance):`);
  const progression = PROGRESSION_SEEDS.map((seed) => progressionLedger(seed));
  const lowest = minMax(progression.map((ledger) => ledger.minimumCash)).min;
  console.log(`  lowest cash over ${progression.length} seeds: ${lowest}`);
  for (const ledger of progression) {
    console.log(
      `  seed=${ledger.seed} completed=${ledger.completed} min-cash=${ledger.minimumCash} ` +
        `final-cash=${ledger.finalCash} contracts=${ledger.completedContracts}/4 ` +
        `positive-net=${ledger.everyDiseasePositiveNet} ` +
        `sold=[${ledger.entries.map((entry) => entry.sold).join(",")}]` +
        (ledger.blockedAction === null ? "" : ` blocked=${ledger.blockedAction}`),
    );
  }
  for (const failure of [
    ...diversityFailures(result),
    ...bootstrapFailures(result),
    ...puzzleBlockerFailures(result),
    ...progression
      .filter((ledger) => !ledger.completed || ledger.minimumCash < PROGRESSION_RETRY_BUDGET)
      .map((ledger) => `seed=${ledger.seed} progression reserve ${ledger.minimumCash} < ${PROGRESSION_RETRY_BUDGET}` +
        (ledger.completed ? "" : " (blocked)")),
  ]) {
    console.error(`FAILED ${failure}`);
  }
  for (const flag of puzzleTuningFlags(result)) {
    console.error(`FLAG ${flag}`);
  }
  return sweepExitCode(result) === 0 && progression.every(
    (ledger) => ledger.completed && ledger.minimumCash >= PROGRESSION_RETRY_BUDGET,
  ) ? 0 : 1;
}

export function parseBalanceArgs(args: readonly string[]): number {
  if (args.length > 1) throw new Error(`unexpected arguments: ${args.slice(1).join(" ")}`);
  const arg = args[0];
  const count = arg !== undefined ? Number(arg) : 100;
  if (!Number.isSafeInteger(count) || count <= 0 || count > MAX_BALANCE_SEEDS) {
    throw new Error(`invalid count: ${arg}`);
  }
  return count;
}

export function main(args = process.argv.slice(2)): void {
  let count: number;
  try {
    count = parseBalanceArgs(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  process.exitCode = runBalance(count);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
