import { describe, expect, it } from "vitest";
import {
  LAB_CELL_PIXELS,
  LAB_VIEWPORT,
  focusLabCamera,
  labCellPolygon,
  labScreenToWorld,
  labWorldToRelativeCell,
} from "./labCamera";

describe("Lab pointy-top hex camera", () => {
  it("centres and picks axial q/r cells through the shared pointy-top projection", () => {
    const focus = { q: 4, r: 3 };
    const camera = focusLabCamera(focus);
    const center = { x: LAB_VIEWPORT.width / 2, y: LAB_VIEWPORT.height / 2 };

    expect(labScreenToWorld(camera, LAB_VIEWPORT, center)).toEqual(focus);
    expect(labWorldToRelativeCell({ q: 2, r: 6 }, focus)).toEqual({ q: -2, r: 3 });

    const polygon = labCellPolygon(camera, focus);
    expect(polygon).toHaveLength(6);
    expect(polygon[0]).toEqual({ x: center.x, y: center.y - LAB_CELL_PIXELS / 2 });
    expect(polygon[3]).toEqual({ x: center.x, y: center.y + LAB_CELL_PIXELS / 2 });
    expect(polygon[1]!.x - polygon[5]!.x).toBeCloseTo(
      Math.sqrt(3) * LAB_CELL_PIXELS / 2,
    );
  });
});
