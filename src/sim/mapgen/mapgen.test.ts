import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { ESLint } from "eslint";
import type {
  GenOptions,
  GeneratedLevel,
  MultiMap,
  MachineCatalogEntry,
} from "../phase0_interfaces";
import { CellKind, DEFAULT_CATALOG } from "../phase0_interfaces";
import { applyStep, initialState, evaluate } from "../drug-graph";
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
 * Test-friendly options: compact maps that still fit the current catalog's
 * multi-cell movement scale + a broad constructive difficulty band. The
 * (W·H)^N solver checks stay fast while exercising multi-map generation.
 */
function smallOpts(seed: number, over: Partial<GenOptions> = {}): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 16,
    height: 16,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 2, max: 6 },
    ...over,
  };
}

/**
 * N-map options. The solver is a BFS over (W·H)^N, so map size must shrink as N
 * grows to keep the per-attempt re-checks fast. A 9×9 map gives every phase start
 * room for at least one current-catalog axis move; the low band keeps solver checks
 * shallow. diseaseCount defaults to nMaps so each disease gets its own map.
 */
function nMapOpts(seed: number, nMaps: number, over: Partial<GenOptions> = {}): GenOptions {
  const dims = 9;
  return {
    seed,
    nMaps,
    width: dims,
    height: dims,
    catalog: DEFAULT_CATALOG,
    diseaseCount: nMaps,
    difficulty: { min: 1, max: 4 },
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
    ["too few maps", (opts) => ({ ...opts, nMaps: 0 }), /nMaps must be between 1 and 4/],
    ["too many maps", (opts) => ({ ...opts, nMaps: 5 }), /nMaps must be between 1 and 4/],
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
    const level = generate(smallOpts(0, { difficulty: { min: 4, max: 4 } }));
    expect(level.seed).toBe(0);
    expect(level.diseases.every((disease) => disease.difficulty === 4)).toBe(true);
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
        base.catalog.map((entry) => entry === swap ? { ...entry, transform: { kind: "swap", a: 0, b: 4 } } : entry),
        /swap index .* outside supported range 0\.\.3/,
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

describe("mapgen centered single-map progression", () => {
  it("starts a 63×63 map at its exact center and scales toward that same center", () => {
    const level = generate({
      seed: 42,
      nMaps: 1,
      width: 63,
      height: 63,
      catalog: DEFAULT_CATALOG,
      diseaseCount: 1,
      difficulty: { min: 2, max: 12 },
    });

    expect(level.mm.maps).toHaveLength(1);
    expect(level.mm.maps[0]!.start).toEqual({ x: 31, y: 31 });
    expect(level.mm.maps[0]!.origin).toEqual({ x: 31, y: 31 });
    expect(level.start.pos).toEqual([{ x: 31, y: 31 }]);
    expect(level.diseases[0]!.reference.steps.every((step) => step.transform.kind !== "swap")).toBe(true);
    expect(evaluate(level.mm, level.start, level.diseases[0]!.reference).cured).toContain(0);
  });

  it("constructs deterministic one- and multi-map levels without any swap machine", () => {
    const catalog = DEFAULT_CATALOG.filter((entry) => entry.transform.kind !== "swap");
    for (const nMaps of [1, 2, 3, 4]) {
      const opts = nMapOpts(2026, nMaps, {
        catalog,
        diseaseCount: nMaps,
        difficulty: { min: 2, max: 10 },
      });
      const a = generate(opts);
      const b = generate(opts);
      expect(multiMapFieldEqual(a.mm, b.mm)).toBe(true);
      expect(a.diseases).toEqual(b.diseases);
      const center = { x: Math.floor(opts.width / 2), y: Math.floor(opts.height / 2) };
      expect(a.mm.maps[0]!.start).toEqual(center);
      expect(new Set(a.mm.maps.map((map) => `${map.start.x},${map.start.y}`)).size).toBe(nMaps);
      for (const map of a.mm.maps) expect(map.origin).toEqual(center);
      for (const disease of a.diseases) {
        expect(disease.reference.steps.every((step) => step.transform.kind !== "swap")).toBe(true);
        expect(evaluate(a.mm, a.start, disease.reference).cured).toContain(disease.id);
        expect(disease.difficulty).toBeGreaterThanOrEqual(opts.difficulty.min);
        expect(disease.difficulty).toBeLessThanOrEqual(opts.difficulty.max);
      }
    }
  });

  it("allows future-layer swaps in a one-map catalog but never emits an unusable reference", () => {
    const opts = nMapOpts(7, 1, {
      width: 15,
      height: 15,
      diseaseCount: 1,
      difficulty: { min: 2, max: 8 },
    });
    const level = generate(opts);
    expect(level.diseases[0]!.reference.steps.some((step) => step.transform.kind === "swap")).toBe(false);
  });
});

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

function featureComponentSizes(
  level: GeneratedLevel,
  mapIndex: number,
  kind: CellKind,
  cureId?: number,
): number[] {
  const map = level.mm.maps[mapIndex];
  if (map === undefined) return [];
  const visited = new Uint8Array(map.cell.length);
  const queue = new Int32Array(map.cell.length);
  const sizes: number[] = [];
  const matches = (index: number): boolean =>
    map.cell[index] === kind && (cureId === undefined || map.cureId[index] === cureId);

  for (let start = 0; start < map.cell.length; start++) {
    if (visited[start] === 1 || !matches(start)) continue;
    let head = 0;
    let tail = 0;
    let size = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++]!;
      size++;
      const x = current % map.width;
      const y = Math.floor(current / map.width);
      const neighbors = [
        x + 1 < map.width ? current + 1 : -1,
        y + 1 < map.height ? current + map.width : -1,
        x > 0 ? current - 1 : -1,
        y > 0 ? current - map.width : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || visited[next] === 1 || !matches(next)) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
    sizes.push(size);
  }
  return sizes;
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

  it("grows every disease into a 5–9-cell connected cure region containing its reference node", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), (seed) => {
        const level = generate(smallOpts(seed));
        for (const disease of level.diseases) {
          const sizes = featureComponentSizes(level, disease.map, CellKind.Cure, disease.id);
          expect(sizes).toHaveLength(1);
          expect(sizes[0]).toBeGreaterThanOrEqual(5);
          expect(sizes[0]).toBeLessThanOrEqual(9);
          expect(cureAt(level, disease.map, disease.node.x, disease.node.y, disease.id)).toBe(true);
          const outcome = evaluate(level.mm, level.start, disease.reference);
          expect(outcome.failed).toBe(false);
          expect(outcome.cured).toContain(disease.id);
        }
      }),
      { numRuns: 40 },
    );
  });
});

