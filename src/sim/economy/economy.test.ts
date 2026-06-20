import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { DiseaseId, EconomyState } from "../phase0_interfaces";
import { nextUnitPrice, sellUnit } from "./index";

const empty: EconomyState = { cash: 0, sold: [] };

describe("nextUnitPrice — diminishing returns", () => {
  it("alreadySold = 0 returns basePrice", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (base) => {
        expect(nextUnitPrice(base, 0)).toBe(base);
      }),
    );
  });

  it("is monotonically non-increasing in alreadySold and floored positive", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 200 }),
        (base, n) => {
          const floor = Math.max(1, Math.floor(base / 10));
          let prev = nextUnitPrice(base, 0);
          for (let k = 1; k <= n; k++) {
            const cur = nextUnitPrice(base, k);
            expect(cur).toBeLessThanOrEqual(prev);
            expect(cur).toBeGreaterThanOrEqual(floor);
            prev = cur;
          }
        },
      ),
    );
  });

  it("is deterministic (same inputs ⇒ same output)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 500 }),
        (base, n) => {
          expect(nextUnitPrice(base, n)).toBe(nextUnitPrice(base, n));
        },
      ),
    );
  });

  it("returns integers and never floats", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 300 }),
        (base, n) => {
          expect(Number.isInteger(nextUnitPrice(base, n))).toBe(true);
        },
      ),
    );
  });

  it("non-positive basePrice earns nothing", () => {
    expect(nextUnitPrice(0, 0)).toBe(0);
    expect(nextUnitPrice(-5, 3)).toBe(0);
  });
});

describe("sellUnit — cash conservation", () => {
  it("cash == initialCash + Σ net over a sequence of sales", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.array(
          fc.record({
            disease: fc.integer({ min: 0, max: 5 }),
            base: fc.integer({ min: 1, max: 10_000 }),
            cost: fc.integer({ min: 0, max: 500 }),
            penalty: fc.integer({ min: 0, max: 500 }),
          }),
          { maxLength: 60 },
        ),
        (initialCash, sales) => {
          let econ: EconomyState = { cash: initialCash, sold: [] };
          let sumNet = 0;
          for (const s of sales) {
            const r = sellUnit(econ, s.disease, s.base, s.cost, s.penalty);
            expect(r.net).toBe(r.revenue - s.cost - s.penalty);
            sumNet += r.net;
            econ = r.econ;
          }
          expect(econ.cash).toBe(initialCash + sumNet);
        },
      ),
    );
  });

  it("sold counts are non-negative and increase by exactly one per sale", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 40 }),
        (diseases) => {
          let econ: EconomyState = empty;
          const tally = new Map<DiseaseId, number>();
          for (const d of diseases) {
            econ = sellUnit(econ, d, 100, 0, 0).econ;
            tally.set(d, (tally.get(d) ?? 0) + 1);
          }
          for (const sc of econ.sold) {
            expect(sc.count).toBeGreaterThan(0);
            expect(sc.count).toBe(tally.get(sc.disease));
          }
          // total sold == number of sales
          const total = econ.sold.reduce((a, sc) => a + sc.count, 0);
          expect(total).toBe(diseases.length);
        },
      ),
    );
  });

  it("sold is kept in ascending-by-disease order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 8 }), { maxLength: 40 }),
        (diseases) => {
          let econ: EconomyState = empty;
          for (const d of diseases) econ = sellUnit(econ, d, 100, 0, 0).econ;
          for (let i = 1; i < econ.sold.length; i++) {
            const prev = econ.sold[i - 1];
            const cur = econ.sold[i];
            if (prev && cur) expect(cur.disease).toBeGreaterThan(prev.disease);
          }
        },
      ),
    );
  });
});

describe("sellUnit — per-disease independence (parallel demand)", () => {
  it("interleaving B's sales does not change A's prices", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }), // base for A
        fc.integer({ min: 1, max: 10_000 }), // base for B
        fc.array(fc.boolean(), { maxLength: 50 }), // true => sell A, false => sell B
        (baseA, baseB, plan) => {
          const A = 0;
          const B = 1;

          // Interleaved run: record A's revenues.
          let mixed: EconomyState = empty;
          const aRevMixed: number[] = [];
          for (const sellA of plan) {
            if (sellA) {
              const r = sellUnit(mixed, A, baseA, 0, 0);
              aRevMixed.push(r.revenue);
              mixed = r.econ;
            } else {
              mixed = sellUnit(mixed, B, baseB, 0, 0).econ;
            }
          }

          // A-only run.
          let aOnly: EconomyState = empty;
          const aRevAlone: number[] = [];
          for (const sellA of plan) {
            if (!sellA) continue;
            const r = sellUnit(aOnly, A, baseA, 0, 0);
            aRevAlone.push(r.revenue);
            aOnly = r.econ;
          }

          expect(aRevMixed).toEqual(aRevAlone);
        },
      ),
    );
  });
});

describe("sellUnit — anti-degeneracy", () => {
  it("a fresh disease's 1st unit out-earns the Kth unit of a spammed one", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 10_000 }),
        fc.integer({ min: 5, max: 50 }),
        (base, k) => {
          // Spam disease 0 k times.
          let econ: EconomyState = empty;
          for (let i = 0; i < k; i++) econ = sellUnit(econ, 0, base, 0, 0).econ;
          const spammedNext = sellUnit(econ, 0, base, 0, 0).revenue;
          // Fresh disease 1, first unit.
          const freshFirst = sellUnit(econ, 1, base, 0, 0).revenue;
          expect(freshFirst).toBeGreaterThan(spammedNext);
        },
      ),
    );
  });
});

describe("sellUnit — determinism", () => {
  it("same inputs ⇒ identical SaleResult", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 200 }),
        (cash, disease, base, cost, penalty) => {
          const econ: EconomyState = { cash, sold: [{ disease, count: 3 }] };
          const a = sellUnit(econ, disease, base, cost, penalty);
          const b = sellUnit(econ, disease, base, cost, penalty);
          expect(a).toEqual(b);
        },
      ),
    );
  });
});
