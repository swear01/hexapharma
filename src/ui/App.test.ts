import { describe, expect, it } from "vitest";
import type { EffectMap, MultiMap } from "../sim/phase0_interfaces";
import { validateLabFogAuthority, withFog } from "./App";

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

  it("overlays the authoritative persistent fog without a reveal-all bypass", () => {
    const fog = new Uint8Array(9);
    fog[4] = 1;
    const rendered = withFog(mm, [fog]);
    expect([...rendered.maps[0]!.fog]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect([...fog]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });
});
