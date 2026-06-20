import type {
  OrientFn,
  EffectiveDeltaFn,
  InitialStateFn,
  ApplyStepFn,
  ApplyTemplateFn,
  EvaluateFn,
  RevealAlongFn,
} from "../phase0_interfaces";

// STUB — owned by the drug-graph agent. Implement to satisfy INV-1..INV-8.
// See docs/invariants.md and phase0_interfaces.ts.
const ni = (name: string): never => {
  throw new Error(`not implemented: drug-graph.${name}`);
};

export const orient: OrientFn = (_v, _o) => ni("orient");
export const effectiveDelta: EffectiveDeltaFn = (_delta, _relation, _o) => ni("effectiveDelta");
export const initialState: InitialStateFn = (_mm) => ni("initialState");
export const applyStep: ApplyStepFn = (_mm, _s, _m) => ni("applyStep");
export const applyTemplate: ApplyTemplateFn = (_mm, _start, _t) => ni("applyTemplate");
export const evaluate: EvaluateFn = (_mm, _start, _t) => ni("evaluate");
export const revealAlong: RevealAlongFn = (_mm, _start, _t) => ni("revealAlong");
