/**
 * HexaPharma — the Shop (Phase 3 sell loop).
 *
 * For each disease the player has produced inventory for, sell units at the
 * diminishing per-disease price computed by the economy sim. Revenue (net) is
 * applied to cash via `sellUnit`; the Shop never reimplements pricing — it CALLS
 * the sim. All diseases' demand is shown so diversifying is visible.
 */
import { useCallback, useState } from "react";
import type {
  GeneratedLevel,
  EconomyState,
  DiseaseId,
  InventoryProduct,
} from "../sim/phase0_interfaces";
import { nextUnitPrice } from "../sim/economy";
import { SIDE_EFFECT_PENALTY } from "../sim/game";
import { diseaseEmblem, diseaseName } from "./effectLabels";

interface ShopProps {
  readonly level: GeneratedLevel;
  readonly economy: EconomyState;
  readonly inventory: readonly InventoryProduct[];
  readonly onSell: (productIds: readonly number[], disease: DiseaseId) => boolean;
}

export function marketSaleFeedback(accepted: boolean, count: number): string {
  if (!accepted) return "";
  return count === 1
    ? "Shipped 1 · +1 Knowledge"
    : `Shipped ${count} · +1 Knowledge each`;
}

export function marketProducts(
  inventory: readonly InventoryProduct[],
  disease: DiseaseId,
): InventoryProduct[] {
  return inventory
    .filter((product) => product.outcome.cured.includes(disease))
    .sort((left, right) =>
      left.outcome.sideEffects.length - right.outcome.sideEffects.length ||
      left.productionCost - right.productionCost ||
      left.inventoryId - right.inventoryId,
    );
}

export function profitableMarketProducts(
  inventory: readonly InventoryProduct[],
  disease: DiseaseId,
  basePrice: number,
  alreadySold: number,
): InventoryProduct[] {
  const profitable: InventoryProduct[] = [];
  for (const product of marketProducts(inventory, disease)) {
    const gross = nextUnitPrice(basePrice, alreadySold + profitable.length);
    if (quoteMarketProduct(product, gross).net <= 0) continue;
    profitable.push(product);
  }
  return profitable;
}

export interface MarketQuote {
  readonly productId: number;
  readonly gross: number;
  readonly productionCost: number;
  readonly sideEffectCount: number;
  readonly sideEffectPenaltyEach: number;
  readonly sideEffectPenalty: number;
  readonly net: number;
}

function quoteMarketProduct(product: InventoryProduct, gross: number): MarketQuote {
  const sideEffectCount = product.outcome.sideEffects.length;
  const sideEffectPenalty = sideEffectCount * SIDE_EFFECT_PENALTY;
  return {
    productId: product.inventoryId,
    gross,
    productionCost: product.productionCost,
    sideEffectCount,
    sideEffectPenaltyEach: SIDE_EFFECT_PENALTY,
    sideEffectPenalty,
    net: gross - product.productionCost - sideEffectPenalty,
  };
}

export function bestMarketQuote(
  inventory: readonly InventoryProduct[],
  disease: DiseaseId,
  basePrice: number,
  alreadySold: number,
): MarketQuote | null {
  const gross = nextUnitPrice(basePrice, alreadySold);
  let fallback: MarketQuote | null = null;
  for (const product of marketProducts(inventory, disease)) {
    const quote = quoteMarketProduct(product, gross);
    if (fallback === null) fallback = quote;
    if (quote.net > 0) return quote;
  }
  return fallback;
}

export function marketDisabledReason(
  eligibleCount: number,
  quote: MarketQuote | null,
): string | null {
  if (eligibleCount === 0) return "No curative stock.";
  if (quote === null || quote.net <= 0) return "No profitable stock at next price.";
  return null;
}

function soldSoFar(economy: EconomyState, disease: DiseaseId): number {
  for (const sc of economy.sold) if (sc.disease === disease) return sc.count;
  return 0;
}

