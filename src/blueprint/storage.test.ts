import { webcrypto } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { compileEntitledPrototype } from "../sim/recipe";
import { generate } from "../sim/mapgen";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
} from "../sim/phase0_interfaces";
import { blueprintFromLayout } from "./format";
import {
  BLUEPRINT_LIBRARY_KEY,
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
  const options = {
    seed: 14,
    nMaps: 1,
    width: 32,
    height: 32,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 1,
    difficulty: { min: 4, max: 12 },
  } as const;
  const template = generate(options).diseases[0]!.reference;
  const layout = compileEntitledPrototype(
    template,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  return blueprintFromLayout("research-route", "Seed 14 route", layout);
}

describe("cross-save Blueprint Library", () => {
  it("persists an independently checksummed blueprint outside save slots", async () => {
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

  it("deletes by stable id and rejects a corrupt library atomically", async () => {
    const storage = new MemoryStorage();
    const saved = await saveLibraryBlueprint(storage, fixture());
    await deleteLibraryBlueprint(storage, saved.id);
    expect(await listLibraryBlueprints(storage)).toEqual([]);

    storage.setItem(BLUEPRINT_LIBRARY_KEY, JSON.stringify({ version: 1, entries: [{ bad: true }] }));
    await expect(listLibraryBlueprints(storage)).rejects.toThrow(/library|entry|field/i);
  });
});