// ────────────── centered multi-map progression ──────────────

describe("mapgen centered multi-map progression", () => {
  it("does not force swap into every multi-map reference", () => {
    const level = generate(smallOpts(99));
    expect(level.diseases.some((disease) =>
      disease.reference.steps.every((step) => step.transform.kind !== "swap"),
    )).toBe(true);
  });

  it("keeps layer A centered while later phase layers start at distinct nearby coordinates", () => {
    const level = generate(nMapOpts(99, 4, { width: 63, height: 63 }));
    expect(level.mm.maps.map((map) => map.start)).toEqual([
      { x: 31, y: 31 },
      { x: 38, y: 31 },
      { x: 31, y: 38 },
      { x: 24, y: 31 },
    ]);
    for (const map of level.mm.maps) expect(map.origin).toEqual({ x: 31, y: 31 });
  });

  it("makes phase exchange change the A/B coordinates after layer B is unlocked", () => {
    const level = generate(nMapOpts(99, 2, { width: 63, height: 63 }));
    const exchange = DEFAULT_CATALOG.find((entry) => entry.typeId === "swap01");
    if (exchange === undefined) throw new Error("missing phase exchange fixture");
    const before = initialState(level.mm);
    const after = applyStep(level.mm, before, {
      typeId: exchange.typeId,
      transform: exchange.transform,
      orientation: { rot: 0, flip: false },
    });
    expect(after.pos).toEqual([before.pos[1], before.pos[0]]);
    expect(after.pos).not.toEqual(before.pos);
  });

  it("gives phase exchange a real alternate-recipe use on the generated seed-14 atlas", () => {
    const level = generate(nMapOpts(14, 2, {
      width: 63,
      height: 63,
      diseaseCount: 2,
      difficulty: { min: 4, max: 12 },
    }));
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push");
    const push2 = DEFAULT_CATALOG.find((entry) => entry.typeId === "push2");
    const exchange = DEFAULT_CATALOG.find((entry) => entry.typeId === "swap01");
    if (push === undefined || push2 === undefined || exchange === undefined) {
      throw new Error("missing phase recipe fixture");
    }
    const movement = [push, push2, push2].map((entry) => ({
      typeId: entry.typeId,
      transform: entry.transform,
      orientation: { rot: 0 as const, flip: false },
    }));
    const withoutExchange = evaluate(level.mm, level.start, { steps: movement });
    const withExchange = evaluate(level.mm, level.start, {
      steps: [...movement, {
        typeId: exchange.typeId,
        transform: exchange.transform,
        orientation: { rot: 0, flip: false },
      }],
    });
    expect(withoutExchange.cured).toEqual([]);
    expect(withExchange.cured).toContain(0);
  });
});

