import { worldCells } from "../sim/factory-geom";
import {
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  MAX_FACTORY_MACHINES,
  MAX_GAME_FACTORY_CELLS,
  MAX_GAME_FACTORY_DIMENSION,
  MAX_TEMPLATE_STEPS,
  type Dir,
  type FactoryLayout,
  type FactoryTile,
  type Machine,
  type MachineCatalogEntry,
  type PlacedMachine,
  type Rotation,
  type Template,
} from "../sim/phase0_interfaces";

export const BLUEPRINT_FORMAT = "hexapharma-blueprint" as const;
export const BLUEPRINT_VERSION = 3 as const;
export const BLUEPRINT_RULESET = 3 as const;
export const MAX_BLUEPRINT_BYTES = 1_048_576;
export const MAX_BLUEPRINT_NAME_LENGTH = 80;

export type BlueprintKind = "research-program" | "factory-layout";

function contentFingerprint(): string {
  const payload = JSON.stringify({
    catalog: DEFAULT_CATALOG.map((entry) => ({
      typeId: entry.typeId,
      path: entry.path,
      cost: entry.cost,
      speed: entry.speed,
    })),
    shapes: Object.entries(DEFAULT_SHAPES).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index++) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export const BLUEPRINT_CONTENT_FINGERPRINT = contentFingerprint();

interface PortableTilePosition {
  readonly x: number;
  readonly y: number;
}

export type PortableFactoryTile =
  | (PortableTilePosition & { readonly kind: "belt"; readonly dir: Dir })
  | (PortableTilePosition & {
      readonly kind: "splitter";
      readonly inDir: Dir;
      readonly outDirs: readonly Dir[];
    })
  | (PortableTilePosition & {
      readonly kind: "merger";
      readonly inDirs: readonly Dir[];
      readonly outDir: Dir;
    })
  | (PortableTilePosition & {
      readonly kind: "source";
      readonly dir: Dir;
      readonly period: number;
    })
  | (PortableTilePosition & { readonly kind: "sink" });

export interface PortableResearchStep {
  readonly typeId: string;
}

export interface PortableFactoryMachine {
  readonly id: number;
  readonly typeId: string;
  readonly anchor: {
    readonly x: number;
    readonly y: number;
  };
  readonly footRot: Rotation;
}

interface PortableBlueprintBase {
  readonly name: string;
  readonly ruleset: typeof BLUEPRINT_RULESET;
  readonly content: string;
}

export interface PortableResearchBlueprint extends PortableBlueprintBase {
  readonly kind: "research-program";
  readonly program: {
    readonly steps: readonly PortableResearchStep[];
  };
}

export interface PortableFactoryBlueprint extends PortableBlueprintBase {
  readonly kind: "factory-layout";
  readonly layout: {
    readonly width: number;
    readonly height: number;
    readonly tiles: readonly PortableFactoryTile[];
    readonly machines: readonly PortableFactoryMachine[];
  };
}

export type PortableBlueprint = PortableResearchBlueprint | PortableFactoryBlueprint;

interface BlueprintDocument {
  readonly format: typeof BLUEPRINT_FORMAT;
  readonly version: typeof BLUEPRINT_VERSION;
  readonly checksum: string;
  readonly blueprint: PortableBlueprint;
}

type UnknownRecord = Record<string, unknown>;

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`blueprint: ${path} must be an object`);
  }
  return value as UnknownRecord;
}

function requireExactKeys(record: UnknownRecord, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) throw new Error(`blueprint: unknown field ${path}.${key}`);
  }
  for (const key of allowed) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      throw new Error(`blueprint: missing field ${path}.${key}`);
    }
  }
}

function requireInteger(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`blueprint: ${path} must be an integer from ${min} to ${max}`);
  }
  return Object.is(value, -0) ? 0 : value as number;
}

function requireDir(value: unknown, path: string): Dir {
  return requireInteger(value, path, 0, 3) as Dir;
}

function requireRotation(value: unknown, path: string): Rotation {
  return requireInteger(value, path, 0, 3) as Rotation;
}

function requireDirectionList(value: unknown, path: string): readonly Dir[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw new Error(`blueprint: ${path} must contain from 1 to 4 directions`);
  }
  const result = value.map((direction, index) => requireDir(direction, `${path}[${index}]`));
  if (new Set(result).size !== result.length) {
    throw new Error(`blueprint: ${path} must not contain duplicate directions`);
  }
  return result;
}

