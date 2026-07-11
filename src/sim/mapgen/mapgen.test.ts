import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
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
import {
  MAX_GENERATION_DIFFICULTY,
  MAX_MAP_CELLS,
  generate,
  difficultyToBasePrice,
} from "./index";

describe("mapgen production boundary", () => {
  it("does not import the dev/test-only solver", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*solver[^"']*["']/);
  });

  it("expresses discrete scatter proportions as integer rational arithmetic", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/\blen\s*\*\s*0\.0[345]\b/);
  });

  it("owns catalog-derived reference machines instead of aliasing caller data", () => {
    const catalog = DEFAULT_CATALOG.map((entry) => structuredClone(entry));
    const opts = smallOpts(14, { catalog });
    const level = generate(opts);
    const reference = level.diseases[0]!.reference;
    const before = structuredClone(reference);
    const first = reference.steps[0]!;
    const sourceEntry = catalog.find((entry) => entry.typeId === first.typeId)!;
    if (sourceEntry.transform.kind === "translate") {
      (sourceEntry.transform.delta as { x: number }).x = 99;
    }

    expect(reference).toEqual(before);
    expect(Object.isFrozen(reference.steps)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.transform)).toBe(true);
    if (reference.steps[1]?.typeId === first.typeId) {
      expect(reference.steps[1]).not.toBe(first);
    }
  });

  it("preserves globally unique side-effect IDs beyond the int16 range", () => {
    const level = generate(nMapOpts(42, 4, { width: 110, height: 100 }));
    const ids = new Set<number>();
    let highIdCell: { map: number; x: number; y: number; id: number } | undefined;

    for (let mapIndex = 0; mapIndex < level.mm.maps.length; mapIndex++) {
      const map = level.mm.maps[mapIndex]!;
      expect(map.sideEffectId).toBeInstanceOf(Int32Array);
      for (let i = 0; i < map.cell.length; i++) {
        if (map.cell[i] !== CellKind.SideEffect) continue;
        const id = map.sideEffectId[i]!;
        expect(id).toBeGreaterThanOrEqual(0);
        expect(ids.has(id)).toBe(false);
        ids.add(id);
        if (id > 0x7fff && highIdCell === undefined) {
          highIdCell = {
            map: mapIndex,
            x: i % map.width,
            y: Math.floor(i / map.width),
            id,
          };
        }
      }
    }

    expect(highIdCell).toBeDefined();
    const target = highIdCell!;
    const pos = level.start.pos.map((p) => ({ x: p.x, y: p.y }));
    pos[target.map] = { x: target.x, y: target.y };
    const outcome = evaluate(level.mm, { pos, failed: false }, { steps: [] });
    expect(outcome.sideEffects).toContain(target.id);
  });

  it("rejects static and dynamic production imports of the dev/test-only solver", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const probes = [
      `import { solve } from "../sim/solver"; void solve;`,
      `void import("../sim/solver/index");`,
    ];
    for (const filePath of ["src/ui/solver-boundary-probe.ts", "src/sim/mapgen/solver-boundary-probe.ts"]) {
      for (const source of probes) {
        const [result] = await eslint.lintText(source, { filePath });
        expect(result?.messages.some((message) => message.message.includes("dev/test-only solver"))).toBe(true);
      }
    }

    for (const filePath of ["src/sim/solver/solver-boundary-probe.ts", "src/ui/solver-boundary-probe.test.ts"]) {
      const [result] = await eslint.lintText(probes[0]!, { filePath });
      expect(result?.messages.some((message) => message.message.includes("dev/test-only solver"))).toBe(false);
    }
  });
});

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

/**
 * N-map options. The solver is a BFS over (W·H)^N, so map size must shrink as N
 * grows to keep the per-attempt re-checks fast: N=3 at 7×7, N=4 at 6×6, both with a
 * modest band. diseaseCount defaults to nMaps so each disease gets its own map.
 */
