import { beforeAll, describe, expect, it, vi } from "vitest";
import { generate } from "../../src/sim/mapgen";
import { DEFAULT_CATALOG } from "../../src/sim/phase0_interfaces";
import {
  MAX_BALANCE_SEEDS,
  BALANCE_CONFIG,
  bootstrapFailures,
  diversityFailures,
  puzzleQualityFailures,
  minMax,
  parseBalanceArgs,
  referenceCost,
  runBalance,
  sweep,
  sweepExitCode,
} from "../../tools/balance";

describe("balance tool failure boundaries", () => {
  let representativeResult!: ReturnType<typeof sweep>;

  beforeAll(() => {
    representativeResult = sweep(2);
  }, 60_000);

  it("uses and reports the representative active one-Atlas configuration", () => {
    expect(BALANCE_CONFIG).toEqual({
      nMaps: 1,
      width: 63,
      height: 63,
      diseaseCount: 4,
      difficulty: { min: 4, max: 12 },
    });
  });

  it("reports min/max for the maximum four-disease sample count without argument spreading", () => {
    const values = Array.from({ length: MAX_BALANCE_SEEDS * 4 }, (_, index) => index - 50);
    expect(minMax(values)).toEqual({ min: -50, max: MAX_BALANCE_SEEDS * 4 - 51 });
  });

  it("rejects trailing CLI arguments", () => {
    expect(() => parseBalanceArgs(["100", "unexpected"])).toThrow(/unexpected arguments/i);
    expect(parseBalanceArgs([])).toBe(100);
  });

  it("rejects impractically large sweeps before entering the seed loop", () => {
    const generateLevel = vi.fn(generate);
    expect(() => sweep(MAX_BALANCE_SEEDS + 1, { generate: generateLevel })).toThrow(
      /1 to 100000/,
    );
    expect(generateLevel).not.toHaveBeenCalled();
  });
  it("throws for an unknown reference machine instead of pricing it at zero", () => {
    expect(() => referenceCost([{ typeId: "unknown-machine" }])).toThrow(
      /unknown machine type.*unknown-machine/,
    );
  });

  it("continues after a seed generation failure but returns a failing result", () => {
    const result = sweep(2, {
      generate: (options) => {
        if (options.seed === 2) throw new Error("synthetic generation failure");
        return generate(options);
      },
    });
    expect(result.samples).toHaveLength(4);
    expect(result.failed).toEqual([{ seed: 2, error: "synthetic generation failure" }]);
    expect(sweepExitCode(result)).toBe(1);
  });

  it("returns a nonzero CLI result when only part of the report failed", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const exitCode = runBalance(2, {
        generate: (options) => {
          if (options.seed === 2) throw new Error("synthetic partial failure");
          return generate(options);
        },
      });
      expect(exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith("FAILED seed=2: synthetic partial failure");
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it("collects analysis failures for every seed and cannot exit successfully", () => {
    let generated = 0;
    const result = sweep(3, {
      generate: (options) => {
        generated += 1;
        return generate(options);
      },
      analyzeThroughput: () => {
        throw new Error("synthetic analysis failure");
      },
    });
    expect(generated).toBe(3);
    expect(result.samples).toHaveLength(0);
    expect(result.failed).toEqual([
      { seed: 1, error: "synthetic analysis failure" },
      { seed: 2, error: "synthetic analysis failure" },
      { seed: 3, error: "synthetic analysis failure" },
    ]);
    expect(sweepExitCode(result)).toBe(1);
  });

  it("fails a sufficiently large sweep when seeds repeat references and cure sets", () => {
    const repeated = generate({
      seed: 1,
      ...BALANCE_CONFIG,
      catalog: DEFAULT_CATALOG,
    });
    const result = sweep(8, {
      generate: () => repeated,
      solve: (_mm, _start, options) => {
        const disease = repeated.diseases.find((candidate) => candidate.id === options.targets[0]);
        if (disease === undefined) return null;
        return {
          template: disease.reference,
          difficulty: disease.difficulty,
          cost: referenceCost(disease.reference.steps),
        };
      },
    });
    expect(diversityFailures(result)).toEqual(expect.arrayContaining([
      expect.stringMatching(/reference diversity/i),
      expect.stringMatching(/cure-set diversity/i),
      expect.stringMatching(/cross-seed cure/i),
    ]));
    expect(sweepExitCode(result)).toBe(1);
  }, 60_000);

  it("reports minimum-solution gaps and a viable disease-zero bootstrap", () => {
    const result = representativeResult;
    expect(result.failed).toEqual([]);
    expect(result.samples).toHaveLength(8);
    for (const sample of result.samples) {
      expect(sample.solverMinSteps).toBeGreaterThanOrEqual(1);
      expect(sample.solverMinSteps).toBeLessThanOrEqual(sample.refSteps);
      expect(sample.referenceGap).toBe(sample.refSteps - sample.solverMinSteps);
      expect(sample.solverMinCost).toBeLessThanOrEqual(sample.cost);
      expect(sample.referenceCostGap).toBe(sample.cost - sample.solverMinCost);
    }
    expect(result.bootstraps).toHaveLength(2);
    expect(result.diversity.worstCrossSeedComparisons).toBe(1);
    expect(result.diversity.worstCrossSeedCures).toBeLessThanOrEqual(1);
    expect(result.diversity.worstCrossSeedTargetDiseaseHits).toHaveLength(
      BALANCE_CONFIG.diseaseCount,
    );
    for (const bootstrap of result.bootstraps) {
      expect(bootstrap.researchCost + bootstrap.constructionQuote).toBe(bootstrap.bootstrapCash);
      expect(bootstrap.startingCash).toBeGreaterThanOrEqual(bootstrap.bootstrapCash);
      expect(bootstrap.firstUnitCleanNet).toBeGreaterThan(0);
      expect(bootstrap.canReachFirstSale).toBe(true);
    }
    expect(bootstrapFailures(result)).toEqual([]);
    expect(puzzleQualityFailures(result).every((failure) => failure.includes("seed="))).toBe(true);
  }, 60_000);

  it("fails structurally trivial cures but keeps large reference gaps informational", () => {
    const result = representativeResult;
    const sample = result.samples[0]!;
    const trivial = {
      ...result,
      samples: [{ ...sample, solverMinSteps: 1 }, ...result.samples.slice(1)],
    };
    expect(puzzleQualityFailures(trivial)).toEqual(expect.arrayContaining([
      expect.stringMatching(/trivial cure/i),
    ]));
    expect(sweepExitCode(trivial)).toBe(1);

    const tuningOnly = {
      ...result,
      samples: [{
        ...sample,
        refSteps: 8,
        solverMinSteps: 2,
        referenceGap: 6,
      }, ...result.samples.slice(1)],
    };
    expect(puzzleQualityFailures(tuningOnly)).toEqual(expect.arrayContaining([
      expect.stringMatching(/extreme reference gap/i),
    ]));
    expect(sweepExitCode(tuningOnly)).toBe(0);
  }, 60_000);
});
