import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type {
  GenOptions,
  GeneratedLevel,
  MultiMap,
  MachineCatalogEntry,
  Solution,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
import { initialState, evaluate } from "../drug-graph";
import { solve } from "../solver";
import { generate, difficultyToBasePrice } from "./index";

// ───────────────────────────── fixtures ─────────────────────────────

/**
 * Test-friendly options: small maps + a difficulty band wide enough to absorb the
 * decoupling/diversity bonuses that cross-map tension forces. The (W·H)^N BFS stays
 * fast (10×12, 2 maps) while still exercising the full tension-generate path.
 * Tension needs ≥2 maps, so nMaps is always 2 here.
 */
function smallOpts(seed: number, over: Partial<GenOptions> = {}): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 10,
    height: 12,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 4, max: 12 },
    ...over,
  };
}

/** A "decoupling step" — a move that can make the maps' positions diverge. */
function solutionDecouples(sol: Solution): boolean {
  return sol.template.steps.some((m) => {
    const t = m.transform;
    if (t.kind === "swap" || t.kind === "scale") return true;
    return (
      t.kind === "translate" &&
      (t.relation === "reverse" || t.relation === "perpendicular" || t.relation === "offset")
    );
  });
}

/** Field-by-field MultiMap equality, including every typed array and per-map origin. */
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
      { numRuns: 60 },
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

// ───────────────────────────── NEW: cross-map tension ─────────────────────────────

describe("mapgen cross-map tension (decoupling required)", () => {
  it("every generated level has ≥1 disease whose canonical solution decouples", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (seed) => {
        const opts = smallOpts(seed);
        const level = generate(opts);
        const start = initialState(level.mm);
        let decoupling = 0;
        for (const d of level.diseases) {
          const sol = solve(level.mm, start, {
            catalog: opts.catalog,
            maxDepth: opts.difficulty.max + 2,
            targets: [d.id],
          });
          expect(sol).not.toBeNull();
          if (sol !== null && solutionDecouples(sol)) decoupling += 1;
          // The declared reference must agree with the canonical solver solution.
          if (sol !== null) {
            expect(solutionDecouples({ template: d.reference, difficulty: d.difficulty, cost: 0 })).toBe(
              solutionDecouples(sol),
            );
          }
        }
        // The whole point: at least one disease cannot be solved by a naive
        // forward-only (lock-step) recipe.
        expect(decoupling).toBeGreaterThanOrEqual(1);
      }),
      { numRuns: 60 },
    );
  });

  it("the naive lock-step forward recipe gets SPOILED on the other map (the trap)", () => {
    // The cross-map trap: pushing the drug straight at a cure's (cx,cy) — which
    // moves EVERY map in lock-step — drives the drug onto the tension hazard that
    // sits at (cx,cy) on the other map, spoiling the whole drug. We replay that
    // exact naive recipe and confirm it fails for the vast majority of diseases.
    const push = DEFAULT_CATALOG.find((c) => c.typeId === "push");
    expect(push).toBeDefined();
    const naiveRecipe = (cx: number, cy: number) => {
      const steps = [];
      for (let i = 0; i < cx; i++) {
        steps.push({ typeId: push!.typeId, transform: push!.transform, orientation: { rot: 0 as const, flip: false } });
      }
      for (let i = 0; i < cy; i++) {
        steps.push({ typeId: push!.typeId, transform: push!.transform, orientation: { rot: 1 as const, flip: false } });
      }
      return { steps };
    };

    let total = 0;
    let spoiled = 0;
    for (let seed = 0; seed < 40; seed++) {
      const opts = smallOpts(seed);
      const level = generate(opts);
      const start = initialState(level.mm);
      for (const d of level.diseases) {
        total += 1;
        const out = evaluate(level.mm, start, naiveRecipe(d.node.x, d.node.y));
        const naiveCures = !out.failed && out.cured.includes(d.id);
        if (!naiveCures) spoiled += 1;
      }
    }
    // Empirically ~0.88 of diseases trap the naive lock-step recipe.
    expect(spoiled / total).toBeGreaterThan(0.6);
  });

  it("reports a high decoupling FRACTION across diseases (aim: most diseases need it)", () => {
    let total = 0;
    let decoupling = 0;
    for (let seed = 0; seed < 40; seed++) {
      const opts = smallOpts(seed);
      const level = generate(opts);
      const start = initialState(level.mm);
      for (const d of level.diseases) {
        total += 1;
        const sol = solve(level.mm, start, {
          catalog: opts.catalog,
          maxDepth: opts.difficulty.max + 2,
          targets: [d.id],
        });
        if (sol !== null && solutionDecouples(sol)) decoupling += 1;
      }
    }
    // Empirically ~0.9; require a clear majority so a regression that silently
    // drops the tension is caught.
    expect(decoupling / total).toBeGreaterThan(0.6);
  });

  it("gives each map a DISTINCT origin (the precondition for decoupling)", () => {
    const level = generate(smallOpts(99));
    const origins = level.mm.maps.map((m) => `${m.origin.x},${m.origin.y}`);
    expect(new Set(origins).size).toBe(level.mm.maps.length);
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
        // full MultiMap field equality (every typed array + origins).
        expect(multiMapFieldEqual(a.mm, b.mm)).toBe(true);
        // diseases: difficulty, basePrice, node, map, id, AND reference template.
        expect(a.diseases).toEqual(b.diseases);
      }),
      { numRuns: 60 },
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
      { numRuns: 60 },
    );
  });

  it("difficulty/cost are canonical (match a fresh solver run)", () => {
    const opts = smallOpts(777);
    const level = generate(opts);
    const start = initialState(level.mm);
    for (const d of level.diseases) {
      const sol = solve(level.mm, start, {
        catalog: opts.catalog,
        maxDepth: opts.difficulty.max + 2,
        targets: [d.id],
      });
      expect(sol).not.toBeNull();
      expect(sol!.difficulty).toBe(d.difficulty);
      // basePrice is derived from the canonical (difficulty, cost).
      expect(d.basePrice).toBe(difficultyToBasePrice(sol!.difficulty, sol!.cost));
    }
  });

  it("respects a tightened range (min===max forces an exact difficulty)", () => {
    const level = generate(smallOpts(0, { difficulty: { min: 8, max: 8 } }));
    for (const d of level.diseases) {
      expect(d.difficulty).toBe(8);
    }
  });

  it("throws a seed+range error when no level can satisfy the band", () => {
    // A tiny 5x5 grid cannot host a difficulty-30+ decoupling solution ⇒ a clear
    // throw, never a bad level.
    expect(() =>
      generate(smallOpts(1, { width: 5, height: 5, difficulty: { min: 30, max: 32 } })),
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
        // Each cure cell is a Cure (not overwritten by scatter or a tension hazard).
        for (const d of level.diseases) {
          expect(cureAt(level, d.map, d.node.x, d.node.y, d.id)).toBe(true);
        }
      }),
      { numRuns: 50 },
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
