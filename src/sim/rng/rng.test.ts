import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { makeRng, restoreRng } from "./index";

describe("rng (INV-14)", () => {
  it("is deterministic for a given seed", () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = makeRng(seed);
        const b = makeRng(seed);
        for (let i = 0; i < 64; i++) expect(a.u32()).toBe(b.u32());
      }),
    );
  });

  it("snapshot/restore reproduces the subsequent stream", () => {
    fc.assert(
      fc.property(fc.integer(), fc.nat(32), (seed, skip) => {
        const a = makeRng(seed);
        for (let i = 0; i < skip; i++) a.u32();
        const snap = a.snapshot();
        const tail = [a.u32(), a.u32(), a.u32(), a.u32()];
        const b = restoreRng(snap);
        expect([b.u32(), b.u32(), b.u32(), b.u32()]).toEqual(tail);
      }),
    );
  });

  it("int(max) stays within [0, max)", () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: 1, max: 100000 }), (seed, max) => {
        const r = makeRng(seed);
        for (let i = 0; i < 32; i++) {
          const v = r.int(max);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(max);
        }
      }),
    );
  });

  it("float stays within [0, 1)", () => {
    const r = makeRng(2026);
    for (let i = 0; i < 2000; i++) {
      const v = r.float();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("fork is deterministic from the same parent state", () => {
    const a = makeRng(7).fork();
    const b = makeRng(7).fork();
    for (let i = 0; i < 16; i++) expect(a.u32()).toBe(b.u32());
  });

  it("int throws on non-positive bound", () => {
    expect(() => makeRng(1).int(0)).toThrow();
  });
});
