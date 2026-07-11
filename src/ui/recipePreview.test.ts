import { describe, expect, it } from "vitest";
import type { EffectMap, Machine, MultiMap, Vec2 } from "../sim/phase0_interfaces";
import { CellKind, IDENTITY } from "../sim/phase0_interfaces";
import { applyTemplate, initialState } from "../sim/drug-graph";
import { buildFogSafeRecipePreview, buildRecipePreview, maskRecipeTrailForFog } from "./recipePreview";

function map(start: Vec2): EffectMap {
  const size = 7;
  const length = size * size;
  return {
    width: size,
    height: size,
    origin: { x: 3, y: 3 },
    start,
    cell: new Uint8Array(length),
    cureId: new Int16Array(length).fill(-1),
    sideEffectId: new Int32Array(length).fill(-1),
    fog: new Uint8Array(length),
  };
}

function withCell(source: EffectMap, x: number, y: number, kind: number): EffectMap {
  const cell = Uint8Array.from(source.cell);
  cell[y * source.width + x] = kind;
  return { ...source, cell };
}

function translate(x: number, y: number): Machine {
  return {
    typeId: "translate",
    transform: { kind: "translate", delta: { x, y }, relation: "forward" },
    orientation: IDENTITY,
  };
}

function swap(): Machine {
  return {
    typeId: "swap01",
    transform: { kind: "swap", a: 0, b: 1 },
    orientation: IDENTITY,
  };
}

describe("buildRecipePreview", () => {
  it("includes the start and every entered cell while preserving a wall stop", () => {
    const effectMap = withCell(map({ x: 1, y: 1 }), 4, 1, CellKind.Wall);
    const mm: MultiMap = { maps: [effectMap] };
    const start = initialState(mm);

    const preview = buildRecipePreview(mm, start, [translate(5, 0)]);

    expect(preview.frames).toEqual([
      start,
      { pos: [{ x: 3, y: 1 }], failed: false },
    ]);
    expect(preview.trails).toEqual([[
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]]);
    expect(preview.failedStep).toBeNull();
  });

  it("records the zero-based step that first enters a hazard", () => {
    const effectMap = withCell(map({ x: 1, y: 1 }), 3, 1, CellKind.Hazard);
    const mm: MultiMap = { maps: [effectMap] };
    const start = initialState(mm);
    const steps = [translate(1, 0), translate(1, 0), translate(1, 0)];

    const preview = buildRecipePreview(mm, start, steps);

    expect(preview.failedStep).toBe(1);
    expect(preview.frames).toHaveLength(steps.length + 1);
    expect(preview.final).toEqual({ pos: [{ x: 3, y: 1 }], failed: true });
    expect(preview.trails[0]).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
  });

  it("breaks each layer route before adding the phase-exchanged position", () => {
    const mm: MultiMap = { maps: [map({ x: 1, y: 1 }), map({ x: 5, y: 5 })] };
    const start = initialState(mm);

    const preview = buildRecipePreview(mm, start, [swap()]);

    expect(preview.trails).toEqual([
      [{ x: 1, y: 1 }, null, { x: 5, y: 5 }],
      [{ x: 5, y: 5 }, null, { x: 1, y: 1 }],
    ]);
  });

  it("has the same final state as the authoritative template application", () => {
    const mm: MultiMap = { maps: [map({ x: 1, y: 1 }), map({ x: 5, y: 5 })] };
    const start = initialState(mm);
    const steps = [translate(1, 0), swap(), translate(0, -1)];

    const preview = buildRecipePreview(mm, start, steps);

    expect(preview.final).toEqual(applyTemplate(mm, start, { steps }));
    expect(preview.frames.at(-1)).toBe(preview.final);
  });

  it("returns deeply immutable preview collections", () => {
    const mm: MultiMap = { maps: [map({ x: 1, y: 1 })] };
    const preview = buildRecipePreview(mm, initialState(mm), [translate(1, 0)]);

    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.frames)).toBe(true);
    expect(Object.isFrozen(preview.frames[0])).toBe(true);
    expect(Object.isFrozen(preview.frames[0]!.pos)).toBe(true);
    expect(Object.isFrozen(preview.frames[0]!.pos[0])).toBe(true);
    expect(Object.isFrozen(preview.trails)).toBe(true);
    expect(Object.isFrozen(preview.trails[0])).toBe(true);
    expect(Object.isFrozen(preview.trails[0]![0])).toBe(true);
  });
});

describe("maskRecipeTrailForFog", () => {
  it("replaces unknown cells with immutable breaks so lines cannot cross fog", () => {
    const source = map({ x: 1, y: 1 });
    const fog = Uint8Array.from(source.fog);
    fog[1 * source.width + 1] = 1;
    fog[1 * source.width + 2] = 1;
    fog[1 * source.width + 4] = 1;
    const effectMap = { ...source, fog };

    const masked = maskRecipeTrailForFog(effectMap, [
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
    ]);

    expect(masked).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      null,
      { x: 4, y: 1 },
    ]);
    expect(Object.isFrozen(masked)).toBe(true);
    expect(Object.isFrozen(masked[0])).toBe(true);
  });
});

