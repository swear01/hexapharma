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

describe("effect map authority", () => {
  it.each([
    ["cell", (level: EffectMap) => ({ ...level, cell: new Int16Array(level.cell.length) as unknown as Uint8Array })],
    ["cureId", (level: EffectMap) => ({ ...level, cureId: new Int32Array(level.cureId.length) as unknown as Int16Array })],
    ["sideEffectId", (level: EffectMap) => ({ ...level, sideEffectId: new Int16Array(level.sideEffectId.length) as unknown as Int32Array })],
    ["portalTo", (level: EffectMap) => ({ ...level, portalTo: new Int16Array(level.portalTo.length) as unknown as Int32Array })],
    ["fog", (level: EffectMap) => ({ ...level, fog: new Int16Array(level.fog.length) as unknown as Uint8Array })],
  ] as const)("requires %s to use its exact typed-array authority", (field, change) => {
    expect(() => validateEffectMap(change(map()))).toThrow(new RegExp(field, "i"));
  });

  it.each(["cell", "cureId", "sideEffectId", "portalTo", "fog"] as const)(
    "requires %s length to equal the map area",
    (field) => {
      const level = map();
      const shortened = level[field].slice(0, -1);
      expect(() => validateEffectMap({ ...level, [field]: shortened })).toThrow(
        new RegExp(`${field}.*width\\*height`, "i"),
      );
    },
  );

  it("requires origin and start to be in-bounds integer coordinates", () => {
    const level = map();
    for (const invalid of [
      { ...level, origin: { x: 1.5, y: 1 } },
      { ...level, origin: { x: level.width, y: 1 } },
      { ...level, start: { x: 1, y: -1 } },
      { ...level, start: { x: Number.MAX_SAFE_INTEGER + 1, y: 1 } },
    ]) {
      expect(() => validateEffectMap(invalid)).toThrow(/origin|start/i);
    }
  });

  it("rejects unknown cell codes and non-binary fog", () => {
    const invalidCell = map();
    invalidCell.cell[0] = 255;
    expect(() => validateEffectMap(invalidCell)).toThrow(/cell.*kind/i);

    const invalidFog = map();
    invalidFog.fog[0] = 2;
    expect(() => validateEffectMap(invalidFog)).toThrow(/fog.*0 or 1/i);
  });

  it("requires Cure and SideEffect metadata while preserving their overlap", () => {
    const missingCure = map();
    missingCure.cell[0] = CellKind.Cure;
    expect(() => validateEffectMap(missingCure)).toThrow(/Cure.*cureId/i);

    const strayCure = map();
    strayCure.cureId[0] = 3;
    expect(() => validateEffectMap(strayCure)).toThrow(/non-Cure.*cureId/i);

    const missingSideEffect = map();
    missingSideEffect.cell[0] = CellKind.SideEffect;
    expect(() => validateEffectMap(missingSideEffect)).toThrow(/SideEffect.*sideEffectId/i);

    const straySideEffect = map();
    straySideEffect.sideEffectId[0] = 4;
    expect(() => validateEffectMap(straySideEffect)).toThrow(/sideEffectId.*Cure|SideEffect/i);

    const invalidNegativeIds = map();
    invalidNegativeIds.cureId[0] = -2;
    expect(() => validateEffectMap(invalidNegativeIds)).toThrow(/cureId.*-1/i);
    invalidNegativeIds.cureId[0] = -1;
    invalidNegativeIds.sideEffectId[0] = -2;
    expect(() => validateEffectMap(invalidNegativeIds)).toThrow(/sideEffectId.*-1/i);

    const overlap = map();
    overlap.cell[0] = CellKind.Cure;
    overlap.cureId[0] = 3;
    overlap.sideEffectId[0] = 4;
    expect(() => validateEffectMap(overlap)).not.toThrow();
  });
});
