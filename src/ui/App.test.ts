import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EffectMap, MultiMap } from "../sim/phase0_interfaces";
import { applyTemplate } from "../sim/drug-graph";
import { generate } from "../sim/mapgen";
import { defaultGenOptions, researchRoute } from "./Game";
import { focusLabCamera } from "../render/labCamera";
import {
  labPointerToViewport,
  researchDrugPoint,
  researchFitCamera,
  researchTrialResolvedCure,
  researchFocusTarget,
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
    origin: { q: 1, r: 1 },
    start: { q: 1, r: 1 },
    cell: new Uint8Array(size * size),
    cureId: new Int16Array(size * size).fill(-1),
    cureTier: new Uint8Array(size * size),
    regionId: new Uint16Array(size * size),
    sideEffectId: new Int32Array(size * size).fill(-1),
    portalTo: new Int32Array(size * size).fill(-1),
    elevation: new Int16Array(size * size),
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
      { mapIndex: 0, cureId: 7, pos: { q: 1, r: 0 } },
      { mapIndex: 0, cureId: 4, pos: { q: 1, r: 2 } },
    ]);
  });
});

describe("Research camera contract", () => {
  it("has no shot-phase prop or automatic camera-follow path", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("shotStep");
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
      { q: 12, r: 8 },
      { q: 12, r: 8 },
    )).toBe(true);
    expect(researchPreviewEndpointHit(
      { q: 11, r: 8 },
      { q: 12, r: 8 },
    )).toBe(false);
    expect(researchPreviewEndpointHit({ q: 12, r: 8 }, undefined)).toBe(false);
    // a swamp half-step endpoint drawn on the edge between (33,31) and (33,32) is hit from either cell
    expect(researchPreviewEndpointHit({ q: 33, r: 31 }, { q: 33, r: 31.5 })).toBe(true);
    expect(researchPreviewEndpointHit({ q: 33, r: 32 }, { q: 33, r: 31.5 })).toBe(true);
    expect(researchPreviewEndpointHit({ q: 34, r: 31 }, { q: 33, r: 31.5 })).toBe(false);
  });

  it("focuses the next candidate when present and the current dose otherwise", () => {
    const dose = { pos: [{ q: 3, r: 4 }], offset: [{ q: 0, r: 0 }], heading: 0 as const, failed: false };
    const candidate = { pos: [{ q: 12, r: 9 }], offset: [{ q: 1, r: 0 }], heading: 2 as const, failed: false };

    expect(researchFocusTarget(dose, candidate, 0)).toEqual({
      label: "Next",
      position: { q: 12.5, r: 9 },
    });
    expect(researchDrugPoint(candidate, 0)).toEqual({ q: 12.5, r: 9 });
    expect(researchFocusTarget(dose, undefined, 0)).toEqual({
      label: "Dose",
      position: { q: 3, r: 4 },
    });
  });

  it("classifies a drag by total displacement rather than only its latest tiny move", () => {
    expect(researchPointerMoved(10, 10, 12, 12)).toBe(false);
    expect(researchPointerMoved(10, 10, 14, 12)).toBe(false);
    expect(researchPointerMoved(10, 10, 16, 12)).toBe(true);
    expect(researchPointerMoved(10, 10, 20, 10)).toBe(true);
  });
});

describe("Research course controls", () => {
  it("numbers one control per executed step and ends at the run's final position", () => {
    const level = generate(defaultGenOptions(14));
    const program = level.diseases[0]!.reference;
    const route = researchRoute(level.mm, level.start, program);
    expect(route.controls).toHaveLength(program.steps.length);
    expect(route.controls.at(-1)).toEqual(researchDrugPoint(applyTemplate(level.mm, level.start, program), 0));
    expect(route.drug).toEqual(applyTemplate(level.mm, level.start, program));
    expect(researchRoute(level.mm, level.start, { steps: [] }).controls).toEqual([]);
  });
});

describe("Research Cure fit", () => {
  it("fires only for a freshly arrived curing trial, never for a stale, failed, or non-curing one", () => {
    const cure = { failed: false, final: [{ q: 1, r: 1 }], cured: [0], premium: [], regions: [1], sideEffects: [] };
    const miss = { ...cure, cured: [], regions: [] };
    const failed = { ...cure, failed: true, cured: [], regions: [] };
    expect(researchTrialResolvedCure(null, cure)).toBe(true);
    expect(researchTrialResolvedCure(miss, { ...cure })).toBe(true);
    expect(researchTrialResolvedCure(cure, cure)).toBe(false);
    expect(researchTrialResolvedCure(null, miss)).toBe(false);
    expect(researchTrialResolvedCure(null, failed)).toBe(false);
    expect(researchTrialResolvedCure(cure, null)).toBe(false);
  });

  it("keeps the whole course inside the uncovered part of the viewport without zooming in", () => {
    const map = { width: 63, height: 63 };
    const viewport = { width: 832, height: 512 };
    const insets = { top: 10, right: 200, bottom: 40, left: 150 };
    const points = [{ q: 31, r: 31 }, { q: 40, r: 31 }, { q: 44, r: 33 }];
    const camera = researchFitCamera(points, viewport, insets, { x: 0, y: 0, zoom: 1 }, map);
    expect(camera.zoom).toBeLessThanOrEqual(1);
    for (const point of points) {
      const projected = focusLabCamera(point);
      const x = viewport.width / 2 + (projected.x - camera.x) * camera.zoom;
      const y = viewport.height / 2 + (projected.y - camera.y) * camera.zoom;
      expect(x).toBeGreaterThanOrEqual(insets.left);
      expect(x).toBeLessThanOrEqual(viewport.width - insets.right);
      expect(y).toBeGreaterThanOrEqual(insets.top);
      expect(y).toBeLessThanOrEqual(viewport.height - insets.bottom);
    }
  });
});
