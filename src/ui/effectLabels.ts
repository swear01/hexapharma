import type { DiseaseId, Outcome } from "../sim/phase0_interfaces";

function requireDiseaseId(disease: DiseaseId): void {
  if (!Number.isSafeInteger(disease) || disease < 0) {
    throw new Error(`Invalid disease id: ${disease}`);
  }
}

export function diseaseName(disease: DiseaseId): string {
  requireDiseaseId(disease);
  return `Disease ${disease + 1}`;
}

export function diseaseEmblem(disease: DiseaseId): string {
  requireDiseaseId(disease);
  return `D${disease + 1}`;
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
