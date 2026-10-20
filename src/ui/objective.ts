import type { DiseaseId, ShippingContractProgress } from "../sim/phase0_interfaces";
import { requiredShippingContractForPatent } from "../sim/game";
import { diseaseName } from "./effectLabels";
import { patentTitle } from "./Patents";

export type ObjectiveTarget = "research" | "pilot" | "production" | "market" | "technology";

export interface Objective {
  readonly text: string;
  readonly target: ObjectiveTarget;
  readonly actionLabel: string;
}

export interface ObjectiveInput {
  readonly contracts: readonly ShippingContractProgress[];
  readonly formulaDiseases: readonly DiseaseId[];
  readonly unlockedPatents: readonly string[];
  readonly gatedPatents: readonly string[];
  readonly profitableUnits: (disease: DiseaseId) => number;
  /** Unsold units in stock that cure the disease (profitable or not). */
  readonly stockFor: (disease: DiseaseId) => number;
  readonly productionHasMachines: boolean;
  /** Production has already made a cure, and none of it is for the active contract's disease. */
  readonly producingOther: boolean;
  readonly sector: string;
}

export function currentObjective(input: ObjectiveInput): Objective {
  for (const id of input.gatedPatents) {
    const disease = requiredShippingContractForPatent(id);
    if (disease === null || input.unlockedPatents.includes(id)) continue;
    if (input.contracts.find((contract) => contract.disease === disease)?.completed === true) {
      return { text: `Unlock ${patentTitle(id)}`, target: "technology", actionLabel: "Technology" };
    }
  }
  const contract = input.contracts.find((candidate) => !candidate.completed);
  if (contract === undefined) {
    return { text: "Every shipping contract is filled", target: "market", actionLabel: "Market" };
  }
  const name = diseaseName(contract.disease);
  if (input.profitableUnits(contract.disease) > 0) {
    return { text: `Ship ${name} · ${contract.sold} of ${contract.quota}`, target: "market", actionLabel: "Ship" };
  }
  if (!input.formulaDiseases.includes(contract.disease)) {
    const where = input.sector === "local" ? "near the start" : `look ${input.sector}`;
    return { text: `Find a cure for ${name} · ${where}`, target: "research", actionLabel: "Research" };
  }
  if (input.stockFor(contract.disease) > 0) {
    return { text: `${name} stock no longer earns · improve the line`, target: "production", actionLabel: "Production" };
  }
  if (!input.productionHasMachines) {
    return { text: `Build the ${name} formula`, target: "pilot", actionLabel: "Open Plan" };
  }
  if (input.producingOther) {
    return { text: `Build the ${name} formula · Production makes another cure`, target: "pilot", actionLabel: "Open Plan" };
  }
  return { text: `Run Production to make ${name}`, target: "production", actionLabel: "Production" };
}