// ───────────────────────────── N-map generation (N=3, N=4) ─────────────────────────────

describe("mapgen N-map generation (N=3, N=4)", () => {
  for (const nMaps of [3, 4]) {
    it(`generates valid centered deterministic levels at N=${nMaps} (several seeds)`, () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 50_000 }), (seed) => {
          const opts = nMapOpts(seed, nMaps);
          const level = generate(opts);
          const start = initialState(level.mm);

          // Right number of maps + diseases.
          expect(level.mm.maps.length).toBe(nMaps);
          expect(level.diseases.length).toBe(nMaps);

          // Layer A starts at the center; later layers use distinct phase offsets.
          const center = { x: Math.floor(opts.width / 2), y: Math.floor(opts.height / 2) };
          expect(level.mm.maps[0]!.start).toEqual(center);
          expect(new Set(level.mm.maps.map((map) => `${map.start.x},${map.start.y}`)).size).toBe(nMaps);
          for (const map of level.mm.maps) expect(map.origin).toEqual(center);

          // Diseases sit on distinct maps (round-robin onto its own map).
          const mapsUsed = level.diseases.map((d) => d.map);
          expect(new Set(mapsUsed).size).toBe(nMaps);

          for (const d of level.diseases) {
            // INV-9: each reference cures, never fails, and its node carries the Cure.
            const out = evaluate(level.mm, start, d.reference);
            expect(out.failed).toBe(false);
            expect(out.cured).toContain(d.id);
            expect(cureAt(level, d.map, d.node.x, d.node.y, d.id)).toBe(true);

            // INV-11: difficulty in band.
            expect(d.difficulty).toBeGreaterThanOrEqual(opts.difficulty.min);
            expect(d.difficulty).toBeLessThanOrEqual(opts.difficulty.max);

            // Canonical solver still agrees with the constructive reference.
            const sol = solve(level.mm, start, {
              catalog: opts.catalog,
              maxDepth: opts.difficulty.max + 2,
              targets: [d.id],
            });
            expect(sol).not.toBeNull();
          }

          // At least one reference remains usable without a phase swap.
          expect(level.diseases.some((disease) =>
            disease.reference.steps.every((step) => step.transform.kind !== "swap"),
          )).toBe(true);

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
    const level = generate(smallOpts(0, { difficulty: { min: 4, max: 4 } }));
    for (const d of level.diseases) {
      expect(d.difficulty).toBe(4);
    }
  });

  it("throws a seed+range error when no level can satisfy the band", () => {
    // A tiny 5x5 grid cannot host a difficulty-30+ outward path ⇒ a clear
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

  it("places walls, hazards, and side effects as connected regions instead of isolated scatter", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 500_000 }), (seed) => {
        const level = generate({
          ...smallOpts(seed),
          width: 24,
          height: 24,
          difficulty: { min: 4, max: 12 },
        });
        for (let mapIndex = 0; mapIndex < level.mm.maps.length; mapIndex++) {
          for (const kind of [CellKind.Wall, CellKind.Hazard, CellKind.SideEffect]) {
            const sizes = featureComponentSizes(level, mapIndex, kind);
            expect(sizes).toHaveLength(1);
            expect(sizes[0]).toBeGreaterThanOrEqual(3);
          }
        }
      }),
      { numRuns: 30 },
    );
  });
});

// ───────────────────────────── catalog guard ─────────────────────────────

describe("mapgen catalog requirements", () => {
  it("constructs solvable levels with the starter catalog (no skew or dilute)", () => {
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
        expect(disease.reference.steps.every((step) => step.transform.kind !== "swap")).toBe(true);
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
