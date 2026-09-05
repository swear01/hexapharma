import { describe, expect, it } from "vitest";
import {
  PROGRESSION_RETRY_BUDGET,
  PROGRESSION_SEEDS,
  REFERENCE_PROGRESSION_SEEDS,
  progressionExitCode,
  progressionLedger,
} from "../../tools/progression-ledger";

describe("four-disease progression ledger", () => {
  it.each(PROGRESSION_SEEDS)("completes the legal reference route for seed %i", (seed) => {
    const ledger = progressionLedger(seed);
    expect(ledger, ledger.blockedAction ?? "completed").toMatchObject({
      completed: true,
      blockedAction: null,
    });
    expect(ledger.entries).toHaveLength(4);
    expect(ledger.completedContracts).toBe(4);
    expect(ledger.everyDiseasePositiveNet).toBe(true);
    expect(ledger.entries.every((entry) => entry.net > 0 && entry.sold >= 3)).toBe(true);
    expect(ledger.minimumCash).toBeGreaterThanOrEqual(PROGRESSION_RETRY_BUDGET);
  }, 60_000);

  it.each(REFERENCE_PROGRESSION_SEEDS)("keeps the original seed %i route legal after a $100 retry", (seed) => {
    expect(progressionLedger(seed, 1_000 - PROGRESSION_RETRY_BUDGET).completed).toBe(true);
  }, 60_000);

  it("makes the CLI fail for a blocked route or exhausted reserve", () => {
    const valid = progressionLedger(14);
    expect(progressionExitCode([valid])).toBe(0);
    expect(progressionExitCode([{ ...valid, completed: false, blockedAction: "blocked" }])).toBe(1);
    expect(progressionExitCode([{ ...valid, minimumCash: PROGRESSION_RETRY_BUDGET - 1 }])).toBe(1);
  });

});
