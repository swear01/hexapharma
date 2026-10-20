import type { DiscoveredFormula, DiseaseId } from "../sim/phase0_interfaces";
import { MachineIcon } from "./MachineIcon";
import { machineName } from "./machineLabels";

function FormulaRibbon({ formula }: { readonly formula: DiscoveredFormula }) {
  return (
    <section className="formula-ribbon" data-testid="formula-ribbon" aria-label={`Discovered formula for Disease ${formula.disease + 1}`}>
      <h2>Disease {formula.disease + 1}</h2>
      <p><strong className="formula-ribbon-cost">${formula.researchCost} assay</strong> · {formula.outcome.sideEffects.length === 0 ? "Clean" : `${formula.outcome.sideEffects.length} side effect${formula.outcome.sideEffects.length === 1 ? "" : "s"}`}</p>
      <ol>
        {formula.program.steps.map((step, index) => (
          <li key={`${index}-${step.typeId}`}>
            <span>{index + 1}</span>
            <MachineIcon typeId={step.typeId} path={step.path} size={32} />
            <span>{machineName(step.typeId)}</span>
            <MachineIcon typeId={step.typeId} path={step.path} size={40} variant="footprint" />
          </li>
        ))}
      </ol>
      <p>Build these machines in order, with belts between their ports.</p>
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
      <label>Disease
        <select data-testid="formula-select" value={current?.disease ?? ""} onChange={(event) => onSelect(Number(event.target.value) as DiseaseId)}>
          {formulas.map((formula) => <option key={formula.disease} value={formula.disease}>Disease {formula.disease + 1}</option>)}
        </select>
      </label>
      {current !== undefined && <FormulaRibbon formula={current} />}
    </section>
  );
}
