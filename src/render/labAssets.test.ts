import { describe, expect, it } from "vitest";
import { labAssetUrls } from "./labAssets";

const manifest = {
  baseUrl: "/assets/lab/",
  assets: Object.fromEntries(
    ["substrate", "fog", "wall", "hazard", "sideEffect", "cure", "drug", "halo"]
      .map((key) => [key, { file: `${key}.png` }]),
  ),
};

describe("Lab asset manifest", () => {
  it("is the runtime source of every atlas asset URL", () => {
    expect(labAssetUrls(manifest)).toEqual({
      substrate: "/assets/lab/substrate.png",
      fog: "/assets/lab/fog.png",
      wall: "/assets/lab/wall.png",
      hazard: "/assets/lab/hazard.png",
      sideEffect: "/assets/lab/sideEffect.png",
      cure: "/assets/lab/cure.png",
      drug: "/assets/lab/drug.png",
      halo: "/assets/lab/halo.png",
    });
  });

  it("rejects a missing or traversing asset filename", () => {
    expect(() => labAssetUrls({ ...manifest, assets: { ...manifest.assets, halo: undefined } })).toThrow(/halo/i);
    expect(() => labAssetUrls({ ...manifest, assets: { ...manifest.assets, halo: { file: "../halo.png" } } })).toThrow(/halo/i);
  });
});
