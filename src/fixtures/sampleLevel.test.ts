import { describe, it, expect } from "vitest";
import { CellKind } from "../sim/phase0_interfaces";
import { evaluate } from "../sim/drug-graph";
import { solve } from "../sim/solver";
import { mm, start, targets, catalog } from "./sampleLevel";

describe("sample Lab level", () => {
  it("has exactly two 9×9 maps sharing start/origin (0,0)", () => {
    expect(mm.maps.length).toBe(2);
    for (const m of mm.maps) {
      expect(m.width).toBe(9);
      expect(m.height).toBe(9);
      expect(m.start).toEqual({ x: 0, y: 0 });
      expect(m.origin).toEqual({ x: 0, y: 0 });
    }
  });

  it("ships fully fogged", () => {
    for (const m of mm.maps) {
      for (const f of m.fog) expect(f).toBe(0);
    }
  });

  it("shows all four non-empty cell features on every map", () => {
    const required = [CellKind.Wall, CellKind.Hazard, CellKind.SideEffect, CellKind.Cure];
    for (const m of mm.maps) {
      const kinds = new Set<number>(m.cell);
      for (const k of required) expect(kinds.has(k)).toBe(true);
    }
  });

  it("carries one Cure per target, each on a distinct map", () => {
    for (const t of targets) {
      let count = 0;
      let mapOf = -1;
      for (let mi = 0; mi < mm.maps.length; mi++) {
        const m = mm.maps[mi]!;
        for (let i = 0; i < m.cell.length; i++) {
          if (m.cell[i] === CellKind.Cure && m.cureId[i] === t) {
            count++;
            mapOf = mi;
          }
        }
      }
      expect(count).toBe(1);
      expect(mapOf).toBe(t); // disease 0 → map 0, disease 1 → map 1
    }
  });

  it("is SOLVABLE: solve() returns a template that cures all targets safely", () => {
    const sol = solve(mm, start, { catalog, maxDepth: 16, targets });
    expect(sol).not.toBeNull();

    // INV-13 sanity: the returned template really cures every target and never fails.
    const out = evaluate(mm, start, sol!.template);
    expect(out.failed).toBe(false);
    for (const t of targets) expect(out.cured).toContain(t);
  });
});
