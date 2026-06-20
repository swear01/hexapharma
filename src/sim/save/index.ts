import type {
  GameState,
  GenOptions,
  EconomyState,
  PatentState,
  FactoryLayout,
  FactoryTile,
  FactoryMachineDef,
  PlacedMachine,
  MachineShape,
  Port,
  RngState,
  SerializeGameFn,
  DeserializeGameFn,
} from "../phase0_interfaces";

// HexaPharma save/load (Phase 3).
//
// GameState is deliberately plain-JSON-shaped (the level is stored as GenOptions
// and regenerated via seed-pure mapgen — no typed arrays to serialize), so a save
// is a stable-key-ordered JSON document tagged with a format version.
//
// Round-trip invariant (docs/invariants.md): deserializeGame(serializeGame(g))
// deep-equals g for any valid GameState. We achieve this by validating the parsed
// blob field-by-field and rebuilding a structurally-equal GameState — never
// defaulting silently on missing/wrong fields.

export const SAVE_VERSION = 1;

/** Tag carried by every serialized blob. Bump on incompatible format changes. */
interface SaveEnvelope {
  readonly version: number;
  readonly game: unknown;
}

export class SaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveError";
  }
}

// ── canonical JSON (stable key order ⇒ deterministic string) ──

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stable((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function canonical(value: unknown): string {
  return JSON.stringify(stable(value));
}

// ── validation helpers (no silent defaults: throw a clear SaveError) ──

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function reqObject(v: unknown, path: string): Record<string, unknown> {
  if (!isObject(v)) throw new SaveError(`${path}: expected object, got ${describe(v)}`);
  return v;
}

function reqArray(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new SaveError(`${path}: expected array, got ${describe(v)}`);
  return v;
}

function reqInt(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) {
    throw new SaveError(`${path}: expected integer, got ${describe(v)}`);
  }
  return v;
}

function reqNumber(v: unknown, path: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new SaveError(`${path}: expected finite number, got ${describe(v)}`);
  }
  return v;
}

function reqString(v: unknown, path: string): string {
  if (typeof v !== "string") throw new SaveError(`${path}: expected string, got ${describe(v)}`);
  return v;
}

