import { describe, expect, it } from "vitest";
import { MAX_BLUEPRINT_BYTES } from "../blueprint/format";
import type { FactoryLayout } from "../sim/phase0_interfaces";
import { factoryBlueprintBuildQuote, readBlueprintUpload } from "./BlueprintLibrary";

describe("Blueprint upload boundary", () => {
  it("rejects an oversized file before reading its contents", async () => {
    let reads = 0;
    await expect(readBlueprintUpload({
      size: MAX_BLUEPRINT_BYTES + 1,
      text: () => {
        reads++;
        return Promise.resolve("{}");
      },
    })).rejects.toThrow(/size|bytes/i);
    expect(reads).toBe(0);
  });
});

describe("Factory Blueprint destinations", () => {
  const layout = (width: number, height: number): FactoryLayout => ({
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ kind: "empty" as const })),
    machines: [],
  });

  it("does not quote an incompatible floor size during render", () => {
    let quotes = 0;
    const quote = () => {
      quotes++;
      return 42;
    };

    expect(factoryBlueprintBuildQuote(layout(24, 12), layout(8, 4), quote)).toBeNull();
    expect(quotes).toBe(0);
    expect(factoryBlueprintBuildQuote(layout(24, 12), layout(24, 12), quote)).toBe(42);
    expect(quotes).toBe(1);
  });
});
