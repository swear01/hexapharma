import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FACTORY_SCHEMATIC_STYLE } from "./factoryRenderer";
import { LAB_SCHEMATIC_STYLE } from "./labRenderer";
import { SHARED_SCHEMATIC_STYLE } from "./schematicStyle";

describe("shared schematic style", () => {
  it("is the single source for both renderer base palettes", () => {
    expect(Object.isFrozen(SHARED_SCHEMATIC_STYLE)).toBe(true);
    for (const key of Object.keys(SHARED_SCHEMATIC_STYLE) as (keyof typeof SHARED_SCHEMATIC_STYLE)[]) {
      expect(FACTORY_SCHEMATIC_STYLE[key]).toBe(SHARED_SCHEMATIC_STYLE[key]);
      expect(LAB_SCHEMATIC_STYLE[key]).toBe(SHARED_SCHEMATIC_STYLE[key]);
    }
  });

  it("keeps shared semantic literals out of renderer production files", () => {
    for (const file of ["factoryRenderer.ts", "labRenderer.ts", "labTerrain.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).not.toMatch(/0x(?:050a12|18242b|e7e1d2|48d7e5|b8e06c|ef6862)/i);
    }
  });
});