function reqBool(v: unknown, path: string): boolean {
  if (typeof v !== "boolean") throw new SaveError(`${path}: expected boolean, got ${describe(v)}`);
  return v;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ── shape parsers (rebuild structurally-equal values) ──

function parseVec2(v: unknown, path: string): { x: number; y: number } {
  const o = reqObject(v, path);
  return { x: reqInt(o.x, `${path}.x`), y: reqInt(o.y, `${path}.y`) };
}

function parseGenOptions(v: unknown): GenOptions {
  const o = reqObject(v, "genOptions");
  const diff = reqObject(o.difficulty, "genOptions.difficulty");
  return {
    seed: reqInt(o.seed, "genOptions.seed"),
    nMaps: reqInt(o.nMaps, "genOptions.nMaps"),
    width: reqInt(o.width, "genOptions.width"),
    height: reqInt(o.height, "genOptions.height"),
    catalog: parseCatalog(o.catalog),
    diseaseCount: reqInt(o.diseaseCount, "genOptions.diseaseCount"),
    difficulty: {
      min: reqNumber(diff.min, "genOptions.difficulty.min"),
      max: reqNumber(diff.max, "genOptions.difficulty.max"),
    },
  };
}

function parseTransform(v: unknown, path: string): GenOptions["catalog"][number]["transform"] {
  const o = reqObject(v, path);
  const kind = reqString(o.kind, `${path}.kind`);
  switch (kind) {
    case "translate": {
      const rel = reqString(o.relation, `${path}.relation`);
      if (rel !== "forward" && rel !== "reverse" && rel !== "perpendicular" && rel !== "offset") {
        throw new SaveError(`${path}.relation: unknown TranslateRelation "${rel}"`);
      }
      return { kind: "translate", delta: parseVec2(o.delta, `${path}.delta`), relation: rel };
    }
    case "scale":
      return { kind: "scale", num: reqInt(o.num, `${path}.num`), den: reqInt(o.den, `${path}.den`) };
    case "swap":
      return { kind: "swap", a: reqInt(o.a, `${path}.a`), b: reqInt(o.b, `${path}.b`) };
    default:
      throw new SaveError(`${path}.kind: unknown Transform kind "${kind}"`);
  }
}

function parseCatalog(v: unknown): GenOptions["catalog"] {
  const arr = reqArray(v, "genOptions.catalog");
  return arr.map((e, i) => {
    const path = `genOptions.catalog[${i}]`;
    const o = reqObject(e, path);
    return {
      typeId: reqString(o.typeId, `${path}.typeId`),
      transform: parseTransform(o.transform, `${path}.transform`),
      cost: reqNumber(o.cost, `${path}.cost`),
      orientable: reqBool(o.orientable, `${path}.orientable`),
    };
  });
}

function parseEconomy(v: unknown): EconomyState {
  const o = reqObject(v, "economy");
  const sold = reqArray(o.sold, "economy.sold");
  return {
    cash: reqInt(o.cash, "economy.cash"),
    sold: sold.map((s, i) => {
      const path = `economy.sold[${i}]`;
      const so = reqObject(s, path);
      return {
        disease: reqInt(so.disease, `${path}.disease`),
        count: reqInt(so.count, `${path}.count`),
      };
    }),
  };
}

function parsePatents(v: unknown): PatentState {
  const o = reqObject(v, "patents");
  const unlocked = reqArray(o.unlocked, "patents.unlocked");
  return {
    unlocked: unlocked.map((u, i) => reqString(u, `patents.unlocked[${i}]`)),
  };
}

function parseOrientation(v: unknown, path: string): { rot: 0 | 1 | 2 | 3; flip: boolean } {
  const o = reqObject(v, path);
  const rot = reqInt(o.rot, `${path}.rot`);
  if (rot !== 0 && rot !== 1 && rot !== 2 && rot !== 3) {
    throw new SaveError(`${path}.rot: expected 0..3, got ${rot}`);
  }
  return { rot, flip: reqBool(o.flip, `${path}.flip`) };
}

function parseTile(v: unknown, path: string): FactoryTile {
  const o = reqObject(v, path);
  const kind = reqString(o.kind, `${path}.kind`);
  switch (kind) {
    case "empty":
      return { kind: "empty" };
    case "belt":
      return { kind: "belt", dir: parseDir(o.dir, `${path}.dir`) };
    case "source":
      return {
        kind: "source",
        dir: parseDir(o.dir, `${path}.dir`),
        period: reqInt(o.period, `${path}.period`),
      };
    case "sink":
      return { kind: "sink" };
    case "splitter":
      return {
        kind: "splitter",
        inDir: parseDir(o.inDir, `${path}.inDir`),
        outDirs: reqArray(o.outDirs, `${path}.outDirs`).map((d, i) =>
          parseDir(d, `${path}.outDirs[${i}]`),
        ),
      };
    case "merger":
      return {
        kind: "merger",
        inDirs: reqArray(o.inDirs, `${path}.inDirs`).map((d, i) =>
          parseDir(d, `${path}.inDirs[${i}]`),
        ),
        outDir: parseDir(o.outDir, `${path}.outDir`),
      };
    default:
      throw new SaveError(`${path}.kind: unknown FactoryTile kind "${kind}"`);
  }
}

function parseDir(v: unknown, path: string): 0 | 1 | 2 | 3 {
  const d = reqInt(v, path);
  if (d !== 0 && d !== 1 && d !== 2 && d !== 3) {
    throw new SaveError(`${path}: expected Dir 0..3, got ${d}`);
  }
  return d;
}

function parseMachineDef(v: unknown, path: string): FactoryMachineDef {
  const o = reqObject(v, path);
  return {
    typeId: reqString(o.typeId, `${path}.typeId`),
    transform: parseTransform(o.transform, `${path}.transform`),
    orientation: parseOrientation(o.orientation, `${path}.orientation`),
    cost: reqNumber(o.cost, `${path}.cost`),
    speed: reqInt(o.speed, `${path}.speed`),
  };
}

function parsePort(v: unknown, path: string): Port {
  const o = reqObject(v, path);
  return { cell: parseVec2(o.cell, `${path}.cell`), side: parseDir(o.side, `${path}.side`) };
}

function parseShape(v: unknown, path: string): MachineShape {
  const o = reqObject(v, path);
  return {
    cells: reqArray(o.cells, `${path}.cells`).map((c, i) => parseVec2(c, `${path}.cells[${i}]`)),
    inPorts: reqArray(o.inPorts, `${path}.inPorts`).map((p, i) => parsePort(p, `${path}.inPorts[${i}]`)),
    outPorts: reqArray(o.outPorts, `${path}.outPorts`).map((p, i) =>
      parsePort(p, `${path}.outPorts[${i}]`),
    ),
  };
}

function parsePlacedMachine(v: unknown, path: string): PlacedMachine {
  const o = reqObject(v, path);
  const footRot = reqInt(o.footRot, `${path}.footRot`);
  if (footRot !== 0 && footRot !== 1 && footRot !== 2 && footRot !== 3) {
    throw new SaveError(`${path}.footRot: expected 0..3, got ${footRot}`);
  }
  return {
    id: reqInt(o.id, `${path}.id`),
    def: parseMachineDef(o.def, `${path}.def`),
    anchor: parseVec2(o.anchor, `${path}.anchor`),
    footRot,
    shape: parseShape(o.shape, `${path}.shape`),
  };
}

function parseFactory(v: unknown): FactoryLayout {
  const o = reqObject(v, "factory");
  const width = reqInt(o.width, "factory.width");
  const height = reqInt(o.height, "factory.height");
  const tiles = reqArray(o.tiles, "factory.tiles");
  if (tiles.length !== width * height) {
    throw new SaveError(
      `factory.tiles: length ${tiles.length} !== width*height (${width}*${height}=${width * height})`,
    );
  }
  const parsedTiles = tiles.map((t, i) => parseTile(t, `factory.tiles[${i}]`));
  const machines = reqArray(o.machines, "factory.machines");
  return {
    width,
    height,
    tiles: parsedTiles,
    machines: machines.map((m, i) => parsePlacedMachine(m, `factory.machines[${i}]`)),
  };
}

function parseRng(v: unknown): RngState {
  const o = reqObject(v, "rng");
  return { s: reqInt(o.s, "rng.s") };
}

function parseGameState(v: unknown): GameState {
  const o = reqObject(v, "game");
  return {
    genOptions: parseGenOptions(o.genOptions),
    economy: parseEconomy(o.economy),
    patents: parsePatents(o.patents),
    factory: parseFactory(o.factory),
    rng: parseRng(o.rng),
  };
}

// ── public API ──

export const serializeGame: SerializeGameFn = (g) => {
  const envelope: SaveEnvelope = { version: SAVE_VERSION, game: g };
  return canonical(envelope);
};

export const deserializeGame: DeserializeGameFn = (s) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new SaveError(`malformed save: invalid JSON (${(e as Error).message})`);
  }
  const env = reqObject(parsed, "save");
  if (!("version" in env)) throw new SaveError("save: missing version tag");
  const version = reqInt(env.version, "save.version");
  if (version !== SAVE_VERSION) {
    throw new SaveError(`save: incompatible version ${version} (expected ${SAVE_VERSION})`);
  }
  if (!("game" in env)) throw new SaveError("save: missing game payload");
  return parseGameState(env.game);
};

