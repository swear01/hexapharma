import { useCallback, useEffect, useRef, useState } from "react";
import type { PatentState } from "../sim/phase0_interfaces";
import { BASE_NAMES } from "../sim/phase0_interfaces";
import { DEFAULT_PATENTS, activeEffects } from "../sim/patent";
import { createPortal } from "react-dom";

interface PatentsProps {
  readonly patents: PatentState;
  /** Bases of this level; a base switch for a base the level lacks is not offered. */
  readonly baseCount: number;
  readonly expansionResetsProduction: boolean;
  readonly onSwitch: (id: string, enabled: boolean) => void;
}

/** Display tree: each branch reads left to right, base node first. Links are layout only; every switch is free (D42). */
export const PATENT_TREE: readonly (readonly string[])[] = [
  ["bench-2", "floor-depth"],
  ["reveal-aid", "field-survey"],
  ["split-merge"],
  ["zigzag-unlock", "straight-unlock"],
  ["loop-unlock", "crane-unlock"],
  ["oil-base", "ethanol-base"],
];

/** The tree as shown: base switches only for bases the level has. */
export function visiblePatentTree(baseCount: number): readonly (readonly (typeof DEFAULT_PATENTS)[number][])[] {
  return PATENT_TREE
    .map((branch) => branch
      .map((id) => {
        const node = DEFAULT_PATENTS.find((candidate) => candidate.id === id);
        if (node === undefined) throw new Error(`Technology tree lists unknown node "${id}"`);
        return node;
      })
      .filter((node) => node.effect.kind !== "unlockBase" || node.effect.base < baseCount))
    .filter((branch) => branch.length > 0);
}

export function patentSwitchWarning(
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
      return "Adds this machine to every hotbar";
    case "expandFactory":
      return e.dw > 0
        ? `Add ${e.dw} factory ${e.dw === 1 ? "column" : "columns"}`
        : `Add ${e.dh} factory ${e.dh === 1 ? "row" : "rows"}`;
    case "revealAid":
      return `Research scan radius +${e.amount} ${e.amount === 1 ? "cell" : "cells"}`;
    case "unlockRouting":
      return "Adds Splitter and Merger to the factory hotbar";
    case "unlockBase":
      return `Research and Sources may use ${BASE_NAMES[e.base]}`;
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
  "oil-base": "Oil base",
  "ethanol-base": "Ethanol base",
};

export function patentTitle(id: string): string {
  const title = PATENT_TITLES[id];
  if (title === undefined) throw new Error(`Technology node "${id}" needs a player-facing name`);
  return title;
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
  if (effects.routing) summary.push("Splitter and Merger on");
  if (effects.unlockedBases.length > 0) {
    summary.push(`${[...effects.unlockedBases].sort().map((base) => BASE_NAMES[base]).join(" and ")} on`);
  }
  if (effects.unlockedMachines.length > 0) {
    const count = effects.unlockedMachines.length;
    summary.push(`${count} ${count === 1 ? "machine" : "machines"} on`);
  }
  return summary;
}

export function Patents({
  patents,
  baseCount,
  expansionResetsProduction,
  onSwitch,
}: PatentsProps) {
  const effectSummary = patentEffectSummary(activeEffects(DEFAULT_PATENTS, patents));
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
  const pendingOn = pending !== null && patents.unlocked.includes(pending.id);

  return (
    <div className="game-view management-view patents-view">
      <header className="management-header">
        <h1>Technology</h1>
        {effectSummary.length > 0 && (
          <div data-testid="patents-effects" className="effects-strip" aria-label="Active benefits">
            {effectSummary.map((summary) => <span key={summary}>{summary}</span>)}
          </div>
        )}
      </header>

      <div className="patent-grid" data-testid="patent-grid">
        <ol className="patent-tree" data-testid="patents-table" aria-label="Technology tree">
          {visiblePatentTree(baseCount).map((branch) => (
            <li key={branch[0]!.id} className="patent-branch">
              {branch.map((node) => {
                const id = node.id;
                const on = patents.unlocked.includes(id);
                return (
                  <article key={id} className={`patent-card${on ? " is-on" : ""}`} data-testid={`patent-row-${id}`}>
                    <div className="patent-card-main">
                      <h3>{patentTitle(id)}</h3>
                      <small>{effectLabel(node)}</small>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={patentTitle(id)}
                      className={on ? "primary-action" : "game-control"}
                      data-testid={`patent-switch-${id}`}
                      onClick={(event) => {
                        if (patentSwitchWarning(node, expansionResetsProduction) === null) {
                          onSwitch(id, !on);
                        } else {
                          triggerRef.current = event.currentTarget;
                          setPending(node);
                        }
                      }}
                    >
                      {on ? "On" : "Off"}
                    </button>
                  </article>
                );
              })}
            </li>
          ))}
        </ol>
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
            <h2 id="patent-confirm-title">{pendingOn ? "Shrink factory?" : "Expand factory?"}</h2>
            <p id="patent-confirm-warning">
              {patentSwitchWarning(pending, expansionResetsProduction)}
            </p>
            <div className="modal-actions">
              <button ref={cancelRef} type="button" onClick={() => closeConfirmation()}>Cancel</button>
              <button
                ref={confirmRef}
                type="button"
                className="danger-action"
                data-testid="patent-confirm-switch"
                onClick={() => {
                  const id = pending.id;
                  closeConfirmation(false);
                  onSwitch(id, !pendingOn);
                }}
              >
                {pendingOn ? "Turn off and reset" : "Turn on and reset"}
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
