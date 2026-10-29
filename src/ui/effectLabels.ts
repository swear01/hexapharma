import type { DiseaseId, Outcome } from "../sim/phase0_interfaces";
import { SIDE_EFFECT_PENALTY } from "../sim/game";

function requireDiseaseId(disease: DiseaseId): void {
  if (!Number.isSafeInteger(disease) || disease < 0) {
    throw new Error(`Invalid disease id: ${disease}`);
  }
}

export function diseaseName(disease: DiseaseId): string {
  requireDiseaseId(disease);
  return `Disease ${disease + 1}`;
}

export function outcomeEffectText(outcome: Outcome): string {
  const result = outcome.failed
    ? "Failed"
    : outcome.cured.length === 0
      ? "No cure"
      : `${outcome.cured.length === 1 ? "Cure" : "Cures"} ${outcome.cured.map(diseaseName).join(", ")}`;
  const sideEffects = outcome.sideEffects.length === 0
    ? "No side effects"
    : `${outcome.sideEffects.length} side effect${outcome.sideEffects.length === 1 ? "" : "s"}`;
  return `${result} · ${sideEffects}`;
}

/** Name and meaning of each Atlas terrain, shared by the Guide legend and a click on a revealed cell. */
export const TERRAIN_NOTES = {
  cure: ["Cure", "A step that ends here cures that disease."],
  premium: ["★ Cure", "Ending here sells for 1.5× the price."],
  sideEffect: ["Side effect", `Ending here adds a side effect: −$${SIDE_EFFECT_PENALTY} per unit sold.`],
  wall: ["Mountain", "Skips that move."],
  marsh: ["Water", "Each move inside goes only half a cell."],
  abyss: ["Black ground", "A step that enters it fails the run."],
} as const;
