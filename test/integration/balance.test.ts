/**
 * Balance invariants (design §5 difficulty→price, §8 anti-degeneracy).
 *
 * These tests validate the economy/mapgen balance, not any single module's
 * contract: difficulties stay in band, price rises with difficulty, and
 * spamming one drug is never the optimal play (diminishing returns make a
 * diversified portfolio out-earn single-disease spam).
 *
 * Kept FAST: small maps + a modest seed count (the solver BFS is (W·H)^N).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { DEFAULT_CATALOG, type GenOptions, type EconomyState } from "../../src/sim/phase0_interfaces";
import { generate, difficultyToBasePrice } from "../../src/sim/mapgen/index";
import { nextUnitPrice, sellUnit } from "../../src/sim/economy/index";

const BAND = { min: 2, max: 8 } as const;

/** Small, fast generation options — keeps the (W·H)^N solver BFS tractable. */
function opts(seed: number): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 10,
    height: 10,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: BAND,
  };
}

/** Sweep a handful of seeds and collect every generated disease. */
function sweep(seeds: readonly number[]) {
  const out: { seed: number; level: ReturnType<typeof generate> }[] = [];
  for (const seed of seeds) {
    out.push({ seed, level: generate(opts(seed)) });
  }
  return out;
}

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

describe("balance: difficulty band (INV-11)", () => {
  it("every generated disease's difficulty stays within [min,max]", () => {
    for (const { level } of sweep(SEEDS)) {
      expect(level.diseases.length).toBeGreaterThan(0);
      for (const d of level.diseases) {
        expect(d.difficulty).toBeGreaterThanOrEqual(BAND.min);
        expect(d.difficulty).toBeLessThanOrEqual(BAND.max);
      }
    }
  });
});

describe("balance: price rises with difficulty (§5, INV-12)", () => {
  it("difficultyToBasePrice is monotonic non-decreasing in difficulty (property)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 200 }),
        (a, b, refCost) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          return difficultyToBasePrice(hi, refCost) >= difficultyToBasePrice(lo, refCost);
        },
      ),
    );
  });

  it("across generated levels, median basePrice of harder diseases ≥ that of easier ones", () => {
    const byDiff = new Map<number, number[]>();
    for (const { level } of sweep(SEEDS)) {
      for (const d of level.diseases) {
        const arr = byDiff.get(d.difficulty) ?? [];
        arr.push(d.basePrice);
        byDiff.set(d.difficulty, arr);
      }
    }
    const median = (xs: number[]): number => {
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    };
    const diffs = [...byDiff.keys()].sort((a, b) => a - b);
    // Need at least two distinct difficulty levels to compare.
    expect(diffs.length).toBeGreaterThanOrEqual(2);
    let prev = -Infinity;
    for (const d of diffs) {
      const med = median(byDiff.get(d)!);
      expect(med).toBeGreaterThanOrEqual(prev);
      prev = med;
    }
  });
});

describe("balance: anti-degeneracy — 狂產單一藥 ≠ 最佳解 (§8)", () => {
  const K = 12; // units to allocate

  /** Total revenue from selling `units[i]` units of disease i, with diminishing returns. */
  function totalRevenue(plan: readonly { disease: number; basePrice: number; units: number }[]): number {
    let econ: EconomyState = { cash: 0, research: 0, sold: [] };
    let revenue = 0;
    for (const p of plan) {
      for (let n = 0; n < p.units; n++) {
        const r = sellUnit(econ, p.disease, p.basePrice, 0, 0);
        econ = r.econ;
        revenue += r.revenue;
      }
    }
    return revenue;
  }

  interface Allocation {
    /** All-K-units-of-the-single-best-disease (the naive spam play). */
    single: number;
    /** Same K units spread EVENLY across every available disease. */
    even: number;
    /** Same K units allocated by the OPTIMAL portfolio (always sell the highest
     *  current marginal price) — the genuinely best "spread across diseases" play. */
    greedy: number;
  }

  function allocate(seed: number): Allocation {
    const level = generate(opts(seed));
    const diseases = level.diseases.map((d) => ({ id: d.id, basePrice: d.basePrice }));
    expect(diseases.length).toBeGreaterThanOrEqual(2);

    // The "best" disease = highest basePrice (the spam target a naive player picks).
    const best = [...diseases].sort((a, b) => b.basePrice - a.basePrice)[0]!;
    const single = totalRevenue([{ disease: best.id, basePrice: best.basePrice, units: K }]);

    // EVEN: K spread evenly across all available diseases.
    const baseUnits = Math.floor(K / diseases.length);
    let extra = K % diseases.length;
    const evenPlan = diseases.map((d) => {
      const units = baseUnits + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      return { disease: d.id, basePrice: d.basePrice, units };
    });
    const even = totalRevenue(evenPlan);

    // GREEDY: each of the K units goes to the disease with the highest CURRENT
    // (post-diminishing) marginal price — the optimal diversified portfolio.
    let econ: EconomyState = { cash: 0, research: 0, sold: [] };
    let greedy = 0;
    for (let i = 0; i < K; i++) {
      let bestId = diseases[0]!.id;
      let bestBp = diseases[0]!.basePrice;
      let bestPrice = -1;
      for (const d of diseases) {
        const sold = econ.sold.find((s) => s.disease === d.id)?.count ?? 0;
        const price = nextUnitPrice(d.basePrice, sold);
        if (price > bestPrice) {
          bestPrice = price;
          bestId = d.id;
          bestBp = d.basePrice;
        }
      }
      const r = sellUnit(econ, bestId, bestBp, 0, 0);
      econ = r.econ;
      greedy += r.revenue;
    }

    return { single, even, greedy };
  }

  it("even-split revenue > single-spam for a representative seed (comparable prices)", () => {
    // Seed 1 generates two diseases with near-equal basePrices, so an even split
    // strictly out-earns dumping all K units into one (diminishing returns bite).
    const { single, even } = allocate(1);
    expect(even).toBeGreaterThan(single);
  });

  it("optimal diversified portfolio is NEVER worse than single-spam (all seeds)", () => {
    // The strongest anti-degeneracy statement: spamming one drug can never beat the
    // best diversified allocation — so "狂產單一藥" is never the unique optimum.
    for (const seed of SEEDS) {
      const { single, greedy } = allocate(seed);
      expect(greedy).toBeGreaterThanOrEqual(single);
    }
  });

  it("diversifying STRICTLY beats single-spam for a strong majority of seeds", () => {
    let wins = 0;
    for (const seed of SEEDS) {
      const { single, greedy } = allocate(seed);
      if (greedy > single) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.75));
  });

  it("diminishing returns: per-unit price is non-increasing in prior sales", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5000 }),
        fc.integer({ min: 0, max: 30 }),
        (basePrice, sold) => {
          return nextUnitPrice(basePrice, sold) >= nextUnitPrice(basePrice, sold + 1);
        },
      ),
    );
  });
});
