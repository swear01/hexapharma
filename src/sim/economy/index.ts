/**
 * HexaPharma — economy.
 *
 * Anti-degeneracy market: per-disease revenue DIMINISHES with prior sales, while
 * different diseases sell on INDEPENDENT counters (parallel demand). Spamming one
 * drug self-limits; diversifying pays. Satisfies the economy invariants:
 *   - cash conservation: cash change == revenue − cost − penalty,
 *   - non-negative sold counts,
 *   - anti-degeneracy: the per-disease gross price is monotonically non-increasing
 *     in `alreadySold`, so the Nth unit never out-earns an earlier one.
 *
 * Pure & deterministic: INTEGER arithmetic only (no Math.random / Date.now / float).
 *
 * Diminishing rule (exact):
 *   Let p_0 = basePrice and floor = max(1, floor(basePrice / 10)).
 *   p_{k+1} = max(floor, floor(p_k * 9 / 10)).
 *   nextUnitPrice(basePrice, alreadySold) = p_{alreadySold}.
 *   I.e. each successive unit of the same disease fetches 90% (integer-floored)
 *   of the previous unit's gross, never dropping below `floor` (a positive 10%
 *   floor of basePrice). alreadySold = 0 returns basePrice exactly. Non-positive
 *   basePrice clamps to a floor of 0 and returns 0.
 */
import type {
  DiseaseId,
  EconomyState,
  SoldCount,
  SaleResult,
} from "../phase0_interfaces";

/** Positive floor: 10% of basePrice (at least 1 when basePrice > 0). */
function priceFloor(basePrice: number): number {
  if (basePrice <= 0) return 0;
  return Math.max(1, Math.floor(basePrice / 10));
}

/**
 * Gross price the next (alreadySold-th, 0-based) unit of a disease fetches.
 * Monotonically non-increasing in `alreadySold` with a positive floor.
 * Deterministic integer geometric decay (×9/10 per prior sale, floored).
 */
export const nextUnitPrice = (basePrice: number, alreadySold: number): number => {
  if (basePrice <= 0) return 0;
  const floor = priceFloor(basePrice);
  let price = basePrice;
  const n = alreadySold < 0 ? 0 : alreadySold;
  for (let k = 0; k < n; k++) {
    if (price <= floor) return floor;
    const decayed = Math.floor((price * 9) / 10);
    price = decayed < floor ? floor : decayed;
  }
  return price;
};

/** Cumulative units already sold for `disease` in this economy. */
function soldSoFar(econ: EconomyState, disease: DiseaseId): number {
  for (const sc of econ.sold) {
    if (sc.disease === disease) return sc.count;
  }
  return 0;
}

/**
 * Return a new `sold` array with `disease`'s count incremented by one, kept in
 * deterministic ascending-by-disease order. Per-disease counters are independent,
 * so selling one disease never changes another's next price.
 */
function bumpSold(sold: readonly SoldCount[], disease: DiseaseId): SoldCount[] {
  const next: SoldCount[] = [];
  let inserted = false;
  for (const sc of sold) {
    if (sc.disease === disease) {
      next.push({ disease, count: sc.count + 1 });
      inserted = true;
    } else {
      if (!inserted && sc.disease > disease) {
        next.push({ disease, count: 1 });
        inserted = true;
      }
      next.push(sc);
    }
  }
  if (!inserted) next.push({ disease, count: 1 });
  return next;
}

/**
 * Sell one produced unit that cures `disease`.
 * revenue = nextUnitPrice(basePrice, soldSoFar(disease));
 * net     = revenue − productionCost − sideEffectPenalty;
 * econ    = { cash: cash + net, sold: sold with disease count + 1 }.
 */
export const sellUnit = (
  econ: EconomyState,
  disease: DiseaseId,
  basePrice: number,
  productionCost: number,
  sideEffectPenalty: number,
): SaleResult => {
  const revenue = nextUnitPrice(basePrice, soldSoFar(econ, disease));
  const net = revenue - productionCost - sideEffectPenalty;
  return {
    econ: {
      cash: econ.cash + net,
      sold: bumpSold(econ.sold, disease),
    },
    revenue,
    net,
  };
};
