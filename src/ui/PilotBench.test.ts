import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Template } from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { PilotBench, buildInitialPrototype, tryBuildInitialPrototype } from "./PilotBench";

function template(...ids: readonly string[]): Template {
  return {
    steps: ids.map((id) => {
      const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === id)!;
      return {
        typeId: entry.typeId,
        transform: entry.transform,
        orientation: { rot: 0 as const, flip: false },
      };
    }),
  };
}

describe("Pilot Bench initial prototype", () => {
  it("creates one real placed machine per effect step on a roomy grid", () => {
    const prototype = buildInitialPrototype(template("push", "shear", "push2"));
    expect(prototype.layout.width).toBe(24);
    expect(prototype.layout.height).toBe(12);
    expect(prototype.layout.machines.map((machine) => machine.def.typeId)).toEqual([
      "push",
      "shear",
      "push2",
    ]);
    expect(prototype.layout.machines.map((machine) => machine.anchor)).toEqual(
      prototype.placements.map((placement) => placement.anchor),
    );
  });

  it("contains an actual connected source, belts, and analyzer sink", () => {
    const { layout } = buildInitialPrototype(template("push"));
    expect(layout.tiles.some((tile) => tile.kind === "source")).toBe(true);
    expect(layout.tiles.some((tile) => tile.kind === "belt")).toBe(true);
    expect(layout.tiles.some((tile) => tile.kind === "sink")).toBe(true);
  });

  it("reports an over-capacity recipe without throwing the Lab view", () => {
    const overCapacity = template(...Array.from({ length: 20 }, () => "push2"));
    const result = tryBuildInitialPrototype(overCapacity);
    expect(result.prototype).toBeNull();
    expect(result.error).toMatch(/cannot fit/i);
    const markup = renderToStaticMarkup(
      createElement(PilotBench, {
        template: overCapacity,
        width: 24,
        height: 12,
        onLayoutChange: () => undefined,
      }),
    );
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("does not fit this Pilot Bench");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Auto arrange<\/button>/);
  });
});
