import { describe, expect, it } from "vitest";
import { DEFAULT_PATENTS } from "../sim/patent";
import { patentUnlockWarning } from "./Patents";

describe("Patent destructive confirmation", () => {
  it("warns only when a factory expansion will reset commissioned Production", () => {
    const expansion = DEFAULT_PATENTS.find((node) => node.effect.kind === "expandFactory")!;
    const scanner = DEFAULT_PATENTS.find((node) => node.effect.kind === "revealAid")!;

    expect(patentUnlockWarning(expansion, false)).toBeNull();
    expect(patentUnlockWarning(scanner, true)).toBeNull();
    expect(patentUnlockWarning(expansion, true)).toMatch(/runtime.*waste.*reset/i);
  });
});
