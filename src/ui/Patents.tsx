import { useCallback, useEffect, useRef, useState } from "react";
import type { EconomyState, PatentState } from "../sim/phase0_interfaces";
import { DEFAULT_PATENTS, canUnlock, activeEffects } from "../sim/patent";
import { machineName } from "./machineLabels";
import { GameModalPortal } from "./GameModalPortal";

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
      return `Unlock ${machineName(e.typeId)}`;
    case "expandFactory":
      return e.dw > 0
        ? `Add ${e.dw} factory ${e.dw === 1 ? "column" : "columns"}`
        : `Add ${e.dh} factory ${e.dh === 1 ? "row" : "rows"}`;
    case "revealAid":
      return `Research scan radius +${e.amount} ${e.amount === 1 ? "cell" : "cells"}`;
  }
}

const PATENT_TITLES: Readonly<Record<string, string>> = {
  "bench-2": "Wider factory floor",
  "reveal-aid": "Trail scanner",
  "skew-unlock": "Zigzag still",
  "dilute-unlock": "Loop vat",
  "floor-depth": "Deeper factory floor",
  "field-survey": "Field survey optics",
  "settle-unlock": "Settler path",
};

export function patentTitle(id: string): string {
  const title = PATENT_TITLES[id];
  if (title === undefined) throw new Error(`Technology node "${id}" needs a player-facing name`);
  return title;
}

export function patentCostLabel(node: (typeof DEFAULT_PATENTS)[number]): string {
  return `${node.cost} cash · ${node.researchCost} Knowledge`;
}

export function patentEffectSummary(effects: ReturnType<typeof activeEffects>): readonly string[] {
  const summary: string[] = [];
  if (effects.factoryDw > 0) {
    summary.push(`Factory +${effects.factoryDw} ${effects.factoryDw === 1 ? "column" : "columns"}`);
  }
  if (effects.factoryDh > 0) {
    summary.push(`Factory +${effects.factoryDh} ${effects.factoryDh === 1 ? "row" : "rows"}`);
  }
  if (effects.revealAid > 0) {
    summary.push(`Research scan radius +${effects.revealAid} ${effects.revealAid === 1 ? "cell" : "cells"}`);
  }
  if (effects.unlockedMachines.length > 0) {
    const count = effects.unlockedMachines.length;
    summary.push(`${count} ${count === 1 ? "machine" : "machines"} unlocked`);
  }
  return summary;
}

export function Patents({
  economy,
  patents,
  expansionResetsProduction,
  onUnlock,
}: PatentsProps) {
  const eff = activeEffects(DEFAULT_PATENTS, patents);
  const effectSummary = patentEffectSummary(eff);
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
        <h1>Technology</h1>
        {effectSummary.length > 0 && (
          <div data-testid="patents-effects" className="effects-strip" aria-label="Unlocked benefits">
            {effectSummary.map((summary) => <span key={summary}>{summary}</span>)}
          </div>
        )}
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
                {node.requires.length > 0 && (
                  <div className="patent-requirement">
                    Requires: {node.requires.map(patentTitle).join(", ")}
                  </div>
                )}
                <div className="patent-cost">{patentCostLabel(node)}</div>
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
                  aria-label={unlocked ? `${patentTitle(node.id)} owned` : `Unlock ${patentTitle(node.id)}`}
                >
                  {unlocked ? "Owned" : "Unlock"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
      {pending !== null && (
        <GameModalPortal>
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
        </GameModalPortal>
      )}
    </div>
  );
}
