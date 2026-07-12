/**
 * HexaPharma — balance sweep tool.
 *
 *   npm run balance [count]   # sweep `count` seeds (default 100)
 *
 * Generates a level per seed at a representative config (nMaps 2, 16×16,
 * diseaseCount 2, difficulty band [2,12]) and, per generated disease, collects:
 *   - difficulty, basePrice, constructed-reference cost and step count,
 *   - compiled-reference steady throughput rate (from analyzeThroughput),
 *   - a simple first-unit net profit/tick ≈ rate × (basePrice − actual recipe cost).
 *
 * It then prints a readable balance report (design §5 difficulty→price, §8
 * anti-degeneracy): a difficulty histogram, basePrice grouped by difficulty
 * (showing it rises), the profit/tick spread (min/median/max), and FLAGS any
 * disease whose profit/tick is a large outlier (a degeneracy risk).
 *
 * Tool-only: console.log + Math.* are fine here (this never runs in the sim core).
 */
import { generate } from "../src/sim/mapgen/index";
import { compileTemplate } from "../src/sim/recipe/index";
import { analyzeThroughput } from "../src/sim/factory-sim/index";
import {
  DEFAULT_CATALOG,
  type GenOptions,
  type MachineCatalogEntry,
} from "../src/sim/phase0_interfaces";
import { pathToFileURL } from "node:url";

export const MAX_BALANCE_SEEDS = 100_000;

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
  readonly rateNum: number;
  readonly rateDen: number;
  /** First-unit net profit/tick; float is reporting-only, never sim state. */
  readonly profitPerTick: number;
}

export interface SweepFailure {
  readonly seed: number;
  readonly error: string;
}

export interface SweepResult {
  readonly samples: Sample[];
  readonly failed: SweepFailure[];
}

export interface SweepOverrides {
  readonly generate?: typeof generate;
  readonly compileTemplate?: typeof compileTemplate;
  readonly analyzeThroughput?: typeof analyzeThroughput;
  readonly catalog?: readonly MachineCatalogEntry[];
}

function optsFor(seed: number, catalog: readonly MachineCatalogEntry[] = DEFAULT_CATALOG): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 32,
    height: 32,
    catalog,
    diseaseCount: 2,
    difficulty: { min: 2, max: 12 },
  };
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
  const catalog = overrides.catalog ?? DEFAULT_CATALOG;
  const samples: Sample[] = [];
  const failed: SweepFailure[] = [];
  for (let seed = 1; seed <= count; seed++) {
    try {
      const level = generateLevel(optsFor(seed, catalog));
      const seedSamples: Sample[] = [];
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
        const rate = report.rateNum / report.rateDen;
        seedSamples.push({
          seed,
          diseaseId: disease.id,
          difficulty: disease.difficulty,
          basePrice: disease.basePrice,
          cost,
          refSteps: disease.reference.steps.length,
          rateNum: report.rateNum,
          rateDen: report.rateDen,
          profitPerTick: rate * (disease.basePrice - cost),
        });
      }
      samples.push(...seedSamples);
    } catch (err) {
      failed.push({ seed, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { samples, failed };
}

export function sweepExitCode(result: SweepResult): 0 | 1 {
  return result.samples.length === 0 || result.failed.length > 0 ? 1 : 0;
}

function printDifficultyHistogram(samples: readonly Sample[]): void {
  const counts = new Map<number, number>();
  for (const s of samples) counts.set(s.difficulty, (counts.get(s.difficulty) ?? 0) + 1);
  const diffs = [...counts.keys()].sort((a, b) => a - b);
  console.log("difficulty histogram (count of diseases per difficulty):");
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
  console.log("\nbasePrice grouped by difficulty (median should rise with difficulty):");
  let prevMedian = -Infinity;
  for (const d of diffs) {
    const prices = byDiff.get(d) ?? [];
    const med = median(prices);
    const { min: lo, max: hi } = minMax(prices);
    const trend = med >= prevMedian ? "↑/=" : "↓!!";
    console.log(
      `  d=${String(d).padStart(2)} | n=${String(prices.length).padStart(4)} ` +
        `min=${String(lo).padStart(6)} median=${String(med).padStart(7)} max=${String(hi).padStart(6)} ${trend}`,
    );
    prevMedian = med;
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
  console.log(`HexaPharma balance sweep — ${count} seeds (nMaps 2, 16×16, diseaseCount 2, band [2,12])\n`);
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
