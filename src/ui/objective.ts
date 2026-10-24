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
  readonly planHasMachines: boolean;
  readonly productionHasMachines: boolean;
  /** Production has already made a cure, and none of it is for the active contract's disease. */
  readonly producingOther: boolean;
  readonly sector: string;
  /** Base the contract's disease lives on; null when the level has one base. */
  readonly base: string | null;
  /** That base is switched off in Technology. */
  readonly baseLocked: boolean;
}

/** The next step of the loop for the first open contract: Research → Plan → Production → Market. */
export function currentObjective(input: ObjectiveInput): Objective {
  const contract = input.contracts.find((candidate) => !candidate.completed);
  if (contract === undefined) {
    return { text: "Every contract filled", target: "market", actionLabel: "Market" };
  }
  const name = diseaseName(contract.disease);
  if (input.profitableUnits(contract.disease) > 0) {
    return { text: `Ship ${name}`, target: "market", actionLabel: "Ship" };
  }
  const onBase = input.base === null ? "" : ` on ${input.base}`;
  if (input.baseLocked) {
    return { text: `Turn on ${input.base} in Technology to reach ${name}`, target: "technology", actionLabel: "Technology" };
  }
  if (!input.knownCureDiseases.includes(contract.disease)) {
    const where = input.sector === "local" ? "near the start" : `look ${input.sector}`;
    return { text: `Find ${name}${onBase} · ${where}`, target: "research", actionLabel: "Research" };
  }
  if (input.stockFor(contract.disease) > 0) {
    return { text: `${name} stock no longer earns · improve the line`, target: "production", actionLabel: "Production" };
  }
  if (!input.productionHasMachines) {
    return input.planHasMachines
      ? { text: `Commission the Plan for ${name}`, target: "pilot", actionLabel: "Plan" }
      : { text: `Plan a line to ${name}${onBase}`, target: "pilot", actionLabel: "Plan" };
  }
  if (input.producingOther) {
    return { text: `Plan a line to ${name}${onBase} · Production makes another cure`, target: "pilot", actionLabel: "Plan" };
  }
  return { text: `Run Production to make ${name}`, target: "production", actionLabel: "Production" };
}