function nMapOpts(seed: number, nMaps: number, over: Partial<GenOptions> = {}): GenOptions {
  const dims = nMaps >= 4 ? 6 : 7;
  return {
    seed,
    nMaps,
    width: dims,
    height: dims,
    catalog: DEFAULT_CATALOG,
    diseaseCount: nMaps,
    difficulty: { min: 3, max: 12 },
    ...over,
  };
}

describe("mapgen GenOptions validation", () => {
  const invalidScalars: readonly [string, (opts: GenOptions) => GenOptions, RegExp][] = [
    ["fractional seed", (opts) => ({ ...opts, seed: 1.5 }), /seed must be a safe integer/],
    ["unsafe seed", (opts) => ({ ...opts, seed: Number.MAX_SAFE_INTEGER + 1 }), /seed must be a safe integer/],
    ["negative seed", (opts) => ({ ...opts, seed: -1 }), /seed must be a uint32/],
    ["seed above uint32", (opts) => ({ ...opts, seed: 0x1_0000_0000 }), /seed must be a uint32/],
    ["fractional map count", (opts) => ({ ...opts, nMaps: 2.5 }), /nMaps must be a safe integer/],
    ["too few maps", (opts) => ({ ...opts, nMaps: 1 }), /nMaps must be between 2 and 4/],
    ["too many maps", (opts) => ({ ...opts, nMaps: 5 }), /nMaps must be between 2 and 4/],
    ["fractional width", (opts) => ({ ...opts, width: 8.5 }), /width must be a safe integer/],
    ["too-small width", (opts) => ({ ...opts, width: 2 }), /width must be at least 3/],
    ["fractional height", (opts) => ({ ...opts, height: 8.5 }), /height must be a safe integer/],
    ["too-small height", (opts) => ({ ...opts, height: 2 }), /height must be at least 3/],
    [
      "oversized map area",
      (opts) => ({ ...opts, width: MAX_MAP_CELLS, height: 3 }),
      /map area must not exceed/,
    ],
    ["fractional disease count", (opts) => ({ ...opts, diseaseCount: 1.5 }), /diseaseCount must be a safe integer/],
    ["empty disease set", (opts) => ({ ...opts, diseaseCount: 0 }), /diseaseCount must be positive/],
    ["too many diseases", (opts) => ({ ...opts, diseaseCount: opts.nMaps + 1 }), /diseaseCount must not exceed nMaps/],
    [
      "fractional minimum difficulty",
      (opts) => ({ ...opts, difficulty: { ...opts.difficulty, min: 4.5 } }),
      /difficulty.min must be a safe integer/,
    ],
    [
      "negative minimum difficulty",
      (opts) => ({ ...opts, difficulty: { ...opts.difficulty, min: -1 } }),
      /difficulty.min must be non-negative/,
    ],
    [
      "fractional maximum difficulty",
      (opts) => ({ ...opts, difficulty: { ...opts.difficulty, max: 12.5 } }),
      /difficulty.max must be a safe integer/,
    ],
    [
      "reversed difficulty range",
      (opts) => ({ ...opts, difficulty: { min: 12, max: 4 } }),
      /difficulty.max must be greater than or equal to difficulty.min/,
    ],
    [
      "excessive difficulty",
      (opts) => ({ ...opts, difficulty: { min: 0, max: 1_000_000 } }),
      /difficulty.max must not exceed/,
    ],
  ];

  it.each(invalidScalars)("rejects %s before generation", (_name, mutate, message) => {
    expect(() => generate(mutate(smallOpts(7)))).toThrowError(message);
  });

  it("accepts seed zero and an exact integer difficulty band", () => {
    const level = generate(smallOpts(0, { difficulty: { min: 8, max: 8 } }));
    expect(level.seed).toBe(0);
    expect(level.diseases.every((disease) => disease.difficulty === 8)).toBe(true);
  });

  it("canonicalizes negative zero to the unique uint32 zero seed", () => {
    const level = generate(smallOpts(-0));
    expect(level.seed).toBe(0);
    expect(Object.is(level.seed, -0)).toBe(false);
  });

  it("does not accept distinct numeric seeds that the uint32 RNG would alias", () => {
    expect(() => generate(smallOpts(14 + 0x1_0000_0000))).toThrow(/uint32/);
    expect(() => generate(smallOpts(-1))).toThrow(/uint32/);
  });

  it("rejects malformed catalog entries before constructing a level", () => {
    const base = smallOpts(11);
    const first = base.catalog[0]!;
    const dilute = base.catalog.find((entry) => entry.transform.kind === "scale")!;
    const swap = base.catalog.find((entry) => entry.transform.kind === "swap")!;
    const cases: readonly [string, readonly MachineCatalogEntry[], RegExp][] = [
      ["duplicate typeId", [...base.catalog, { ...first }], /duplicate typeId/],
      ["empty typeId", [{ ...first, typeId: "" }, ...base.catalog.slice(1)], /typeId must be a non-empty string/],
      ["negative cost", [{ ...first, cost: -1 }, ...base.catalog.slice(1)], /cost must be a non-negative safe integer/],
      ["fractional cost", [{ ...first, cost: 1.5 }, ...base.catalog.slice(1)], /cost must be a non-negative safe integer/],
      ["zero speed", [{ ...first, speed: 0 }, ...base.catalog.slice(1)], /speed must be a positive safe integer/],
      ["fractional speed", [{ ...first, speed: 1.5 }, ...base.catalog.slice(1)], /speed must be a positive safe integer/],
      [
        "fractional translate delta",
        [{ ...first, transform: { kind: "translate", delta: { x: 1.5, y: 0 }, relation: "forward" } }, ...base.catalog.slice(1)],
        /translate delta must use safe integers/,
      ],
      [
        "unknown translate relation",
        [{ ...first, transform: { kind: "translate", delta: { x: 1, y: 0 }, relation: "sideways" as never } }, ...base.catalog.slice(1)],
        /unknown translate relation/,
      ],
      [
        "oversized translate delta",
        [{ ...first, transform: { kind: "translate", delta: { x: 0x80000000, y: 0 }, relation: "forward" } }, ...base.catalog.slice(1)],
        /translate delta.*int32/,
      ],
      [
        "invalid scale ratio",
        base.catalog.map((entry) => entry === dilute ? { ...entry, transform: { kind: "scale", num: 2, den: 2 } } : entry),
        /scale requires safe integers satisfying 0 < num < den/,
      ],
      [
        "fractional scale ratio",
        base.catalog.map((entry) => entry === dilute ? { ...entry, transform: { kind: "scale", num: 0.5, den: 2 } } : entry),
        /scale requires safe integers satisfying 0 < num < den/,
      ],
      [
        "oversized scale ratio",
        base.catalog.map((entry) => entry === dilute ? { ...entry, transform: { kind: "scale", num: 1, den: 0x80000000 } } : entry),
        /scale requires safe integers satisfying 0 < num < den/,
      ],
      [
        "same-map swap",
        base.catalog.map((entry) => entry === swap ? { ...entry, transform: { kind: "swap", a: 0, b: 0 } } : entry),
        /swap requires distinct map indices/,
      ],
      [
        "out-of-range swap",
        base.catalog.map((entry) => entry === swap ? { ...entry, transform: { kind: "swap", a: 0, b: base.nMaps } } : entry),
        /swap index .* outside 0\.\./,
      ],
    ];

    for (const [name, catalog, message] of cases) {
      expect(() => generate({ ...base, catalog }), name).toThrowError(message);
    }
  });

  it("rejects an oversized catalog before scanning or allocating generation state", () => {
    const base = smallOpts(11);
    expect(() => generate({
      ...base,
      catalog: new Array(257).fill(base.catalog[0]),
    })).toThrow(/catalog must not exceed/i);
  });
});

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

