import { describe, expect, it } from "vitest";
import type { DiseaseSpec, InventoryProduct } from "../sim/phase0_interfaces";
import {
  bestMarketQuote,
  marketDisabledReason,
  marketProducts,
  marketLineReadout,
  marketPenaltyLabel,
  marketPriceLadder,
  marketSaleFeedback,
  formatMoney,
  profitableMarketProducts,
} from "./Shop";
import { nextUnitPrice } from "../sim/economy";

function product(
  inventoryId: number,
  cures: readonly number[],
  sideEffects: readonly number[],
  productionCost: number,
  premium: readonly number[] = [],
  region = 1,
): InventoryProduct {
  return {
    id: inventoryId,
    inventoryId,
    base: 0,
    drug: { pos: [{ q: 0, r: 0 }], offset: [{ q: 0, r: 0 }], heading: 0, failed: false },
    productionCost,
    outcome: {
      failed: false,
      final: [{ q: 0, r: 0 }],
      cured: cures,
      premium,
      regions: cures.map(() => region),
      sideEffects,
    },
  };
}

/** A disease whose region 1 sells at `price` (region 2 at twice that). */
function disease(id: number, price: number): DiseaseSpec {
  return {
    id,
    map: 0,
    node: { q: 0, r: 0 },
    difficulty: 1,
    basePrice: price,
    regions: [
      { id: 1, difficulty: 1, price, capped: false },
      { id: 2, difficulty: 2, price: price * 2, capped: false },
    ],
    reference: { steps: [] },
  };
}

describe("Market product choice", () => {
  it("shows only matching cures and ships clean, cheaper stock first", () => {
    const ranked = marketProducts([
      product(3, [0], [9], 10),
      product(2, [0], [], 14),
      product(1, [1], [], 1),
      product(4, [0], [], 8),
    ], 0);

    expect(ranked.map((candidate) => candidate.inventoryId)).toEqual([4, 2, 3]);
  });

  it("does not bulk-ship stock once demand would make a unit unprofitable", () => {
    const profitable = profitableMarketProducts([
      product(1, [0], [], 5),
      product(2, [0], [], 5),
      product(3, [0], [9], 5),
    ], disease(0, 12), 0);

    expect(profitable.map((candidate) => candidate.inventoryId)).toEqual([1, 2]);
  });

  it("skips an unprofitable preferred item without consuming demand for later stock", () => {
    const profitable = profitableMarketProducts([
      product(1, [0], [], 60),
      product(2, [0], [9], 0),
      product(3, [0], [9], 19),
    ], disease(0, 50), 0);

    expect(profitable.map((candidate) => candidate.inventoryId)).toEqual([2, 3]);
  });

  it("quotes the exact gross, production cost, per-effect penalty, and net for Ship best", () => {
    const quote = bestMarketQuote([
      product(1, [0], [], 60),
      product(2, [0], [9], 0),
      product(3, [0], [9, 10], 1),
    ], disease(0, 50), 0);

    expect(quote).toEqual({
      productId: 2,
      regionPrice: 50,
      gross: 50,
      premium: false,
      productionCost: 0,
      sideEffectCount: 1,
      sideEffectPenaltyEach: 25,
      sideEffectPenalty: 25,
      net: 25,
    });
  });

  it("prices each unit by the cure region it ended on", () => {
    const quote = bestMarketQuote([product(1, [0], [], 10, [], 2)], disease(0, 50), 1)!;
    expect(quote).toMatchObject({ regionPrice: 100, gross: nextUnitPrice(100, 1), net: nextUnitPrice(100, 1) - 10 });
    expect(bestMarketQuote([product(1, [0], [], 10, [0], 2)], disease(0, 50), 0)).toMatchObject({ premium: true, gross: 150 });
  });

  it("quotes a ★ (tier-2) cure at demand + floor(demand / 2)", () => {
    const quote = bestMarketQuote([product(1, [0], [], 10, [0])], disease(0, 51), 0)!;
    expect(quote).toMatchObject({ premium: true, gross: 76, net: 66 });
    expect(bestMarketQuote([product(1, [0, 1], [], 10, [1])], disease(0, 51), 0)).toMatchObject({ premium: false, gross: 51 });
  });

  it("explains whether shipping is disabled by missing or unprofitable stock", () => {
    expect(marketDisabledReason(0, null)).toBe("No curative stock.");
    expect(marketDisabledReason(2, {
      productId: 1,
      regionPrice: 24,
      gross: 24,
      premium: false,
      productionCost: 26,
      sideEffectCount: 0,
      sideEffectPenaltyEach: 25,
      sideEffectPenalty: 0,
      net: -2,
    })).toBe("No profitable stock at next price.");
    expect(marketDisabledReason(2, {
      productId: 1,
      regionPrice: 27,
      gross: 27,
      premium: false,
      productionCost: 26,
      sideEffectCount: 0,
      sideEffectPenaltyEach: 25,
      sideEffectPenalty: 0,
      net: 1,
    })).toBeNull();
  });

  it("reports a shipment only when the authoritative sale was accepted", () => {
    expect(marketSaleFeedback(false, 1)).toBe("");
    expect(marketSaleFeedback(false, 4)).toBe("");
    expect(marketSaleFeedback(true, 1)).toBe("Shipped 1");
    expect(marketSaleFeedback(true, 4)).toBe("Shipped 4");
  });

});

it("stock readout sums only profitable units at their successive demand prices", () => {
  const inventory = [product(1, [0], [], 60), product(2, [0], [9], 0), product(3, [0], [9], 19)];
  const selected = profitableMarketProducts(inventory, disease(0, 50), 0);
  const quotes = selected.map((item, index) => bestMarketQuote([item], disease(0, 50), index)!);
  expect(marketLineReadout(inventory, disease(0, 50), 0)).toEqual({
    units: selected.length,
    gross: quotes.reduce((sum, quote) => sum + quote.gross, 0),
    net: quotes.reduce((sum, quote) => sum + quote.net, 0),
  });
  expect(marketLineReadout([], disease(0, 50), 0)).toEqual({ units: 0, gross: 0, net: 0 });
});

it("shows the side-effect penalty only when the best unit carries side effects", () => {
  expect(marketPenaltyLabel(null)).toBeNull();
  expect(marketPenaltyLabel(bestMarketQuote([product(1, [0], [], 5)], disease(0, 50), 0))).toBeNull();
  expect(marketPenaltyLabel(bestMarketQuote([product(1, [0], [9, 10], 0)], disease(0, 80), 0)))
    .toBe("$25 × 2 = $50");
});

it("price ladder lists the sim's next unit prices from the current sold count", () => {
  expect(marketPriceLadder(96, 3)).toEqual([3, 4, 5, 6, 7].map((sold) => nextUnitPrice(96, sold)));
  expect(marketPriceLadder(96, 0, 2)).toEqual([96, nextUnitPrice(96, 1)]);
});

it("formats negative money with a leading minus sign", () => {
  expect(formatMoney(70)).toBe("$70");
  expect(formatMoney(0)).toBe("$0");
  expect(formatMoney(-1)).toBe("−$1");
});
