import { useCallback, useEffect, useRef, useState } from "react";
import type { EconomyState, PatentState, ShippingContractProgress } from "../sim/phase0_interfaces";
import { requiredShippingContractForPatent } from "../sim/game";
import { DEFAULT_PATENTS, canUnlock, activeEffects } from "../sim/patent";
import { createPortal } from "react-dom";
import { diseaseName } from "./effectLabels";
import { machineName } from "./machineLabels";

interface PatentsProps {
  readonly economy: EconomyState;
  readonly patents: PatentState;
  readonly contracts: readonly ShippingContractProgress[];
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
    case "unlockRouting":
      return "Unlock Splitter and Merger";
  }
}

const PATENT_TITLES: Readonly<Record<string, string>> = {
  "bench-2": "Wider factory floor",
  "reveal-aid": "Trail scanner",
  "split-merge": "Split / Merge",
  "zigzag-unlock": "Zigzag still",
  "loop-unlock": "Loop vat",
  "floor-depth": "Deeper factory floor",
  "field-survey": "Field survey optics",
  "straight-unlock": "Straight drive",
  "crane-unlock": "Crane arm",
};

export function patentTitle(id: string): string {
  const title = PATENT_TITLES[id];
  if (title === undefined) throw new Error(`Technology node "${id}" needs a player-facing name`);
  return title;
}

export function patentCostLabel(node: (typeof DEFAULT_PATENTS)[number]): string {
  return `$${node.cost} · ${node.researchCost} Knowledge`;
}

export function patentContractRequirement(
  patentId: string,
  contracts: readonly ShippingContractProgress[],
): string | null {
  const disease = requiredShippingContractForPatent(patentId);
  if (disease === null) return null;
  const contract = contracts.find((candidate) => candidate.disease === disease);
  if (contract === undefined) return `${diseaseName(disease)} contract unavailable`;
  return contract.completed
    ? null
    : `Ship ${Math.max(0, contract.quota - contract.sold)} more for ${diseaseName(disease)} contract (${contract.sold}/${contract.quota})`;
}

/** Only what is actually missing; null when both resources cover the cost. */
export function patentShortfall(
  node: Pick<(typeof DEFAULT_PATENTS)[number], "cost" | "researchCost">,
  cash: number,
  knowledge: number,
): string | null {
  const parts: string[] = [];
  if (node.cost > cash) parts.push(`$${node.cost - cash} more cash`);
  if (node.researchCost > knowledge) parts.push(`${node.researchCost - knowledge} more Knowledge`);
  return parts.length === 0 ? null : `Need ${parts.join(" and ")}`;
}

export type PatentGroup = "available" | "contract" | "requires" | "owned";

export const PATENT_GROUP_TITLES: Readonly<Record<PatentGroup, string>> = {
  available: "Available now",
  contract: "Waiting on a contract",
  requires: "Requires another node",
  owned: "Owned",
};

export function patentGroup(
  node: (typeof DEFAULT_PATENTS)[number],
  unlocked: readonly string[],
  contractRequirement: string | null,
): PatentGroup {
  if (unlocked.includes(node.id)) return "owned";
  if (node.requires.some((id) => !unlocked.includes(id))) return "requires";
  return contractRequirement === null ? "available" : "contract";
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
  if (effects.routing) summary.push("Splitter and Merger unlocked");
  if (effects.unlockedMachines.length > 0) {
    const count = effects.unlockedMachines.length;
    summary.push(`${count} ${count === 1 ? "machine" : "machines"} unlocked`);
  }
  return summary;
}

export function Patents({
  economy,
  patents,
  contracts,
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
        {economy.cash === 0 && <p className="recovery-guidance">No cash remains. Check Market for profitable stock and consider a cheaper route. If you choose a fresh start, use Menu → New Game; save first to keep this run.</p>}
      </header>

      <div className="patent-grid" data-testid="patent-grid">
        <div className="patent-grid-contents" data-testid="patents-table">
          {(Object.keys(PATENT_GROUP_TITLES) as PatentGroup[]).map((group) => {
            const nodes = DEFAULT_PATENTS.filter((node) =>
              patentGroup(node, patents.unlocked, patentContractRequirement(node.id, contracts)) === group);
            if (nodes.length === 0) return null;
            return (
              <section key={group} className={`patent-group is-${group}`} aria-labelledby={`patent-group-${group}`}>
                <h2 id={`patent-group-${group}`}>{PATENT_GROUP_TITLES[group]}</h2>
                {nodes.map((node) => {
                  const unlocked = group === "owned";
                  const contractRequirement = patentContractRequirement(node.id, contracts);
                  const affordable = contractRequirement === null
                    && canUnlock(DEFAULT_PATENTS, patents, economy.cash, economy.research, node.id);
                  const shortfall = group === "available"
                    ? patentShortfall(node, economy.cash, economy.research)
                    : null;
                  const reasonId = `patent-reason-${node.id}`;
                  const missing = node.requires.filter((id) => !patents.unlocked.includes(id));
                  const reason = shortfall ?? contractRequirement;
                  return (
                    <article key={node.id} className={`patent-card is-${group}`} data-testid={`patent-row-${node.id}`}>
                      <div className="patent-card-main">
                        <h3>{patentTitle(node.id)}</h3>
                        <small>{effectLabel(node)}</small>
                        {missing.length > 0 && (
                          <div className="patent-requirement">Requires: {missing.map(patentTitle).join(", ")}</div>
                        )}
                        {!unlocked && reason !== null && (
                          <div id={reasonId} className="patent-requirement" data-testid={shortfall === null ? undefined : `patent-shortfall-${node.id}`}>{reason}</div>
                        )}
                      </div>
                      {!unlocked && <div className="patent-cost">{patentCostLabel(node)}</div>}
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
                        aria-describedby={!unlocked && reason !== null ? reasonId : undefined}
                        className={affordable ? "primary-action" : "game-control"}
                        data-testid={`patent-unlock-${node.id}`}
                        aria-label={unlocked ? `${patentTitle(node.id)} owned` : `Unlock ${patentTitle(node.id)}`}
                      >
                        {unlocked ? "Owned" : "Unlock"}
                      </button>
                    </article>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      {pending !== null && createPortal(
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
        </div>,
        document.body,
      )}
    </div>
  );
}
