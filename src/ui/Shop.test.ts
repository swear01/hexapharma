import { describe, expect, it } from "vitest";
import type { InventoryProduct } from "../sim/phase0_interfaces";
import {
  bestMarketQuote,
  marketDisabledReason,
  marketProducts,
  marketSaleFeedback,
  profitableMarketProducts,
} from "./Shop";

function product(
  inventoryId: number,
  cures: readonly number[],
  sideEffects: readonly number[],
  productionCost: number,
): InventoryProduct {
  return {
    id: inventoryId,
    inventoryId,
    drug: { pos: [{ x: 0, y: 0 }], failed: false },
    productionCost,
    outcome: {
      failed: false,
      final: [{ x: 0, y: 0 }],
      cured: cures,
      sideEffects,
    },
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
    ], 0, 12, 0);

    expect(profitable.map((candidate) => candidate.inventoryId)).toEqual([1, 2]);
  });

  it("skips an unprofitable preferred item without consuming demand for later stock", () => {
    const profitable = profitableMarketProducts([
      product(1, [0], [], 60),
      product(2, [0], [9], 0),
      product(3, [0], [9], 19),
    ], 0, 50, 0);

    expect(profitable.map((candidate) => candidate.inventoryId)).toEqual([2, 3]);
  });

  it("quotes the exact gross, production cost, per-effect penalty, and net for Ship best", () => {
    const quote = bestMarketQuote([
      product(1, [0], [], 60),
      product(2, [0], [9], 0),
      product(3, [0], [9, 10], 1),
    ], 0, 50, 0);

    expect(quote).toEqual({
      productId: 2,
      gross: 50,
      productionCost: 0,
      sideEffectCount: 1,
      sideEffectPenaltyEach: 25,
      sideEffectPenalty: 25,
      net: 25,
    });
  });

  it("explains whether shipping is disabled by missing or unprofitable stock", () => {
    expect(marketDisabledReason(0, null)).toBe("No curative stock.");
    expect(marketDisabledReason(2, {
      productId: 1,
      gross: 24,
      productionCost: 26,
      sideEffectCount: 0,
      sideEffectPenaltyEach: 25,
      sideEffectPenalty: 0,
      net: -2,
    })).toBe("No profitable stock at next price.");
    expect(marketDisabledReason(2, {
      productId: 1,
      gross: 27,
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
    expect(marketSaleFeedback(true, 1)).toBe("Shipped 1 · +1 Knowledge");
    expect(marketSaleFeedback(true, 4)).toBe("Shipped 4 · +1 Knowledge each");
  });

});
