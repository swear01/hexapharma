import { describe, expect, it } from "vitest";
import type { EffectMap } from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { validateEffectMap } from "./validation";

function map(width = 5, height = 3): EffectMap {
  const length = width * height;
  return {
    width,
    height,
    origin: { x: 2, y: 1 },
    start: { x: 2, y: 1 },
    cell: new Uint8Array(length),
    cureId: new Int16Array(length).fill(-1),
    sideEffectId: new Int32Array(length).fill(-1),
    portalTo: new Int32Array(length).fill(-1),
    fog: new Uint8Array(length),
  };
}

function portal(level: EffectMap, entry: number, exit: number): void {
  level.cell[entry] = CellKind.Portal;
  level.portalTo[entry] = exit;
}

describe("directed portal authority", () => {
  it("accepts a unique same-map A to non-activating B pair", () => {
    const level = map();
    portal(level, 5, 9);

    expect(() => validateEffectMap(level)).not.toThrow();
    expect(level.cell[9]).toBe(CellKind.Empty);
    expect(level.portalTo[9]).toBe(-1);
  });

  it("rejects a self destination", () => {
    const level = map();
    portal(level, 5, 5);

    expect(() => validateEffectMap(level)).toThrow(/portal destination.*itself/i);
  });

  it("rejects an exit that is also an activating portal entry", () => {
    const level = map();
    portal(level, 5, 9);
    portal(level, 9, 12);

    expect(() => validateEffectMap(level)).toThrow(/portal destination.*portal entry/i);
  });

  it("rejects an exit shared by multiple entries", () => {
    const level = map();
    portal(level, 5, 9);
    portal(level, 6, 9);

    expect(() => validateEffectMap(level)).toThrow(/portal destination.*unique/i);
  });
});
