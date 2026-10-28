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
  DiseaseSpec,
  InventoryProduct,
} from "../sim/phase0_interfaces";
import { BASE_NAMES } from "../sim/phase0_interfaces";
import { nextUnitPrice, premiumGross } from "../sim/economy";
import { SIDE_EFFECT_PENALTY, cureRegionPrice } from "../sim/game";
import { diseaseName } from "./effectLabels";

interface ShopProps {
  readonly level: GeneratedLevel;
  readonly economy: EconomyState;
  readonly inventory: readonly InventoryProduct[];
  readonly onSell: (productIds: readonly number[], disease: DiseaseId) => boolean;
}

export function marketSaleFeedback(accepted: boolean, count: number): string {
  if (!accepted) return "";
  return `Shipped ${count}`;
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
  disease: DiseaseSpec,
  alreadySold: number,
): InventoryProduct[] {
  const profitable: InventoryProduct[] = [];
  for (const product of marketProducts(inventory, disease.id)) {
    if (quoteMarketProduct(product, disease, alreadySold + profitable.length).net <= 0) continue;
    profitable.push(product);
  }
  return profitable;
}

export interface MarketQuote {
  readonly productId: number;
  /** Price of the cure region the product ended on, before demand decay. */
  readonly regionPrice: number;
  /** Demand price of that region, plus half again when the product hit a ★ (tier-2) cure. */
  readonly gross: number;
  readonly premium: boolean;
  readonly productionCost: number;
  readonly sideEffectCount: number;
  readonly sideEffectPenaltyEach: number;
  readonly sideEffectPenalty: number;
  readonly net: number;
}

function quoteMarketProduct(product: InventoryProduct, disease: DiseaseSpec, alreadySold: number): MarketQuote {
  const sideEffectCount = product.outcome.sideEffects.length;
  const sideEffectPenalty = sideEffectCount * SIDE_EFFECT_PENALTY;
  const premium = product.outcome.premium.includes(disease.id);
  const regionPrice = cureRegionPrice(disease, product.outcome);
  const demand = nextUnitPrice(regionPrice, alreadySold);
  const gross = premium ? premiumGross(demand) : demand;
  return {
    productId: product.inventoryId,
    regionPrice,
    gross,
    premium,
    productionCost: product.productionCost,
    sideEffectCount,
    sideEffectPenaltyEach: SIDE_EFFECT_PENALTY,
    sideEffectPenalty,
    net: gross - product.productionCost - sideEffectPenalty,
  };
}

