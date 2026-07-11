/**
 * HexaPharma — the Patents tab (Phase 3 talent tree).
 *
 * Lists DEFAULT_PATENTS with cost / locked / affordable state. Unlocking calls the
 * patent sim (`unlockPatent`, which spends cash); the unlockMap patent additionally
 * asks the Game to regenerate a deeper level. Active effects are summarized via
 * `activeEffects`. No unlock logic is reimplemented — the Shop/Patents only CALL sim.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { EconomyState, PatentState } from "../sim/phase0_interfaces";
import { DEFAULT_PATENTS, canUnlock, activeEffects } from "../sim/patent";

interface PatentsProps {
  readonly active: boolean;
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
      return node.id === "new-map"
        ? "unlock ingredient layer B"
        : node.id === "new-map-4"
          ? "unlock ingredient layer C"
          : "unlock ingredient layer D";
  }
}

function patentTitle(id: string): string {
  if (id === "new-map") return "Layer B: carrier medium";
  if (id === "new-map-4") return "Layer C: catalytic phase";
  if (id === "deep-map-4") return "Layer D: deep substrate";
  return id;
}

export function Patents({ active, economy, patents, onUnlock }: PatentsProps) {
  const eff = activeEffects(DEFAULT_PATENTS, patents);
  const [pendingMapUnlock, setPendingMapUnlock] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeConfirmation = useCallback((restoreFocus = true) => {
    setPendingMapUnlock(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!active) setPendingMapUnlock(null);
  }, [active]);

  useEffect(() => {
    if (!active || pendingMapUnlock === null) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeConfirmation();
      } else if (event.key === "Tab") {
        event.preventDefault();
        if (document.activeElement === confirmRef.current) cancelRef.current?.focus();
        else confirmRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, closeConfirmation, pendingMapUnlock]);

  return (
    <div className="game-view management-view patents-view">
      <header className="management-header">
        <div className="panel-kicker">Research network</div>
        <h1>Patent Lattice</h1>
        <p>Invest cash and R&amp;D to unlock machines, factory capacity, exploration aids, and deeper maps.</p>
        <div data-testid="patents-effects" className="effects-strip">
          <span>Factory +{eff.factoryDw}w +{eff.factoryDh}h</span>
          <span>Reveal +{eff.revealAid}</span>
          <span>Machines {eff.unlockedMachines.length}</span>
          <span>Deep map {eff.newMapUnlocked ? "online" : "locked"}</span>
        </div>
      </header>

      {pendingMapUnlock !== null && (
        <div className="game-modal-backdrop" onPointerDown={(event) => {
          if (event.currentTarget === event.target) closeConfirmation();
        }}>
          <div role="alertdialog" aria-modal="true" aria-label="Confirm deeper level reset" data-testid="patent-confirmation" className="game-modal">
            <div className="warning-mark" aria-hidden="true">!</div>
            <h2>Start a deeper level?</h2>
            <p>This permanently clears the saved recipe, factory layout and runtime, factory waste, inventory, explored fog, and disease sales history.</p>
            <p>Cash and R&amp;D after the cost, patents, and the next inventory ID remain.</p>
            <div className="modal-actions">
            <button
              ref={confirmRef}
              type="button"
              className="danger-action"
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
              ref={cancelRef}
              type="button"
              className="game-control"
              data-testid={`patent-cancel-${pendingMapUnlock}`}
              onClick={() => closeConfirmation()}
            >
              Cancel
            </button>
            </div>
          </div>
        </div>
      )}

      <div className="patent-grid" data-testid="patent-grid">
        <div className="patent-grid-contents" data-testid="patents-table">
          {DEFAULT_PATENTS.map((node) => {
            const unlocked = patents.unlocked.includes(node.id);
            const affordable = canUnlock(DEFAULT_PATENTS, patents, economy.cash, economy.research, node.id);
            const stateLabel = unlocked ? "unlocked" : affordable ? "available" : "locked";
            return (
              <article key={node.id} className={`patent-card is-${stateLabel}`} data-testid={`patent-row-${node.id}`}>
                <div className="patent-node-line" aria-hidden="true" />
                <div className="patent-card-heading">
                  <span className="patent-emblem">⌬</span>
                  <div><h2>{patentTitle(node.id)}</h2><small>{effectLabel(node)}</small></div>
                </div>
                <div className="patent-requirement">Requires: {node.requires.join(", ") || "root"}</div>
                <div className="patent-cost">{node.cost} cash · {node.researchCost} R&amp;D</div>
                <div className={`state-chip is-${stateLabel}`} data-testid={`patent-state-${node.id}`}>{stateLabel}</div>
                  <button
                    type="button"
                    onClick={() => {
                      if (node.effect.kind === "unlockMap") {
                        triggerRef.current = document.activeElement instanceof HTMLButtonElement
                          ? document.activeElement
                          : null;
                        setPendingMapUnlock(node.id);
                      } else {
                        onUnlock(node.id);
                      }
                    }}
                    disabled={unlocked || !affordable}
                    className={affordable ? "primary-action" : "game-control"}
                    data-testid={`patent-unlock-${node.id}`}
                  >
                    {unlocked ? "Owned" : "Unlock"}
                  </button>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