function requireName(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_BLUEPRINT_NAME_LENGTH ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new Error(
      `blueprint: name must be non-empty, contain no control characters, and be at most ` +
        `${MAX_BLUEPRINT_NAME_LENGTH} characters`,
    );
  }
  return value;
}

function catalogEntry(value: unknown, path: string): MachineCatalogEntry {
  if (typeof value !== "string") throw new Error(`blueprint: ${path} must be a string`);
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === value);
  if (entry === undefined) throw new Error(`blueprint: ${path} is an unknown machine type`);
  return entry;
}

function parseResearchStep(value: unknown, index: number): PortableResearchStep {
  const path = `blueprint.program.steps[${index}]`;
  const record = requireRecord(value, path);
  requireExactKeys(record, ["typeId"], path);
  const entry = catalogEntry(record.typeId, `${path}.typeId`);
  return { typeId: entry.typeId };
}

function parseProgram(value: unknown): PortableResearchBlueprint["program"] {
  const program = requireRecord(value, "blueprint.program");
  requireExactKeys(program, ["steps"], "blueprint.program");
  if (
    !Array.isArray(program.steps) ||
    program.steps.length < 1 ||
    program.steps.length > MAX_TEMPLATE_STEPS
  ) {
    throw new Error(
      `blueprint: program.steps must contain from 1 to ${MAX_TEMPLATE_STEPS} fixed-path steps`,
    );
  }
  return { steps: program.steps.map(parseResearchStep) };
}

function parseTile(value: unknown, width: number, height: number, index: number): PortableFactoryTile {
  const path = `blueprint.layout.tiles[${index}]`;
  const record = requireRecord(value, path);
  const x = requireInteger(record.x, `${path}.x`, 0, width - 1);
  const y = requireInteger(record.y, `${path}.y`, 0, height - 1);
  if (typeof record.kind !== "string") throw new Error(`blueprint: ${path}.kind must be a string`);

  switch (record.kind) {
    case "belt":
      requireExactKeys(record, ["x", "y", "kind", "dir"], path);
      return { x, y, kind: "belt", dir: requireDir(record.dir, `${path}.dir`) };
    case "splitter":
      requireExactKeys(record, ["x", "y", "kind", "inDir", "outDirs"], path);
      return {
        x,
        y,
        kind: "splitter",
        inDir: requireDir(record.inDir, `${path}.inDir`),
        outDirs: requireDirectionList(record.outDirs, `${path}.outDirs`),
      };
    case "merger":
      requireExactKeys(record, ["x", "y", "kind", "inDirs", "outDir"], path);
      return {
        x,
        y,
        kind: "merger",
        inDirs: requireDirectionList(record.inDirs, `${path}.inDirs`),
        outDir: requireDir(record.outDir, `${path}.outDir`),
      };
    case "source":
      requireExactKeys(record, ["x", "y", "kind", "dir", "period"], path);
      return {
        x,
        y,
        kind: "source",
        dir: requireDir(record.dir, `${path}.dir`),
        period: requireInteger(record.period, `${path}.period`, 1, 0x7fff_ffff),
      };
    case "sink":
      requireExactKeys(record, ["x", "y", "kind"], path);
      return { x, y, kind: "sink" };
    case "empty":
      throw new Error(`blueprint: ${path} must omit empty tiles from the sparse tile list`);
    default:
      throw new Error(`blueprint: ${path}.kind is unknown`);
  }
}

function parseFactoryMachine(
  value: unknown,
  width: number,
  height: number,
  index: number,
): PortableFactoryMachine {
  const path = `blueprint.layout.machines[${index}]`;
  const record = requireRecord(value, path);
  requireExactKeys(record, ["id", "typeId", "anchor", "footRot"], path);
  const entry = catalogEntry(record.typeId, `${path}.typeId`);
  if (DEFAULT_SHAPES[entry.typeId] === undefined) {
    throw new Error(`blueprint: ${path}.typeId has no local factory shape`);
  }
  const anchor = requireRecord(record.anchor, `${path}.anchor`);
  requireExactKeys(anchor, ["x", "y"], `${path}.anchor`);
  return {
    id: requireInteger(record.id, `${path}.id`, 0, 0x7fff_ffff),
    typeId: entry.typeId,
    anchor: {
      x: requireInteger(anchor.x, `${path}.anchor.x`, 0, width - 1),
      y: requireInteger(anchor.y, `${path}.anchor.y`, 0, height - 1),
    },
    footRot: requireRotation(record.footRot, `${path}.footRot`),
  };
}