// ── multi-save / rewind (snapshot history) ──
//
// A run keeps a list of GameState snapshots; rewind = drop back to an earlier one.
// serializeSlots/deserializeSlots persist the whole list as one versioned blob.

export const serializeSlots = (states: readonly GameState[]): string => {
  const envelope = { version: SAVE_VERSION, slots: states };
  return canonical(envelope);
};

export const deserializeSlots = (s: string): GameState[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (e) {
    throw new SaveError(`malformed slots: invalid JSON (${(e as Error).message})`);
  }
  const env = reqObject(parsed, "slots");
  if (!("version" in env)) throw new SaveError("slots: missing version tag");
  const version = reqInt(env.version, "slots.version");
  if (version !== SAVE_VERSION) {
    throw new SaveError(`slots: incompatible version ${version} (expected ${SAVE_VERSION})`);
  }
  const arr = reqArray(env.slots, "slots.slots");
  return arr.map((g, i) => parseGameState((reqObject({ game: g }, `slots[${i}]`)).game));
};

/** Push a snapshot onto a rewind history (returns a new array; does not mutate). */
export const pushSnapshot = (history: readonly GameState[], g: GameState): GameState[] => [
  ...history,
  g,
];

/**
 * Rewind to the snapshot `stepsBack` before the latest (default 1 = previous).
 * Returns the recalled state and the truncated history ending at that state.
 */
export const rewind = (
  history: readonly GameState[],
  stepsBack = 1,
): { state: GameState; history: GameState[] } => {
  if (!Number.isInteger(stepsBack) || stepsBack < 0) {
    throw new SaveError(`rewind: stepsBack must be a non-negative integer, got ${stepsBack}`);
  }
  const idx = history.length - 1 - stepsBack;
  const state = history[idx];
  if (idx < 0 || state === undefined) {
    throw new SaveError(`rewind: cannot go back ${stepsBack} from history of length ${history.length}`);
  }
  return { state, history: history.slice(0, idx + 1) };
};
