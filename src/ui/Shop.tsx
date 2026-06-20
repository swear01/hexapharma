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
} from "../sim/phase0_interfaces";
import { sellUnit, nextUnitPrice } from "../sim/economy";

interface ShopProps {
  readonly level: GeneratedLevel;
  readonly economy: EconomyState;
  readonly inventory: Record<DiseaseId, number>;
  /** Production cost charged per unit sold (sum of recipe step costs). */
  readonly recipeCost: number;
  /** Apply a sale: caller updates cash from the new economy + decrements inventory. */
  readonly onSell: (disease: DiseaseId, nextEconomy: EconomyState) => void;
}

function soldSoFar(economy: EconomyState, disease: DiseaseId): number {
  for (const sc of economy.sold) if (sc.disease === disease) return sc.count;
  return 0;
}

export function Shop({ level, economy, inventory, recipeCost, onSell }: ShopProps) {
  const sellOne = useCallback(
    (disease: DiseaseId, basePrice: number) => {
      if ((inventory[disease] ?? 0) <= 0) return;
      // sideEffectPenalty = 0 (Phase 1 cures land on a cure cell, no side-effect).
      const res = sellUnit(economy, disease, basePrice, recipeCost, 0);
      onSell(disease, res.econ);
    },
    [economy, inventory, recipeCost, onSell],
  );

  const sellAll = useCallback(
    (disease: DiseaseId, basePrice: number) => {
      let econ = economy;
      let have = inventory[disease] ?? 0;
      while (have > 0) {
        const res = sellUnit(econ, disease, basePrice, recipeCost, 0);
        econ = res.econ;
        have -= 1;
        onSell(disease, res.econ);
      }
    },
    [economy, inventory, recipeCost, onSell],
  );

  const btn: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #b8c2cc",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };
  const cell: React.CSSProperties = { padding: "8px 10px", borderBottom: "1px solid #eef2f6", fontSize: 13 };

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#1d242c", maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 4px" }}>HexaPharma Shop</h1>
      <p style={{ margin: "0 0 14px", color: "#5a6470" }}>
        Sell produced units. Each successive unit of the SAME disease fetches less
        (diminishing demand), so diversifying your cures pays. Production cost per
        unit: {recipeCost}.
      </p>

      <table data-testid="shop-table" style={{ borderCollapse: "collapse", width: "100%", maxWidth: 760 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#475260", fontSize: 12 }}>
            <th style={cell}>Disease</th>
            <th style={cell}>Base price</th>
            <th style={cell}>Sold</th>
            <th style={cell}>Next price</th>
            <th style={cell}>Inventory</th>
            <th style={cell}>Sell</th>
          </tr>
        </thead>
        <tbody>
          {level.diseases.map((d) => {
            const have = inventory[d.id] ?? 0;
            const sold = soldSoFar(economy, d.id);
            const next = nextUnitPrice(d.basePrice, sold);
            return (
              <tr key={d.id} data-testid={`shop-row-${d.id}`}>
                <td style={cell}>{d.id}</td>
                <td style={cell}>{d.basePrice}</td>
                <td style={cell} data-testid={`shop-sold-${d.id}`}>{sold}</td>
                <td style={cell} data-testid={`shop-next-${d.id}`}>{next}</td>
                <td style={cell} data-testid={`shop-inv-${d.id}`}>{have}</td>
                <td style={cell}>
                  <button
                    type="button"
                    onClick={() => sellOne(d.id, d.basePrice)}
                    disabled={have <= 0}
                    style={btn}
                    data-testid={`shop-sell-${d.id}`}
                  >
                    Sell 1
                  </button>{" "}
                  <button
                    type="button"
                    onClick={() => sellAll(d.id, d.basePrice)}
                    disabled={have <= 0}
                    style={btn}
                    data-testid={`shop-sell-all-${d.id}`}
                  >
                    Sell all
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
