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
import { App } from "./App";
import { MachineIcon } from "./MachineIcon";
import { machineName } from "./machineLabels";

export function researchMachineCost(typeId: string): number {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`Research machine "${typeId}" has no cash cost`);
  return entry.cost;
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
  return (
    <div className="research-workspace" data-testid="research-workspace">
      <section className="research-mission" data-testid="research-mission" aria-label="Active assay">
        <span>Assay</span>
        <strong>Disease {props.missionDisease + 1}</strong>
        <span>Look <output data-testid="research-assay-sector">{props.missionSector}</output></span>
      </section>
      {program.steps.length > 0 && (
        <div className="research-program-strip" data-testid="research-program-strip" aria-label="Research route">
          <ol>
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
      <div className="research-commandbar" role="toolbar" aria-label="Research program controls">
        <strong data-testid="research-program-count">{program.steps.length} tested</strong>
        <output className="research-shot-cost" data-testid="research-shot-cost">${props.shotCost} spent</output>
        {props.shotActive && (
          <button type="button" className="is-warning" title="End assay. No refund; revealed terrain stays." onClick={props.onAbort} data-testid="research-abort">End assay</button>
        )}
        <button
          type="button"
          className="facility-command"
          disabled={props.blockReason !== null}
          onClick={props.onRun}
          data-testid="research-command"
          title={props.blockReason ?? "Test cartridge (Enter)"}
        >
          Test · ${selectedEntry?.cost ?? 0}
        </button>
      </div>
      <App
        active={props.active}
        level={props.level}
        fog={props.fog}
        drug={props.drug}
        trails={props.trails}
        previewTrails={props.previewTrails}
        previewDrug={props.previewDrug}
        lastOutcome={props.lastOutcome}
        onWorldActivate={props.onRun}
        onWorldErase={props.onAbort}
      />
      <div className="research-path-hotbar" role="toolbar" aria-label="Fixed machine paths" data-testid="research-path-hotbar">
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
            <MachineIcon typeId={entry.typeId} path={entry.path} size={34} variant="token" />
            <span>{machineName(entry.typeId)}</span>
            <kbd>{index + 1}</kbd>
          </button>
        ))}
      </div>
    </div>
  );
}
