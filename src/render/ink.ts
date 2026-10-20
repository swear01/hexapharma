/**
 * Deterministic hand-drawn jitter for renderer-only linework. Same inputs always give the same
 * offset, so a redraw never shimmers; allocation-free for hot render paths.
 */
export function inkJitter(seed: number, index: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}
