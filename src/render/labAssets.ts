export const LAB_ASSET_KEYS = [
  "substrate",
  "fog",
  "wall",
  "hazard",
  "sideEffect",
  "cure",
  "drug",
  "halo",
] as const;

export type LabAssetKey = (typeof LAB_ASSET_KEYS)[number];
export type LabAssetUrls = Readonly<Record<LabAssetKey, string>>;

export function labAssetUrls(value: unknown): LabAssetUrls {
  if (typeof value !== "object" || value === null) throw new Error("Lab asset manifest must be an object");
  const manifest = value as { baseUrl?: unknown; assets?: unknown };
  if (typeof manifest.baseUrl !== "string" || !manifest.baseUrl.startsWith("/") || !manifest.baseUrl.endsWith("/")) {
    throw new Error("Lab asset manifest baseUrl must be an absolute directory URL");
  }
  if (typeof manifest.assets !== "object" || manifest.assets === null) {
    throw new Error("Lab asset manifest assets must be an object");
  }
  const assets = manifest.assets as Record<string, unknown>;
  const urls = {} as Record<LabAssetKey, string>;
  for (const key of LAB_ASSET_KEYS) {
    const entry = assets[key];
    const file = typeof entry === "object" && entry !== null
      ? (entry as { file?: unknown }).file
      : undefined;
    if (typeof file !== "string" || file.length === 0 || file.includes("/") || file.includes("..")) {
      throw new Error(`Lab asset manifest entry "${key}" has an invalid file`);
    }
    urls[key] = `${manifest.baseUrl}${file}`;
  }
  return Object.freeze(urls);
}