function parseLayout(value: unknown): PortableFactoryBlueprint["layout"] {
  const layout = requireRecord(value, "blueprint.layout");
  requireExactKeys(layout, ["width", "height", "tiles", "machines"], "blueprint.layout");
  const width = requireInteger(layout.width, "blueprint.layout.width", 1, MAX_GAME_FACTORY_DIMENSION);
  const height = requireInteger(layout.height, "blueprint.layout.height", 1, MAX_GAME_FACTORY_DIMENSION);
  const area = width * height;
  if (area > MAX_GAME_FACTORY_CELLS) {
    throw new Error(`blueprint: layout dimensions must contain at most ${MAX_GAME_FACTORY_CELLS} cells`);
  }
  if (!Array.isArray(layout.tiles) || layout.tiles.length > area) {
    throw new Error("blueprint: layout tiles must be a bounded sparse array");
  }
  if (
    !Array.isArray(layout.machines) ||
    layout.machines.length > Math.min(area, MAX_FACTORY_MACHINES)
  ) {
    throw new Error("blueprint: layout machines must be a bounded array");
  }

  const tiles = layout.tiles.map((tile, index) => parseTile(tile, width, height, index));
  const tilePositions = new Set<number>();
  for (const tile of tiles) {
    const position = tile.y * width + tile.x;
    if (tilePositions.has(position)) throw new Error(`blueprint: duplicate tile at ${tile.x},${tile.y}`);
    tilePositions.add(position);
  }
  tiles.sort((left, right) => left.y - right.y || left.x - right.x);

  const machines = layout.machines.map((machine, index) =>
    parseFactoryMachine(machine, width, height, index));
  const machineIds = new Set<number>();
  for (const machine of machines) {
    if (machineIds.has(machine.id)) throw new Error(`blueprint: duplicate machine id ${machine.id}`);
    machineIds.add(machine.id);
  }
  machines.sort((left, right) => left.id - right.id);
  return { width, height, tiles, machines };
}

function parseBlueprint(value: unknown): PortableBlueprint {
  const record = requireRecord(value, "blueprint");
  if (record.kind !== "research-program" && record.kind !== "factory-layout") {
    throw new Error("blueprint: kind must be research-program or factory-layout");
  }
  const payloadKey = record.kind === "research-program" ? "program" : "layout";
  requireExactKeys(record, ["kind", "name", "ruleset", "content", payloadKey], "blueprint");
  const name = requireName(record.name);
  if (record.ruleset !== BLUEPRINT_RULESET) {
    throw new Error(`blueprint: unsupported ruleset ${String(record.ruleset)}`);
  }
  if (record.content !== BLUEPRINT_CONTENT_FINGERPRINT) {
    throw new Error(
      `blueprint: content fingerprint ${String(record.content)} does not match ` +
        BLUEPRINT_CONTENT_FINGERPRINT,
    );
  }

  if (record.kind === "research-program") {
    return {
      kind: "research-program",
      name,
      ruleset: BLUEPRINT_RULESET,
      content: BLUEPRINT_CONTENT_FINGERPRINT,
      program: parseProgram(record.program),
    };
  }
  return {
    kind: "factory-layout",
    name,
    ruleset: BLUEPRINT_RULESET,
    content: BLUEPRINT_CONTENT_FINGERPRINT,
    layout: parseLayout(record.layout),
  };
}

function materializeProgramCanonical(blueprint: PortableResearchBlueprint): Template {
  return {
    steps: blueprint.program.steps.map((step): Machine => {
      const entry = catalogEntry(step.typeId, "program step typeId");
      return {
        typeId: entry.typeId,
        path: [...entry.path],
      };
    }),
  };
}

