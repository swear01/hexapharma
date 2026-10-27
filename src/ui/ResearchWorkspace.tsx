import { useEffect, useRef, useState } from "react";
import type {
  DrugState,
  GeneratedLevel,
  HexDir,
  MachineCatalogEntry,
  MachineTypeId,
  Outcome,
  PathStamp,
  Template,
  Vec2,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import type { ResearchDeviation } from "../render/labRenderer";
import { App, researchOutcomeText } from "./App";
import { BasePicker } from "./BasePicker";
import { MachineIcon } from "./MachineIcon";
import { machineName } from "./machineLabels";

export function researchMachineCost(typeId: string): number {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`Research machine "${typeId}" has no cash cost`);
  return entry.cost;
}

function ResearchResult({ outcome }: { readonly outcome: Outcome }) {
  return (
    <div className={`research-result research-readout${outcome.failed ? " is-failed" : ""}`} role="status">
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        {outcome.failed ? <path d="M4 4l12 12M16 4L4 16" /> : <circle cx="10" cy="10" r="6.5" />}
      </svg>
      <span data-testid="research-atlas-outcome">{researchOutcomeText(outcome)}</span>
    </div>
  );
}

/** A machine path as drawn at `heading` (paths are relative to the drug heading). */
export function researchHeadingPath(path: PathStamp, heading: number): PathStamp {
  return path.map((direction) => ((direction + heading) % 6) as HexDir);
}

export interface ResearchWorkspaceProps {
  readonly active: boolean;
  /** The shown base only: a one-map level and its fog. */
  readonly level: GeneratedLevel;
  readonly fog: readonly Uint8Array[];
  readonly base: number;
  /** Per base: why it is locked, or null. */
  readonly baseLocks: readonly (string | null)[];
  readonly onBase: (base: number) => void;
  /** The local planned route; never authoritative until Run. */
  readonly plan: Template;
  readonly planCost: number;
  readonly cash: number;
  readonly catalog: readonly MachineCatalogEntry[];
  readonly blockReason: string | null;
  /** Actual drug after the last trial (or the start). */
  readonly drug: DrugState;
  /** Actual trail of the last trial on the true map. */
  readonly trails: readonly (readonly (Vec2 | null)[])[];
  readonly legEnds: readonly number[];
  /** Planned route on the known map. */
  readonly previewTrails: readonly (readonly (Vec2 | null)[])[];
  readonly previewLegEnds: readonly number[];
  /** The Production Plan line's route on the known map. */
  readonly lineTrails?: readonly (readonly (Vec2 | null)[])[];
  readonly previewDrug: DrugState;
  readonly estimate: boolean;
  readonly deviation: ResearchDeviation | null;
  readonly controls: readonly Vec2[];
  readonly lastOutcome: Outcome | null;
  readonly onAppend: (typeId: MachineTypeId) => void;
  readonly onUndo: () => void;
  readonly onClear: () => void;
  readonly onRun: () => void;
}

