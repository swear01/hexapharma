import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  GenOptions,
  GeneratedLevel,
  MultiMap,
  MachineCatalogEntry,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
import { initialState, evaluate } from "../drug-graph";
import { solve } from "../solver";
import { generate, difficultyToBasePrice } from "./index";

// ───────────────────────────── fixtures ─────────────────────────────

/**
 * Test-friendly options: small maps + a wide difficulty band keep the solver's
 * (W·H)^N BFS fast while still exercising the full generate path across seeds.
 */
function smallOpts(seed: number, over: Partial<GenOptions> = {}): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 10,
    height: 10,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 2, max: 8 },
    ...over,
  };
}

/** Field-by-field MultiMap equality, including every typed array. */
function multiMapFieldEqual(a: MultiMap, b: MultiMap): boolean {
  if (a.maps.length !== b.maps.length) return false;
  for (let i = 0; i < a.maps.length; i++) {
    const ma = a.maps[i];
    const mb = b.maps[i];
    if (ma === undefined || mb === undefined) return false;
    if (ma.width !== mb.width || ma.height !== mb.height) return false;
    if (ma.origin.x !== mb.origin.x || ma.origin.y !== mb.origin.y) return false;
    if (ma.start.x !== mb.start.x || ma.start.y !== mb.start.y) return false;
    const arrays = ["cell", "cureId", "sideEffectId", "fog"] as const;
    for (const k of arrays) {
      const aa = ma[k];
      const bb = mb[k];
      if (aa.length !== bb.length) return false;
      for (let j = 0; j < aa.length; j++) {
        if (aa[j] !== bb[j]) return false;
      }
    }
  }
  return true;
}

/** Cure-cell lookup: confirm a DiseaseSpec.node really holds its Cure on its map. */
function cureAt(level: GeneratedLevel, map: number, x: number, y: number, id: number): boolean {
  const m = level.mm.maps[map];
  if (m === undefined) return false;
  const i = y * m.width + x;
  return m.cell[i] === CellKind.Cure && m.cureId[i] === id;
}

// ───────────────────────────── INV-9: constructive solvability ─────────────────────────────

describe("mapgen INV-9 (constructive solvability)", () => {
  it("every disease's reference cures it and never fails (across many seeds)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        const level = generate(smallOpts(seed));
        const start = initialState(level.mm);
        expect(level.diseases.length).toBe(2);
        for (const d of level.diseases) {
          const out = evaluate(level.mm, start, d.reference);
          expect(out.failed).toBe(false);
          expect(out.cured).toContain(d.id);
          // The disease's declared node truly carries its Cure cell.
          expect(cureAt(level, d.map, d.node.x, d.node.y, d.id)).toBe(true);
        }
      }),
      { numRuns: 80 },
    );
  });

  it("round-robins diseases onto distinct maps (no two cures on one map)", () => {
    const level = generate(smallOpts(123));
    const mapsUsed = level.diseases.map((d) => d.map);
    expect(new Set(mapsUsed).size).toBe(level.diseases.length);
  });

  it("works with the CLI's 16x16 DEFAULT_CATALOG config (seed 42)", () => {
    const level = generate({
      seed: 42,
      nMaps: 2,
      width: 16,
      height: 16,
      catalog: DEFAULT_CATALOG,
      diseaseCount: 2,
      difficulty: { min: 2, max: 12 },
    });
    const start = initialState(level.mm);
    for (const d of level.diseases) {
      const out = evaluate(level.mm, start, d.reference);
      expect(out.failed).toBe(false);
      expect(out.cured).toContain(d.id);
    }
  });
});

// ───────────────────────────── INV-10: generation determinism ─────────────────────────────

describe("mapgen INV-10 (generation determinism)", () => {
  it("same seed ⇒ field-equal MultiMap + identical diseases (across many seeds)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        const a = generate(smallOpts(seed));
        const b = generate(smallOpts(seed));
        expect(a.seed).toBe(b.seed);
        // start state.
        expect(a.start).toEqual(b.start);
        // full MultiMap field equality (every typed array).
        expect(multiMapFieldEqual(a.mm, b.mm)).toBe(true);
        // diseases: difficulty, basePrice, node, map, id, AND reference template.
        expect(a.diseases).toEqual(b.diseases);
      }),
      { numRuns: 80 },
    );
  });

  it("is byte-identical for a 16x16 level too", () => {
    const o: GenOptions = {
      seed: 2024,
      nMaps: 2,
      width: 16,
      height: 16,
      catalog: DEFAULT_CATALOG,
      diseaseCount: 2,
      difficulty: { min: 2, max: 12 },
    };
    const a = generate(o);
    const b = generate(o);
    expect(multiMapFieldEqual(a.mm, b.mm)).toBe(true);
    expect(a.diseases).toEqual(b.diseases);
  });
});

