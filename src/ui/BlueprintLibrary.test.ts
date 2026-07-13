import { describe, expect, it } from "vitest";
import { MAX_BLUEPRINT_BYTES } from "../blueprint/format";
import { readBlueprintUpload } from "./BlueprintLibrary";

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
