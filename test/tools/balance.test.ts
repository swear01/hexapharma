import { describe, expect, it, vi } from "vitest";
import { generate } from "../../src/sim/mapgen";
import {
  MAX_BALANCE_SEEDS,
  minMax,
  parseBalanceArgs,
  referenceCost,
  runBalance,
  sweep,
  sweepExitCode,
} from "../../tools/balance";

describe("balance tool failure boundaries", () => {
  it("reports min/max for the maximum two-disease sample count without argument spreading", () => {
    const values = Array.from({ length: MAX_BALANCE_SEEDS * 2 }, (_, index) => index - 50);
    expect(minMax(values)).toEqual({ min: -50, max: MAX_BALANCE_SEEDS * 2 - 51 });
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
    expect(result.samples).toHaveLength(2);
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
});