function materializeLayoutCanonical(blueprint: PortableFactoryBlueprint): FactoryLayout {
  const { width, height } = blueprint.layout;
  const tiles: FactoryTile[] = Array.from({ length: width * height }, () => ({ kind: "empty" }));
  for (const tile of blueprint.layout.tiles) {
    const index = tile.y * width + tile.x;
    switch (tile.kind) {
      case "belt":
        tiles[index] = { kind: "belt", dir: tile.dir };
        break;
      case "splitter":
        tiles[index] = { kind: "splitter", inDir: tile.inDir, outDirs: [...tile.outDirs] };
        break;
      case "merger":
        tiles[index] = { kind: "merger", inDirs: [...tile.inDirs], outDir: tile.outDir };
        break;
      case "source":
        tiles[index] = { kind: "source", dir: tile.dir, period: tile.period };
        break;
      case "sink":
        tiles[index] = { kind: "sink" };
        break;
    }
  }

  const machines: PlacedMachine[] = blueprint.layout.machines.map((machine) => {
    const entry = catalogEntry(machine.typeId, `machine ${machine.id} typeId`);
    const shape = DEFAULT_SHAPES[entry.typeId];
    if (shape === undefined) {
      throw new Error(`blueprint: machine ${machine.id} is absent from the local shape catalog`);
    }
    return {
      id: machine.id,
      def: {
        typeId: entry.typeId,
        path: [...entry.path],
        cost: entry.cost,
        speed: entry.speed,
      },
      anchor: { x: machine.anchor.x, y: machine.anchor.y },
      footRot: machine.footRot,
      shape,
    };
  });

  const occupied = new Int32Array(width * height).fill(-1);
  for (const machine of machines) {
    for (const cell of worldCells(machine)) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height) {
        throw new Error(`blueprint: machine ${machine.id} footprint is out of bounds`);
      }
      const index = cell.y * width + cell.x;
      if ((occupied[index] ?? -1) >= 0) {
        throw new Error(`blueprint: machine ${machine.id} footprint overlaps another machine`);
      }
      if (tiles[index]?.kind !== "empty") {
        throw new Error(`blueprint: machine ${machine.id} footprint overlaps a routing tile`);
      }
      occupied[index] = machine.id;
    }
  }
  return { width, height, tiles, machines };
}

function validateGeometry(blueprint: PortableBlueprint): void {
  if (blueprint.kind === "factory-layout") materializeLayoutCanonical(blueprint);
}

function normalizeBlueprint(value: unknown): PortableBlueprint {
  const blueprint = parseBlueprint(value);
  validateGeometry(blueprint);
  return blueprint;
}

function canonicalPayload(blueprint: PortableBlueprint): string {
  return JSON.stringify(blueprint);
}

