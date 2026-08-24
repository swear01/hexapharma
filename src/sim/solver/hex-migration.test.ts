import { describe, expect, it } from "vitest";
import type {
  EffectMap,
  MachineCatalogEntry,
  MultiMap,
  PathStamp,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import type { HexCoord, HexDir } from "../hex";
import { evaluate, initialState } from "../drug-graph";
import { solve } from "./index";

const NE = 5 as HexDir;

function cureMap(start: HexCoord, cure: HexCoord, diseaseId: number): EffectMap {
  const width = 5;
  const height = 5;
  const length = width * height;
  const cell = new Uint8Array(length);
  const cureId = new Int16Array(length).fill(-1);
  const cureIndex = cure.r * width + cure.q;
  cell[cureIndex] = CellKind.Cure;
  cureId[cureIndex] = diseaseId;
  return {
    width,
    height,
    origin: { q: 2, r: 2 },
    start,
    cell,
    cureId,
    sideEffectId: new Int32Array(length).fill(-1),
    portalTo: new Int32Array(length).fill(-1),
    fog: new Uint8Array(length),
  };
}

describe("true-hex solver", () => {
  it("finds a deterministic, sound one-step north-east solution", () => {
    const mm: MultiMap = { maps: [cureMap({ q: 2, r: 2 }, { q: 3, r: 1 }, 7)] };
    const catalog: readonly MachineCatalogEntry[] = [{
      typeId: "north-east",
      path: [NE] as PathStamp,
      cost: 3,
      speed: 1,
    }];
    const start = initialState(mm);
    const opts = { catalog, maxDepth: 1, targets: [7] };

    const first = solve(mm, start, opts);
    const second = solve(mm, start, opts);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      template: { steps: [{ typeId: "north-east", path: [NE] }] },
      difficulty: 1,
      cost: 3,
    });
    expect(evaluate(mm, start, first!.template)).toMatchObject({
      failed: false,
      cured: [7],
      final: [{ q: 3, r: 1 }],
    });
  });
});
