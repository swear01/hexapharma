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
    const camera = focusLabCamera({ x: 31, y: 31 });
    const bounds = visibleLabCells(camera, viewport, map);
    expect(bounds.x1 - bounds.x0).toBeGreaterThanOrEqual(21);
    expect(bounds.x1 - bounds.x0).toBeLessThanOrEqual(24);
    expect(bounds.y1 - bounds.y0).toBeGreaterThanOrEqual(14);
    expect(bounds.y1 - bounds.y0).toBeLessThanOrEqual(16);
    expect(bounds.x0).toBeGreaterThan(0);
    expect(bounds.y0).toBeGreaterThan(0);
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
    expect(labWorldToRelativeCell({ x: 31, y: 31 }, { x: 31, y: 31 })).toEqual({ x: 0, y: 0 });
    expect(labWorldToRelativeCell({ x: 29, y: 34 }, { x: 31, y: 31 })).toEqual({ x: -2, y: 3 });
  });

  it("fades minor grid lines when zoomed out without hiding the major grid", () => {
    const zoomedOutMinor = labGridLineStyle("minor", LAB_MIN_ZOOM);
    const defaultMinor = labGridLineStyle("minor", 1);
    const zoomedOutMajor = labGridLineStyle("major", LAB_MIN_ZOOM);
    expect(zoomedOutMinor.alpha).toBeLessThan(defaultMinor.alpha);
    expect(zoomedOutMajor.alpha).toBeGreaterThan(zoomedOutMinor.alpha);
    expect(zoomedOutMajor.alpha).toBeGreaterThanOrEqual(0.18);
  });

  it("focuses a grid cell at the viewport centre", () => {
    const world = labScreenToWorld(focusLabCamera({ x: 31, y: 31 }), viewport, {
      x: viewport.width / 2,
      y: viewport.height / 2,
    });
    expect(world.x).toBeCloseTo(31.5);
    expect(world.y).toBeCloseTo(31.5);
  });

  it("keeps the world point below the cursor fixed while zooming", () => {
    const camera: LabCamera = { x: 20, y: 20, zoom: 1 };
    const pointer = { x: 120, y: 160 };
    const before = labScreenToWorld(camera, viewport, pointer);
    const zoomed = zoomLabCameraAt(camera, 1.5, pointer, viewport, map);
    const after = labScreenToWorld(zoomed, viewport, pointer);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("pans in pixels and clamps the camera to a map", () => {
    const camera = focusLabCamera({ x: 31, y: 31 });
    const moved = panLabCamera(camera, 80, 40, viewport, map);
    expect(moved.x).toBeCloseTo(29.5);
    expect(moved.y).toBeCloseTo(30.5);
    expect(clampLabCamera({ x: -99, y: 99, zoom: 1 }, viewport, map)).toEqual({
      x: 10.4,
      y: 56.6,
      zoom: 1,
    });
  });

  it("limits zoom to the playable range", () => {
    const camera = focusLabCamera({ x: 31, y: 31 });
    expect(zoomLabCameraAt(camera, 0.01, { x: 0, y: 0 }, viewport, map).zoom).toBe(0.75);
    expect(zoomLabCameraAt(camera, 99, { x: 0, y: 0 }, viewport, map).zoom).toBe(2.25);
  });

  it("builds an ordered per-layer route from animated drug frames", () => {
    expect(labTrailsForFrames([
      { pos: [{ x: 1, y: 2 }, { x: 5, y: 6 }] },
      { pos: [{ x: 2, y: 2 }, { x: 5, y: 7 }] },
    ], 2, [false, true])).toEqual([
      [{ x: 1, y: 2 }, null, { x: 2, y: 2 }],
      [{ x: 5, y: 6 }, null, { x: 5, y: 7 }],
    ]);
  });
});