export function bestMarketQuote(
  inventory: readonly InventoryProduct[],
  disease: DiseaseSpec,
  alreadySold: number,
): MarketQuote | null {
  let fallback: MarketQuote | null = null;
  for (const product of marketProducts(inventory, disease.id)) {
    const quote = quoteMarketProduct(product, disease, alreadySold);
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

export function formatMoney(amount: number): string {
  return amount < 0 ? `−$${-amount}` : `$${amount}`;
}

/** The next unit's sum, for the net figure's tooltip. */
export function marketQuoteBreakdown(quote: MarketQuote): string {
  const penalty = quote.sideEffectCount === 0 ? "" : ` − $${quote.sideEffectPenalty} side effects`;
  return `${formatMoney(quote.gross)}${quote.premium ? " ★" : ""} price − $${quote.productionCost} cost${penalty}. Each unit shipped lowers the next price.`;
}

function soldSoFar(economy: EconomyState, disease: DiseaseId): number {
  for (const sc of economy.sold) if (sc.disease === disease) return sc.count;
  return 0;
}

export function Shop({ level, economy, inventory, onSell }: ShopProps) {
  const [saleFeedback, setSaleFeedback] = useState({ text: "", serial: 0 });
  const ship = useCallback(
    (disease: DiseaseId, all: boolean) => {
      const spec = level.diseases.find((candidate) => candidate.id === disease);
      if (spec === undefined) return;
      const profitable = profitableMarketProducts(inventory, spec, soldSoFar(economy, disease));
      const productIds = (all ? profitable : profitable.slice(0, 1)).map((product) => product.inventoryId);
      if (productIds.length === 0) return;
      const text = marketSaleFeedback(onSell(productIds, disease), productIds.length);
      setSaleFeedback((previous) => ({ text, serial: previous.serial + 1 }));
    },
    [economy, inventory, level.diseases, onSell],
  );

  const rows = level.diseases.map((disease) => ({ disease, eligible: marketProducts(inventory, disease.id) }));
  rows.sort((left, right) =>
    Number(right.eligible.length > 0) - Number(left.eligible.length > 0) || left.disease.id - right.disease.id);

  return (
    <div className="game-view management-view market-view">
      <header className="management-header">
        <h1>Market</h1>
        {saleFeedback.text !== "" && (
          <p key={saleFeedback.serial} className="market-feedback" role="status" data-testid="market-sale-feedback">{saleFeedback.text}</p>
        )}
      </header>
      <div className="market-grid" data-testid="market-grid">
        <div className="market-grid-contents" data-testid="shop-table">
          {rows.map(({ disease, eligible }) => {
            const have = eligible.length;
            const clean = eligible.filter((product) => product.outcome.sideEffects.length === 0).length;
            const premium = eligible.filter((product) => product.outcome.premium.includes(disease.id)).length;
            const tainted = have - clean;
            const sold = soldSoFar(economy, disease.id);
            const quote = bestMarketQuote(inventory, disease, sold);
            const disabledReason = marketDisabledReason(have, quote);
            const disabledReasonId = `shop-disabled-reason-${disease.id}`;
            const cardTitle = (
              <h2>{diseaseName(disease.id)}{level.mm.maps.length > 1 && ` · ${BASE_NAMES[disease.map]}`}</h2>
            );
            if (have === 0 || quote === null) {
              return (
                <article key={disease.id} className="market-card is-quiet" data-testid={`shop-row-${disease.id}`}>
                  {cardTitle}
                  <span className="market-quiet-price" title="Next unit price">Next <strong data-testid={`shop-next-${disease.id}`}>{formatMoney(nextUnitPrice(disease.basePrice, sold))}</strong></span>
                </article>
              );
            }
            const describedBy = disabledReason === null ? undefined : disabledReasonId;
            return (
              <article key={disease.id} className="market-card is-active" data-testid={`shop-row-${disease.id}`}>
                <div className="market-card-heading">
                  {cardTitle}
                  <span className="market-net" title={marketQuoteBreakdown(quote)}>
                    Net <strong data-testid={`shop-net-${disease.id}`}>{formatMoney(quote.net)}</strong>
                  </span>
                </div>
                <div className="market-card-body">
                  <span className="market-stock" title="Units in stock">
                    <span className="is-clean"><strong data-testid={`shop-clean-${disease.id}`}>{clean}</strong> clean</span>
                    {tainted > 0 && <span className="is-tainted"><strong data-testid={`shop-tainted-${disease.id}`}>{tainted}</strong> tainted</span>}
                    {premium > 0 && <span className="is-premium" title="★ pays ×1.5"><strong data-testid={`shop-premium-${disease.id}`}>{premium}</strong> ★</span>}
                  </span>
                  <div className="market-actions">
                    <button
                      type="button"
                      onClick={() => ship(disease.id, false)}
                      disabled={disabledReason !== null}
                      aria-describedby={describedBy}
                      className="primary-action"
                      data-testid={`shop-sell-${disease.id}`}
                    >
                      Ship best
                    </button>
                    <button
                      type="button"
                      onClick={() => ship(disease.id, true)}
                      disabled={disabledReason !== null}
                      aria-describedby={describedBy}
                      className="game-control"
                      data-testid={`shop-sell-all-${disease.id}`}
                    >
                      Ship profitable
                    </button>
                  </div>
                </div>
                {disabledReason !== null && (
                  <p id={disabledReasonId} className="market-reason" data-testid={disabledReasonId} title="Lower processing cost or side effects, or ship another disease.">{disabledReason}</p>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