// ───────────────────────────── INV-11: difficulty bounds ─────────────────────────────

describe("mapgen INV-11 (difficulty bounds)", () => {
  it("every disease difficulty lies in [min,max] (across many seeds)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        const opts = smallOpts(seed);
        const level = generate(opts);
        for (const d of level.diseases) {
          expect(d.difficulty).toBeGreaterThanOrEqual(opts.difficulty.min);
          expect(d.difficulty).toBeLessThanOrEqual(opts.difficulty.max);
        }
      }),
      { numRuns: 80 },
    );
  });

  it("difficulty/cost are canonical (match a fresh solver run)", () => {
    const opts = smallOpts(777);
    const level = generate(opts);
    const start = initialState(level.mm);
    for (const d of level.diseases) {
      const sol = solve(level.mm, start, {
        catalog: opts.catalog,
        maxDepth: opts.difficulty.max + 1,
        targets: [d.id],
      });
      expect(sol).not.toBeNull();
      expect(sol!.difficulty).toBe(d.difficulty);
      // basePrice is derived from the canonical (difficulty, cost).
      expect(d.basePrice).toBe(difficultyToBasePrice(sol!.difficulty, sol!.cost));
    }
  });

  it("respects a tightened range (min===max forces an exact difficulty)", () => {
    const level = generate(smallOpts(55, { difficulty: { min: 4, max: 4 } }));
    for (const d of level.diseases) {
      expect(d.difficulty).toBe(4);
    }
  });

  it("throws a seed+range error when no level can satisfy the band", () => {
    // A 5x5 grid with max-step 2 caps difficulty at ceil(4/2)+ceil(4/2)=4; asking
    // for difficulty 20+ is physically impossible ⇒ a clear throw, never a bad level.
    expect(() =>
      generate(smallOpts(1, { width: 5, height: 5, difficulty: { min: 20, max: 22 } })),
    ).toThrowError(/seed=1/);
  });
});

// ───────────────────────────── INV-12: pricing ─────────────────────────────

describe("mapgen INV-12 (pricing consistency)", () => {
  it("is deterministic and integer", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 200 }),
        (difficulty, refCost) => {
          const p = difficultyToBasePrice(difficulty, refCost);
          expect(Number.isInteger(p)).toBe(true);
          expect(difficultyToBasePrice(difficulty, refCost)).toBe(p);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is monotonically non-decreasing in difficulty (fixed refCost)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 29 }),
        (refCost, d) => {
          expect(difficultyToBasePrice(d + 1, refCost)).toBeGreaterThanOrEqual(
            difficultyToBasePrice(d, refCost),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is monotonically non-decreasing in refCost (fixed difficulty)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 30 }),
        fc.integer({ min: 0, max: 199 }),
        (difficulty, c) => {
          expect(difficultyToBasePrice(difficulty, c + 1)).toBeGreaterThanOrEqual(
            difficultyToBasePrice(difficulty, c),
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  it("is jointly non-decreasing (both args increase ⇒ price never drops)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 25 }),
        fc.integer({ min: 0, max: 150 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 40 }),
        (d, c, dd, dc) => {
          expect(difficultyToBasePrice(d + dd, c + dc)).toBeGreaterThanOrEqual(
            difficultyToBasePrice(d, c),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ───────────────────────────── scatter safety ─────────────────────────────

describe("mapgen scatter never corrupts the reference", () => {
  it("no Wall/Hazard sits on a cure cell, and starts stay Empty", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), (seed) => {
        const level = generate(smallOpts(seed));
        for (const m of level.mm.maps) {
          // start cell is never a blocking/cure feature.
          const si = m.start.y * m.width + m.start.x;
          expect(m.cell[si]).toBe(CellKind.Empty);
        }
        // Each cure cell is a Cure (not overwritten by scatter).
        for (const d of level.diseases) {
          expect(cureAt(level, d.map, d.node.x, d.node.y, d.id)).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });
});

// ───────────────────────────── catalog guard ─────────────────────────────

describe("mapgen catalog requirements", () => {
  it("throws when the catalog has no positive +x/+y translate movers", () => {
    // Only a swap machine: no way to construct an axis-aligned reference.
    const swapOnly: readonly MachineCatalogEntry[] = [
      { typeId: "swap01", transform: { kind: "swap", a: 0, b: 1 }, cost: 1, orientable: false },
    ];
    expect(() => generate(smallOpts(1, { catalog: swapOnly }))).toThrowError(/movers/);
  });
});
