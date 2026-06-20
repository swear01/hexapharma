import type { GenerateFn, DifficultyToBasePriceFn } from "../phase0_interfaces";

// STUB — owned by the mapgen agent. Implement to satisfy INV-9..INV-12.
export const generate: GenerateFn = (_opts) => {
  throw new Error("not implemented: mapgen.generate");
};

export const difficultyToBasePrice: DifficultyToBasePriceFn = (_difficulty, _refCost) => {
  throw new Error("not implemented: mapgen.difficultyToBasePrice");
};