function constructedDifficulty(steps: GeneratedLevel["diseases"][number]["reference"]["steps"]): number {
  const types = new Set(steps.map((step) => step.typeId));
  const diversityBonus = steps.length === 0 ? 0 : types.size - 1;
  const decouplingBonus = steps.some((step) => {
    const transform = step.transform;
    return (
      transform.kind === "swap" ||
      transform.kind === "scale" ||
      (transform.kind === "translate" && transform.relation !== "forward")
    );
  })
    ? 2
    : 0;
  return steps.length + diversityBonus + decouplingBonus;
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

// ───────────────────────────── N-map generation (N=3, N=4) ─────────────────────────────

describe("mapgen N-map generation (N=3, N=4)", () => {
  for (const nMaps of [3, 4]) {
    it(`generates valid, decoupling, deterministic levels at N=${nMaps} (several seeds)`, () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 50_000 }), (seed) => {
          const opts = nMapOpts(seed, nMaps);
          const level = generate(opts);
          const start = initialState(level.mm);

          // Right number of maps + diseases.
          expect(level.mm.maps.length).toBe(nMaps);
          expect(level.diseases.length).toBe(nMaps);

          // Distinct origins across ALL maps (the decoupling precondition).
          const origins = level.mm.maps.map((m) => `${m.origin.x},${m.origin.y}`);
          expect(new Set(origins).size).toBe(nMaps);

          // Diseases sit on distinct maps (round-robin onto its own map).
          const mapsUsed = level.diseases.map((d) => d.map);
          expect(new Set(mapsUsed).size).toBe(nMaps);

          let decoupling = 0;
          for (const d of level.diseases) {
            // INV-9: each reference cures, never fails, and its node carries the Cure.
            const out = evaluate(level.mm, start, d.reference);
            expect(out.failed).toBe(false);
            expect(out.cured).toContain(d.id);
            expect(cureAt(level, d.map, d.node.x, d.node.y, d.id)).toBe(true);

            // INV-11: difficulty in band.
            expect(d.difficulty).toBeGreaterThanOrEqual(opts.difficulty.min);
            expect(d.difficulty).toBeLessThanOrEqual(opts.difficulty.max);

            // Canonical solver agrees, and we count decoupling diseases.
            const sol = solve(level.mm, start, {
              catalog: opts.catalog,
              maxDepth: opts.difficulty.max + 2,
              targets: [d.id],
            });
            expect(sol).not.toBeNull();
            if (sol !== null && solutionDecouples(sol)) decoupling += 1;
          }

          // Cross-map tension predicate: ≥1 disease's canonical solution decouples.
          expect(decoupling).toBeGreaterThanOrEqual(1);

          // INV-10: regeneration is field-equal (all N maps) + identical diseases.
          const again = generate(opts);
          expect(multiMapFieldEqual(level.mm, again.mm)).toBe(true);
          expect(level.diseases).toEqual(again.diseases);
          expect(level.start).toEqual(again.start);
        }),
        { numRuns: nMaps >= 4 ? 6 : 8 },
      );
    });
  }
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

  it("difficulty and price are derived from the constructed reference", () => {
    const opts = smallOpts(777);
    const level = generate(opts);
    for (const d of level.diseases) {
      const cost = d.reference.steps.reduce((sum, step) => {
        const entry = opts.catalog.find((candidate) => candidate.typeId === step.typeId);
        expect(entry).toBeDefined();
        return sum + entry!.cost;
      }, 0);
      expect(d.difficulty).toBe(constructedDifficulty(d.reference.steps));
      expect(d.basePrice).toBe(difficultyToBasePrice(d.difficulty, cost));
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
  function exactPriceOracle(difficulty: number, refCost: number): bigint {
    const exponent = BigInt(difficulty);
    const numerator = 10n * 17n ** exponent;
    const denominator = 10n ** exponent;
    const roundedDifficultyPrice = (2n * numerator + denominator) / (2n * denominator);
    return roundedDifficultyPrice + 3n * BigInt(refCost);
  }

  it("uses the exact 17/10 rational curve across the supported difficulty range", () => {
    for (let difficulty = 0; difficulty <= MAX_GENERATION_DIFFICULTY; difficulty++) {
      for (const refCost of [0, 1, 7, 200, 1_000_000_000]) {
        expect(difficultyToBasePrice(difficulty, refCost)).toBe(
          Number(exactPriceOracle(difficulty, refCost)),
        );
      }
    }
  });

  it("keeps the legacy floating-point outputs unchanged in the active 0..30 range", () => {
    for (let difficulty = 0; difficulty <= 30; difficulty++) {
      for (const refCost of [0, 1, 7, 200]) {
        const legacy = Math.round(10 * Math.pow(1.7, difficulty) + 3 * refCost);
        expect(difficultyToBasePrice(difficulty, refCost)).toBe(legacy);
      }
    }
  });

  it("does not derive prices from floating-point exponentiation", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Math\.pow\s*\(/);
    expect(source).not.toMatch(/\b1\.7\b/);
  });

  it("rejects invalid inputs and outputs outside the safe-integer range", () => {
    for (const difficulty of [NaN, Infinity, 1.5]) {
      expect(() => difficultyToBasePrice(difficulty, 0)).toThrow(/difficulty must be a safe integer/);
    }
    expect(() => difficultyToBasePrice(-1, 0)).toThrow(/difficulty must be non-negative/);
    expect(() => difficultyToBasePrice(MAX_GENERATION_DIFFICULTY + 1, 0)).toThrow(
      /difficulty must not exceed/,
    );

    for (const refCost of [NaN, Infinity, 1.5]) {
      expect(() => difficultyToBasePrice(0, refCost)).toThrow(/refCost must be a safe integer/);
    }
    expect(() => difficultyToBasePrice(0, -1)).toThrow(/refCost must be non-negative/);

    const difficultyPrice = exactPriceOracle(MAX_GENERATION_DIFFICULTY, 0);
    const maxRefCost = Number(
      (BigInt(Number.MAX_SAFE_INTEGER) - difficultyPrice) / 3n,
    );
    expect(Number.isSafeInteger(maxRefCost)).toBe(true);
    expect(difficultyToBasePrice(MAX_GENERATION_DIFFICULTY, maxRefCost)).toBe(
      Number(exactPriceOracle(MAX_GENERATION_DIFFICULTY, maxRefCost)),
    );
    expect(() =>
      difficultyToBasePrice(MAX_GENERATION_DIFFICULTY, maxRefCost + 1),
    ).toThrow(/base price exceeds the safe-integer range/);
  });

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
  it("constructs a tense level with the starter catalog (no skew or dilute)", () => {
    const starterCatalog = DEFAULT_CATALOG.filter(
      (entry) => entry.typeId !== "skew" && entry.typeId !== "dilute",
    );
    for (let seed = 0; seed < 10; seed++) {
      const opts = smallOpts(seed, { catalog: starterCatalog });
      const level = generate(opts);
      const start = initialState(level.mm);
      for (const disease of level.diseases) {
        const outcome = evaluate(level.mm, start, disease.reference);
        expect(outcome.failed).toBe(false);
        expect(outcome.cured).toContain(disease.id);
        const oracle = solve(level.mm, start, {
          catalog: starterCatalog,
          maxDepth: opts.difficulty.max + 2,
          targets: [disease.id],
        });
        expect(oracle).not.toBeNull();
        expect(solutionDecouples(oracle!)).toBe(true);
      }
    }
  });

  it("throws when the catalog has no positive +x/+y translate movers", () => {
    // Only a swap machine: no way to construct an axis-aligned reference.
    const swapOnly: readonly MachineCatalogEntry[] = [
      {
        typeId: "swap01",
        transform: { kind: "swap", a: 0, b: 1 },
        cost: 1,
        speed: 1,
        orientable: false,
      },
    ];
    expect(() => generate(smallOpts(1, { catalog: swapOnly }))).toThrowError(/movers/);
  });
});
