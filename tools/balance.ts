/**
 * HexaPharma — balance sweep tool.
 *
 *   npm run balance [count]   # sweep `count` seeds (default 100)
 *
 * Generates a level per seed at the active one-Atlas config and, per disease, collects:
 *   - constructed-reference complexity, solver minimum depth and gap,
 *   - basePrice, constructed-reference cost and step count,
 *   - compiled-reference steady throughput rate (from analyzeThroughput),
 *   - a simple first-unit net profit/tick ≈ rate × (basePrice − actual recipe cost).
 *
 * It then reports seed/content diversity, constructed-reference vs dev-solver
 * depth, bootstrap affordability/packability, and profit/tick outliers.
 *
 * Tool-only: console.log + Math.* are fine here (this never runs in the sim core).
 */
import { generate } from "../src/sim/mapgen/index";
import { compileEntitledPrototype, compileTemplate } from "../src/sim/recipe/index";
import { analyzeThroughput } from "../src/sim/factory-sim/index";
import { solve } from "../src/sim/solver/index";
import { quoteProductionBuild } from "../src/sim/construction/index";
import { DEFAULT_STARTING_CASH } from "../src/sim/game";
import { walkValidatedPathInto } from "../src/sim/drug-graph";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  CellKind,
  DEFAULT_CATALOG,
  type FactoryLayout,
  type GeneratedLevel,
  type GenOptions,
  type MachineCatalogEntry,
  type Template,
} from "../src/sim/phase0_interfaces";
import { pathToFileURL } from "node:url";

