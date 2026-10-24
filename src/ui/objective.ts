import type { DiseaseId, ShippingContractProgress } from "../sim/phase0_interfaces";
import { diseaseName } from "./effectLabels";

export type ObjectiveTarget = "research" | "pilot" | "production" | "market" | "technology";

export interface Objective {
  readonly text: string;
  readonly target: ObjectiveTarget;
  readonly actionLabel: string;
}

export interface ObjectiveInput {
  readonly contracts: readonly ShippingContractProgress[];
  /** Diseases with at least one Cure cell already revealed in fog. */
  readonly knownCureDiseases: readonly DiseaseId[];
  readonly profitableUnits: (disease: DiseaseId) => number;
  /** Unsold units in stock that cure the disease (profitable or not). */
  readonly stockFor: (disease: DiseaseId) => number;
  readonly productionHasMachines: boolean;
  /** Production has already made a cure, and none of it is for the active contract's disease. */
  readonly producingOther: boolean;
  readonly sector: string;
}

export function currentObjective(input: ObjectiveInput): Objective {
  const contract = input.contracts.find((candidate) => !candidate.completed);
  if (contract === undefined) {
    return { text: "Every shipping contract is filled", target: "market", actionLabel: "Market" };
  }
  const name = diseaseName(contract.disease);
  if (input.profitableUnits(contract.disease) > 0) {
    return { text: `Ship ${name} · ${contract.sold} of ${contract.quota}`, target: "market", actionLabel: "Ship" };
  }
  if (!input.knownCureDiseases.includes(contract.disease)) {
    const where = input.sector === "local" ? "near the start" : `look ${input.sector}`;
    return { text: `Find ${name} · ${where}`, target: "research", actionLabel: "Research" };
  }
  if (input.stockFor(contract.disease) > 0) {
    return { text: `${name} stock no longer earns · improve the line`, target: "production", actionLabel: "Production" };
  }
  if (!input.productionHasMachines) {
    return { text: `Plan a line to ${name}`, target: "pilot", actionLabel: "Open Plan" };
  }
  if (input.producingOther) {
    return { text: `Plan a line to ${name} · Production makes another cure`, target: "pilot", actionLabel: "Open Plan" };
  }
  return { text: `Run Production to make ${name}`, target: "production", actionLabel: "Production" };
}
