import { useEffect, useRef } from "react";
import type {
  DiscoveredFormula,
  DrugState,
  GeneratedLevel,
  MachineCatalogEntry,
  MachineTypeId,
  Outcome,
  Template,
  Vec2,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { App, researchOutcomeText } from "./App";
import { diseaseName } from "./effectLabels";
import { MachineIcon } from "./MachineIcon";
import { machineName } from "./machineLabels";

export function researchMachineCost(typeId: string): number {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`Research machine "${typeId}" has no cash cost`);
  return entry.cost;
}

export function researchFormulaId(disease: number): string {
  return `F-${String(disease + 1).padStart(2, "0")}`;
}

export function researchStepCountLabel(count: number): string {
  return `${count} ${count === 1 ? "step" : "steps"}`;
}

/** Compass sectors in screen degrees (y down), matching the Atlas hex directions. */
const COMPASS_SECTORS = ["east", "south-east", "south-west", "west", "north-west", "north-east"] as const;

function wedgePath(index: number): string {
  const point = (degrees: number, radius: number) => {
    const radians = degrees * Math.PI / 180;
    return `${(24 + Math.cos(radians) * radius).toFixed(2)} ${(24 + Math.sin(radians) * radius).toFixed(2)}`;
  };
  const from = index * 60 - 30;
  const to = index * 60 + 30;
  return `M${point(from, 7)} L${point(from, 21)} A21 21 0 0 1 ${point(to, 21)} L${point(to, 7)} A7 7 0 0 0 ${point(from, 7)} Z`;
}

function TargetCompass({ sector }: { readonly sector: string }) {
  const local = sector === "local";
  return (
    <svg className="research-compass-dial" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true">
      {COMPASS_SECTORS.map((name, index) => (
        <path key={name} d={wedgePath(index)} className={name === sector ? "is-target" : undefined} />
      ))}
      <circle cx="24" cy="24" r={local ? 4 : 2} className={local ? "is-target" : undefined} />
    </svg>
  );
}

function ResearchResult({
  outcome,
  formulas,
  steps,
  cost,
  onOpenPlan,
}: {
  readonly outcome: Outcome;
  readonly formulas: readonly DiscoveredFormula[];
  readonly steps: number;
  readonly cost: number;
  readonly onOpenPlan: () => void;
}) {
  const cured = outcome.failed
    ? undefined
    : outcome.cured.find((disease) => formulas.some((formula) => formula.disease === disease));
  if (cured === undefined) {
    return (
      <div className={`research-result research-readout${outcome.failed ? " is-failed" : ""}`} role="status">
        <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
          {outcome.failed ? <path d="M4 4l12 12M16 4L4 16" /> : <circle cx="10" cy="10" r="6.5" />}
        </svg>
        <span data-testid="research-atlas-outcome">{researchOutcomeText(outcome)}</span>
      </div>
    );
  }
  const effects = outcome.sideEffects.length;
  return (
    <section className="research-result research-cure-card" role="status" aria-label="Cure found. Formula saved.">
      <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
        <circle cx="16" cy="16" r="13" />
        <circle cx="16" cy="16" r="8.5" />
      </svg>
      <div className="research-cure-body">
        <h2 data-testid="research-atlas-outcome">{researchFormulaId(cured)} · {diseaseName(cured)}</h2>
        <p className="research-cure-stats">
          <span>{researchStepCountLabel(steps)}</span>
          <span>${cost}</span>
          <span className={effects === 0 ? "is-clean" : "has-effects"}>
            {effects === 0 ? "Clean" : `${effects} side effect${effects === 1 ? "" : "s"}`}
          </span>
        </p>
      </div>
      <button type="button" className="research-open-plan" onClick={onOpenPlan} data-testid="research-open-plan">
        Open in Plan
      </button>
    </section>
  );
}

export interface ResearchWorkspaceProps {
  readonly active: boolean;
  readonly level: GeneratedLevel;
  readonly fog: readonly Uint8Array[];
  readonly missionDisease: number;
  readonly missionSector: string;
  readonly program: Template;
  readonly shotActive: boolean;
  readonly shotCost: number;
  readonly catalog: readonly MachineCatalogEntry[];
  readonly selectedEntry: MachineCatalogEntry | undefined;
  readonly blockReason: string | null;
  readonly drug: DrugState;
  readonly trails: readonly (readonly (Vec2 | null)[])[];
  readonly previewTrails: readonly (readonly (Vec2 | null)[])[] | undefined;
  readonly previewDrug: DrugState | undefined;
  readonly lastOutcome: Outcome | null;
  readonly formulas: readonly DiscoveredFormula[];
  readonly onSelectMachine: (typeId: MachineTypeId) => void;
  readonly onRun: () => void;
  readonly onAbort: () => void;
  readonly onOpenPlan: () => void;
}

