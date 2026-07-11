/**
 * HexaPharma — the Shop (Phase 3 sell loop).
 *
 * For each disease the player has produced inventory for, sell units at the
 * diminishing per-disease price computed by the economy sim. Revenue (net) is
 * applied to cash via `sellUnit`; the Shop never reimplements pricing — it CALLS
 * the sim. All diseases' demand is shown so diversifying is visible.
 */
import { useCallback } from "react";
import type {
  GeneratedLevel,
  EconomyState,
  DiseaseId,
  InventoryProduct,
} from "../sim/phase0_interfaces";
import { nextUnitPrice } from "../sim/economy";

interface ShopProps {
  readonly level: GeneratedLevel;
  readonly economy: EconomyState;
  readonly inventory: readonly InventoryProduct[];
  readonly onSell: (productIds: readonly number[], disease: DiseaseId) => void;
}

function soldSoFar(economy: EconomyState, disease: DiseaseId): number {
  for (const sc of economy.sold) if (sc.disease === disease) return sc.count;
  return 0;
}

export function Shop({ level, economy, inventory, onSell }: ShopProps) {
  const sellOne = useCallback(
    (disease: DiseaseId) => {
      const product = inventory.find((candidate) => candidate.outcome.cured.includes(disease));
      if (product === undefined) return;
      onSell([product.inventoryId], disease);
    },
    [inventory, onSell],
  );

  const sellAll = useCallback(
    (disease: DiseaseId) => {
      const productIds = inventory
        .filter((product) => product.outcome.cured.includes(disease))
        .map((product) => product.inventoryId);
      if (productIds.length > 0) onSell(productIds, disease);
    },
    [inventory, onSell],
  );

  return (
    <div className="game-view management-view market-view">
      <header className="management-header">
        <div className="panel-kicker">Commercial operations</div>
        <h1>Therapeutic Market</h1>
        <p>Ship physical products into independent disease markets. Repeated sales reduce that market's next price.</p>
      </header>
      <div className="market-grid" data-testid="market-grid">
        <div className="market-grid-contents" data-testid="shop-table">
          {level.diseases.map((disease) => {
            const eligible = inventory.filter((product) => product.outcome.cured.includes(disease.id));
            const have = eligible.length;
            const sold = soldSoFar(economy, disease.id);
            const next = nextUnitPrice(disease.basePrice, sold);
            return (
              <article key={disease.id} className={`market-card${have > 0 ? " is-active" : ""}`} data-testid={`shop-row-${disease.id}`}>
                <div className="market-card-heading">
                  <span className="disease-emblem">D{disease.id}</span>
                  <div><h2>Disease {disease.id}</h2><small>Effect map {disease.map} · difficulty {disease.difficulty}</small></div>
                </div>
                <div className="market-stats">
                  <div><span>Base</span><strong>{disease.basePrice}</strong></div>
                  <div><span>Sold</span><strong data-testid={`shop-sold-${disease.id}`}>{sold}</strong></div>
                  <div><span>Next</span><strong data-testid={`shop-next-${disease.id}`}>{next}</strong></div>
                  <div><span>Stock</span><strong data-testid={`shop-inv-${disease.id}`}>{have}</strong></div>
                </div>
                <div className="market-actions">
                  <button
                    type="button"
                    onClick={() => sellOne(disease.id)}
                    disabled={have <= 0}
                    className="primary-action"
                    data-testid={`shop-sell-${disease.id}`}
                  >
                    Ship one
                  </button>
                  <button
                    type="button"
                    onClick={() => sellAll(disease.id)}
                    disabled={have <= 0}
                    className="game-control"
                    data-testid={`shop-sell-all-${disease.id}`}
                  >
                    Ship all
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
