import { describe, expect, it } from "vitest";
import type {
  Dir,
  PlacedMachine,
  Rotation,
} from "./phase0_interfaces";
import {
  rotateVec,
  worldCells,
  worldInPorts,
  worldOutPorts,
} from "./factory-geom";

describe("true-hex factory geometry", () => {
  it("rotates one axial step clockwise through all six 60-degree orientations", () => {
    expect([0, 1, 2, 3, 4, 5].map((rotation) =>
      rotateVec({ q: 1, r: 0 }, rotation as Rotation)
    )).toEqual([
      { q: 1, r: 0 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
      { q: -1, r: 0 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
    ]);
  });

  it("rotates footprint cells and port sides by the same 60-degree steps", () => {
    const machine: PlacedMachine = {
      id: 1,
      def: { typeId: "test", path: [0], cost: 1, speed: 1 },
      anchor: { q: 4, r: 4 },
      footRot: 2 as Rotation,
      shape: {
        cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        inPorts: [{ cell: { q: 0, r: 0 }, side: 3 as Dir }],
        outPorts: [{ cell: { q: 1, r: 0 }, side: 0 }],
      },
    };

    expect(worldCells(machine)).toEqual([{ q: 4, r: 4 }, { q: 3, r: 5 }]);
    expect(worldInPorts(machine)).toEqual([{ q: 4, r: 4, side: 5 }]);
    expect(worldOutPorts(machine)).toEqual([{ q: 3, r: 5, side: 2 }]);
  });
});
