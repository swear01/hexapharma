import type { Rng, RngState, MakeRngFn, RestoreRngFn } from "../phase0_interfaces";

const U32 = 0x1_0000_0000;

/** Deterministic mulberry32 PRNG. The sim's only randomness source. */
function mulberry32(seed: number): Rng {
  let a = seed | 0;

  const u32 = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  return {
    u32,
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
        throw new RangeError(`rng.int: maxExclusive must be a positive integer, got ${maxExclusive}`);
      }
      // Multiply-high keeps the distribution even across the 32-bit space.
      return Math.floor((u32() / U32) * maxExclusive);
    },
    float(): number {
      return u32() / U32;
    },
    fork(): Rng {
      return mulberry32((u32() ^ 0x9e3779b9) | 0);
    },
    snapshot(): RngState {
      return { s: a >>> 0 };
    },
  };
}

export const makeRng: MakeRngFn = (seed) => mulberry32(seed | 0);
export const restoreRng: RestoreRngFn = (state) => mulberry32(state.s | 0);
