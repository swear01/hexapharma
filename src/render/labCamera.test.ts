import { describe, expect, it } from "vitest";
import {
  LAB_CELL_PIXELS,
  LAB_VIEWPORT,
  LAB_MIN_ZOOM,
  clampLabCamera,
  focusLabCamera,
  labGridKindForBoundary,
  labGridLineStyle,
  labScreenToWorld,
  labTrailsForFrames,
  labWorldToRelativeCell,
  panLabCamera,
  visibleLabCells,
  zoomLabCameraAt,
  type LabCamera,
} from "./labCamera";

const viewport = LAB_VIEWPORT;
const map = { width: 63, height: 63 };

describe("Lab camera", () => {
  it("uses a compact 40 px atlas grid and still shows only a local map window", () => {
    expect(LAB_CELL_PIXELS).toBe(40);
    expect(LAB_VIEWPORT.width / LAB_VIEWPORT.height).toBeGreaterThan(1.6);
    const camera = focusLabCamera({ q: 31, r: 31 });
    const bounds = visibleLabCells(camera, viewport, map);
    expect(bounds.q1 - bounds.q0).toBeGreaterThanOrEqual(35);
    expect(bounds.q1 - bounds.q0).toBeLessThanOrEqual(42);
    expect(bounds.r1 - bounds.r0).toBeGreaterThanOrEqual(20);
    expect(bounds.r1 - bounds.r0).toBeLessThanOrEqual(24);
    expect(bounds.q0).toBeGreaterThan(0);
    expect(bounds.r0).toBeGreaterThan(0);
  });

  it("keeps major grid lines stronger than minor lines", () => {
    const minor = labGridLineStyle("minor", 1);
    const major = labGridLineStyle("major", 1);
    expect(minor.alpha).toBeGreaterThan(0);
    expect(major.alpha).toBeGreaterThan(minor.alpha);
  });

  it("centres the origin cell in a five-by-five major-grid block", () => {
    expect(labGridKindForBoundary(28, 31)).toBe("minor");
    expect(labGridKindForBoundary(29, 31)).toBe("major");
    expect(labGridKindForBoundary(33, 31)).toBe("minor");
    expect(labGridKindForBoundary(34, 31)).toBe("major");
    expect(labGridKindForBoundary(39, 31)).toBe("major");
  });

  it("converts world cells to player-facing coordinates relative to the origin", () => {
    expect(labWorldToRelativeCell({ q: 31, r: 31 }, { q: 31, r: 31 })).toEqual({ q: 0, r: 0 });
    expect(labWorldToRelativeCell({ q: 29, r: 34 }, { q: 31, r: 31 })).toEqual({ q: -2, r: 3 });
  });

  it("fades minor grid lines when zoomed out without hiding the major grid", () => {
    const zoomedOutMinor = labGridLineStyle("minor", LAB_MIN_ZOOM);
    const defaultMinor = labGridLineStyle("minor", 1);
    const zoomedOutMajor = labGridLineStyle("major", LAB_MIN_ZOOM);
    expect(zoomedOutMinor.alpha).toBeLessThan(defaultMinor.alpha);
    expect(zoomedOutMajor.alpha).toBeGreaterThan(zoomedOutMinor.alpha);
    expect(defaultMinor.alpha).toBeLessThan(0.1);
    expect(zoomedOutMajor.alpha).toBeLessThan(0.15);
  });

  it("focuses a grid cell at the viewport centre", () => {
    const world = labScreenToWorld(focusLabCamera({ q: 31, r: 31 }), viewport, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    });
    expect(world).toEqual({ q: 31, r: 31 });
  });

  it("keeps the world point below the cursor fixed while zooming", () => {
    const camera: LabCamera = focusLabCamera({ q: 31, r: 31 });
    const pointer = { x: 120, y: 160 };
    const before = labScreenToWorld(camera, viewport, pointer);
    const zoomed = zoomLabCameraAt(camera, 1.5, pointer, viewport, map);
    const after = labScreenToWorld(zoomed, viewport, pointer);
    expect(after).toEqual(before);
  });

  it("pans in pixels and clamps the camera to a map", () => {
    const camera = focusLabCamera({ q: 31, r: 31 });
    const moved = panLabCamera(camera, 80, 40, viewport, map);
    expect(labScreenToWorld(moved, viewport, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    })).toEqual({ q: 29, r: 30 });
    expect(clampLabCamera({ x: -99, y: 99, zoom: 1 }, viewport, map)).toEqual({
      x: 398.6794919243112,
      y: 236,
      zoom: 1,
    });
  });

  it("limits zoom to the playable range", () => {
    const camera = focusLabCamera({ q: 31, r: 31 });
    expect(zoomLabCameraAt(camera, 0.01, { x: 0, y: 0 }, viewport, map).zoom).toBe(0.75);
    expect(zoomLabCameraAt(camera, 99, { x: 0, y: 0 }, viewport, map).zoom).toBe(2.25);
  });

  it("builds an ordered per-layer route from animated drug frames", () => {
    expect(labTrailsForFrames([
      { pos: [{ q: 1, r: 2 }, { q: 5, r: 6 }] },
      { pos: [{ q: 2, r: 2 }, { q: 5, r: 7 }] },
    ], 2, [false, true])).toEqual([
      [{ q: 1, r: 2 }, null, { q: 2, r: 2 }],
      [{ q: 5, r: 6 }, null, { q: 5, r: 7 }],
    ]);
  });
});
