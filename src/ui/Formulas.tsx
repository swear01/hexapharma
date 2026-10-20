import type { DiscoveredFormula, DiseaseId } from "../sim/phase0_interfaces";
import { MachineIcon } from "./MachineIcon";
import { machineName } from "./machineLabels";
import { diseaseName } from "./effectLabels";
import { MapSymbol } from "./FieldGuide";

export function formulaId(disease: DiseaseId): string {
  return `F-${String(disease + 1).padStart(2, "0")}`;
}

export function sideEffectCountLabel(count: number): string {
  return count === 0 ? "Clean" : `${count} side effect${count === 1 ? "" : "s"}`;
}

export function formulaEffectsLabel(formula: DiscoveredFormula): string {
  return sideEffectCountLabel(formula.outcome.sideEffects.length);
}

/** Orienteering control description sheet: start, numbered steps, finish. */
function FormulaRibbon({ formula }: { readonly formula: DiscoveredFormula }) {
  const clean = formula.outcome.sideEffects.length === 0;
  return (
    <section className="formula-ribbon" data-testid="formula-ribbon" aria-label={`Formula ${formulaId(formula.disease)} for ${diseaseName(formula.disease)}`}>
      <header className="formula-sheet-head">
        <h2><span className="formula-id">{formulaId(formula.disease)}</span> · {diseaseName(formula.disease)}</h2>
        <div className="formula-sheet-meta">
          <span>Research <strong className="formula-ribbon-cost">${formula.researchCost}</strong></span>
          <span className={clean ? "is-clean" : "is-tainted"}>
            <MapSymbol kind={clean ? "cure" : "sideEffect"} size={18} />
            {formulaEffectsLabel(formula)}
          </span>
        </div>
      </header>
      <div className="formula-sheet-end">
        <MapSymbol kind="start" size={28} />
        <span>Source</span>
      </div>
      <ol>
        {formula.program.steps.map((step, index) => (
          <li key={`${index}-${step.typeId}`}>
            <span className="formula-step-number">{index + 1}</span>
            <span className="formula-step-icon"><MachineIcon typeId={step.typeId} path={step.path} size={32} variant="token" /></span>
            <span className="formula-step-name">{machineName(step.typeId)}</span>
            <span className="formula-step-icon"><MachineIcon typeId={step.typeId} path={step.path} size={34} variant="footprint" /></span>
          </li>
        ))}
      </ol>
      <div className="formula-sheet-end">
        <MapSymbol kind="finish" size={28} />
        <span>Sink · cures {diseaseName(formula.disease)}</span>
      </div>
      <p className="formula-sheet-note">Build the steps in order from Source to Sink; belt each output port to the next step’s input port.</p>
    </section>
  );
}

export interface FormulasProps {
  readonly formulas: readonly DiscoveredFormula[];
  readonly current: DiscoveredFormula | undefined;
  readonly onSelect: (disease: DiseaseId) => void;
}

export function Formulas({ formulas, current, onSelect }: FormulasProps) {
  return (
    <section className="formula-library">
      <h1>Discovered formulas</h1>
      <label className="formula-picker">Formula
        <select data-testid="formula-select" value={current?.disease ?? ""} onChange={(event) => onSelect(Number(event.target.value) as DiseaseId)}>
          {formulas.map((formula) => <option key={formula.disease} value={formula.disease}>{formulaId(formula.disease)} · {diseaseName(formula.disease)}</option>)}
        </select>
      </label>
      {current === undefined
        ? <p className="panel-empty">No formulas yet. A run that reaches a Cure saves its steps here.</p>
        : <FormulaRibbon formula={current} />}
    </section>
  );
}