async function sha256(value: string): Promise<string> {
  if (globalThis.crypto?.subtle === undefined) {
    throw new Error("blueprint: SHA-256 requires Web Crypto support");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function blueprintChecksum(blueprint: PortableBlueprint): Promise<string> {
  return `sha256:${await sha256(canonicalPayload(blueprint))}`;
}

export async function encodeBlueprint(value: PortableBlueprint): Promise<string> {
  const blueprint = normalizeBlueprint(value);
  const document: BlueprintDocument = {
    format: BLUEPRINT_FORMAT,
    version: BLUEPRINT_VERSION,
    checksum: await blueprintChecksum(blueprint),
    blueprint,
  };
  const encoded = `${JSON.stringify(document, null, 2)}\n`;
  if (new TextEncoder().encode(encoded).byteLength > MAX_BLUEPRINT_BYTES) {
    throw new Error(`blueprint: encoded document exceeds ${MAX_BLUEPRINT_BYTES} bytes`);
  }
  return encoded;
}

export async function decodeBlueprint(source: string): Promise<PortableBlueprint> {
  if (typeof source !== "string") throw new Error("blueprint: source must be a string");
  if (new TextEncoder().encode(source).byteLength > MAX_BLUEPRINT_BYTES) {
    throw new Error(`blueprint: source exceeds ${MAX_BLUEPRINT_BYTES} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`blueprint: invalid JSON (${error instanceof Error ? error.message : String(error)})`, {
      cause: error,
    });
  }
  const document = requireRecord(parsed, "document");
  requireExactKeys(document, ["format", "version", "checksum", "blueprint"], "document");
  if (document.format !== BLUEPRINT_FORMAT) throw new Error("blueprint: unsupported format");
  if (document.version === 1 || document.version === 2) {
    throw new Error(`blueprint: legacy blueprint version ${document.version} is not supported by the v3 schema`);
  }
  if (document.version !== BLUEPRINT_VERSION) {
    throw new Error(`blueprint: unsupported version ${String(document.version)}`);
  }
  if (typeof document.checksum !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(document.checksum)) {
    throw new Error("blueprint: checksum must be a lowercase SHA-256 digest");
  }
  const blueprint = parseBlueprint(document.blueprint);
  const expected = await blueprintChecksum(blueprint);
  if (document.checksum !== expected) throw new Error("blueprint: checksum mismatch");
  validateGeometry(blueprint);
  return blueprint;
}

export function materializeResearchProgram(value: PortableBlueprint): Template {
  const blueprint = normalizeBlueprint(value);
  if (blueprint.kind !== "research-program") {
    throw new Error("blueprint: cannot materialize a Factory Blueprint as a ResearchProgram");
  }
  return materializeProgramCanonical(blueprint);
}

export function materializeFactoryLayout(value: PortableBlueprint): FactoryLayout {
  const blueprint = normalizeBlueprint(value);
  if (blueprint.kind !== "factory-layout") {
    throw new Error("blueprint: cannot materialize a Research Blueprint as a Factory layout");
  }
  return materializeLayoutCanonical(blueprint);
}

function portableTile(tile: FactoryTile, x: number, y: number): PortableFactoryTile | null {
  switch (tile.kind) {
    case "empty":
      return null;
    case "belt":
      return { x, y, kind: "belt", dir: tile.dir };
    case "splitter":
      return { x, y, kind: "splitter", inDir: tile.inDir, outDirs: [...tile.outDirs] };
    case "merger":
      return { x, y, kind: "merger", inDirs: [...tile.inDirs], outDir: tile.outDir };
    case "source":
      return { x, y, kind: "source", dir: tile.dir, period: tile.period };
    case "sink":
      return { x, y, kind: "sink" };
  }
}

function sameData(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function blueprintFromProgram(name: string, program: Template): PortableResearchBlueprint {
  if (!Array.isArray(program.steps)) throw new Error("blueprint: source program steps must be an array");
  const steps = program.steps.map((step, index): PortableResearchStep => {
    const entry = catalogEntry(step.typeId, `source program.steps[${index}].typeId`);
    if (!sameData(step.path, entry.path)) {
      throw new Error(`blueprint: source program.steps[${index}].path does not match the catalog`);
    }
    return { typeId: entry.typeId };
  });
  return normalizeBlueprint({
    kind: "research-program",
    name,
    ruleset: BLUEPRINT_RULESET,
    content: BLUEPRINT_CONTENT_FINGERPRINT,
    program: { steps },
  }) as PortableResearchBlueprint;
}

export function blueprintFromFactoryLayout(name: string, layout: FactoryLayout): PortableFactoryBlueprint {
  const width = requireInteger(layout.width, "source layout.width", 1, MAX_GAME_FACTORY_DIMENSION);
  const height = requireInteger(layout.height, "source layout.height", 1, MAX_GAME_FACTORY_DIMENSION);
  if (width * height > MAX_GAME_FACTORY_CELLS) {
    throw new Error(`blueprint: source layout must contain at most ${MAX_GAME_FACTORY_CELLS} cells`);
  }
  if (!Array.isArray(layout.tiles) || layout.tiles.length !== width * height) {
    throw new Error("blueprint: source layout tile count does not match its dimensions");
  }
  if (!Array.isArray(layout.machines)) {
    throw new Error("blueprint: source layout machines must be an array");
  }

  const tiles: PortableFactoryTile[] = [];
  for (let index = 0; index < layout.tiles.length; index++) {
    const tile = layout.tiles[index];
    if (tile === undefined || typeof tile !== "object") {
      throw new Error(`blueprint: source layout tile ${index} is invalid`);
    }
    const encoded = portableTile(tile, index % width, Math.floor(index / width));
    if (encoded === undefined) throw new Error(`blueprint: source layout tile ${index} kind is unknown`);
    if (encoded !== null) tiles.push(encoded);
  }

  const machines = layout.machines.map((machine, index): PortableFactoryMachine => {
    const entry = catalogEntry(machine.def.typeId, `source layout.machines[${index}].typeId`);
    const shape = DEFAULT_SHAPES[entry.typeId];
    if (shape === undefined) {
      throw new Error(`blueprint: source layout.machines[${index}] has no local factory shape`);
    }
    if (!sameData(machine.def.path, entry.path)) {
      throw new Error(`blueprint: source layout.machines[${index}].path does not match the catalog`);
    }
    if (machine.def.cost !== entry.cost || machine.def.speed !== entry.speed) {
      throw new Error(`blueprint: source layout.machines[${index}] cost/speed does not match the catalog`);
    }
    if (!sameData(machine.shape, shape)) {
      throw new Error(`blueprint: source layout.machines[${index}].shape does not match the catalog`);
    }
    return {
      id: machine.id,
      typeId: entry.typeId,
      anchor: { x: machine.anchor.x, y: machine.anchor.y },
      footRot: machine.footRot,
    };
  });

  return normalizeBlueprint({
    kind: "factory-layout",
    name,
    ruleset: BLUEPRINT_RULESET,
    content: BLUEPRINT_CONTENT_FINGERPRINT,
    layout: { width, height, tiles, machines },
  }) as PortableFactoryBlueprint;
}
