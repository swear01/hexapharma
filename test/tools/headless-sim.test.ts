import { describe, expect, it } from "vitest";
import { parseCliArgs, parseSeed } from "../../tools/headless-sim";

describe("headless sim CLI seed parsing", () => {
  it("accepts only exact canonical uint32 integers", () => {
    expect(parseSeed("14")).toBe(14);
    expect(parseSeed("-0")).toBe(0);
    for (const raw of ["14junk", "1.5", "", "-1", "4294967296", "1e100"]) {
      expect(() => parseSeed(raw)).toThrow(/invalid seed.*uint32/i);
    }
  });

  it("rejects trailing CLI arguments instead of silently ignoring them", () => {
    expect(() => parseCliArgs(["gen", "14", "unexpected"])).toThrow(/unexpected arguments/i);
    expect(parseCliArgs(["run", "14"])).toEqual({ cmd: "run", seed: 14 });
  });
});