export function ResearchWorkspace(props: ResearchWorkspaceProps) {
  const { program, selectedEntry } = props;
  const stepListRef = useRef<HTMLOListElement | null>(null);
  useEffect(() => {
    const list = stepListRef.current;
    if (list !== null) list.scrollTo({ top: list.scrollHeight, left: list.scrollWidth });
  }, [program.steps.length]);
  return (
    <div className="research-workspace" data-testid="research-workspace">
      <App
        active={props.active}
        level={props.level}
        fog={props.fog}
        drug={props.drug}
        trails={props.trails}
        previewTrails={props.previewTrails}
        previewDrug={props.previewDrug}
        program={program}
        lastOutcome={props.lastOutcome}
        onWorldActivate={props.onRun}
        onWorldErase={props.onAbort}
      />
      <div className="research-overlay">
        <section className="research-compass" data-testid="research-mission" aria-label="Active assay">
          <TargetCompass sector={props.missionSector} />
          <div>
            <strong>Disease {props.missionDisease + 1}</strong>
            <span>Look <output data-testid="research-assay-sector">{props.missionSector}</output></span>
          </div>
        </section>
        {program.steps.length > 0 && (
          <div className="research-program-strip" data-testid="research-program-strip" aria-label="Research course">
            <ol ref={stepListRef}>
              {program.steps.map((step, index) => (
                <li key={`${index}-${step.typeId}`}>
                  <span className="research-step-number" aria-hidden="true">{index + 1}</span>
                  <MachineIcon typeId={step.typeId} path={step.path} size={24} />
                  <span className="research-step-name" title={machineName(step.typeId)}>{machineName(step.typeId)}</span>
                  <span className="research-step-cost">${researchMachineCost(step.typeId)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
        {props.lastOutcome !== null && (
          <ResearchResult
            outcome={props.lastOutcome}
            formulas={props.formulas}
            steps={program.steps.length}
            cost={props.shotCost}
            onOpenPlan={props.onOpenPlan}
          />
        )}
      </div>
      <div className="research-path-hotbar" role="toolbar" aria-label="Machine legend" data-testid="research-path-hotbar">
        {props.catalog.map((entry, index) => (
          <button
            key={entry.typeId}
            type="button"
            className={selectedEntry?.typeId === entry.typeId ? "is-selected" : ""}
            aria-pressed={selectedEntry?.typeId === entry.typeId}
            onClick={() => props.onSelectMachine(entry.typeId)}
            data-testid={`research-machine-${entry.typeId}`}
            title={`${machineName(entry.typeId)} — previews next path (${index + 1})`}
          >
            <MachineIcon typeId={entry.typeId} path={entry.path} size={36} variant="token" />
            <span className="research-legend-name">{machineName(entry.typeId)}</span>
            <span className="research-legend-cost">${entry.cost}</span>
            <kbd>{index + 1}</kbd>
          </button>
        ))}
      </div>
      <div className="research-commandbar" role="toolbar" aria-label="Research run controls">
        {props.blockReason !== null && <span className="research-block-reason" role="status">{props.blockReason}</span>}
        <span className="research-run-readout">
          <strong data-testid="research-program-count">{researchStepCountLabel(program.steps.length)}</strong>
          {" · "}
          <output className="research-shot-cost" data-testid="research-shot-cost">${props.shotCost} spent</output>
        </span>
        {props.shotActive && (
          <button
            type="button"
            className="research-end-run"
            title="End run (Backspace). No refund; the revealed map stays."
            onClick={props.onAbort}
            data-testid="research-abort"
          >
            End run
          </button>
        )}
        <button
          type="button"
          className="research-run"
          disabled={props.blockReason !== null}
          onClick={props.onRun}
          data-testid="research-command"
          title={props.blockReason ?? "Run step (Enter)"}
        >
          Run · ${selectedEntry?.cost ?? 0}
        </button>
      </div>
    </div>
  );
}
