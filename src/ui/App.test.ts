import { describe, expect, it } from "vitest";
import type { EffectMap, MultiMap } from "../sim/phase0_interfaces";
import { recipeCandidateFailedAtInsertion, validateLabFogAuthority, withFog } from "./App";

function map(size: number): EffectMap {
  return {
    width: size,
    height: size,
    origin: { x: 1, y: 1 },
    start: { x: 1, y: 1 },
    cell: new Uint8Array(size * size),
    cureId: new Int16Array(size * size).fill(-1),
    sideEffectId: new Int32Array(size * size).fill(-1),
    fog: new Uint8Array(size * size),
  };
}

describe("Lab fog authority", () => {
  const mm: MultiMap = { maps: [map(3)] };

  it("accepts an exact per-layer fog shape", () => {
    expect(validateLabFogAuthority(mm, [new Uint8Array(9)])).toBeNull();
  });

  it("reports layer count and cell-count mismatches instead of falling back", () => {
    expect(validateLabFogAuthority(mm, [])).toMatch(/layer count/i);
    expect(validateLabFogAuthority(mm, [new Uint8Array(8)])).toMatch(/layer A/i);
  });

  it("creates a fully revealed render copy without mutating persistent fog", () => {
    const fog = new Uint8Array(9);
    const rendered = withFog(mm, [fog], true);
    expect([...rendered.maps[0]!.fog]).toEqual(new Array(9).fill(1));
    expect([...fog]).toEqual(new Array(9).fill(0));
  });
});

describe("Recipe candidate failure marker", () => {
  it("marks only a held machine that itself fails at its active insertion slot", () => {
    expect(recipeCandidateFailedAtInsertion(1, 1, 1)).toBe(true);
    expect(recipeCandidateFailedAtInsertion(0, 1, 0)).toBe(false);
    expect(recipeCandidateFailedAtInsertion(2, 1, 2)).toBe(false);
    expect(recipeCandidateFailedAtInsertion(1, 1, null)).toBe(false);
  });
});
