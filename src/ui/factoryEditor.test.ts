import { describe, expect, it } from "vitest";
import {
  appendUniqueCells,
  clampCamera,
  createEditorHistory,
  gridCellCenterToScreen,
  panCamera,
  rasterizeGridLine,
  redoEditorHistory,
  reconcilePendingCommit,
  screenToGrid,
  undoEditorHistory,
  pushEditorHistory,
  zoomCameraAt,
  type Camera,
  type GridCell,
} from "./factoryEditor";

describe("factory editor camera", () => {
  it("clamps every camera component without mutating its input", () => {
    const camera: Camera = { x: -50, y: 500, zoom: 8 };

    const clamped = clampCamera(camera, {
      minX: -20,
      maxX: 100,
      minY: -30,
      maxY: 200,
      minZoom: 0.5,
      maxZoom: 3,
    });

    expect(clamped).toEqual({ x: -20, y: 200, zoom: 3 });
    expect(camera).toEqual({ x: -50, y: 500, zoom: 8 });
  });

  it("zooms around an intrinsic-canvas cursor without moving its world anchor", () => {
    const camera: Camera = { x: 30, y: -10, zoom: 1 };
    const cursor = { x: 250, y: 170 };
    const worldBefore = {
      x: (cursor.x - camera.x) / camera.zoom,
      y: (cursor.y - camera.y) / camera.zoom,
    };

    const zoomed = zoomCameraAt(camera, cursor, 2, { minZoom: 0.5, maxZoom: 4 });
    const worldAfter = {
      x: (cursor.x - zoomed.x) / zoomed.zoom,
      y: (cursor.y - zoomed.y) / zoomed.zoom,
    };

    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
    expect(zoomed.zoom).toBe(2);
    expect(camera).toEqual({ x: 30, y: -10, zoom: 1 });
  });

  it("clamps zoom before anchoring and pans immutably", () => {
    const camera: Camera = { x: 10, y: 20, zoom: 1 };
    const zoomed = zoomCameraAt(camera, { x: 100, y: 80 }, 99, {
      minZoom: 0.5,
      maxZoom: 2,
    });

    expect(zoomed).toEqual({ x: -80, y: -40, zoom: 2 });
    expect(panCamera(zoomed, { x: 12, y: -7 })).toEqual({ x: -68, y: -47, zoom: 2 });
    expect(zoomed).toEqual({ x: -80, y: -40, zoom: 2 });
  });
});

describe("factory editor coordinates", () => {
  it("round-trips a grid cell through a scaled canvas rect and camera", () => {
    const rect = { left: 100, top: 50, width: 600, height: 300 };
    const intrinsic = { width: 1200, height: 600 };
    const camera: Camera = { x: -75, y: 45, zoom: 1.5 };
    const grid = { cellSize: 56, origin: { x: 12, y: 12 } };
    const cell: GridCell = { x: 7, y: 3 };

    const screen = gridCellCenterToScreen(cell, rect, intrinsic, camera, grid);

    expect(screenToGrid(screen, rect, intrinsic, camera, grid)).toEqual(cell);
  });

  it("maps coordinates immediately outside the grid origin to negative cells", () => {
    const rect = { left: 0, top: 0, width: 500, height: 500 };
    const intrinsic = { width: 500, height: 500 };
    const camera: Camera = { x: 0, y: 0, zoom: 1 };

    expect(
      screenToGrid({ x: 11.9, y: 11.9 }, rect, intrinsic, camera, {
        cellSize: 56,
        origin: { x: 12, y: 12 },
      }),
    ).toEqual({ x: -1, y: -1 });
  });
});

