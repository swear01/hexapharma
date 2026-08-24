import { describe, expect, it } from "vitest";
import type {
  GenOptions,
  MachineCatalogEntry,
  PathStamp,
} from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import {
  HEX_DIRS,
  HEX_DQ,
  HEX_DR,
  type HexCoord,
  type HexDir,
} from "../hex";
import { evaluate } from "../drug-graph";
import { generate } from "./index";

const NE = 5 as HexDir;
const catalog: readonly MachineCatalogEntry[] = [{
  typeId: "north-east",
  path: [NE] as PathStamp,
  cost: 1,
  speed: 1,
}];

const options: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 32,
  height: 32,
  catalog,
  diseaseCount: 1,
  difficulty: { min: 1, max: 1 },
};

describe("true-hex map generation", () => {
  it("constructs deterministic, sound references from a HexDir catalog", () => {
    const first = generate(options);
    const second = generate(options);
    const disease = first.diseases[0]!;

    expect(first).toEqual(second);
    expect(first.mm.maps[0]!.start).toEqual({ q: 16, r: 16 });
    expect(first.mm.maps[0]!.origin).toEqual({ q: 16, r: 16 });
    expect(disease.reference.steps).toEqual([{ typeId: "north-east", path: [NE] }]);
    expect(evaluate(first.mm, first.start, disease.reference)).toMatchObject({
      failed: false,
      cured: [disease.id],
    });
  });

  it("grows each visible cure region through six-neighbor axial adjacency", () => {
    const level = generate(options);
    const disease = level.diseases[0]!;
    const map = level.mm.maps[disease.map]!;
    const pending: HexCoord[] = [disease.node];
    const visited = new Set<string>();

    while (pending.length > 0) {
      const current = pending.pop()!;
      const key = `${current.q},${current.r}`;
      if (visited.has(key)) continue;
      const index = current.r * map.width + current.q;
      if (map.cell[index] !== CellKind.Cure || map.cureId[index] !== disease.id) continue;
      visited.add(key);
      for (const dir of HEX_DIRS) {
        pending.push({
          q: current.q + HEX_DQ[dir]!,
          r: current.r + HEX_DR[dir]!,
        });
      }
    }

    expect(visited.size).toBe(5);
  });
});
