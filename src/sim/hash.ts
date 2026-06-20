/** Deterministic FNV-1a hashing for replay/equality checks (INV-15). */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function hashInit(): number {
  return FNV_OFFSET >>> 0;
}

/** Fold a 32-bit integer into the running hash, byte by byte. */
export function hashU32(h: number, v: number): number {
  let x = h;
  x ^= v & 0xff;
  x = Math.imul(x, FNV_PRIME);
  x ^= (v >>> 8) & 0xff;
  x = Math.imul(x, FNV_PRIME);
  x ^= (v >>> 16) & 0xff;
  x = Math.imul(x, FNV_PRIME);
  x ^= (v >>> 24) & 0xff;
  x = Math.imul(x, FNV_PRIME);
  return x >>> 0;
}

export function hashInts(values: Iterable<number>): number {
  let h = hashInit();
  for (const v of values) h = hashU32(h, v | 0);
  return h >>> 0;
}