describe("factory editor gestures", () => {
  it("rasterizes fast horizontal, diagonal, reverse, and stationary drags", () => {
    expect(rasterizeGridLine({ x: 1, y: 2 }, { x: 5, y: 2 })).toEqual([
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 5, y: 2 },
    ]);
    expect(rasterizeGridLine({ x: 1, y: 1 }, { x: 4, y: 4 })).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 4 },
    ]);
    expect(rasterizeGridLine({ x: 3, y: 1 }, { x: 1, y: 1 })).toEqual([
      { x: 3, y: 1 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ]);
    expect(rasterizeGridLine({ x: 2, y: 8 }, { x: 2, y: 8 })).toEqual([{ x: 2, y: 8 }]);
  });

  it("never repeats a rasterized cell and never skips a neighboring cell", () => {
    const cells = rasterizeGridLine({ x: -8, y: 3 }, { x: 17, y: 11 });
    expect(new Set(cells.map((cell) => `${cell.x},${cell.y}`)).size).toBe(cells.length);
    for (let index = 1; index < cells.length; index++) {
      const previous = cells[index - 1]!;
      const current = cells[index]!;
      expect(Math.abs(current.x - previous.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(current.y - previous.y)).toBeLessThanOrEqual(1);
    }
  });

  it("appends only unseen cells in stable gesture order without mutating inputs", () => {
    const existing: readonly GridCell[] = [{ x: 1, y: 1 }, { x: 2, y: 1 }];
    const additions: readonly GridCell[] = [
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 2 },
    ];

    expect(appendUniqueCells(existing, additions)).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 2 },
    ]);
    expect(existing).toHaveLength(2);
    expect(additions).toHaveLength(4);
  });
});

describe("factory editor history", () => {
  it("does not let stale prop acknowledgements overwrite rapid local commits", () => {
    const pending = ["layout-a", "layout-b", "layout-c"];
    expect(reconcilePendingCommit(pending, "layout-a")).toEqual({
      pendingKeys: ["layout-b", "layout-c"],
      applyIncoming: false,
      resetHistory: false,
    });
    expect(reconcilePendingCommit(pending, "layout-c")).toEqual({
      pendingKeys: [],
      applyIncoming: true,
      resetHistory: false,
    });
    expect(reconcilePendingCommit(pending, "external-layout")).toEqual({
      pendingKeys: [],
      applyIncoming: true,
      resetHistory: true,
    });
  });

  it("commits one completed gesture as exactly one undo entry", () => {
    const initial = createEditorHistory("empty");
    const afterGesture = pushEditorHistory(initial, "five painted cells");

    expect(afterGesture.past).toEqual(["empty"]);
    expect(afterGesture.present).toBe("five painted cells");
    expect(afterGesture.future).toEqual([]);
    expect(undoEditorHistory(afterGesture).present).toBe("empty");
  });

  it("undoes and redoes immutably and stops at either boundary", () => {
    const initial = createEditorHistory(0);
    const two = pushEditorHistory(pushEditorHistory(initial, 1), 2);
    const one = undoEditorHistory(two);
    const zero = undoEditorHistory(one);

    expect(one.present).toBe(1);
    expect(zero.present).toBe(0);
    expect(undoEditorHistory(zero)).toBe(zero);
    expect(redoEditorHistory(zero).present).toBe(1);
    expect(redoEditorHistory(redoEditorHistory(zero)).present).toBe(2);
    expect(redoEditorHistory(two)).toBe(two);
    expect(two.present).toBe(2);
  });

  it("cuts off the redo branch when a new edit is pushed", () => {
    const initial = createEditorHistory("a");
    const c = pushEditorHistory(pushEditorHistory(initial, "b"), "c");
    const b = undoEditorHistory(c);

    const branched = pushEditorHistory(b, "d");

    expect(branched).toEqual({ past: ["a", "b"], present: "d", future: [] });
    expect(redoEditorHistory(branched)).toBe(branched);
  });

  it("supports undefined as a legitimate history value", () => {
    const changed = pushEditorHistory(createEditorHistory<string | undefined>(undefined), "placed");
    const undone = undoEditorHistory(changed);

    expect(undone.present).toBeUndefined();
    expect(redoEditorHistory(undone).present).toBe("placed");
  });

  it("caps undo snapshots at fifty complete gestures", () => {
    let history = createEditorHistory(0);
    for (let value = 1; value <= 75; value++) history = pushEditorHistory(history, value);

    expect(history.past).toHaveLength(50);
    expect(history.past[0]).toBe(25);
    expect(history.present).toBe(75);
  });
});
