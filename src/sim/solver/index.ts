import type { SolveFn } from "../phase0_interfaces";

// STUB — owned by the solver agent. Implement to satisfy INV-13 (soundness).
// Dev/test-only: NEVER wire into an in-game auto-solver (D14).
export const solve: SolveFn = (_mm, _start, _opts) => {
  throw new Error("not implemented: solver.solve");
};
