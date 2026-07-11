import { describe, expect, it } from "vitest";
import {
  clampLabCamera,
  focusLabCamera,
  labScreenToWorld,
  labTrailsForFrames,
  panLabCamera,
  visibleLabCells,
  zoomLabCameraAt,
  type LabCamera,
} from "./labCamera";

const viewport = { width: 704, height: 512 };
const map = { width: 63, height: 63 };

describe("Lab camera", () => {
  it("shows only a local 11 by 8 cell window at the default zoom", () => {
    const camera = focusLabCamera({ x: 31, y: 31 });
    const bounds = visibleLabCells(camera, viewport, map);
    expect(bounds.x1 - bounds.x0).toBeLessThanOrEqual(13);
    expect(bounds.y1 - bounds.y0).toBeLessThanOrEqual(11);
    expect(bounds.x0).toBeGreaterThan(0);
    expect(bounds.y0).toBeGreaterThan(0);
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
    const moved = panLabCamera(camera, 128, 64, viewport, map);
    expect(moved.x).toBeCloseTo(29.5);
    expect(moved.y).toBeCloseTo(30.5);
    expect(clampLabCamera({ x: -99, y: 99, zoom: 1 }, viewport, map)).toEqual({
      x: 5.5,
      y: 59,
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
