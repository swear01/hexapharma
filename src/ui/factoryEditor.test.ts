import { describe, expect, it } from "vitest";
import { hexDistance } from "../sim/hex";
import {
  appendUniqueCells,
  clampCamera,
  createEditorHistory,
  gridCellCenterToScreen,
  orientBeltGesture,
  panCamera,
  rasterizeGridLine,
  redoEditorHistory,
  reconcilePendingCommit,
  routeBeltGesture,
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
  it("picks pointy-top axial centers and fills fast drags with six-neighbor cells", () => {
    const rect = { left: 100, top: 50, width: 600, height: 300 };
    const intrinsic = { width: 1200, height: 600 };
    const camera: Camera = { x: -75, y: 45, zoom: 1.5 };
    const grid = { cellSize: 21, origin: { x: 32, y: 33 } };
    const cell: GridCell = { q: 7, r: 3 };

    const screen = gridCellCenterToScreen(cell, rect, intrinsic, camera, grid);

    expect(screenToGrid(screen, rect, intrinsic, camera, grid)).toEqual(cell);
    const line = rasterizeGridLine({ q: 0, r: 0 }, { q: 5, r: 3 });
    for (let index = 1; index < line.length; index++) {
      const before = line[index - 1]!;
      const after = line[index]!;
      expect(hexDistance(before.q, before.r, after.q, after.r)).toBe(1);
    }
  });

  it("round-trips a grid cell through a scaled canvas rect and camera", () => {
    const rect = { left: 100, top: 50, width: 600, height: 300 };
    const intrinsic = { width: 1200, height: 600 };
    const camera: Camera = { x: -75, y: 45, zoom: 1.5 };
    const grid = { cellSize: 56, origin: { x: 12, y: 12 } };
    const cell: GridCell = { q: 7, r: 3 };

    const screen = gridCellCenterToScreen(cell, rect, intrinsic, camera, grid);

    expect(screenToGrid(screen, rect, intrinsic, camera, grid)).toEqual(cell);
  });

  it("maps a negative axial center outside the grid origin", () => {
    const rect = { left: 0, top: 0, width: 500, height: 500 };
    const intrinsic = { width: 500, height: 500 };
    const camera: Camera = { x: 0, y: 0, zoom: 1 };

    const grid = { cellSize: 28, origin: { x: 250, y: 250 } };
    const screen = gridCellCenterToScreen(
      { q: -1, r: -1 },
      rect,
      intrinsic,
      camera,
      grid,
    );
    expect(screenToGrid(screen, rect, intrinsic, camera, grid)).toEqual({ q: -1, r: -1 });
  });
});

describe("factory editor gestures", () => {
  it("rasterizes fast drags as a direct contiguous hex line", () => {
    expect(rasterizeGridLine({ q: 1, r: 2 }, { q: 5, r: 2 })).toEqual([
      { q: 1, r: 2 },
      { q: 2, r: 2 },
      { q: 3, r: 2 },
      { q: 4, r: 2 },
      { q: 5, r: 2 },
    ]);
    const diagonal = rasterizeGridLine({ q: 1, r: 1 }, { q: 4, r: 4 });
    expect(diagonal[0]).toEqual({ q: 1, r: 1 });
    expect(diagonal.at(-1)).toEqual({ q: 4, r: 4 });
    expect(rasterizeGridLine({ q: 3, r: 1 }, { q: 1, r: 1 })).toEqual([
      { q: 3, r: 1 },
      { q: 2, r: 1 },
      { q: 1, r: 1 },
    ]);
    expect(rasterizeGridLine({ q: 2, r: 8 }, { q: 2, r: 8 })).toEqual([{ q: 2, r: 8 }]);
  });

  it("replaces a belt drag preview with a direct line from its original cell", () => {
    expect(routeBeltGesture(
      [{ q: 2, r: 2 }, { q: 3, r: 2 }, { q: 3, r: 3 }],
      { q: 6, r: 5 },
    )).toEqual(rasterizeGridLine({ q: 2, r: 2 }, { q: 6, r: 5 }));
    expect(routeBeltGesture([], { q: 4, r: 4 })).toEqual([{ q: 4, r: 4 }]);
  });

  it("never repeats a rasterized cell and never skips a neighboring cell", () => {
    const cells = rasterizeGridLine({ q: -8, r: 3 }, { q: 17, r: 11 });
    expect(new Set(cells.map((cell) => `${cell.q},${cell.r}`)).size).toBe(cells.length);
    for (let index = 1; index < cells.length; index++) {
      const previous = cells[index - 1]!;
      const current = cells[index]!;
      expect(hexDistance(previous.q, previous.r, current.q, current.r)).toBe(1);
    }
  });

  it("orients every belt toward the next cell and keeps the final tangent", () => {
    expect(orientBeltGesture([
      { q: 1, r: 1 },
      { q: 2, r: 1 },
      { q: 2, r: 2 },
      { q: 1, r: 3 },
    ], 3)).toEqual([0, 1, 2, 2]);
    expect(orientBeltGesture([{ q: 4, r: 4 }], 5)).toEqual([5]);
  });

  it("appends only unseen cells in stable gesture order without mutating inputs", () => {
    const existing: readonly GridCell[] = [{ q: 1, r: 1 }, { q: 2, r: 1 }];
    const additions: readonly GridCell[] = [
      { q: 2, r: 1 },
      { q: 3, r: 1 },
      { q: 3, r: 1 },
      { q: 4, r: 2 },
    ];

    expect(appendUniqueCells(existing, additions)).toEqual([
      { q: 1, r: 1 },
      { q: 2, r: 1 },
      { q: 3, r: 1 },
      { q: 4, r: 2 },
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