export const MAX_BALANCE_SEEDS = 100_000;
export const MAX_ALL_PAIRS_LEVELS = 100;
export const BALANCE_CONFIG = Object.freeze({
  nMaps: 1,
  width: 63,
  height: 63,
  diseaseCount: 4,
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
  readonly basePrice: number;
  readonly cost: number;
  readonly refSteps: number;
  readonly solverMinSteps: number;
  readonly solverMinCost: number;
  readonly referenceGap: number;
  readonly referenceCostGap: number;
  readonly referenceSignature: string;
  readonly cureMap: number;
  readonly cureX: number;
  readonly cureY: number;
  readonly rateNum: number;
  readonly rateDen: number;
  /** First-unit net profit/tick; float is reporting-only, never sim state. */
  readonly profitPerTick: number;
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
  readonly crossSeedCures: number;
  readonly crossSeedComparisons: number;
  readonly worstCrossSeedCures: number;
  readonly worstCrossSeedComparisons: number;
  readonly worstCrossSeedSourceSeed: number;
  readonly worstCrossSeedDiseaseId: number;
  readonly worstCrossSeedReferenceSignature: string;
  readonly worstCrossSeedTargetDiseaseHits: readonly number[];
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
  readonly generate?: typeof generate;
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

function generatedReferenceCures(level: GeneratedLevel, reference: Template): readonly number[] {
  const map = level.mm.maps[0];
  const start = level.start.pos[0];
  if (map === undefined || start === undefined) {
    throw new Error("balance all-pairs requires the active one-Atlas level");
  }
  const output = new Int32Array(3);
  let x = start.x;
  let y = start.y;
  for (const machine of reference.steps) {
    walkValidatedPathInto(map, x, y, machine, output, 0);
    if (output[2] === 1) return [];
    x = output[0]!;
    y = output[1]!;
  }
  const index = y * map.width + x;
  const disease = map.cureId[index];
  return map.cell[index] === CellKind.Cure && disease !== undefined && disease >= 0
    ? [disease]
    : [];
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
  const generateLevel = overrides.generate ?? generate;
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
  const crossSeedLevels: ReturnType<typeof generate>[] = [];
  let baselineSeed = -1;
  let baselineReferences: readonly Template[] = [];
  let crossSeedCures = 0;
  let crossSeedComparisons = 0;
  let seedCount = 0;
  for (let seed = 1; seed <= count; seed++) {
    try {
      const level = generateLevel(optsFor(seed, catalog));
      const seedSamples: Sample[] = [];
      let seedBootstrap: BootstrapSample | null = null;
      for (const disease of level.diseases) {
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
        const availableCount = disease.id === 0
          ? Math.min(4, catalog.length)
          : Math.min(catalog.length, 4 + disease.id);
        const minimum = findMinimum(level.mm, level.start, {
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
          basePrice: disease.basePrice,
          cost,
          refSteps: disease.reference.steps.length,
          solverMinSteps,
          solverMinCost: minimum.cost,
          referenceGap: disease.reference.steps.length - solverMinSteps,
          referenceCostGap: cost - minimum.cost,
          referenceSignature: templateSignature(disease.reference),
          cureMap: disease.map,
          cureX: disease.node.x,
          cureY: disease.node.y,
          rateNum: report.rateNum,
          rateDen: report.rateDen,
          profitPerTick: rate * (disease.basePrice - cost),
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
          const firstUnitCleanNet = disease.basePrice - cost;
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
        `${sample.cureMap}:${sample.cureX},${sample.cureY}`,
      ).join("|"));
      if (crossSeedLevels.length < MAX_ALL_PAIRS_LEVELS) crossSeedLevels.push(level);
      if (baselineReferences.length === 0) {
        baselineSeed = seed;
        baselineReferences = level.diseases.map((disease) => disease.reference);
      } else if (seed !== baselineSeed) {
        for (const reference of baselineReferences) {
          crossSeedComparisons++;
          if (generatedReferenceCures(level, reference).length > 0) crossSeedCures++;
        }
      }
    } catch (err) {
      failed.push({ seed, error: err instanceof Error ? err.message : String(err) });
    }
  }
  let worstCrossSeedCures = 0;
  let worstCrossSeedComparisons = 0;
  let worstCrossSeedSourceSeed = -1;
  let worstCrossSeedDiseaseId = -1;
  let worstCrossSeedReferenceSignature = "";
  let worstCrossSeedTargetDiseaseHits: number[] = [];
  for (let sourceIndex = 0; sourceIndex < crossSeedLevels.length; sourceIndex++) {
    const source = crossSeedLevels[sourceIndex]!;
    for (const disease of source.diseases) {
      let cures = 0;
      let comparisons = 0;
      const targetDiseaseHits = Array.from({ length: BALANCE_CONFIG.diseaseCount }, () => 0);
      for (let targetIndex = 0; targetIndex < crossSeedLevels.length; targetIndex++) {
        if (targetIndex === sourceIndex) continue;
        const target = crossSeedLevels[targetIndex]!;
        comparisons++;
        const cured = generatedReferenceCures(target, disease.reference);
        if (cured.length > 0) cures++;
        for (const targetDisease of cured) {
          if (targetDisease >= 0 && targetDisease < targetDiseaseHits.length) {
            targetDiseaseHits[targetDisease] = targetDiseaseHits[targetDisease]! + 1;
          }
        }
      }
      if (cures > worstCrossSeedCures) {
        worstCrossSeedCures = cures;
        worstCrossSeedComparisons = comparisons;
        worstCrossSeedSourceSeed = source.seed;
        worstCrossSeedDiseaseId = disease.id;
        worstCrossSeedReferenceSignature = templateSignature(disease.reference);
        worstCrossSeedTargetDiseaseHits = targetDiseaseHits;
      }
    }
  }
  return {
    samples,
    bootstraps,
    diversity: {
      seedCount,
      uniqueReferenceSignatures: referenceSignatures.size,
      uniqueCureSets: cureSets.size,
      crossSeedCures,
      crossSeedComparisons,
      worstCrossSeedCures,
      worstCrossSeedComparisons,
      worstCrossSeedSourceSeed,
      worstCrossSeedDiseaseId,
      worstCrossSeedReferenceSignature,
      worstCrossSeedTargetDiseaseHits,
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
  const worstIndividualFailed = diversity.worstCrossSeedComparisons >= 39 &&
    diversity.worstCrossSeedCures > Math.floor(diversity.worstCrossSeedComparisons * 0.15);
  const smallRepeatedSampleFailed = diversity.worstCrossSeedComparisons < 39 &&
    diversity.crossSeedComparisons > 0 &&
    diversity.crossSeedCures * 4 > diversity.crossSeedComparisons;
  if (worstIndividualFailed || smallRepeatedSampleFailed) {
    failures.push(
      `worst cross-seed cure rate too high: ${diversity.worstCrossSeedCures}/` +
        `${diversity.worstCrossSeedComparisons} from seed=${diversity.worstCrossSeedSourceSeed} ` +
        `disease=${diversity.worstCrossSeedDiseaseId} ${diversity.worstCrossSeedReferenceSignature}`,
    );
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
  console.log("\nbasePrice grouped by constructed-reference complexity:");
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

function printDiversity(result: SweepResult): void {
  const report = result.diversity;
  console.log("\nseed/content diversity:");
  console.log(
    `  unique references=${report.uniqueReferenceSignatures}  ` +
      `unique cure sets=${report.uniqueCureSets}  successful seeds=${report.seedCount}`,
  );
  console.log(
    `  baseline-blueprint cross-seed cures=${report.crossSeedCures}/${report.crossSeedComparisons}`,
  );
  console.log(
    `  worst individual cross-seed cures=${report.worstCrossSeedCures}/` +
      `${report.worstCrossSeedComparisons} seed=${report.worstCrossSeedSourceSeed} ` +
      `disease=${report.worstCrossSeedDiseaseId} ${report.worstCrossSeedReferenceSignature} ` +
      `targets=[${report.worstCrossSeedTargetDiseaseHits.join(",")}]`,
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
  console.log("\nfirst-unit net profit/tick spread (rate × (basePrice − production cost)):");
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
  printDiversity(result);
  printPuzzleQuality(samples);
  printBootstrap(result.bootstraps);
  for (const failure of [
    ...diversityFailures(result),
    ...bootstrapFailures(result),
    ...puzzleBlockerFailures(result),
  ]) {
    console.error(`FAILED ${failure}`);
  }
  for (const flag of puzzleTuningFlags(result)) {
    console.error(`FLAG ${flag}`);
  }
  return sweepExitCode(result);
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