export function Shop({ level, economy, inventory, onSell }: ShopProps) {
  const [saleFeedback, setSaleFeedback] = useState("");
  const sellOne = useCallback(
    (disease: DiseaseId) => {
      const spec = level.diseases.find((candidate) => candidate.id === disease);
      if (spec === undefined) return;
      const product = profitableMarketProducts(
        inventory,
        disease,
        spec.basePrice,
        soldSoFar(economy, disease),
      )[0];
      if (product === undefined) return;
      setSaleFeedback(marketSaleFeedback(onSell([product.inventoryId], disease), 1));
    },
    [economy, inventory, level.diseases, onSell],
  );

  const sellAll = useCallback(
    (disease: DiseaseId) => {
      const spec = level.diseases.find((candidate) => candidate.id === disease);
      if (spec === undefined) return;
      const productIds = profitableMarketProducts(
        inventory,
        disease,
        spec.basePrice,
        soldSoFar(economy, disease),
      ).map((product) => product.inventoryId);
      if (productIds.length > 0) {
        setSaleFeedback(marketSaleFeedback(onSell(productIds, disease), productIds.length));
      }
    },
    [economy, inventory, level.diseases, onSell],
  );

  return (
    <div className="game-view management-view market-view">
      <header className="management-header">
        <h1>Market</h1>
        {saleFeedback !== "" && (
          <p role="status" data-testid="market-sale-feedback">{saleFeedback}</p>
        )}
      </header>
      <div className="market-grid" data-testid="market-grid">
        <div className="market-grid-contents" data-testid="shop-table">
          {level.diseases.map((disease) => {
            const eligible = marketProducts(inventory, disease.id);
            const have = eligible.length;
            const clean = eligible.filter((product) => product.outcome.sideEffects.length === 0).length;
            const tainted = have - clean;
            const sold = soldSoFar(economy, disease.id);
            const next = nextUnitPrice(disease.basePrice, sold);
            const profitable = profitableMarketProducts(
              inventory,
              disease.id,
              disease.basePrice,
              sold,
            );
            const quote = bestMarketQuote(
              inventory,
              disease.id,
              disease.basePrice,
              sold,
            );
            const disabledReason = marketDisabledReason(have, quote);
            const disabledReasonId = `shop-disabled-reason-${disease.id}`;
            return (
              <article key={disease.id} className={`market-card${have > 0 ? " is-active" : ""}`} data-testid={`shop-row-${disease.id}`}>
                <div className="market-card-heading">
                  <span className="disease-emblem">{diseaseEmblem(disease.id)}</span>
                  <h2>{diseaseName(disease.id)}</h2>
                </div>
                <div className="market-stats">
                  <div><span>Base</span><strong>{disease.basePrice}</strong></div>
                  <div><span>Sold</span><strong data-testid={`shop-sold-${disease.id}`}>{sold}</strong></div>
                  <div><span>Next gross</span><strong data-testid={`shop-next-${disease.id}`}>{next}</strong></div>
                  <div><span>Clean stock</span><strong data-testid={`shop-clean-${disease.id}`}>{clean}</strong></div>
                  <div><span>Tainted stock</span><strong data-testid={`shop-tainted-${disease.id}`}>{tainted}</strong></div>
                  <div><span>Best production cost</span><strong data-testid={`shop-production-cost-${disease.id}`}>{quote?.productionCost ?? "—"}</strong></div>
                  <div><span>Best effect penalty</span><strong data-testid={`shop-side-effect-penalty-${disease.id}`}>{quote === null ? "—" : `$${quote.sideEffectPenaltyEach} × ${quote.sideEffectCount} = $${quote.sideEffectPenalty}`}</strong></div>
                  <div><span>Best net</span><strong data-testid={`shop-net-${disease.id}`}>{quote?.net ?? "—"}</strong></div>
                </div>
                <div className="market-actions">
                  <button
                    type="button"
                    onClick={() => sellOne(disease.id)}
                    disabled={profitable.length <= 0}
                    aria-describedby={disabledReason === null ? undefined : disabledReasonId}
                    className="primary-action"
                    data-testid={`shop-sell-${disease.id}`}
                  >
                    Ship best
                  </button>
                  <button
                    type="button"
                    onClick={() => sellAll(disease.id)}
                    disabled={profitable.length <= 0}
                    aria-describedby={disabledReason === null ? undefined : disabledReasonId}
                    className="game-control"
                    data-testid={`shop-sell-all-${disease.id}`}
                  >
                    Ship profitable
                  </button>
                </div>
                {disabledReason !== null && (
                  <p id={disabledReasonId} data-testid={disabledReasonId}>{disabledReason}</p>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
