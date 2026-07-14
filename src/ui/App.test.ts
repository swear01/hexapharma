import { describe, expect, it } from "vitest";
import type { EffectMap, MultiMap } from "../sim/phase0_interfaces";
import {
  labPointerToViewport,
  researchPointerMoved,
  researchPointerAction,
  validateLabFogAuthority,
  withFog,
} from "./App";

function map(size: number): EffectMap {
  return {
    width: size,
    height: size,
    origin: { x: 1, y: 1 },
    start: { x: 1, y: 1 },
    cell: new Uint8Array(size * size),
    cureId: new Int16Array(size * size).fill(-1),
    sideEffectId: new Int32Array(size * size).fill(-1),
    portalTo: new Int32Array(size * size).fill(-1),
    fog: new Uint8Array(size * size),
  };
}

describe("Lab fog authority", () => {
  const mm: MultiMap = { maps: [map(3)] };

  it("accepts an exact per-layer fog shape", () => {
    expect(validateLabFogAuthority(mm, [new Uint8Array(9)])).toBeNull();
  });

  it("reports layer count and cell-count mismatches instead of falling back", () => {
    expect(validateLabFogAuthority(mm, [])).toMatch(/one Atlas/i);
    expect(validateLabFogAuthority(mm, [new Uint8Array(8)])).toMatch(/the Atlas/i);
  });

  it("rejects multi-map authority instead of exposing layer tabs", () => {
    const legacy: MultiMap = { maps: [map(3), map(3)] };
    expect(validateLabFogAuthority(legacy, [new Uint8Array(9), new Uint8Array(9)]))
      .toMatch(/single Research Atlas/i);
  });

  it("overlays the authoritative persistent fog without a reveal-all bypass", () => {
    const fog = new Uint8Array(9);
    fog[4] = 1;
    const rendered = withFog(mm, [fog]);
    expect([...rendered.maps[0]!.fog]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    expect([...fog]).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });
});

describe("Lab pointer projection", () => {
  it("maps a pointer through a uniformly scaled, horizontally cropped canvas", () => {
    expect(labPointerToViewport(195, 322, {
      left: -130,
      top: 66,
      width: 650,
      height: 512,
    })).toEqual({ x: 416, y: 256 });
  });

  it("maps click-to-place and right-click-to-erase without firing after a pan", () => {
    expect(researchPointerAction(0, false)).toBe("place");
    expect(researchPointerAction(2, false)).toBe("erase");
    expect(researchPointerAction(0, true)).toBeNull();
    expect(researchPointerAction(1, false)).toBeNull();
  });

  it("classifies a drag by total displacement rather than only its latest tiny move", () => {
    expect(researchPointerMoved(10, 10, 12, 12)).toBe(false);
    expect(researchPointerMoved(10, 10, 14, 12)).toBe(true);
    expect(researchPointerMoved(10, 10, 20, 10)).toBe(true);
  });
});
