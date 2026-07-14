import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, type Template } from "../sim/phase0_interfaces";
import { blueprintFromProgram } from "./format";
import {
  BLUEPRINT_LIBRARY_KEY,
  BLUEPRINT_LIBRARY_VERSION,
  MAX_LIBRARY_BLUEPRINTS,
  deleteLibraryBlueprint,
  exportLibraryBlueprint,
  importLibraryBlueprint,
  listLibraryBlueprints,
  saveLibraryBlueprint,
} from "./storage";

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", { value: webcrypto });
  }
});

function fixture() {
  const entry = DEFAULT_CATALOG[0]!;
  const program: Template = {
    steps: [{ typeId: entry.typeId, path: entry.path, stroke: 2 }],
  };
  return blueprintFromProgram("Reusable Research program", program);
}

describe("cross-save Blueprint Library v2", () => {
  it("uses a breaking v2 namespace and persists checksummed documents outside save slots", async () => {
    expect(BLUEPRINT_LIBRARY_VERSION).toBe(2);
    expect(BLUEPRINT_LIBRARY_KEY).toBe("hexapharma.blueprint-library.v2");
    const storage = new MemoryStorage();
    const saved = await saveLibraryBlueprint(storage, fixture());
    expect(storage.getItem(BLUEPRINT_LIBRARY_KEY)).toContain("hexapharma-blueprint");
    expect(await listLibraryBlueprints(storage)).toEqual([saved]);
  });

  it("deduplicates the same canonical blueprint and supports JSON export/import", async () => {
    const source = new MemoryStorage();
    const first = await saveLibraryBlueprint(source, fixture());
    const second = await saveLibraryBlueprint(source, fixture());
    expect(second.id).toBe(first.id);
    expect(await listLibraryBlueprints(source)).toHaveLength(1);
    const document = await exportLibraryBlueprint(source, first.id);

    const target = new MemoryStorage();
    const imported = await importLibraryBlueprint(target, document);
    expect(imported.id).toBe(first.id);
    expect(await exportLibraryBlueprint(target, imported.id)).toBe(document);
  });

  it("deletes by stable id and rejects corrupt or legacy libraries atomically", async () => {
    const storage = new MemoryStorage();
    const saved = await saveLibraryBlueprint(storage, fixture());
    await deleteLibraryBlueprint(storage, saved.id);
    expect(await listLibraryBlueprints(storage)).toEqual([]);

    storage.setItem(BLUEPRINT_LIBRARY_KEY, JSON.stringify({ version: 2, entries: [{ bad: true }] }));
    await expect(listLibraryBlueprints(storage)).rejects.toThrow(/library|entry|field/i);

    storage.setItem(BLUEPRINT_LIBRARY_KEY, JSON.stringify({ version: 1, entries: [] }));
    await expect(listLibraryBlueprints(storage)).rejects.toThrow(/version 1/i);
  });

  it("rejects imported v1 Blueprint documents without changing storage", async () => {
    const storage = new MemoryStorage();
    const legacy = JSON.stringify({
      format: "hexapharma-blueprint",
      version: 1,
      checksum: `sha256:${"0".repeat(64)}`,
      blueprint: { kind: "research-route" },
    });

    await expect(importLibraryBlueprint(storage, legacy)).rejects.toThrow(/version 1/i);
    expect(storage.getItem(BLUEPRINT_LIBRARY_KEY)).toBeNull();
  });

  it("rejects a stored library above its entry cap before decoding documents", async () => {
    const storage = new MemoryStorage();
    storage.setItem(BLUEPRINT_LIBRARY_KEY, JSON.stringify({
      version: BLUEPRINT_LIBRARY_VERSION,
      entries: Array.from({ length: MAX_LIBRARY_BLUEPRINTS + 1 }, () => ({ bad: true })),
    }));
    await expect(listLibraryBlueprints(storage)).rejects.toThrow(/at most 64/i);
  });
});
