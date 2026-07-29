export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function asJsonRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new Error(`${path}: expected object`);
  }
  return value;
}
