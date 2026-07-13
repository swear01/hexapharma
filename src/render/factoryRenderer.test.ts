import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { machineVisualStyle } from "./factoryRenderer";

describe("factory machine visual language", () => {
  it("gives every machine family a distinct bounded chassis palette", () => {
    const styles = DEFAULT_CATALOG.map((entry) => machineVisualStyle(entry.typeId));
    const signatures = styles.map((style) => `${style.body}:${style.face}:${style.accent}`);

    expect(new Set(signatures).size).toBe(DEFAULT_CATALOG.length);
    for (const style of styles) {
      expect(style.body).toBeGreaterThanOrEqual(0);
      expect(style.body).toBeLessThanOrEqual(0xffffff);
      expect(style.face).toBeGreaterThanOrEqual(0);
      expect(style.face).toBeLessThanOrEqual(0xffffff);
      expect(style.accent).toBeGreaterThanOrEqual(0);
      expect(style.accent).toBeLessThanOrEqual(0xffffff);
    }
  });

  it("does not collapse push and pull into the same visual family", () => {
    expect(machineVisualStyle("push")).not.toEqual(machineVisualStyle("pull"));
  });
});
