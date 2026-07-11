/**
 * HexaPharma — the Patents tab (Phase 3 talent tree).
 *
 * Lists DEFAULT_PATENTS with cost / locked / affordable state. Unlocking calls the
 * patent sim (`unlockPatent`, which spends cash); the unlockMap patent additionally
 * asks the Game to regenerate a deeper level. Active effects are summarized via
 * `activeEffects`. No unlock logic is reimplemented — the Shop/Patents only CALL sim.
 */
import { useState } from "react";
import type { EconomyState, PatentState } from "../sim/phase0_interfaces";
import { DEFAULT_PATENTS, canUnlock, activeEffects } from "../sim/patent";

interface PatentsProps {
  readonly economy: EconomyState;
  readonly patents: PatentState;
  readonly onUnlock: (id: string) => void;
}

function effectLabel(node: (typeof DEFAULT_PATENTS)[number]): string {
  const e = node.effect;
  switch (e.kind) {
    case "unlockMachine":
      return `unlock machine "${e.typeId}"`;
    case "expandFactory":
      return `expand factory +${e.dw}w +${e.dh}h`;
    case "revealAid":
      return `reveal aid +${e.amount}`;
    case "unlockMap":
      return "unlock a new, deeper map";
  }
}

export function Patents({ economy, patents, onUnlock }: PatentsProps) {
  const eff = activeEffects(DEFAULT_PATENTS, patents);
  const [pendingMapUnlock, setPendingMapUnlock] = useState<string | null>(null);

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
      <h1 style={{ margin: "0 0 4px" }}>HexaPharma Patents</h1>
      <p style={{ margin: "0 0 14px", color: "#5a6470" }}>
        Spend cash + research to deepen your lab. The <strong>new-map</strong> patents regenerate a
        bigger, deeper level. This clears the saved recipe, factory layout and runtime,
        factory waste, inventory, explored fog, and disease sales history; it keeps cash
        and R&amp;D after the patent cost, unlocked patents, and the next inventory ID.
      </p>

      {pendingMapUnlock !== null && (
        <div
          role="alertdialog"
          aria-label="Confirm deeper level reset"
          data-testid="patent-confirmation"
          style={{
            maxWidth: 740,
            marginBottom: 12,
            padding: "10px 12px",
            border: "1px solid #e2b35b",
            borderRadius: 8,
            background: "#fff7e8",
            color: "#5c4518",
            fontSize: 13,
          }}
        >
          <strong>Start a deeper level?</strong> This permanently clears the saved recipe,
          factory layout and runtime, factory waste, inventory, explored fog, and disease
          sales history. Cash and R&amp;D after the cost, patents, and the next inventory ID remain.
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              style={btn}
              data-testid={`patent-confirm-${pendingMapUnlock}`}
              onClick={() => {
                const id = pendingMapUnlock;
                setPendingMapUnlock(null);
                onUnlock(id);
              }}
            >
              Confirm deeper level
            </button>
            <button
              type="button"
              style={btn}
              data-testid={`patent-cancel-${pendingMapUnlock}`}
              onClick={() => setPendingMapUnlock(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div data-testid="patents-effects" style={{ fontSize: 12, color: "#5a6470", marginBottom: 12 }}>
        Active effects · factory +{eff.factoryDw}w +{eff.factoryDh}h · reveal aid {eff.revealAid} ·
        machines [{eff.unlockedMachines.join(", ") || "none"}] · new map {eff.newMapUnlocked ? "yes" : "no"}
      </div>

      <table data-testid="patents-table" style={{ borderCollapse: "collapse", width: "100%", maxWidth: 760 }}>
        <thead>
          <tr style={{ textAlign: "left", color: "#475260", fontSize: 12 }}>
            <th style={cell}>Patent</th>
            <th style={cell}>Effect</th>
            <th style={cell}>Cost</th>
            <th style={cell}>Requires</th>
            <th style={cell}>State</th>
            <th style={cell}>Unlock</th>
          </tr>
        </thead>
        <tbody>
          {DEFAULT_PATENTS.map((node) => {
            const unlocked = patents.unlocked.includes(node.id);
            const affordable = canUnlock(DEFAULT_PATENTS, patents, economy.cash, economy.research, node.id);
            const stateLabel = unlocked ? "unlocked" : affordable ? "available" : "locked";
            return (
              <tr key={node.id} data-testid={`patent-row-${node.id}`}>
                <td style={cell}>{node.id}</td>
                <td style={cell}>{effectLabel(node)}</td>
                <td style={cell}>{node.cost} cash + {node.researchCost} R&amp;D</td>
                <td style={cell}>{node.requires.join(", ") || "—"}</td>
                <td style={cell} data-testid={`patent-state-${node.id}`}>{stateLabel}</td>
                <td style={cell}>
                  <button
                    type="button"
                    onClick={() => {
                      if (node.effect.kind === "unlockMap") {
                        setPendingMapUnlock(node.id);
                      } else {
                        onUnlock(node.id);
                      }
                    }}
                    disabled={unlocked || !affordable}
                    style={btn}
                    data-testid={`patent-unlock-${node.id}`}
                  >
                    {unlocked ? "Owned" : "Unlock"}
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
