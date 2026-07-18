import { describe, expect, it } from "vitest";
import type { EffectMap, MultiMap } from "../sim/phase0_interfaces";
import {
  labPointerToViewport,
  researchFocusTarget,
  researchKnownCureLabel,
  researchKnownCureCount,
  researchKnownCureLocations,
  researchPointerMoved,
  researchPointerAction,
  researchPreviewEndpointHit,
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

  it("counts distinct Cure IDs only through authoritative revealed cells", () => {
    const cureMap = map(3);
    cureMap.cureId[0] = 2;
    cureMap.cureId[1] = 2;
    cureMap.cureId[2] = 3;
    const fog = new Uint8Array(9);
    fog[0] = 1;

    expect(researchKnownCureCount({ maps: [cureMap] }, [fog])).toBe(1);
    fog[1] = 1;
    expect(researchKnownCureCount({ maps: [cureMap] }, [fog])).toBe(1);
    fog[2] = 1;
    expect(researchKnownCureCount({ maps: [cureMap] }, [fog])).toBe(2);
  });

  it("returns one focus target per known Cure without leaking hidden regions", () => {
    const cureMap = map(3);
    cureMap.cureId[0] = 7;
    cureMap.cureId[1] = 7;
    cureMap.cureId[7] = 4;
    cureMap.cureId[8] = 9;
    const fog = new Uint8Array(9);
    fog[1] = 1;
    fog[7] = 1;

    expect(researchKnownCureLocations({ maps: [cureMap] }, [fog])).toEqual([
      { mapIndex: 0, cureId: 7, pos: { x: 1, y: 0 } },
      { mapIndex: 0, cureId: 4, pos: { x: 1, y: 2 } },
    ]);
  });

  it("labels only the revealed Cure count without exposing the hidden total", () => {
    expect(researchKnownCureLabel(0)).toBe("Cure sites 0");
    expect(researchKnownCureLabel(3)).toBe("Cure sites 3");
    expect(researchKnownCureLabel(3)).not.toContain("/");
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

  it("commits only on the candidate endpoint while preserving right-click erase", () => {
    expect(researchPointerAction(0, false, true, "commit")).toBe("place");
    expect(researchPointerAction(0, false, false, "commit")).toBeNull();
    expect(researchPointerAction(2, false, false, "commit")).toBe("erase");
    expect(researchPointerAction(0, true, true, "commit")).toBeNull();
    expect(researchPointerAction(1, false, true, "commit")).toBeNull();
  });

  it("never commits a canceled pointer gesture", () => {
    expect(researchPointerAction(0, false, true, "cancel")).toBeNull();
    expect(researchPointerAction(2, false, false, "cancel")).toBeNull();
  });

  it("uses the visible candidate token as the direct commit target", () => {
    expect(researchPreviewEndpointHit(
      { x: 12.92, y: 8.2 },
      { x: 12, y: 8 },
    )).toBe(true);
    expect(researchPreviewEndpointHit(
      { x: 12.2, y: 8.2 },
      { x: 12, y: 8 },
    )).toBe(true);
    expect(researchPreviewEndpointHit(
      { x: 11.9, y: 8.5 },
      { x: 12, y: 8 },
    )).toBe(false);
    expect(researchPreviewEndpointHit({ x: 12.5, y: 8.5 }, undefined)).toBe(false);
  });

  it("labels planning focus as Next and active-shot focus as Dose", () => {
    const dose = { pos: [{ x: 3, y: 4 }], failed: false };
    const candidate = { pos: [{ x: 12, y: 9 }], failed: false };

    expect(researchFocusTarget(dose, candidate, 0, false)).toEqual({
      label: "Next",
      position: { x: 12, y: 9 },
    });
    expect(researchFocusTarget(dose, candidate, 0, true)).toEqual({
      label: "Dose",
      position: { x: 3, y: 4 },
    });
    expect(researchFocusTarget(dose, undefined, 0, false)).toEqual({
      label: "Dose",
      position: { x: 3, y: 4 },
    });
  });

  it("classifies a drag by total displacement rather than only its latest tiny move", () => {
    expect(researchPointerMoved(10, 10, 12, 12)).toBe(false);
    expect(researchPointerMoved(10, 10, 14, 12)).toBe(false);
    expect(researchPointerMoved(10, 10, 16, 12)).toBe(true);
    expect(researchPointerMoved(10, 10, 20, 10)).toBe(true);
  });
});
