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
 *   Let p_0 = basePrice.
 *   p_{k+1} = floor(p_k * 9 / 10).
 *   nextUnitPrice(basePrice, alreadySold) = p_{alreadySold}.
 *   I.e. each successive unit of the same disease fetches 90% (integer-floored)
 *   of the previous unit's gross until demand reaches zero. alreadySold = 0
 *   returns basePrice exactly. Non-positive basePrice returns 0.
 */
import type {
  DiseaseId,
  EconomyState,
  SoldCount,
  SaleResult,
} from "../phase0_interfaces";

/**
 * Gross price the next (alreadySold-th, 0-based) unit of a disease fetches.
 * Monotonically non-increasing in `alreadySold` until reaching zero.
 * Deterministic integer geometric decay (×9/10 per prior sale, floored).
 */
export const nextUnitPrice = (basePrice: number, alreadySold: number): number => {
  if (!Number.isSafeInteger(basePrice)) {
    throw new Error("economy: basePrice must be a safe integer");
  }
  if (!Number.isSafeInteger(alreadySold) || alreadySold < 0) {
    throw new Error("economy: alreadySold must be a non-negative safe integer");
  }
  if (basePrice <= 0) return 0;
  let price = basePrice;
  for (let k = 0; k < alreadySold; k++) {
    if (price === 0) return 0;
    const quotient = Math.floor(price / 10);
    const remainder = price % 10;
    price = quotient * 9 + Math.floor((remainder * 9) / 10);
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
  if (!Number.isSafeInteger(econ.cash)) throw new Error("economy: cash must be a safe integer");
  if (!Number.isSafeInteger(econ.research) || econ.research < 0) {
    throw new Error("economy: research must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(disease) || disease < 0) {
    throw new Error("economy: disease must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(productionCost) || productionCost < 0) {
    throw new Error("economy: production cost must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(sideEffectPenalty) || sideEffectPenalty < 0) {
    throw new Error("economy: side-effect penalty must be a non-negative safe integer");
  }
  let previousDisease = -1;
  for (const sold of econ.sold) {
    if (!Number.isSafeInteger(sold.disease) || sold.disease < 0 || sold.disease <= previousDisease) {
      throw new Error("economy: sold diseases must be unique non-negative safe integers in order");
    }
    if (!Number.isSafeInteger(sold.count) || sold.count <= 0) {
      throw new Error("economy: stored sold count must be a positive safe integer");
    }
    if (sold.disease === disease && sold.count === Number.MAX_SAFE_INTEGER) {
      throw new Error("economy: sold count cannot be incremented safely");
    }
    previousDisease = sold.disease;
  }
  const revenue = nextUnitPrice(basePrice, soldSoFar(econ, disease));
  const net = revenue - productionCost - sideEffectPenalty;
  const cash = econ.cash + net;
  const research = econ.research + 1;
  if (!Number.isSafeInteger(net) || !Number.isSafeInteger(cash) || !Number.isSafeInteger(research)) {
    throw new Error("economy: sale result exceeds safe-integer range");
  }
  return {
    econ: {
      cash,
      research,
      sold: bumpSold(econ.sold, disease),
    },
    revenue,
    net,
  };
};
