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
import { nextUnitPrice, premiumGross } from "../sim/economy";
import { SHIPPING_CONTRACT_QUOTA, SIDE_EFFECT_PENALTY, cureRegionPrice } from "../sim/game";
import { diseaseEmblem, diseaseName } from "./effectLabels";

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

export function marketLineReadout(
  inventory: readonly InventoryProduct[],
  disease: DiseaseSpec,
  alreadySold: number,
): { readonly units: number; readonly gross: number; readonly net: number } {
  const products = profitableMarketProducts(inventory, disease, alreadySold);
  let gross = 0;
  let net = 0;
  for (const [index, product] of products.entries()) {
    const quote = quoteMarketProduct(product, disease, alreadySold + index);
    gross += quote.gross;
    net += quote.net;
  }
  return { units: products.length, gross, net };
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

export const MARKET_LADDER_UNITS = 5;

export function formatMoney(amount: number): string {
  return amount < 0 ? `−$${-amount}` : `$${amount}`;
}

/** The side-effect term of a quote, or null when the best unit is clean. */
export function marketPenaltyLabel(quote: MarketQuote | null): string | null {
  if (quote === null || quote.sideEffectCount === 0) return null;
  return `$${quote.sideEffectPenaltyEach} × ${quote.sideEffectCount} = $${quote.sideEffectPenalty}`;
}

/** Gross price of each of the next `count` units: finite demand made concrete. */
export function marketPriceLadder(basePrice: number, alreadySold: number, count = MARKET_LADDER_UNITS): number[] {
  return Array.from({ length: count }, (_, index) => nextUnitPrice(basePrice, alreadySold + index));
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
        <p>Every unit shipped lowers that disease’s next price.</p>
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
            const next = nextUnitPrice(disease.basePrice, sold);
            const quote = bestMarketQuote(inventory, disease, sold);
            const remaining = marketLineReadout(inventory, disease, sold);
            const disabledReason = marketDisabledReason(have, quote);
            const disabledReasonId = `shop-disabled-reason-${disease.id}`;
            const penalty = marketPenaltyLabel(quote);
            const contract = (
              <span className="market-contract">
                Sold <strong data-testid={`shop-sold-${disease.id}`}>{sold}</strong>
                {" · "}Contract <strong>{Math.min(sold, SHIPPING_CONTRACT_QUOTA)}/{SHIPPING_CONTRACT_QUOTA}</strong>
              </span>
            );
            if (have === 0) {
              return (
                <article key={disease.id} className="market-card is-quiet" data-testid={`shop-row-${disease.id}`}>
                  <span className="disease-emblem">{diseaseEmblem(disease.id)}</span>
                  <h2>{diseaseName(disease.id)}</h2>
                  <span className="market-quiet-price">Next <strong data-testid={`shop-next-${disease.id}`}>{formatMoney(next)}</strong></span>
                  {contract}
                  <span id={disabledReasonId} className="market-reason" data-testid={disabledReasonId}>{disabledReason}</span>
                </article>
              );
            }
            const describedBy = disabledReason === null ? undefined : disabledReasonId;
            return (
              <article key={disease.id} className="market-card is-active" data-testid={`shop-row-${disease.id}`}>
                <div className="market-card-heading">
                  <span className="disease-emblem">{diseaseEmblem(disease.id)}</span>
                  <h2>{diseaseName(disease.id)}</h2>
                  {contract}
                </div>
                <dl className="market-sheet">
                  <dt>Stock</dt>
                  <dd>
                    <span className="market-stock is-clean"><strong className="market-value-clean" data-testid={`shop-clean-${disease.id}`}>{clean}</strong> Clean</span>
                    <span className="market-stock is-tainted"><strong className="market-value-tainted" data-testid={`shop-tainted-${disease.id}`}>{tainted}</strong> Tainted</span>
                    {premium > 0 && (
                      <span className="market-stock is-premium"><strong className="market-value-premium" data-testid={`shop-premium-${disease.id}`}>{premium}</strong> ★ pay ×1.5</span>
                    )}
                  </dd>
                  <dt>Next unit</dt>
                  <dd className="market-equation">
                    <span><strong data-testid={`shop-next-${disease.id}`}>{formatMoney(quote?.gross ?? next)}</strong> {quote?.premium === true ? "★ price" : "price"}</span>
                    <span>− <strong data-testid={`shop-production-cost-${disease.id}`}>{formatMoney(quote?.productionCost ?? 0)}</strong> cost</span>
                    {penalty !== null && (
                      <span className="market-value-tainted">− <strong data-testid={`shop-side-effect-penalty-${disease.id}`}>{penalty}</strong> side effects</span>
                    )}
                    <span className="market-net">= <strong data-testid={`shop-net-${disease.id}`}>{formatMoney(quote?.net ?? 0)}</strong> net</span>
                  </dd>
                  <dt>Demand</dt>
                  <dd>
                    <ol className="price-ladder" aria-label={`Next ${MARKET_LADDER_UNITS} unit prices`} data-testid={`shop-ladder-${disease.id}`}>
                      {marketPriceLadder(quote?.regionPrice ?? disease.basePrice, sold).map((price, index) => (
                        <li key={index} className={index < remaining.units ? "is-covered" : undefined}>{formatMoney(price)}</li>
                      ))}
                    </ol>
                  </dd>
                </dl>
                <p className="market-readout" data-testid={`shop-stock-net-${disease.id}`}>
                  This stock can still net <strong>{formatMoney(remaining.net)}</strong> across <strong>{remaining.units}</strong> {remaining.units === 1 ? "unit" : "units"}.
                </p>
                <div className="market-actions">
                  <button
                    type="button"
                    onClick={() => ship(disease.id, false)}
                    disabled={remaining.units === 0}
                    aria-describedby={describedBy}
                    className="primary-action"
                    data-testid={`shop-sell-${disease.id}`}
                  >
                    Ship best
                  </button>
                  <button
                    type="button"
                    onClick={() => ship(disease.id, true)}
                    disabled={remaining.units === 0}
                    aria-describedby={describedBy}
                    className="game-control"
                    data-testid={`shop-sell-all-${disease.id}`}
                  >
                    Ship profitable
                  </button>
                  {disabledReason !== null && (
                    <p className="market-reason">
                      <span id={disabledReasonId} data-testid={disabledReasonId}>{disabledReason}</span>
                      {" "}Lower processing cost or side effects, or ship another disease.
                    </p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