export function ResearchWorkspace(props: ResearchWorkspaceProps) {
  const { plan } = props;
  const [baseHint, setBaseHint] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ readonly point: Vec2 } | null>(null);
  const stepListRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const list = stepListRef.current;
    const latest = list?.lastElementChild;
    if (list === null || !(latest instanceof HTMLElement)) return;
    list.style.removeProperty("--strip-width");
    const style = getComputedStyle(list);
    if (style.display !== "flex") {
      list.scrollTo({ top: list.scrollHeight });
      return;
    }
    // Compact strip: start on a whole chip, end on the latest, and size the strip to exactly those chips.
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const end = latest.offsetLeft + latest.offsetWidth;
    let first = latest;
    for (const item of list.children) {
      if (item instanceof HTMLElement && end - item.offsetLeft + padding <= list.clientWidth) {
        first = item;
        break;
      }
    }
    list.style.setProperty("--strip-width", `${end - first.offsetLeft + padding}px`);
    list.scrollTo({ left: first.offsetLeft - parseFloat(style.paddingLeft) });
  }, [plan.steps.length]);
  const heading = props.previewDrug.heading;
  return (
    <div className="research-workspace" data-testid="research-workspace">
      <App
        active={props.active}
        level={props.level}
        fog={props.fog}
        drug={props.drug}
        trails={props.trails}
        legEnds={props.legEnds}
        previewTrails={props.previewTrails}
        previewLegEnds={props.previewLegEnds}
        lineTrails={props.lineTrails}
        previewDrug={props.previewDrug}
        estimate={props.estimate}
        deviation={props.deviation}
        controls={props.controls}
        lastOutcome={props.lastOutcome}
        focusRequest={focusRequest}
        onWorldActivate={props.onUndo}
        onWorldErase={props.onUndo}
      />
      <div className="research-overlay">
        {plan.steps.length > 0 && (
          <div className="research-program-strip" data-testid="research-program-strip" aria-label="Planned route">
            <ol ref={stepListRef}>
              {plan.steps.map((step, index) => (
                <li key={`${index}-${step.typeId}`}>
                  <button
                    type="button"
                    className="research-step"
                    disabled={props.controls[index] === undefined}
                    onClick={() => setFocusRequest({ point: props.controls[index]! })}
                    title={`Center on step ${index + 1}`}
                  >
                    <span className="research-step-number" aria-hidden="true">{index + 1}</span>
                    <MachineIcon typeId={step.typeId} path={step.path} size={24} />
                    <span className="research-step-name" title={machineName(step.typeId)}>{machineName(step.typeId)}</span>
                    <span className="research-step-cost">${researchMachineCost(step.typeId)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
        {props.lastOutcome !== null && <ResearchResult outcome={props.lastOutcome} />}
        {props.baseLocks.length > 1 && (
          <div className="research-bases">
            {baseHint !== null && <span className="research-base-hint" role="status">{baseHint}</span>}
            <BasePicker value={props.base} locks={props.baseLocks} onChange={props.onBase} onHint={setBaseHint} testId="research-base" />
          </div>
        )}
      </div>
      <div className="research-path-hotbar" role="toolbar" aria-label="Add a machine to the route" data-testid="research-path-hotbar">
        {props.catalog.map((entry, index) => (
          <button
            key={entry.typeId}
            type="button"
            onClick={() => props.onAppend(entry.typeId)}
            data-testid={`research-machine-${entry.typeId}`}
            title={`Add ${machineName(entry.typeId)} (${index + 1})`}
          >
            <MachineIcon typeId={entry.typeId} path={researchHeadingPath(entry.path, heading)} rotation={heading as HexDir} size={36} variant="token" />
            <span className="research-legend-name">{machineName(entry.typeId)}</span>
            <span className="research-legend-cost">${entry.cost}</span>
            <kbd>{index + 1}</kbd>
          </button>
        ))}
      </div>
      <div className="research-commandbar" role="toolbar" aria-label="Research route controls">
        {props.blockReason !== null && plan.steps.length > 0 && (
          <span className="research-block-reason" role="status">{props.blockReason}</span>
        )}
        {props.blockReason === null && (
          <span className="research-run-readout" data-testid="research-cash-after">${props.cash - props.planCost} left</span>
        )}
        <button
          type="button"
          className="research-undo"
          disabled={plan.steps.length === 0}
          onClick={props.onUndo}
          data-testid="research-undo"
          title="Remove last step (Backspace)"
        >
          Undo
        </button>
        <button
          type="button"
          className="research-clear"
          disabled={plan.steps.length === 0}
          onClick={props.onClear}
          data-testid="research-clear"
        >
          Clear
        </button>
        <button
          type="button"
          className="research-run"
          disabled={props.blockReason !== null}
          onClick={props.onRun}
          data-testid="research-command"
          title={props.blockReason ?? "Run the route (Enter)"}
        >
          Run · ${props.planCost}
        </button>
      </div>
    </div>
  );
}
