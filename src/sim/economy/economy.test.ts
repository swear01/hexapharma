import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { DiseaseId, EconomyState } from "../phase0_interfaces";
import { nextUnitPrice, sellUnit } from "./index";

const empty: EconomyState = { cash: 0, research: 0, sold: [] };

describe("nextUnitPrice — diminishing returns", () => {
  it("alreadySold = 0 returns basePrice", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (base) => {
        expect(nextUnitPrice(base, 0)).toBe(base);
      }),
    );
  });

  it("is monotonically non-increasing in alreadySold and never negative", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 0, max: 200 }),
        (base, n) => {
          let prev = nextUnitPrice(base, 0);
          for (let k = 1; k <= n; k++) {
            const cur = nextUnitPrice(base, k);
            expect(cur).toBeLessThanOrEqual(prev);
            expect(cur).toBeGreaterThanOrEqual(0);
            prev = cur;
          }
        },
      ),
    );
  });

  it("eventually reaches zero gross demand and stays there", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (base) => {
        expect(nextUnitPrice(base, 512)).toBe(0);
        expect(nextUnitPrice(base, 513)).toBe(0);
      }),
    );
  });

  it("has finite cumulative gross revenue for repeated sales of one disease", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (base) => {
        let total = 0;
        for (let sold = 0; sold <= 512; sold++) total += nextUnitPrice(base, sold);
        expect(total).toBeLessThanOrEqual(base * 10);
        expect(nextUnitPrice(base, 512)).toBe(0);
      }),
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

  it("matches exact integer decay at the safe-integer boundary", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: Number.MAX_SAFE_INTEGER - 10_000, max: Number.MAX_SAFE_INTEGER }),
        (base) => {
          const expected = Number((BigInt(base) * 9n) / 10n);
          expect(nextUnitPrice(base, 1)).toBe(expected);
        },
      ),
    );
  });

  it("non-positive basePrice earns nothing", () => {
    expect(nextUnitPrice(0, 0)).toBe(0);
    expect(nextUnitPrice(-5, 3)).toBe(0);
  });

  it("rejects non-integer prices and invalid sale counts instead of looping or rounding", () => {
    expect(() => nextUnitPrice(10.5, 0)).toThrow(/integer/i);
    expect(() => nextUnitPrice(100, -1)).toThrow(/alreadySold|non-negative/i);
    expect(() => nextUnitPrice(100, Number.POSITIVE_INFINITY)).toThrow(/alreadySold|integer/i);
  });
});

describe("sellUnit — cash conservation", () => {
  it("rejects malformed economy and negative physical costs", () => {
    expect(() => sellUnit(empty, 0, 100, -1, 0)).toThrow(/cost/i);
    expect(() => sellUnit(empty, 0, 100, 0, -1)).toThrow(/penalty/i);
    expect(() => sellUnit({ cash: 0, research: 0, sold: [{ disease: 0, count: -1 }] }, 0, 100, 0, 0))
      .toThrow(/sold count/i);
  });

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
          let econ: EconomyState = { cash: initialCash, research: 0, sold: [] };
          let sumNet = 0;
          for (const s of sales) {
            const r = sellUnit(econ, s.disease, s.base, s.cost, s.penalty);
            expect(r.net).toBe(r.revenue - s.cost - s.penalty);
            sumNet += r.net;
            econ = r.econ;
          }
          expect(econ.cash).toBe(initialCash + sumNet);
          expect(econ.research).toBe(sales.length);
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
  it("keeps fresh-disease demand intact after another disease reaches zero", () => {
    const exhausted: EconomyState = {
      cash: 0,
      research: 512,
      sold: [{ disease: 0, count: 512 }],
    };

    expect(sellUnit(exhausted, 0, 100, 0, 0).revenue).toBe(0);
    expect(sellUnit(exhausted, 1, 100, 0, 0).revenue).toBe(100);
  });

  it("lets a different disease sell when another counter is saturated", () => {
    const econ: EconomyState = {
      cash: 0,
      research: 0,
      sold: [{ disease: 1, count: Number.MAX_SAFE_INTEGER }],
    };

    const result = sellUnit(econ, 0, 100, 0, 0);

    expect(result.revenue).toBe(100);
    expect(result.econ).toEqual({
      cash: 100,
      research: 1,
      sold: [
        { disease: 0, count: 1 },
        { disease: 1, count: Number.MAX_SAFE_INTEGER },
      ],
    });
    expect(econ.sold).toEqual([{ disease: 1, count: Number.MAX_SAFE_INTEGER }]);
  });

  it("atomically rejects incrementing the saturated target disease", () => {
    const econ: EconomyState = {
      cash: 7,
      research: 3,
      sold: [{ disease: 0, count: Number.MAX_SAFE_INTEGER }],
    };
    const before: EconomyState = {
      cash: econ.cash,
      research: econ.research,
      sold: econ.sold.map((entry) => ({ ...entry })),
    };

    expect(() => sellUnit(econ, 0, 100, 0, 0)).toThrow(/incremented safely/i);
    expect(econ).toEqual(before);
  });

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
          const econ: EconomyState = { cash, research: 0, sold: [{ disease, count: 3 }] };
          const a = sellUnit(econ, disease, base, cost, penalty);
          const b = sellUnit(econ, disease, base, cost, penalty);
          expect(a).toEqual(b);
        },
      ),
    );
  });
});