describe("buildFogSafeRecipePreview", () => {
  it("makes hidden empty, wall, and hazard cells publicly indistinguishable", () => {
    const source = map({ x: 1, y: 1 });
    const fog = Uint8Array.from(source.fog);
    fog[1 * source.width + 1] = 1;
    fog[1 * source.width + 2] = 1;
    const hiddenEmpty = { ...source, fog };
    const hiddenWall = withCell(hiddenEmpty, 3, 1, CellKind.Wall);
    const hiddenHazard = withCell(hiddenEmpty, 3, 1, CellKind.Hazard);
    const steps = [translate(2, 0), translate(1, 0)];

    const previews = [hiddenEmpty, hiddenWall, hiddenHazard].map((effectMap) => {
      const mm: MultiMap = { maps: [effectMap] };
      return buildFogSafeRecipePreview(mm, initialState(mm), steps);
    });

    expect(previews[0]).toEqual(previews[1]);
    expect(previews[1]).toEqual(previews[2]);
    expect(previews[0]).toMatchObject({ uncertainStep: 0, failedStep: null });
    expect(previews[0]!.trails[0]).toEqual([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
  });

  it("reports a wall stop or hazard only after the relevant cell is revealed", () => {
    const source = map({ x: 1, y: 1 });
    const fog = new Uint8Array(source.fog.length).fill(1);
    const wall = withCell({ ...source, fog }, 3, 1, CellKind.Wall);
    const hazard = withCell({ ...source, fog }, 3, 1, CellKind.Hazard);
    const wallMap: MultiMap = { maps: [wall] };
    const hazardMap: MultiMap = { maps: [hazard] };

    expect(buildFogSafeRecipePreview(wallMap, initialState(wallMap), [translate(2, 0)]))
      .toMatchObject({ uncertainStep: null, failedStep: null, final: { pos: [{ x: 2, y: 1 }] } });
    expect(buildFogSafeRecipePreview(hazardMap, initialState(hazardMap), [translate(2, 0)]))
      .toMatchObject({ uncertainStep: null, failedStep: 0, final: { failed: true } });
  });

  it("stays indistinguishable when only another layer has hidden content", () => {
    const knownLayer = map({ x: 1, y: 1 });
    const knownFog = Uint8Array.from(knownLayer.fog);
    knownFog[1 * knownLayer.width + 1] = 1;
    knownFog[1 * knownLayer.width + 2] = 1;
    const visible = { ...knownLayer, fog: knownFog };
    const hiddenLayer = map({ x: 5, y: 5 });
    const hiddenFog = Uint8Array.from(hiddenLayer.fog);
    hiddenFog[5 * hiddenLayer.width + 5] = 1;
    const hidden = { ...hiddenLayer, fog: hiddenFog };

    const previews = [CellKind.Empty, CellKind.Wall, CellKind.Hazard].map((kind) => {
      const second = withCell(hidden, 6, 5, kind);
      const mm: MultiMap = { maps: [visible, second] };
      return buildFogSafeRecipePreview(mm, initialState(mm), [translate(1, 0), translate(1, 0)]);
    });

    expect(previews[0]).toEqual(previews[1]);
    expect(previews[1]).toEqual(previews[2]);
    expect(previews[0]).toMatchObject({ uncertainStep: 0, failedStep: null });
    expect(previews[0]!.trails).toEqual([
      [{ x: 1, y: 1 }, { x: 2, y: 1 }],
      [{ x: 5, y: 5 }],
    ]);
  });

  it("keeps phase exchange uncertain until both destination cells are known", () => {
    const a = map({ x: 1, y: 1 });
    const b = map({ x: 5, y: 5 });
    const fogA = Uint8Array.from(a.fog);
    const fogB = Uint8Array.from(b.fog);
    fogA[1 * a.width + 1] = 1;
    fogB[5 * b.width + 5] = 1;
    const hiddenSwap: MultiMap = { maps: [{ ...a, fog: fogA }, { ...b, fog: fogB }] };
    const hiddenPreview = buildFogSafeRecipePreview(hiddenSwap, initialState(hiddenSwap), [swap(), translate(1, 0)]);
    expect(hiddenPreview).toMatchObject({ uncertainStep: 0, failedStep: null });
    expect(hiddenPreview.frames).toHaveLength(1);

    fogA[5 * a.width + 5] = 1;
    fogB[1 * b.width + 1] = 1;
    const knownSwap: MultiMap = { maps: [{ ...a, fog: fogA }, { ...b, fog: fogB }] };
    const knownPreview = buildFogSafeRecipePreview(knownSwap, initialState(knownSwap), [swap()]);
    expect(knownPreview).toMatchObject({ uncertainStep: null, failedStep: null });
    expect(knownPreview.frames).toHaveLength(2);
    expect(knownPreview.final.pos).toEqual([{ x: 5, y: 5 }, { x: 1, y: 1 }]);
  });
});
