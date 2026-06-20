/**
 * HexaPharma — the Patents tab (Phase 3 talent tree).
 *
 * Lists DEFAULT_PATENTS with cost / locked / affordable state. Unlocking calls the
 * patent sim (`unlockPatent`, which spends cash); the unlockMap patent additionally
 * asks the Game to regenerate a deeper level. Active effects are summarized via
 * `activeEffects`. No unlock logic is reimplemented — the Shop/Patents only CALL sim.
 */
import { useCallback } from "react";
import type { EconomyState, PatentState } from "../sim/phase0_interfaces";
import { DEFAULT_PATENTS, canUnlock, unlockPatent, activeEffects } from "../sim/patent";

interface PatentsProps {
  readonly economy: EconomyState;
  readonly patents: PatentState;
  /** Apply an unlock: new patent state + remaining cash, and whether to regen a deeper map. */
  readonly onPatents: (patents: PatentState, cash: number, regenDeeper: boolean) => void;
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

export function Patents({ economy, patents, onPatents }: PatentsProps) {
  const eff = activeEffects(DEFAULT_PATENTS, patents);

  const unlock = useCallback(
    (id: string) => {
      const res = unlockPatent(DEFAULT_PATENTS, patents, economy.cash, id);
      const node = DEFAULT_PATENTS.find((n) => n.id === id);
      const regenDeeper = node?.effect.kind === "unlockMap";
      onPatents(res.patents, res.cash, regenDeeper);
    },
    [economy.cash, patents, onPatents],
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
      <h1 style={{ margin: "0 0 4px" }}>HexaPharma Patents</h1>
      <p style={{ margin: "0 0 14px", color: "#5a6470" }}>
        Spend cash to deepen your lab. The <strong>new-map</strong> patent regenerates a
        bigger, deeper level (resets recipe + inventory, keeps cash + patents).
      </p>

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
            const affordable = canUnlock(DEFAULT_PATENTS, patents, economy.cash, node.id);
            const stateLabel = unlocked ? "unlocked" : affordable ? "available" : "locked";
            return (
              <tr key={node.id} data-testid={`patent-row-${node.id}`}>
                <td style={cell}>{node.id}</td>
                <td style={cell}>{effectLabel(node)}</td>
                <td style={cell}>{node.cost}</td>
                <td style={cell}>{node.requires.join(", ") || "—"}</td>
                <td style={cell} data-testid={`patent-state-${node.id}`}>{stateLabel}</td>
                <td style={cell}>
                  <button
                    type="button"
                    onClick={() => unlock(node.id)}
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
