import { describe, expect, it } from "vitest";
import { BLUEPRINT_CONTENT_FINGERPRINT } from "../blueprint/format";
import { fnv1a32Hex, hashInit, hashString } from "./hash";

describe("hash", () => {
  it("uses FNV-1a over UTF-16 code units for string fingerprints", () => {
    expect(hashString("")).toBe(hashInit());
    expect(fnv1a32Hex("abc")).toBe("fnv1a32:1a47e90b");
  });

  it("keeps the blueprint content fingerprint stable", () => {
    expect(BLUEPRINT_CONTENT_FINGERPRINT).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
  });
});
