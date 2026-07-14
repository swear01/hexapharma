import {
  MAX_BLUEPRINT_BYTES,
  decodeBlueprint,
  encodeBlueprint,
  type PortableBlueprint,
} from "./format";

export const BLUEPRINT_LIBRARY_KEY = "hexapharma.blueprint-library.v2";
export const BLUEPRINT_LIBRARY_VERSION = 2 as const;
export const MAX_LIBRARY_BLUEPRINTS = 64;
export const MAX_LIBRARY_BYTES = 4_000_000;

export interface LibraryBlueprint {
  readonly id: string;
  readonly document: string;
  readonly blueprint: PortableBlueprint;
}

interface StoredEntry {
  readonly id: string;
  readonly document: string;
}

interface StoredLibrary {
  readonly version: typeof BLUEPRINT_LIBRARY_VERSION;
  readonly entries: readonly StoredEntry[];
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`blueprint library: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`blueprint library: ${path} fields are invalid`);
  }
}

function checksumId(document: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document) as unknown;
  } catch (error) {
    throw new Error(
      `blueprint library: document is invalid JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
  const value = record(parsed, "document");
  const checksum = value.checksum;
  if (typeof checksum !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(checksum)) {
    throw new Error("blueprint library: document checksum is invalid");
  }
  return checksum;
}

function parseStoredLibrary(raw: string | null): StoredLibrary {
  if (raw === null) return { version: BLUEPRINT_LIBRARY_VERSION, entries: [] };
  if (new TextEncoder().encode(raw).byteLength > MAX_LIBRARY_BYTES) {
    throw new Error(`blueprint library: storage exceeds ${MAX_LIBRARY_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(
      `blueprint library: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  }
  const root = record(parsed, "root");
  exactKeys(root, ["version", "entries"], "root");
  if (root.version !== BLUEPRINT_LIBRARY_VERSION) {
    throw new Error(`blueprint library: unsupported version ${String(root.version)}`);
  }
  if (!Array.isArray(root.entries) || root.entries.length > MAX_LIBRARY_BLUEPRINTS) {
    throw new Error(`blueprint library: entries must contain at most ${MAX_LIBRARY_BLUEPRINTS} items`);
  }
  const ids = new Set<string>();
  const entries = root.entries.map((value, index): StoredEntry => {
    const entry = record(value, `entries[${index}]`);
    exactKeys(entry, ["id", "document"], `entries[${index}]`);
    if (typeof entry.id !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(entry.id)) {
      throw new Error(`blueprint library: entries[${index}].id is invalid`);
    }
    if (ids.has(entry.id)) throw new Error(`blueprint library: duplicate id ${entry.id}`);
    ids.add(entry.id);
    if (
      typeof entry.document !== "string" ||
      new TextEncoder().encode(entry.document).byteLength > MAX_BLUEPRINT_BYTES
    ) {
      throw new Error(`blueprint library: entries[${index}].document is invalid or too large`);
    }
    if (checksumId(entry.document) !== entry.id) {
      throw new Error(`blueprint library: entries[${index}] id does not match its document`);
    }
    return { id: entry.id, document: entry.document };
  });
  return { version: BLUEPRINT_LIBRARY_VERSION, entries };
}

async function materializeLibrary(library: StoredLibrary): Promise<readonly LibraryBlueprint[]> {
  const result: LibraryBlueprint[] = [];
  for (const entry of library.entries) {
    result.push({
      id: entry.id,
      document: entry.document,
      blueprint: await decodeBlueprint(entry.document),
    });
  }
  return result;
}

function writeLibrary(storage: Storage, entries: readonly StoredEntry[]): void {
  const raw = JSON.stringify({ version: BLUEPRINT_LIBRARY_VERSION, entries });
  if (new TextEncoder().encode(raw).byteLength > MAX_LIBRARY_BYTES) {
    throw new Error(`blueprint library: storage exceeds ${MAX_LIBRARY_BYTES} bytes`);
  }
  storage.setItem(BLUEPRINT_LIBRARY_KEY, raw);
}

export async function listLibraryBlueprints(storage: Storage): Promise<readonly LibraryBlueprint[]> {
  return materializeLibrary(parseStoredLibrary(storage.getItem(BLUEPRINT_LIBRARY_KEY)));
}

export async function saveLibraryBlueprint(
  storage: Storage,
  blueprint: PortableBlueprint,
): Promise<LibraryBlueprint> {
  const current = await listLibraryBlueprints(storage);
  const document = await encodeBlueprint(blueprint);
  const id = checksumId(document);
  const entry = { id, document, blueprint: await decodeBlueprint(document) };
  const existing = current.findIndex((candidate) => candidate.id === id);
  if (existing >= 0) return current[existing]!;
  if (current.length >= MAX_LIBRARY_BLUEPRINTS) {
    throw new Error(`blueprint library: cannot exceed ${MAX_LIBRARY_BLUEPRINTS} blueprints`);
  }
  writeLibrary(storage, [
    ...current.map((candidate) => ({ id: candidate.id, document: candidate.document })),
    { id, document },
  ]);
  return entry;
}

export async function importLibraryBlueprint(
  storage: Storage,
  document: string,
): Promise<LibraryBlueprint> {
  return saveLibraryBlueprint(storage, await decodeBlueprint(document));
}

export async function exportLibraryBlueprint(storage: Storage, id: string): Promise<string> {
  const entry = (await listLibraryBlueprints(storage)).find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`blueprint library: unknown id ${id}`);
  return entry.document;
}

export async function deleteLibraryBlueprint(storage: Storage, id: string): Promise<void> {
  const current = await listLibraryBlueprints(storage);
  const next = current.filter((candidate) => candidate.id !== id);
  if (next.length === current.length) throw new Error(`blueprint library: unknown id ${id}`);
  writeLibrary(storage, next.map((candidate) => ({ id: candidate.id, document: candidate.document })));
}
