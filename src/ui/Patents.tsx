import { useCallback, useEffect, useRef, useState } from "react";
import type { EconomyState, PatentState } from "../sim/phase0_interfaces";
import { DEFAULT_PATENTS, canUnlock, activeEffects } from "../sim/patent";

interface PatentsProps {
  readonly economy: EconomyState;
  readonly patents: PatentState;
  readonly expansionResetsProduction: boolean;
  readonly onUnlock: (id: string) => void;
}

export function patentUnlockWarning(
  node: (typeof DEFAULT_PATENTS)[number],
  expansionResetsProduction: boolean,
): string | null {
  return node.effect.kind === "expandFactory" && expansionResetsProduction
    ? "Production runtime and waste will reset."
    : null;
}

function effectLabel(node: (typeof DEFAULT_PATENTS)[number]): string {
  const e = node.effect;
  switch (e.kind) {
    case "unlockMachine":
      return `unlock machine "${e.typeId}"`;
    case "expandFactory":
      return `expand factory +${e.dw}w +${e.dh}h`;
    case "revealAid":
      return `trail scanner +${e.amount}`;
  }
}

function patentTitle(id: string): string {
  if (id === "floor-depth") return "Deeper factory floor";
  if (id === "field-survey") return "Field survey optics";
  if (id === "settle-unlock") return "Settler path";
  return id;
}

export function Patents({
  economy,
  patents,
  expansionResetsProduction,
  onUnlock,
}: PatentsProps) {
  const eff = activeEffects(DEFAULT_PATENTS, patents);
  const [pending, setPending] = useState<(typeof DEFAULT_PATENTS)[number] | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const closeConfirmation = useCallback((restoreFocus = true) => {
    setPending(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (pending === null) return;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeConfirmation();
      } else if (event.key === "Tab") {
        event.preventDefault();
        if (document.activeElement === confirmRef.current) cancelRef.current?.focus();
        else confirmRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeConfirmation, pending]);

  return (
    <div className="game-view management-view patents-view">
      <header className="management-header">
        <div className="panel-kicker">Research network</div>
        <h1>Patent Lattice</h1>
        <div data-testid="patents-effects" className="effects-strip">
          <span>Facility floors +{eff.factoryDw}w +{eff.factoryDh}h</span>
          <span>Trail scan +{eff.revealAid}</span>
          <span>Machines {eff.unlockedMachines.length}</span>
        </div>
      </header>

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
                    onClick={(event) => {
                      if (patentUnlockWarning(node, expansionResetsProduction) === null) {
                        onUnlock(node.id);
                      } else {
                        triggerRef.current = event.currentTarget;
                        setPending(node);
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
      {pending !== null && (
        <div
          className="game-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeConfirmation();
          }}
        >
          <section
            className="game-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="patent-confirm-title"
            aria-describedby="patent-confirm-warning"
            data-testid="patent-confirm"
          >
            <h2 id="patent-confirm-title">Expand factory?</h2>
            <p id="patent-confirm-warning">
              {patentUnlockWarning(pending, expansionResetsProduction)}
            </p>
            <div className="modal-actions">
              <button ref={cancelRef} type="button" onClick={() => closeConfirmation()}>Cancel</button>
              <button
                ref={confirmRef}
                type="button"
                className="danger-action"
                data-testid="patent-confirm-unlock"
                onClick={() => {
                  const id = pending.id;
                  closeConfirmation(false);
                  onUnlock(id);
                }}
              >
                Unlock and reset
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
