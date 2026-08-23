import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./game.css", import.meta.url), "utf8");

describe("UI theme contracts", () => {
  it("uses semantic hooks and current theme tokens", () => {
    expect(css).not.toContain("[data-testid^=");
    expect(css).not.toContain("rgb(39 200 180");
    expect(css).not.toContain("rgb(194 206 211");
    expect(css).toContain("--failure-border:");
    expect(css).toContain("--failure-surface:");
    expect(css).toMatch(/\.game-alert\s*\{[^}]*border-color: var\(--failure-border\);[^}]*background: var\(--failure-surface\);/su);
  });
});
