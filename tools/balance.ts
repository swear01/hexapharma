/**
 * HexaPharma — balance sweep tool.
 *
 *   npm run balance [count]   # sweep `count` seeds (default 100)
 *
 * Generates a level per seed at a representative config (nMaps 2, 16×16,
 * diseaseCount 2, difficulty band [2,12]) and, per generated disease, collects:
 *   - difficulty, basePrice, solver cost, reference (canonical) step count,
 *   - compiled-reference steady throughput rate (from analyzeThroughput),
 *   - a simple profit/tick ≈ rate × basePrice.
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
import { DEFAULT_CATALOG, type GenOptions } from "../src/sim/phase0_interfaces";

interface Sample {
  readonly seed: number;
  readonly diseaseId: number;
  readonly difficulty: number;
  readonly basePrice: number;
  readonly cost: number;
  readonly refSteps: number;
  readonly rateNum: number;
  readonly rateDen: number;
  /** profit/tick ≈ (rateNum/rateDen) × basePrice, as a float for reporting only. */
  readonly profitPerTick: number;
}

function optsFor(seed: number): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 16,
    height: 16,
    catalog: DEFAULT_CATALOG,
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

function sweep(count: number): { samples: Sample[]; failed: { seed: number; error: string }[] } {
  const samples: Sample[] = [];
  const failed: { seed: number; error: string }[] = [];
  for (let seed = 1; seed <= count; seed++) {
    let level;
    try {
      level = generate(optsFor(seed));
    } catch (err) {
      failed.push({ seed, error: err instanceof Error ? err.message : String(err) });
      continue;
    }
    for (const d of level.diseases) {
      const layout = compileTemplate(d.reference);
      const tp = analyzeThroughput(layout, level.mm);
      const rate = tp.rateDen === 0 ? 0 : tp.rateNum / tp.rateDen;
      samples.push({
        seed,
        diseaseId: d.id,
        difficulty: d.difficulty,
        basePrice: d.basePrice,
        cost: d.reference.steps.reduce((acc, s) => {
          const entry = DEFAULT_CATALOG.find((e) => e.typeId === s.typeId);
          return acc + (entry?.cost ?? 0);
        }, 0),
        refSteps: d.reference.steps.length,
        rateNum: tp.rateNum,
        rateDen: tp.rateDen,
        profitPerTick: rate * d.basePrice,
      });
    }
  }
  return { samples, failed };
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
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
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
  const lo = Math.min(...profits);
  const hi = Math.max(...profits);
  const med = median(profits);
  console.log("\nprofit/tick spread (rate × basePrice):");
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

function main(): void {
  const arg = process.argv[2];
  const count = arg !== undefined ? Number.parseInt(arg, 10) : 100;
  if (!Number.isFinite(count) || count <= 0) {
    console.error(`invalid count: ${arg}`);
    process.exitCode = 1;
    return;
  }

  console.log(`HexaPharma balance sweep — ${count} seeds (nMaps 2, 16×16, diseaseCount 2, band [2,12])\n`);
  const { samples, failed } = sweep(count);

  if (samples.length === 0) {
    console.error("no diseases generated; nothing to report.");
    if (failed.length > 0) console.error(`${failed.length} seed(s) failed to generate.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `generated ${samples.length} diseases from ${count - failed.length}/${count} seeds` +
      (failed.length > 0 ? ` (${failed.length} seed(s) failed to generate)` : "") +
      ".\n",
  );

  printDifficultyHistogram(samples);
  printPriceByDifficulty(samples);
  printProfitSpread(samples);
}

main();
