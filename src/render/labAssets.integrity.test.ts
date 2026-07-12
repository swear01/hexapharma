import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LAB_ASSET_KEYS, type LabAssetKey } from "./labAssets";

interface ManifestAsset {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly alpha: boolean;
  readonly repeat: boolean;
  readonly role: string;
}

interface Manifest {
  readonly assets: Readonly<Record<LabAssetKey, ManifestAsset>>;
}

interface ImageHeader {
  readonly width: number;
  readonly height: number;
  readonly alpha: boolean;
}

const ASSET_DIRECTORY = resolve(process.cwd(), "public/assets/lab");
const manifest = JSON.parse(
  readFileSync(resolve(ASSET_DIRECTORY, "manifest.json"), "utf8"),
) as Manifest;

function uint24le(buffer: Buffer, offset: number): number {
  return buffer.readUInt8(offset)
    | (buffer.readUInt8(offset + 1) << 8)
    | (buffer.readUInt8(offset + 2) << 16);
}

function pngHeader(buffer: Buffer): ImageHeader {
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(buffer.toString("ascii", 12, 16)).toBe("IHDR");
  const colorType = buffer.readUInt8(25);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    alpha: colorType === 4 || colorType === 6,
  };
}

function webpHeader(buffer: Buffer): ImageHeader {
  expect(buffer.toString("ascii", 0, 4)).toBe("RIFF");
  expect(buffer.toString("ascii", 8, 12)).toBe("WEBP");

  let offset = 12;
  let alphaChunk = false;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (type === "ALPH") alphaChunk = true;
    if (type === "VP8X") {
      return {
        width: uint24le(buffer, data + 4) + 1,
        height: uint24le(buffer, data + 7) + 1,
        alpha: (buffer.readUInt8(data) & 0x10) !== 0,
      };
    }
    if (type === "VP8L") {
      expect(buffer.readUInt8(data)).toBe(0x2f);
      const dimensions = buffer.readUInt32LE(data + 1);
      return {
        width: (dimensions & 0x3fff) + 1,
        height: ((dimensions >>> 14) & 0x3fff) + 1,
        alpha: ((dimensions >>> 28) & 1) === 1,
      };
    }
    if (type === "VP8 ") {
      expect(buffer.subarray(data + 3, data + 6)).toEqual(Buffer.from([0x9d, 0x01, 0x2a]));
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
        alpha: alphaChunk,
      };
    }
    offset = data + length + (length & 1);
  }
  throw new Error("WebP has no image data chunk");
}

function imageHeader(file: string, buffer: Buffer): ImageHeader {
  if (file.endsWith(".png")) return pngHeader(buffer);
  if (file.endsWith(".webp")) return webpHeader(buffer);
  throw new Error(`Unsupported Lab asset format: ${file}`);
}

describe("Lab asset files", () => {
  it("declares exactly the runtime asset keys", () => {
    expect(Object.keys(manifest.assets).sort()).toEqual([...LAB_ASSET_KEYS].sort());
  });

  it("keeps every declared file present with matching dimensions and alpha", () => {
    for (const key of LAB_ASSET_KEYS) {
      const entry = manifest.assets[key];
      const buffer = readFileSync(resolve(ASSET_DIRECTORY, entry.file));
      expect(imageHeader(entry.file, buffer), key).toEqual({
        width: entry.width,
        height: entry.height,
        alpha: entry.alpha,
      });
    }
  });

  it("does not leave undeclared PNG or WebP assets beside the manifest", () => {
    const declared = new Set(Object.values(manifest.assets).map(({ file }) => file));
    const rasterFiles = readdirSync(ASSET_DIRECTORY)
      .filter((file) => file.endsWith(".png") || file.endsWith(".webp"));
    expect(rasterFiles.sort()).toEqual([...declared].sort());
  });

  it("marks only opaque world surfaces as repeatable", () => {
    const repeated = Object.entries(manifest.assets)
      .filter(([, entry]) => entry.repeat)
      .map(([key]) => key)
      .sort();
    expect(repeated).toEqual(["fog", "substrate"]);

    for (const [key, entry] of Object.entries(manifest.assets)) {
      expect(entry.role.length, `${key} must document its rendering role`).toBeGreaterThan(0);
      expect(entry.alpha, key).toBe(!entry.repeat);
    }
  });
});
