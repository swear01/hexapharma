/**
 * HexaPharma — the Factory (Phase 2 visual, NEW model).
 *
 * The top-level GameState owns the authoritative layout/runtime; this component
 * owns only editing controls and sends intents through callbacks. It hands plain
 * sim state to the dumb PixiJS renderer (src/render/factoryRenderer).
 * NO tick/throughput logic lives here — we only CALL the sim. See AGENTS.md layering.
 *
 * NEW model recap:
 *  - Machines are NOT tiles. A PlacedMachine = { id, def, anchor, footRot, shape }.
 *    Its WORLD footprint = local shape rotated by `footRot` sixth-turns CW about
 *    the anchor; `def.path` remains fixed.
 *  - Belts/splitters/mergers/source/sink are tiles; splitter fans one input out
 *    round-robin, merger fans inputs into one output → REAL parallelism: a
 *    source→splitter→[two machines]→merger→sink out-produces a single machine.
 *
 * A facility with no authority opens as an empty entitled floor. Nothing is
 * auto-packed or committed: the player builds geometry directly, and Production
 * sends edits to the game reducer.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { MachineIcon } from "./MachineIcon";
import { CommandGlyph } from "./CommandGlyph";
import { blockingDialogOpen } from "./blockingDialog";
import { machineName } from "./machineLabels";
import { outcomeEffectText } from "./effectLabels";
import type {
  Dir,
  HexCoord,
  Rotation,
  PlacedMachine,
  MachineShape,
  FactoryTile,
  FactoryLayout,
  FactoryMachineDef,
  FactoryRuntime,
  MachineCatalogEntry,
  MachineTypeId,
  GeneratedLevel,
  MultiMap,
  ThroughputReport,
  Outcome,
  Machine,
  Template,
} from "../sim/phase0_interfaces";
import { BASE_NAMES, DEFAULT_CATALOG, DEFAULT_SHAPES } from "../sim/phase0_interfaces";
import { initFactory, analyzeThroughput } from "../sim/factory-sim";
import { factoryOutcome } from "../sim/recipe";
import { quoteProductionBuild } from "../sim/construction";
import { worldCells } from "../sim/factory-geom";
import { hexInBounds, hexIndex } from "../sim/hex";
import { buildFactoryTransportTopology, type FactoryTransportEdge } from "../render/factoryTransportTopology";
import { inkJitter } from "../render/ink";
import { hexBoardBounds, hexPolygon, hexToPixel } from "../render/hexProjection";
import type { FactoryGhost, FactoryGhostTile, FactoryRenderer } from "../render/factoryRenderer";
import { BasePicker, LockGlyph } from "./BasePicker";
import {
  boxCells,
  copySelection,
  eraseItems,
  itemCells,
  moveSelection,
  placeFragment,
  rotateSelection,
  transformFragment,
  type FactoryClipboard,
} from "./factorySelection";
import {
  appendUniqueCells,
  clampCamera,
  createEditorHistory,
  panCamera,
  pushEditorHistory,
  rasterizeGridLine,
  routeBeltGesture,
  orientBeltGesture,
  reconcilePendingCommit,
  redoEditorHistory,
  screenToGrid,
  undoEditorHistory,
  zoomCameraAt,
  type Camera,
  type EditorHistory,
  type GridCell,
} from "./factoryEditor";

// ───────────────────────────── directions ─────────────────────────────

const E: Dir = 0;
function opposite(d: Dir): Dir {
  return ((d + 3) % 6) as Dir;
}

function emptyTiles(w: number, h: number): FactoryTile[] {
  return Array.from({ length: w * h }, () => ({ kind: "empty" }));
}

// ───────────────────────────── machine geometry ─────────────────────────────

/** The machine (if any) whose rotated footprint covers world cell (q,r). */
function machineAt(layout: FactoryLayout, q: number, r: number): PlacedMachine | undefined {
  for (const m of layout.machines) {
    for (const c of worldCells(m)) {
      if (c.q === q && c.r === r) return m;
    }
  }
  return undefined;
}

export function directGestureMachineAt(
  layout: FactoryLayout,
  q: number,
  r: number,
  eraseActive: boolean,
): PlacedMachine | undefined {
  return eraseActive ? undefined : machineAt(layout, q, r);
}

export function factoryErasePreviewCells(
  layout: FactoryLayout,
  q: number,
  r: number,
): readonly HexCoord[] {
  const machine = machineAt(layout, q, r);
  return machine === undefined ? [{ q, r }] : worldCells(machine);
}

export function transformPlacedMachine(
  layout: FactoryLayout,
  machineId: number,
  anchor: HexCoord,
  footRot: Rotation,
): FactoryLayout {
  const machineIndex = layout.machines.findIndex((machine) => machine.id === machineId);
  const current = layout.machines[machineIndex];
  if (current === undefined) return layout;
  if (
    current.anchor.q === anchor.q &&
    current.anchor.r === anchor.r &&
    current.footRot === footRot
  ) {
    return layout;
  }

  const transformed: PlacedMachine = { ...current, anchor, footRot };
  for (const cell of worldCells(transformed)) {
    if (!hexInBounds(layout.width, layout.height, cell.q, cell.r)) return layout;
    if (layout.tiles[hexIndex(layout.width, cell.q, cell.r)]?.kind !== "empty") return layout;
    const occupied = machineAt(layout, cell.q, cell.r);
    if (occupied !== undefined && occupied.id !== machineId) return layout;
  }

  const machines = layout.machines.slice();
  machines[machineIndex] = transformed;
  return { ...layout, machines };
}

function nextMachineId(layout: FactoryLayout): number {
  let max = -1;
  for (const m of layout.machines) if (m.id > max) max = m.id;
  return max + 1;
}

// ───────────────────────────── facility layouts ─────────────────────────────

function entryOf(typeId: MachineTypeId): MachineCatalogEntry {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`Factory: unknown machine type "${typeId}"`);
  return entry;
}

export function machineTooltip(entry: MachineCatalogEntry): string {
  return `${machineName(entry.typeId)} · ${entry.speed} ticks/unit · Processing $${entry.cost}/unit`;
}

/** Why a machine is not on the toolbelt yet, in player terms. */
export function machineLockReason(typeId: MachineTypeId): string {
  return `${machineName(typeId)} off · turn it on in Technology`;
}

export const ROUTING_LOCK_REASON = "Splitter and Merger off · turn on Split / Merge in Technology";

/** Id of a rejected machine ghost: it is in no layout, so no real machine (ids ≥ 0) can share it. */
const UNPLACED_MACHINE_ID = -1;

function machineDef(typeId: MachineTypeId): FactoryMachineDef {
  const entry = entryOf(typeId);
  return {
    typeId,
    path: entry.path,
    turn: entry.turn,
    cost: entry.cost,
    speed: entry.speed,
  };
}

export function initialFacilityLayout(
  layout: FactoryLayout | null,
  entitledWidth: number,
  entitledHeight: number,
): FactoryLayout {
  if (layout !== null) return layout;
  return {
    width: entitledWidth,
    height: entitledHeight,
    tiles: emptyTiles(entitledWidth, entitledHeight),
    machines: [],
  };
}

export interface PixelBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Pixel bounds of everything built (machines and tiles), padded by one cell; null on an empty floor. */
export function factoryLayoutBounds(layout: FactoryLayout): PixelBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (q: number, r: number) => {
    const center = factoryCellCenter({ q, r });
    minX = Math.min(minX, center.x);
    minY = Math.min(minY, center.y);
    maxX = Math.max(maxX, center.x);
    maxY = Math.max(maxY, center.y);
  };
  for (const machine of layout.machines) {
    for (const cell of worldCells(machine)) include(cell.q, cell.r);
  }
  for (let index = 0; index < layout.tiles.length; index++) {
    if (layout.tiles[index]?.kind !== "empty") include(index % layout.width, Math.floor(index / layout.width));
  }
  if (minX === Infinity) return null;
  const margin = FACTORY_HEX_WIDTH * 1.5;
  return { minX: minX - margin, minY: minY - margin, maxX: maxX + margin, maxY: maxY + margin };
}

/** Pixel centre of the first Source, where a line starts. */
export function factoryStartPoint(layout: FactoryLayout): { readonly x: number; readonly y: number } | null {
  const index = layout.tiles.findIndex((tile) => tile.kind === "source");
  return index < 0 ? null : factoryCellCenter({ q: index % layout.width, r: Math.floor(index / layout.width) });
}

function factoryFloorBounds(layout: FactoryLayout): PixelBounds {
  const bounds = hexBoardBounds(layout.width, layout.height, FACTORY_HEX_SIZE);
  return { minX: PAD, minY: PAD, maxX: PAD + bounds.maxX - bounds.minX, maxY: PAD + bounds.maxY - bounds.minY };
}

/** Machines the first unit from the first Source passes through on its way to a Sink (a Splitter sends it out its first connected output, as the sim does), and that Source's base. */
export function factoryLineProgram(layout: FactoryLayout): { readonly program: Template; readonly base: number } | null {
  const topology = buildFactoryTransportTopology(layout);
  const area = layout.width * layout.height;
  const owner = new Int32Array(area).fill(-1);
  const byId = new Map<number, PlacedMachine>();
  for (const machine of layout.machines) {
    byId.set(machine.id, machine);
    for (const cell of worldCells(machine)) owner[hexIndex(layout.width, cell.q, cell.r)] = machine.id;
  }
  const exits: FactoryTransportEdge[][] = Array.from({ length: area }, () => []);
  for (const edge of topology.edges) exits[hexIndex(layout.width, edge.from.q, edge.from.r)]!.push(edge);
  const steps: Machine[] = [];
  const seen = new Uint8Array(area);
  let at = layout.tiles.findIndex((tile) => tile.kind === "source");
  const source = layout.tiles[at];
  const base = source?.kind === "source" ? source.base : 0;
  while (at >= 0 && seen[at] === 0) {
    const tile = layout.tiles[at];
    if (tile?.kind === "sink") return steps.length > 0 ? { program: { steps }, base } : null;
    seen[at] = 1;
    let options = exits[at]!;
    const machine = byId.get(owner[at]!);
    if (machine !== undefined) {
      steps.push({ typeId: machine.def.typeId, path: machine.def.path, turn: machine.def.turn });
      options = [];
      for (const cell of worldCells(machine)) {
        const index = hexIndex(layout.width, cell.q, cell.r);
        seen[index] = 1;
        options = options.concat(exits[index]!);
      }
    }
    const edge = tile?.kind === "splitter"
      ? tile.outDirs.map((dir) => options.find((candidate) => candidate.dir === dir)).find((candidate) => candidate !== undefined)
      : options[0];
    at = edge === undefined ? -1 : hexIndex(layout.width, edge.to.q, edge.to.r);
  }
  return null;
}

const PAPER_TILE_CELLS = 120;
const PAPER_STEP = 12;
const PAPER_SEED = 0x51f3;
let paperTexture: string | null = null;

/**
 * Unbuilt ground around the floor: paper-sunk with faint contour ink, like the Atlas's unprinted
 * paper. A periodic height field run through marching squares gives a seamless tile; crossings
 * wobble by inkJitter keyed to the shared grid edge, so the tile is deterministic. Built once.
 */
export function factoryPaperTexture(): string {
  if (paperTexture !== null) return paperTexture;
  const n = PAPER_TILE_CELLS;
  const tau = Math.PI * 2;
  const height = (i: number, j: number) => {
    const x = (((i % n) + n) % n) / n * tau;
    const y = (((j % n) + n) % n) / n * tau;
    return Math.sin(3 * x + 1.6 * Math.sin(2 * y + 0.4)) + Math.sin(4 * y + 1.4 * Math.sin(3 * x + 1.9))
      + 0.55 * Math.sin(5 * x - 2 * y + 2.3) + 0.45 * Math.sin(x + 2 * y + 1.1) + 0.35 * Math.sin(2 * x + 5 * y + 0.7);
  };
  const interval = 0.42;
  let thin = "";
  let index = "";
  const crossing = (gi: number, gj: number, vertical: boolean, a: number, b: number, threshold: number, level: number) => {
    const key = Math.imul(((gi % n) + n) % n, 7_919) ^ Math.imul(((gj % n) + n) % n, 104_729) ^ (vertical ? 1 : 0);
    const t = Math.min(1, Math.max(0, (threshold - a) / (b - a) + inkJitter(key ^ PAPER_SEED, level) * 0.07));
    const x = (vertical ? gi : gi + t) * PAPER_STEP;
    const y = (vertical ? gj + t : gj) * PAPER_STEP;
    return `${x.toFixed(1)} ${y.toFixed(1)}`;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v0 = height(i, j);
      const v1 = height(i + 1, j);
      const v2 = height(i + 1, j + 1);
      const v3 = height(i, j + 1);
      const hi = Math.max(v0, v1, v2, v3);
      for (let level = Math.ceil(Math.min(v0, v1, v2, v3) / interval - 0.5); (level + 0.5) * interval <= hi; level++) {
        const threshold = (level + 0.5) * interval;
        const code = (v0 > threshold ? 1 : 0) | (v1 > threshold ? 2 : 0) | (v2 > threshold ? 4 : 0) | (v3 > threshold ? 8 : 0);
        if (code === 0 || code === 15) continue;
        const top = () => crossing(i, j, false, v0, v1, threshold, level);
        const right = () => crossing(i + 1, j, true, v1, v2, threshold, level);
        const bottom = () => crossing(i, j + 1, false, v3, v2, threshold, level);
        const left = () => crossing(i, j, true, v0, v3, threshold, level);
        const segment = (a: string, b: string) => {
          if (((level % 5) + 5) % 5 === 0) index += `M${a}L${b}`;
          else thin += `M${a}L${b}`;
        };
        switch (code) {
          case 1: case 14: segment(left(), top()); break;
          case 2: case 13: segment(top(), right()); break;
          case 3: case 12: segment(left(), right()); break;
          case 4: case 11: segment(right(), bottom()); break;
          case 6: case 9: segment(top(), bottom()); break;
          case 7: case 8: segment(left(), bottom()); break;
          case 5: segment(left(), top()); segment(right(), bottom()); break;
          case 10: segment(top(), right()); segment(left(), bottom()); break;
        }
      }
    }
  }
  const size = n * PAPER_STEP;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<path d="${thin}" fill="none" stroke="#a0673a" stroke-opacity=".22" stroke-width="1" stroke-linecap="round"/>`
    + `<path d="${index}" fill="none" stroke="#a0673a" stroke-opacity=".3" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  paperTexture = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  return paperTexture;
}

// ───────────────────────────── palette / editing ─────────────────────────────

type Brush =
  | { kind: "belt" }
  | { kind: "splitter" }
  | { kind: "merger" }
  | { kind: "source" }
  | { kind: "sink" }
  | { kind: "erase" }
  | { kind: "select" }
  | { kind: "machine"; typeId: MachineTypeId };

interface PickedBrush {
  readonly brush: Brush;
  readonly dir: Dir;
  readonly base: number;
  readonly footRot: Rotation;
}

type CanvasGesture =
  | {
      readonly pointerId: number;
      readonly mode: "paint" | "erase";
      readonly base: FactoryLayout;
      readonly cells: readonly GridCell[];
      readonly last: GridCell;
    }
  | {
      readonly pointerId: number;
      readonly mode: "move";
      readonly base: FactoryLayout;
      readonly cells: readonly GridCell[];
      readonly last: GridCell;
      readonly machineId: number;
      readonly anchorOffset: HexCoord;
      readonly footRot: Rotation;
    }
  | {
      /** Erase or select every item in the box from `start` to `last`. */
      readonly pointerId: number;
      readonly mode: "box";
      readonly base: FactoryLayout;
      readonly start: GridCell;
      readonly last: GridCell;
      readonly erase: boolean;
      readonly additive: boolean;
    }
  | {
      /** Move the selection so `start` lands on `last`, turned `rot`. */
      readonly pointerId: number;
      readonly mode: "drag";
      readonly base: FactoryLayout;
      readonly start: GridCell;
      readonly last: GridCell;
      readonly rot: Rotation;
    }
  | {
      /** Place the held paste at `last` on release. */
      readonly pointerId: number;
      readonly mode: "paste";
      readonly base: FactoryLayout;
      readonly last: GridCell;
    };

const DIR_LABEL: Record<Dir, string> = {
  0: "E",
  1: "SE",
  2: "SW",
  3: "W",
  4: "NW",
  5: "NE",
};

type TileBrushKind = Exclude<Brush["kind"], "machine">;

/** Legend glyphs for transport tools; they match the symbols printed on the floor. */
function ToolGlyph({ kind }: { readonly kind: TileBrushKind }) {
  const common = { width: 30, height: 30, viewBox: "0 0 30 30", fill: "none", "aria-hidden": true, focusable: false } as const;
  switch (kind) {
    case "belt":
      return <svg {...common}><path d="M3 15h24" stroke="var(--flow)" strokeWidth="7" /><path d="M13 11l4 4-4 4" stroke="var(--paper-raised)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "splitter":
      return <svg {...common}><path d="M3 15h12l9-8M15 15l9 8" stroke="var(--flow)" strokeWidth="5" strokeLinejoin="round" /><circle cx="15" cy="15" r="5" fill="var(--paper-raised)" stroke="currentColor" strokeWidth="2" /><circle cx="15" cy="15" r="1.5" fill="currentColor" /></svg>;
    case "merger":
      return <svg {...common}><path d="M6 7l9 8h12M6 23l9-8" stroke="var(--flow)" strokeWidth="5" strokeLinejoin="round" /><circle cx="15" cy="15" r="6" fill="var(--paper-raised)" /><path d="M20 15l-8 4.6v-9.2z" fill="currentColor" /></svg>;
    case "source":
      return <svg {...common}><path d="M15 15h12" stroke="var(--flow)" strokeWidth="5" /><path d="M22 15L8 23V7z" fill="var(--paper-raised)" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>;
    case "sink":
      return <svg {...common}><circle cx="15" cy="15" r="10" stroke="currentColor" strokeWidth="2" /><circle cx="15" cy="15" r="5.5" stroke="currentColor" strokeWidth="2" /></svg>;
    case "erase":
      return <svg {...common}><path d="M15 4l9.5 5.5v11L15 26l-9.5-5.5v-11z" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2.5" /><path d="M10.5 10.5l9 9M19.5 10.5l-9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
    case "select":
      return <svg {...common}><path d="M4 5h18v13H4z" stroke="var(--course)" strokeWidth="1.5" strokeDasharray="3 2.5" /><path d="M14 12l11 4.5-4.6 1.4 3.4 4.4-2 1.5-3.4-4.4-2.6 4z" fill="var(--paper-raised)" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>;
  }
}

/** Small heading arrow for the current brush direction (drawn, rotated by hex direction). */
function DirectionGlyph({ dir }: { readonly dir: Dir }) {
  return (
    <svg className="direction-glyph" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <g transform={`rotate(${dir * 60} 7 7)`}>
        <path d="M2 7h8M7 3.5L10.5 7 7 10.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function ChevronGlyph({ down = false }: { readonly down?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d={down ? "M3 5l4 4 4-4" : "M5 3l4 4-4 4"} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Production playback rates: each interval advances `TICKS_PER_INTERVAL × speed` ticks (1× = 8 ticks per 80 ms). */
const PLAY_SPEEDS = [1, 2, 10] as const;
type PlaySpeed = (typeof PLAY_SPEEDS)[number];

/** A belt-grid tile for the current brush + direction (machines handled separately). */
function makeTile(brush: Brush, dir: Dir, base: number): FactoryTile | null {
  switch (brush.kind) {
    case "belt":
      return { kind: "belt", dir };
    case "splitter":
      // in from behind; fan out forward + one perpendicular (CW). brushDir=E → in W, out [E,S].
      return { kind: "splitter", inDir: opposite(dir), outDirs: [dir, ((dir + 1) % 6) as Dir] };
    case "merger":
      // out forward; accept from behind + one perpendicular (CW). brushDir=E → out E, in [W,S].
      return { kind: "merger", inDirs: [opposite(dir), ((dir + 1) % 6) as Dir], outDir: dir };
    case "source":
      return { kind: "source", dir, period: 1, base };
    case "sink":
      return { kind: "sink" };
    case "erase":
      return { kind: "empty" };
    case "select":
    case "machine":
      return null; // machines are placed into layout.machines, not tiles
  }
}

function cloneFactoryTile(tile: FactoryTile): FactoryTile {
  switch (tile.kind) {
    case "empty":
      return { kind: "empty" };
    case "belt":
      return { kind: "belt", dir: tile.dir };
    case "splitter":
      return { kind: "splitter", inDir: tile.inDir, outDirs: [...tile.outDirs] };
    case "merger":
      return { kind: "merger", inDirs: [...tile.inDirs], outDir: tile.outDir };
    case "source":
      return { kind: "source", dir: tile.dir, period: tile.period, base: tile.base };
    case "sink":
      return { kind: "sink" };
  }
}

export function copyFactoryTile(
  layout: FactoryLayout,
  q: number,
  r: number,
): FactoryTile | null {
  if (!hexInBounds(layout.width, layout.height, q, r)) return null;
  if (machineAt(layout, q, r) !== undefined) return null;
  const tile = layout.tiles[hexIndex(layout.width, q, r)];
  return tile === undefined || tile.kind === "empty" ? null : cloneFactoryTile(tile);
}

export function placeFactoryTile(
  layout: FactoryLayout,
  q: number,
  r: number,
  tile: FactoryTile,
): FactoryLayout {
  if (
    tile.kind === "empty" ||
    !hexInBounds(layout.width, layout.height, q, r) ||
    machineAt(layout, q, r) !== undefined
  ) {
    return layout;
  }
  const index = hexIndex(layout.width, q, r);
  const current = layout.tiles[index];
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(tile)) return layout;
  const tiles = layout.tiles.slice();
  tiles[index] = cloneFactoryTile(tile);
  return { ...layout, tiles };
}

function brushAt(layout: FactoryLayout, cell: GridCell): PickedBrush | null {
  const machine = machineAt(layout, cell.q, cell.r);
  if (machine !== undefined) {
    return {
      brush: { kind: "machine", typeId: machine.def.typeId },
      dir: E,
      base: 0,
      footRot: machine.footRot,
    };
  }
  const tile = copyFactoryTile(layout, cell.q, cell.r);
  if (tile === null) return null;
  if (tile.kind === "empty") return null;
  const dir = tile.kind === "belt" || tile.kind === "source"
    ? tile.dir
    : tile.kind === "splitter"
      ? tile.outDirs[0] ?? E
      : tile.kind === "merger" ? tile.outDir : E;
  return {
    brush: { kind: tile.kind },
    dir,
    base: tile.kind === "source" ? tile.base : 0,
    footRot: 0,
  };
}

/** Apply a click at (q,r) with the current brush, returning a new layout. */
function paint(
  layout: FactoryLayout,
  q: number,
  r: number,
  brush: Brush,
  dir: Dir,
  footRot: Rotation,
  base = 0,
): FactoryLayout {
  if (brush.kind === "machine") {
    const shape: MachineShape | undefined = DEFAULT_SHAPES[brush.typeId];
    if (shape === undefined) throw new Error(`Factory: unknown machine shape "${brush.typeId}"`);
    const m: PlacedMachine = {
      id: nextMachineId(layout),
      def: machineDef(brush.typeId),
      anchor: { q, r },
      footRot,
      shape,
    };
    for (const cell of worldCells(m)) {
      if (!hexInBounds(layout.width, layout.height, cell.q, cell.r)) return layout;
      if (machineAt(layout, cell.q, cell.r) !== undefined) return layout;
      if (layout.tiles[hexIndex(layout.width, cell.q, cell.r)]?.kind !== "empty") return layout;
    }
    return { ...layout, machines: [...layout.machines, m] };
  }

  if (brush.kind === "erase") {
    // remove any machine covering the cell AND clear the tile.
    const hit = machineAt(layout, q, r);
    const index = hexIndex(layout.width, q, r);
    const currentTile = layout.tiles[index];
    if (hit === undefined && currentTile?.kind === "empty") return layout;
    const machines = hit ? layout.machines.filter((m) => m.id !== hit.id) : layout.machines;
    const tiles = layout.tiles.slice();
    tiles[index] = { kind: "empty" };
    return { ...layout, tiles, machines };
  }

  const tile = makeTile(brush, dir, base);
  if (tile === null) return layout;
  return placeFactoryTile(layout, q, r, tile);
}

/** The belts a drag along `cells` places; commit and the ghost both use this orientation. */
export function beltRouteTiles(cells: readonly GridCell[], fallbackDirection: Dir): readonly FactoryGhostTile[] {
  const directions = orientBeltGesture(cells, fallbackDirection);
  return cells.map((cell, index) => ({ q: cell.q, r: cell.r, tile: { kind: "belt", dir: directions[index] ?? fallbackDirection } }));
}

export function paintBeltRoute(
  layout: FactoryLayout,
  cells: readonly GridCell[],
  fallbackDirection: Dir,
): FactoryLayout {
  let next = layout;
  for (const { q, r, tile } of beltRouteTiles(cells, fallbackDirection)) next = placeFactoryTile(next, q, r, tile);
  return next;
}

const CELL = 42;
const FACTORY_HEX_SIZE = CELL / 2;
const FACTORY_HEX_WIDTH = Math.sqrt(3) * FACTORY_HEX_SIZE;
const PAD = 12;
const MIN_ZOOM = 0.35;
/** On a phone a built line opens no smaller than this, so ports and icons stay legible. */
const MIN_PHONE_FIT_ZOOM = 0.6;
const MAX_ZOOM = 2.25;
const MARK_BAND = 36;
/** The floor is framed up to this zoom; beyond it hexes stop reading as a map. */
const MAX_FIT_ZOOM = 1.6;

/**
 * Camera that frames the work: an empty floor fills the view (never below 100%, so touch hexes
 * stay usable); a built layout is fitted whole (Source to Sink), zooming below 100% only when
 * it cannot otherwise fit. On a phone the fit stops at a legible zoom and, if the line is still
 * wider than the view, opens at its left (Source) end for the player to pan along.
 * Translation is relative to the frame's top-left.
 */
export function fitFactoryCamera(
  view: { readonly width: number; readonly height: number },
  floor: PixelBounds,
  layout: PixelBounds | null,
  start: { readonly x: number; readonly y: number } | null = null,
): Camera {
  if (view.width <= 0 || view.height <= 0) return { x: 0, y: 0, zoom: 1 };
  const fitHeight = Math.max(1, view.height - 2 * Math.min(MARK_BAND, view.height * 0.1));
  const zoomFor = (b: PixelBounds) =>
    Math.min(view.width / (b.maxX - b.minX), fitHeight / (b.maxY - b.minY)) * 0.96;
  const floorZoom = zoomFor(floor);
  const zoom = layout === null
    ? Math.min(MAX_FIT_ZOOM, Math.max(1, floorZoom))
    : Math.max(view.width <= 768 ? MIN_PHONE_FIT_ZOOM : MIN_ZOOM, Math.min(zoomFor(layout), MAX_FIT_ZOOM, Math.max(1, floorZoom)));
  const target = layout === null || zoom <= floorZoom ? floor : layout;
  if (layout !== null && zoom > floorZoom && zoom > zoomFor(layout)) {
    // Cropped: open at the edge nearest the Source so the line's start is on screen.
    const midX = (layout.minX + layout.maxX) / 2;
    const midY = (layout.minY + layout.maxY) / 2;
    const fitsY = zoom * (layout.maxY - layout.minY) <= view.height;
    return {
      x: start !== null && start.x > midX ? view.width - PAD - zoom * layout.maxX : PAD - zoom * layout.minX,
      y: fitsY || start === null
        ? view.height / 2 - zoom * midY
        : start.y > midY ? view.height - PAD - zoom * layout.maxY : PAD - zoom * layout.minY,
      zoom,
    };
  }
  return {
    x: view.width / 2 - zoom * (target.minX + target.maxX) / 2,
    y: view.height / 2 - zoom * (target.minY + target.maxY) / 2,
    zoom,
  };
}

function factoryCellCenter(cell: HexCoord): { readonly x: number; readonly y: number } {
  const projected = hexToPixel(cell.q, cell.r, FACTORY_HEX_SIZE);
  return {
    x: PAD + FACTORY_HEX_WIDTH / 2 + projected.x,
    y: PAD + FACTORY_HEX_SIZE + projected.y,
  };
}

// ───────────────────────────── component ─────────────────────────────

const TICK_MS = 80;
const TICKS_PER_INTERVAL = 8;

type FacilityMode = "pilot" | "production";

export function previewProductionBuildCost(
  mode: FacilityMode,
  current: FactoryLayout,
  proposed: FactoryLayout,
): number | null {
  if (mode !== "production" || current === proposed) return null;
  return quoteProductionBuild(current, proposed);
}

export function requestFactoryLayoutChange(
  current: FactoryLayout,
  proposed: FactoryLayout,
  onLayoutChange: (layout: FactoryLayout) => boolean,
): boolean {
  return proposed !== current && onLayoutChange(proposed);
}

type FactoryHotkeyTargetKind = "text" | "control" | "world";

function factoryHotkeyTarget(target: EventTarget | null): FactoryHotkeyTargetKind {
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  ) return "text";
  return target instanceof Element && target.closest("button, a, [role]") !== null ? "control" : "world";
}

/** WASD pan speed, in screen pixels per millisecond. */
const PAN_KEY_SPEED = 0.6;
const PAN_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);

export function factoryHotkeyTargetConsumesKey(
  targetKind: FactoryHotkeyTargetKind,
  key: string,
): boolean {
  return targetKind === "text" ||
    (targetKind === "control" && (key === "Enter" || key === " "));
}

export function facilityMayAnalyzeOutcome(mode: FacilityMode, rateNum: number): boolean {
  return mode === "pilot" && rateNum > 0;
}

export function facilityOutcomeMap(
  mode: FacilityMode,
  planningMap: MultiMap,
): MultiMap | null {
  return mode === "pilot" ? planningMap : null;
}

export function formatFacilityOutcome(outcome: Outcome): string {
  return outcomeEffectText(outcome);
}

interface FactoryProps {
  readonly active: boolean;
  readonly mode: FacilityMode;
  readonly level: GeneratedLevel;
  readonly planningMap: MultiMap;
  /** Per base: why Sources may not use it, or null. */
  readonly baseLocks: readonly (string | null)[];
  readonly layout: FactoryLayout | null;
  readonly runtime: FactoryRuntime | null;
  readonly waste: number;
  readonly entitledWidth: number;
  readonly entitledHeight: number;
  readonly catalog: readonly MachineCatalogEntry[];
  /** Splitter and Merger are unlocked in Technology. */
  readonly routing: boolean;
  readonly onLayoutChange: (layout: FactoryLayout) => boolean;
  readonly onAdvance?: (ticks: number) => boolean;
  readonly commandLabel?: string;
  readonly commandDisabled?: boolean;
  readonly onCommand?: (layout: FactoryLayout) => void;
  /** Shared by Plan and Production, so a copy in one pastes in the other. */
  readonly clipboard: FactoryClipboard | null;
  readonly onClipboardChange: (clipboard: FactoryClipboard) => void;
}

/** State event handlers read through the ref: a key or click can land before the render that follows a set. */
function useLatestState<T>(initial: T): [T, { readonly current: T }, (next: T) => void] {
  const [value, setValue] = useState(initial);
  const ref = useRef(value);
  const set = useCallback((next: T) => {
    ref.current = next;
    setValue(next);
  }, []);
  return [value, ref, set];
}

export function Factory({
  active,
  mode,
  level,
  planningMap,
  baseLocks,
  layout: authoritativeLayout,
  runtime,
  waste,
  entitledWidth,
  entitledHeight,
  catalog,
  routing,
  onLayoutChange,
  onAdvance,
  commandLabel,
  commandDisabled = false,
  onCommand,
  clipboard,
  onClipboardChange,
}: FactoryProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<FactoryRenderer | null>(null);
  /** The live renderer as state, so the ghost repaints when a renderer is (re)created. */
  const [liveRenderer, setLiveRenderer] = useState<FactoryRenderer | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);

  const { mm, start } = level;

  const [layout, setLayout] = useState<FactoryLayout>(() =>
    initialFacilityLayout(authoritativeLayout, entitledWidth, entitledHeight)
  );
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [playing, setPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<PlaySpeed>(1);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // editing brush + parameters.
  const [brush, brushRef, setBrushState] = useLatestState<Brush>({ kind: "belt" });
  const [lockedHint, setLockedHint] = useState<string | null>(null);
  /** Box-selected item cells, and the held paste's rotation (null: nothing held). */
  const [selection, selectionRef, setSelection] = useLatestState<readonly HexCoord[]>([]);
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  const [held, heldRef, setHeld] = useLatestState<Rotation | null>(null);
  // Loading a game clears the shared clipboard; nothing is left to hold.
  useEffect(() => {
    if (clipboard === null) setHeld(null);
  }, [clipboard, setHeld]);
  // Any new tool choice (click, hotkey, pipette) retires a stale locked-machine hint and drops
  // the held paste; leaving Select drops the selection.
  const setBrush = useCallback((next: Brush) => {
    setBrushState(next);
    setLockedHint(null);
    setHeld(null);
    if (next.kind !== "select") setSelection([]);
  }, [setBrushState, setHeld, setSelection]);
  const [brushDir, brushDirRef, setBrushDir] = useLatestState<Dir>(E);
  const [sourceBase, sourceBaseRef, setSourceBase] = useLatestState(0);
  const [footRot, footRotRef, setFootRot] = useLatestState<Rotation>(0);
  const [hoverCell, hoverRef, setHoverCell] = useLatestState<GridCell | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [history, setHistory] = useState<EditorHistory<FactoryLayout>>(() =>
    createEditorHistory(layout)
  );
  const historyRef = useRef(history);
  historyRef.current = history;
  const activeRef = useRef(active);
  activeRef.current = active;
  const pendingViewportFocusRef = useRef(true);
  const pendingCommittedKeysRef = useRef<string[]>([]);
  const gestureRef = useRef<CanvasGesture | null>(null);
  // The gesture lives in a ref; ending one bumps this so the render (and its ghost) catches up.
  const [, repaintGesture] = useReducer((count: number) => count + 1, 0);
  const panGestureRef = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly startX: number;
    readonly startY: number;
  } | null>(null);
  const activeTouchPointerRef = useRef<number | null>(null);

  // keep the latest layout/level in refs so the play timer reads fresh values.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const state = useMemo(
    () => runtime ?? initFactory(layout, mm),
    [runtime, layout, mm, start],
  );

  const throughputAnalysis = useMemo<{
    readonly report: ThroughputReport | null;
    readonly error: string | null;
  }>(() => {
    if (authoritativeLayout === null) {
      return { report: null, error: null };
    }
    try {
      return { report: analyzeThroughput(layout, mm), error: null };
    } catch (error) {
      return {
        report: null,
        error: `Throughput analysis unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }, [authoritativeLayout, layout, mm]);
  const throughput = throughputAnalysis.report;
  const sourceMarks = useMemo(() => baseLocks.length < 2 ? [] : layout.tiles.flatMap((tile, index) => {
    if (tile.kind !== "source") return [];
    const center = factoryCellCenter({ q: index % layout.width, r: Math.floor(index / layout.width) });
    return [{ index, base: tile.base, x: center.x, y: center.y - 17 }];
  }), [baseLocks.length, layout]);
  const sampleAnalysis = useMemo<{
    readonly outcome: Outcome | null;
    readonly error: string | null;
  }>(() => {
    const outcomeMap = facilityOutcomeMap(mode, planningMap);
    if (
      authoritativeLayout === null ||
      throughput === null ||
      outcomeMap === null ||
      !facilityMayAnalyzeOutcome(mode, throughput.rateNum)
    ) {
      return { outcome: null, error: null };
    }
    try {
      return { outcome: factoryOutcome(layout, outcomeMap), error: null };
    } catch (error) {
      return {
        outcome: null,
        error: `Sample unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }, [authoritativeLayout, layout, mode, planningMap, throughput]);
  const analysisError = [throughputAnalysis.error, sampleAnalysis.error]
    .filter((entry): entry is string => entry !== null)
    .join(" ");

  useLayoutEffect(() => {
    const next = initialFacilityLayout(authoritativeLayout, entitledWidth, entitledHeight);
    playingRef.current = false;
    setPlaying(false);
    const key = JSON.stringify(next);
    const reconciliation = reconcilePendingCommit(pendingCommittedKeysRef.current, key);
    pendingCommittedKeysRef.current = [...reconciliation.pendingKeys];
    if (!reconciliation.applyIncoming) return;
    if (reconciliation.resetHistory) {
      pendingViewportFocusRef.current = true;
      setSelection([]);
      const resetHistory = createEditorHistory(next);
      historyRef.current = resetHistory;
      setHistory(resetHistory);
    }
    layoutRef.current = next;
    setLayout(next);
  }, [authoritativeLayout, entitledHeight, entitledWidth, mm, start]);

  const commitLayout = useCallback(
    (next: FactoryLayout) => {
      if (!requestFactoryLayoutChange(layoutRef.current, next, onLayoutChange)) return false;
      playingRef.current = false;
      setPlaying(false);
      pendingCommittedKeysRef.current.push(JSON.stringify(next));
      layoutRef.current = next;
      setLayout(next);
      const nextHistory = pushEditorHistory(historyRef.current, next);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      return true;
    },
    [onLayoutChange],
  );

  const restoreHistory = useCallback((next: EditorHistory<FactoryLayout>) => {
    if (next === historyRef.current || !onLayoutChange(next.present)) return;
    pendingCommittedKeysRef.current.push(JSON.stringify(next.present));
    historyRef.current = next;
    setHistory(next);
    layoutRef.current = next.present;
    setLayout(next.present);
    playingRef.current = false;
    setPlaying(false);
  }, [onLayoutChange]);

  const undoLayout = useCallback(() => {
    restoreHistory(undoEditorHistory(historyRef.current));
  }, [restoreHistory]);

  const redoLayout = useCallback(() => {
    restoreHistory(redoEditorHistory(historyRef.current));
  }, [restoreHistory]);

  // ── mount / unmount the Pixi renderer ──
  const stateRef = useRef(state);
  stateRef.current = state;
  const highlightedMachineId = throughput?.bottleneck ?? null;
  const bottleneckRef = useRef(highlightedMachineId);
  bottleneckRef.current = highlightedMachineId;
  const fitCamera = useCallback((): Camera => {
    const frame = frameRef.current;
    if (frame === null) return { x: 0, y: 0, zoom: 1 };
    return fitFactoryCamera(
      { width: frame.clientWidth, height: frame.clientHeight },
      factoryFloorBounds(layoutRef.current),
      factoryLayoutBounds(layoutRef.current),
      factoryStartPoint(layoutRef.current),
    );
  }, []);
  const focusLayoutInViewport = useCallback(() => {
    const frame = frameRef.current;
    if (!activeRef.current || frame === null || rendererRef.current === null) return false;
    if (frame.clientWidth === 0 || frame.clientHeight === 0) return false;
    const fitted = fitCamera();
    cameraRef.current = fitted;
    setCamera(fitted);
    pendingViewportFocusRef.current = false;
    return true;
  }, [fitCamera]);
  useEffect(() => {
    let disposed = false;
    let local: FactoryRenderer | null = null;
    let focusRequest = 0;
    setRendererError(null);
    void (async () => {
      try {
        const { createFactoryRenderer } = await import("../render/factoryRenderer");
        const r = await createFactoryRenderer(layoutRef.current, mode === "pilot" ? "plan" : "production");
        if (disposed) {
          r.destroy();
          return;
        }
        local = r;
        rendererRef.current = r;
        setLiveRenderer(r);
        if (mountRef.current) mountRef.current.appendChild(r.canvas);
        r.render(layoutRef.current, stateRef.current, bottleneckRef.current);
        focusRequest = window.requestAnimationFrame(() => {
          if (!disposed && pendingViewportFocusRef.current) focusLayoutInViewport();
        });
      } catch (error) {
        if (local !== null) {
          local.destroy();
          local = null;
        }
        // A superseded init must not clear the newer renderer's handle; its cleanup already did.
        if (!disposed) {
          rendererRef.current = null;
          setLiveRenderer(null);
          const detail = error instanceof Error ? error.message : String(error);
          setRendererError(`Could not start the Factory renderer: ${detail}`);
        }
      }
    })();
    return () => {
      disposed = true;
      if (focusRequest !== 0) window.cancelAnimationFrame(focusRequest);
      rendererRef.current = null;
      setLiveRenderer(null);
      if (local) local.destroy();
    };
  }, [focusLayoutInViewport, layout.width, layout.height, mode]);

  // A frame resize (window, rotation, the Formulas reference) reframes the floor like Center.
  useEffect(() => {
    const frame = frameRef.current;
    if (frame === null || typeof ResizeObserver === "undefined") return;
    let last = { width: frame.clientWidth, height: frame.clientHeight };
    const observer = new ResizeObserver(() => {
      const next = { width: frame.clientWidth, height: frame.clientHeight };
      const changed = Math.abs(next.width - last.width) > 1 || Math.abs(next.height - last.height) > 40;
      last = next;
      if (!changed || !activeRef.current || next.width === 0 || next.height === 0) return;
      const fitted = fitCamera();
      cameraRef.current = fitted;
      setCamera(fitted);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [fitCamera]);

  // Details changes the frame width: reframe the floor.
  useEffect(() => {
    if (!activeRef.current) return;
    const request = window.requestAnimationFrame(() => {
      const fitted = fitCamera();
      cameraRef.current = fitted;
      setCamera(fitted);
    });
    return () => window.cancelAnimationFrame(request);
  }, [diagnosticsOpen, fitCamera]);

  // ── repaint whenever layout / state / bottleneck changes ──
  useEffect(() => {
    rendererRef.current?.render(layout, state, highlightedMachineId);
  }, [highlightedMachineId, layout, state, state.tick]);

  useEffect(() => {
    if (!active || !pendingViewportFocusRef.current) return;
    const request = window.requestAnimationFrame(() => focusLayoutInViewport());
    return () => window.cancelAnimationFrame(request);
  }, [active, focusLayoutInViewport, layout]);

  // ── play timer: advance the sim by one batch per interval; speed scales the batch ──
  useEffect(() => {
    if (!playing || mode !== "production" || onAdvance === undefined) return;
    const ticks = TICKS_PER_INTERVAL * speed;
    const id = window.setInterval(() => {
      if (!playingRef.current || blockingDialogOpen()) return;
      if (!onAdvance(ticks)) {
        playingRef.current = false;
        setPlaying(false);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [mode, onAdvance, playing, speed]);

  // stop playing automatically on deadlock.
  useEffect(() => {
    if (state.deadlocked && playing) {
      playingRef.current = false;
      setPlaying(false);
    }
  }, [state.deadlocked, playing]);

  // ── controls ──
  const stepOnce = useCallback(() => {
    onAdvance?.(1);
  }, [onAdvance]);

  const updateCamera = useCallback((change: (current: Camera) => Camera) => {
    setCamera((current) => {
      const requested = change(current);
      const canvas = rendererRef.current?.canvas;
      const frame = frameRef.current;
      if (canvas === undefined || frame === null) {
        return clampCamera(requested, {
          minX: -10_000,
          maxX: 10_000,
          minY: -10_000,
          maxY: 10_000,
          minZoom: MIN_ZOOM,
          maxZoom: MAX_ZOOM,
        });
      }
      const rect = canvas.getBoundingClientRect();
      const frameRect = frame.getBoundingClientRect();
      const baseWidth = rect.width / current.zoom;
      const baseHeight = rect.height / current.zoom;
      const baseLeft = rect.left - current.x;
      const baseTop = rect.top - current.y;
      const visibleEdge = 80;
      return clampCamera(requested, {
        minX: frameRect.left + visibleEdge - baseLeft - baseWidth * requested.zoom,
        maxX: frameRect.right - visibleEdge - baseLeft,
        minY: frameRect.top + visibleEdge - baseTop - baseHeight * requested.zoom,
        maxY: frameRect.bottom - visibleEdge - baseTop,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
      });
    });
  }, []);

  const pointerCell = useCallback((clientX: number, clientY: number): GridCell | null => {
    const canvas = rendererRef.current?.canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const current = cameraRef.current;
    const baseWidth = rect.width / current.zoom;
    const baseHeight = rect.height / current.zoom;
    const baseRect = {
      left: rect.left - current.x,
      top: rect.top - current.y,
      width: baseWidth,
      height: baseHeight,
    };
    const cell = screenToGrid(
      { x: clientX, y: clientY },
      baseRect,
      { width: baseWidth, height: baseHeight },
      current,
      {
        cellSize: FACTORY_HEX_SIZE * baseWidth / canvas.clientWidth,
        origin: {
          x: (PAD + FACTORY_HEX_WIDTH / 2) * baseWidth / canvas.clientWidth,
          y: (PAD + FACTORY_HEX_SIZE) * baseHeight / canvas.clientHeight,
        },
      },
    );
    const layout = layoutRef.current;
    return !hexInBounds(layout.width, layout.height, cell.q, cell.r)
      ? null
      : cell;
  }, []);

  const selectedCells = useMemo(() => itemCells(layout, selection), [layout, selection]);

  /** The gesture a primary press at `cell` starts with the current tool. */
  const startGesture = useCallback((pointerId: number, cell: GridCell, additive: boolean): CanvasGesture => {
    const base = layoutRef.current;
    const brush = brushRef.current;
    if (heldRef.current !== null) return { pointerId, mode: "paste", base, last: cell };
    if (brush.kind === "erase" || brush.kind === "select") {
      const onSelection = itemCells(base, selectionRef.current).some(({ q, r }) => q === cell.q && r === cell.r);
      return !additive && brush.kind === "select" && onSelection
        ? { pointerId, mode: "drag", base, start: cell, last: cell, rot: 0 }
        : { pointerId, mode: "box", base, start: cell, last: cell, erase: brush.kind === "erase", additive };
    }
    const machine = directGestureMachineAt(base, cell.q, cell.r, false);
    return machine === undefined
      ? { pointerId, mode: "paint", base, cells: [cell], last: cell }
      : {
          pointerId,
          mode: "move",
          base,
          cells: [cell],
          last: cell,
          machineId: machine.id,
          anchorOffset: { q: machine.anchor.q - cell.q, r: machine.anchor.r - cell.r },
          footRot: machine.footRot,
        };
  }, []);

  /** Esc / right-click: cancel the gesture, else drop the held paste, else the selection. */
  const cancelHeld = useCallback(() => {
    if (gestureRef.current !== null) {
      gestureRef.current = null;
      repaintGesture();
    } else if (heldRef.current !== null) setHeld(null);
    else if (selectionRef.current.length > 0) setSelection([]);
    else return false;
    return true;
  }, [setHeld, setSelection]);

  const onCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && event.button === 0) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      if (
        activeTouchPointerRef.current !== null &&
        activeTouchPointerRef.current !== event.pointerId
      ) {
        gestureRef.current = null;
        repaintGesture();
        activeTouchPointerRef.current = event.pointerId;
        panGestureRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          startX: camera.x,
          startY: camera.y,
        };
        return;
      }
      activeTouchPointerRef.current = event.pointerId;
      const cell = pointerCell(event.clientX, event.clientY);
      setHoverCell(cell);
      if (cell === null) {
        panGestureRef.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          startX: camera.x,
          startY: camera.y,
        };
        return;
      }
      gestureRef.current = startGesture(event.pointerId, cell, false);
      return;
    }
    if (event.button === 1) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      panGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startX: camera.x,
        startY: camera.y,
      };
      return;
    }
    if (event.button === 2 && cancelHeld()) return;
    if (event.button !== 0 && event.button !== 2) return;
    const cell = pointerCell(event.clientX, event.clientY);
    if (cell === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHoverCell(cell);
    gestureRef.current = event.button === 2
      ? { pointerId: event.pointerId, mode: "erase", base: layoutRef.current, cells: [cell], last: cell }
      : startGesture(event.pointerId, cell, event.shiftKey);
    repaintGesture();
  }, [camera.x, camera.y, cancelHeld, pointerCell, startGesture]);

  const onCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const panGesture = panGestureRef.current;
    if (panGesture?.pointerId === event.pointerId) {
      updateCamera((current) => panCamera(
        { x: panGesture.startX, y: panGesture.startY, zoom: current.zoom },
        { x: event.clientX - panGesture.clientX, y: event.clientY - panGesture.clientY },
      ));
      return;
    }
    const cell = pointerCell(event.clientX, event.clientY);
    setHoverCell(cell);
    const gesture = gestureRef.current;
    if (cell === null || gesture?.pointerId !== event.pointerId) return;
    if (gesture.mode !== "paint" && gesture.mode !== "erase") {
      gestureRef.current = { ...gesture, last: cell };
      return;
    }
    const cells = gesture.mode === "paint" && brushRef.current.kind === "belt"
      ? routeBeltGesture(gesture.cells, cell)
      : appendUniqueCells(gesture.cells, rasterizeGridLine(gesture.last, cell));
    gestureRef.current = {
      ...gesture,
      cells,
      last: cell,
    };
  }, [pointerCell, updateCamera]);

  const finishCanvasGesture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && activeTouchPointerRef.current === event.pointerId) {
      activeTouchPointerRef.current = null;
    }
    const panGesture = panGestureRef.current;
    if (panGesture?.pointerId === event.pointerId) {
      panGestureRef.current = null;
      return;
    }
    const gesture = gestureRef.current;
    if (gesture?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    // A rejected commit sets no state; re-render anyway so the gesture's ghost clears.
    repaintGesture();
    switch (gesture.mode) {
      case "move":
        commitLayout(transformPlacedMachine(
          gesture.base,
          gesture.machineId,
          {
            q: gesture.last.q + gesture.anchorOffset.q,
            r: gesture.last.r + gesture.anchorOffset.r,
          },
          gesture.footRot,
        ));
        return;
      case "paste": {
        const clipboard = clipboardRef.current;
        const held = heldRef.current;
        if (clipboard === null || held === null) return;
        const placed = placeFragment(gesture.base, transformFragment(clipboard.layout, clipboard.pivot, gesture.last, held), true);
        if (placed !== null) commitLayout(placed);
        return;
      }
      case "drag": {
        const moved = moveSelection(gesture.base, selectionRef.current, gesture.start, gesture.last, gesture.rot);
        if (moved.layout !== null && commitLayout(moved.layout)) setSelection(moved.cells);
        return;
      }
      case "box": {
        const boxed = itemCells(gesture.base, boxCells(gesture.base.width, gesture.base.height, gesture.start, gesture.last));
        if (gesture.erase) commitLayout(eraseItems(gesture.base, boxed));
        else setSelection(gesture.additive ? itemCells(gesture.base, [...selectionRef.current, ...boxed]) : boxed);
        return;
      }
    }
    const activeBrush: Brush = gesture.mode === "erase" ? { kind: "erase" } : brushRef.current;
    let next = activeBrush.kind === "belt"
      ? paintBeltRoute(gesture.base, gesture.cells, brushDirRef.current)
      : gesture.base;
    if (activeBrush.kind !== "belt") {
      for (const cell of gesture.cells) {
        next = paint(next, cell.q, cell.r, activeBrush, brushDirRef.current, footRotRef.current, sourceBaseRef.current);
      }
    }
    commitLayout(next);
  }, [commitLayout, setSelection]);

  const onCanvasWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const canvas = rendererRef.current?.canvas;
    if (canvas === undefined) return;
    const rect = canvas.getBoundingClientRect();
    const current = cameraRef.current;
    const baseLeft = rect.left - current.x;
    const baseTop = rect.top - current.y;
    updateCamera((value) => zoomCameraAt(
      value,
      { x: event.clientX - baseLeft, y: event.clientY - baseTop },
      value.zoom * Math.exp(-event.deltaY * 0.0015),
      { minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM },
    ));
  }, [updateCamera]);

  const pickHovered = useCallback(() => {
    const hoverCell = hoverRef.current;
    if (hoverCell === null) return;
    const picked = brushAt(layoutRef.current, hoverCell);
    if (picked === null) return;
    setBrush(picked.brush);
    setBrushDir(picked.dir);
    if (picked.brush.kind === "source") setSourceBase(picked.base);
    setFootRot(picked.footRot);
  }, [setBrush, setBrushDir, setFootRot, setSourceBase]);

  /** Copy the selection, or the hovered item when nothing is selected; a cut also removes it. */
  const copyItems = useCallback((cut: boolean) => {
    const hoverCell = hoverRef.current;
    const hovered = hoverCell === null ? [] : [hoverCell];
    const cells = selectionRef.current.length > 0 ? selectionRef.current : hovered;
    const copied = copySelection(layoutRef.current, cells);
    if (copied === null) return;
    clipboardRef.current = copied;
    onClipboardChange(copied);
    if (cut && commitLayout(eraseItems(layoutRef.current, cells))) setSelection([]);
  }, [commitLayout, onClipboardChange, setSelection]);

  const deleteSelection = useCallback(() => {
    const selected = selectionRef.current;
    if (selected.length > 0 && commitLayout(eraseItems(layoutRef.current, selected))) setSelection([]);
  }, [commitLayout, setSelection]);

  const rotateHoveredMachine = useCallback((step: Rotation) => {
    const hoverCell = hoverRef.current;
    if (hoverCell === null) return false;
    const current = layoutRef.current;
    const machine = machineAt(current, hoverCell.q, hoverCell.r);
    if (machine === undefined) return false;
    commitLayout(transformPlacedMachine(
      current,
      machine.id,
      machine.anchor,
      ((machine.footRot + step) % 6) as Rotation,
    ));
    return true;
  }, [commitLayout]);

  /**
   * R turns what is in hand: a dragged selection, the held paste, the selection in place, the
   * hovered machine, else the brush. Shift+R turns back.
   */
  const rotate = useCallback((step: Rotation) => {
    const turn = (value: number) => ((value + step) % 6) as Rotation;
    const gesture = gestureRef.current;
    if (gesture?.mode === "drag") {
      gestureRef.current = { ...gesture, rot: turn(gesture.rot) };
      repaintGesture();
    } else if (heldRef.current !== null) setHeld(turn(heldRef.current));
    else if (itemCells(layoutRef.current, selectionRef.current).length > 0) {
      // A gesture commits from its own base layout; turning under it would be overwritten.
      if (gesture !== null) return;
      const turned = rotateSelection(layoutRef.current, selectionRef.current, step);
      if (turned.layout !== null && commitLayout(turned.layout)) setSelection(turned.cells);
    } else if (rotateHoveredMachine(step)) return;
    else if (brushRef.current.kind === "machine") setFootRot(turn(footRotRef.current));
    else setBrushDir(turn(brushDirRef.current) as Dir);
  }, [commitLayout, rotateHoveredMachine, setBrushDir, setFootRot, setHeld, setSelection]);

  useEffect(() => {
    if (!active) return;
    const tileBrushes: readonly Brush[] = [
      { kind: "belt" },
      { kind: "splitter" },
      { kind: "merger" },
      { kind: "source" },
      { kind: "sink" },
      { kind: "erase" },
    ];
    const onKeyDown = (event: KeyboardEvent) => {
      if (blockingDialogOpen()) return;
      if (factoryHotkeyTargetConsumesKey(factoryHotkeyTarget(event.target), event.key)) return;
      const lower = event.key.toLowerCase();
      const command = event.ctrlKey || event.metaKey;
      if (command && lower === "z") {
        event.preventDefault();
        if (event.shiftKey) redoLayout();
        else undoLayout();
      } else if (command && lower === "y") {
        event.preventDefault();
        redoLayout();
      } else if (command && (lower === "c" || lower === "x")) {
        event.preventDefault();
        copyItems(lower === "x");
      } else if (command && lower === "v") {
        event.preventDefault();
        if (clipboardRef.current !== null) setHeld(0);
      } else if (command || event.altKey) {
        return;
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (selectionRef.current.length > 0) {
          event.preventDefault();
          deleteSelection();
        }
      } else if (event.key === "Escape") {
        if (cancelHeld()) event.preventDefault();
      } else if (/^Digit[1-6]$/.test(event.code)) {
        event.preventDefault();
        const next = tileBrushes[Number(event.code.slice(5)) - 1];
        if (next !== undefined && !routing && (next.kind === "splitter" || next.kind === "merger")) {
          setLockedHint(ROUTING_LOCK_REASON);
        } else if (next !== undefined) setBrush(next);
      } else if (/^Digit[7-9]$/.test(event.code) || event.code === "Digit0") {
        event.preventDefault();
        const slot = event.code === "Digit0" ? 3 : Number(event.code.slice(5)) - 7;
        const entry = catalog[slot];
        if (entry !== undefined) {
          setBrush({ kind: "machine", typeId: entry.typeId });
        }
      } else if (lower === "r") {
        event.preventDefault();
        rotate(event.shiftKey ? 5 : 1);
      } else if (lower === "q") {
        event.preventDefault();
        pickHovered();
      } else if (lower === "x") {
        event.preventDefault();
        setBrush({ kind: "erase" });
      } else if (lower === "v") {
        event.preventDefault();
        setBrush({ kind: "select" });
      } else if (event.code === "Space") {
        if (mode === "production") {
          event.preventDefault();
          setPlaying((value) => !value && !state.deadlocked);
        }
      } else if (event.key === ".") {
        if (mode === "production") {
          event.preventDefault();
          if (!playing && !state.deadlocked) stepOnce();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, cancelHeld, catalog, copyItems, deleteSelection, mode, pickHovered, playing, redoLayout, rotate, routing, setBrush, setHeld, state.deadlocked, stepOnce, undoLayout]);

  // WASD pans while held, at a steady screen speed.
  useEffect(() => {
    if (!active) return;
    const pressed = new Set<string>();
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      const elapsed = last === 0 ? 16 : Math.min(50, now - last);
      last = now;
      const distance = PAN_KEY_SPEED * elapsed;
      const dx = (pressed.has("KeyA") ? 1 : 0) - (pressed.has("KeyD") ? 1 : 0);
      const dy = (pressed.has("KeyW") ? 1 : 0) - (pressed.has("KeyS") ? 1 : 0);
      if (dx !== 0 || dy !== 0) updateCamera((current) => panCamera(current, { x: dx * distance, y: dy * distance }));
      frame = pressed.size === 0 ? 0 : window.requestAnimationFrame(tick);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!PAN_KEYS.has(event.code) || event.ctrlKey || event.metaKey || event.altKey || blockingDialogOpen()) return;
      if (factoryHotkeyTargetConsumesKey(factoryHotkeyTarget(event.target), event.key)) return;
      event.preventDefault();
      pressed.add(event.code);
      if (frame === 0) {
        last = 0;
        frame = window.requestAnimationFrame(tick);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
    const release = () => pressed.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, [active, updateCamera]);

  const brushIsMachine = brush.kind === "machine";
  const brushLabel = held !== null ? "Paste" : brush.kind === "machine" ? machineName(brush.typeId) : brush.kind;
  const rate = throughput === null
    ? "unavailable"
    : throughput.rateDen === 0 ? "0" : (throughput.rateNum / throughput.rateDen).toLocaleString(undefined, { maximumSignificantDigits: 3 });
  const sampleSummary = sampleAnalysis.outcome === null
    ? "not runnable"
    : formatFacilityOutcome(sampleAnalysis.outcome);
  const hoveredMachine = hoverCell === null ? undefined : machineAt(layout, hoverCell.q, hoverCell.r);
  const hoveredTile = hoverCell === null
    ? undefined
    : layout.tiles[hexIndex(layout.width, hoverCell.q, hoverCell.r)];
  const hoverKind = hoveredMachine === undefined
    ? hoveredTile?.kind === "source" && baseLocks.length > 1
      ? `source · ${BASE_NAMES[hoveredTile.base]}`
      : hoveredTile?.kind ?? "outside"
    : machineName(hoveredMachine.def.typeId);
  const activeGesture = gestureRef.current;
  const moveGesture = activeGesture?.mode === "move" ? activeGesture : null;
  const moveMachine = moveGesture?.base.machines.find(
    (machine) => machine.id === moveGesture.machineId,
  );
  const moveAnchor = moveGesture === null
    ? null
    : {
        q: moveGesture.last.q + moveGesture.anchorOffset.q,
        r: moveGesture.last.r + moveGesture.anchorOffset.r,
      };
  const moveBase = moveGesture?.base ?? null;
  const moveCandidate = moveBase === null || moveMachine === undefined || moveAnchor === null
    ? null
    : transformPlacedMachine(moveBase, moveMachine.id, moveAnchor, moveMachine.footRot);
  const beltGestureCandidate = activeGesture?.mode === "paint" && brush.kind === "belt"
    ? paintBeltRoute(activeGesture.base, activeGesture.cells, brushDir)
    : null;
  const boxGesture = activeGesture?.mode === "box" ? activeGesture : null;
  const boxedCells = useMemo(
    () => boxGesture === null ? [] : itemCells(boxGesture.base, boxCells(boxGesture.base.width, boxGesture.base.height, boxGesture.start, boxGesture.last)),
    [boxGesture],
  );
  const dragGesture = activeGesture?.mode === "drag" ? activeGesture : null;
  const pasteCell = held === null ? null : activeGesture?.mode === "paste" ? activeGesture.last : hoverCell;
  // A dragged selection or the held paste: the moved items, and the layout they make (null: refused).
  const fragmentPreview = useMemo(() => {
    if (dragGesture !== null) {
      const moved = moveSelection(dragGesture.base, selection, dragGesture.start, dragGesture.last, dragGesture.rot);
      return { fragment: moved.fragment, candidate: moved.layout };
    }
    if (clipboard === null || held === null || pasteCell === null) return null;
    const fragment = transformFragment(clipboard.layout, clipboard.pivot, pasteCell, held);
    return { fragment, candidate: placeFragment(layout, fragment, true) };
  }, [clipboard, dragGesture, held, layout, pasteCell, selection]);
  const idleDirectMachine = activeGesture === null && hoverCell !== null && held === null
    ? directGestureMachineAt(layout, hoverCell.q, hoverCell.r, brush.kind === "erase" || brush.kind === "select")
    : undefined;
  // A refused fragment keeps the current layout as its candidate.
  const fragmentCandidate = fragmentPreview === null ? null : fragmentPreview.candidate ?? layout;
  const hoverOverride = moveCandidate ?? beltGestureCandidate ?? fragmentCandidate;
  const paints = hoverOverride === null && boxGesture === null && idleDirectMachine === undefined && hoverCell !== null;
  const idleCandidate = paints ? paint(layout, hoverCell.q, hoverCell.r, brush, brushDir, footRot, sourceBase) : layout;
  const hoverCandidate = hoverOverride ?? idleCandidate;
  const moveUnchanged = moveMachine !== undefined && moveAnchor !== null &&
    moveMachine.anchor.q === moveAnchor.q && moveMachine.anchor.r === moveAnchor.r;
  const hoverPlacementValid = moveBase !== null
    ? moveUnchanged || moveCandidate !== moveBase
    : fragmentPreview !== null
    ? fragmentPreview.candidate !== null
    : idleDirectMachine !== undefined || hoverCell === null || brush.kind === "erase" || hoverCandidate !== layout;
  const hoverBuildCost = previewProductionBuildCost(mode, layout, hoverCandidate);
  const erasePreviewCells = boxGesture?.erase === true
    ? boxedCells
    : held === null && boxGesture === null && hoverCell !== null &&
      (brush.kind === "erase" || activeGesture?.mode === "erase")
    ? factoryErasePreviewCells(layout, hoverCell.q, hoverCell.r)
    : null;
  // The SVG outline layer carries the erase preview, the grabbed-machine outline and the selection.
  let ghostCells: readonly HexCoord[] = [];
  if (erasePreviewCells !== null) ghostCells = erasePreviewCells;
  else if (idleDirectMachine !== undefined) ghostCells = worldCells(idleDirectMachine);
  const outlinedSelection = boxGesture !== null && !boxGesture.erase
    ? boxGesture.additive ? itemCells(layout, [...selectedCells, ...boxedCells]) : boxedCells
    : selectedCells;
  // Any other placement previews the real thing in Pixi. Memoized on its inputs so a Production
  // tick re-render keeps the same ghost and does not repaint it.
  const placementGhost = useMemo((): FactoryGhost | null => {
    if (boxGesture !== null || ghostCells.length > 0) return null;
    const invalid = !hoverPlacementValid;
    const ghostLayout = invalid ? layout : hoverCandidate;
    if (fragmentPreview !== null) {
      return { layout: ghostLayout, invalid, tiles: fragmentPreview.fragment.tiles, machines: fragmentPreview.fragment.machines };
    }
    if (moveMachine !== undefined && moveAnchor !== null) {
      return { layout: ghostLayout, invalid, tiles: [], machines: [{ ...moveMachine, anchor: moveAnchor }] };
    }
    if (beltGestureCandidate !== null && activeGesture?.mode === "paint") {
      return { layout: ghostLayout, invalid, tiles: beltRouteTiles(activeGesture.cells, brushDir), machines: [] };
    }
    if (hoverCell === null) return null;
    if (brush.kind === "machine") {
      const shape = DEFAULT_SHAPES[brush.typeId]!;
      const placed = invalid ? undefined : hoverCandidate.machines.at(-1);
      return {
        layout: ghostLayout,
        invalid,
        tiles: [],
        machines: invalid
          ? [{ id: UNPLACED_MACHINE_ID, def: machineDef(brush.typeId), anchor: hoverCell, footRot, shape }]
          : placed === undefined ? [] : [placed],
      };
    }
    const tile = makeTile(brush, brushDir, sourceBase);
    return tile === null ? null : { layout: ghostLayout, invalid, tiles: [{ q: hoverCell.q, r: hoverCell.r, tile }], machines: [] };
  // Every value read above derives from these inputs; a new input to those derivations belongs here too.
  }, [layout, hoverCell, brush, brushDir, footRot, sourceBase, activeGesture, fragmentPreview, held]);
  useEffect(() => {
    // The mount effect nulls rendererRef before destroying; skip a stale handle in that window.
    if (liveRenderer === null || liveRenderer !== rendererRef.current) return;
    liveRenderer.renderGhost(placementGhost);
  }, [liveRenderer, placementGhost]);
  let ghostState: "valid" | "invalid" | undefined;
  if (placementGhost !== null) ghostState = placementGhost.invalid ? "invalid" : "valid";

  const tileBrushBtn = (kind: TileBrushKind, label: string, hotkey: string) => {
    const locked = !routing && (kind === "splitter" || kind === "merger");
    const showHint = locked ? () => setLockedHint(ROUTING_LOCK_REASON) : undefined;
    const hideHint = locked ? () => setLockedHint(null) : undefined;
    return (
      <button
        type="button"
        onClick={locked ? showHint : () => setBrush({ kind })}
        onMouseEnter={showHint}
        onMouseLeave={hideHint}
        onFocus={showHint}
        onBlur={hideHint}
        aria-disabled={locked ? true : undefined}
        className={`tool-slot${brush.kind === kind ? " is-selected" : ""}${locked ? " is-locked" : ""}`}
        aria-pressed={brush.kind === kind}
        data-testid={`brush-${kind}`}
        title={locked ? ROUTING_LOCK_REASON : `${label} (${hotkey})`}
      >
        <span className="hotkey">{hotkey}</span>
        {locked && <LockGlyph />}
        <span className="tool-symbol"><ToolGlyph kind={kind} /></span>
        <span className="tool-name">{label}</span>
      </button>
    );
  };

  const facilityName = mode === "pilot" ? "Production Plan" : "Production";
  const quote = mode === "pilot"
    ? null
    : held === null && (brush.kind === "erase" || boxGesture?.erase === true)
    ? "No refund"
    : hoverBuildCost === null
    ? null
    : `${moveCandidate === null && dragGesture === null ? "Build" : "Move"} $${hoverBuildCost}`;
  const canvasBounds = hexBoardBounds(layout.width, layout.height, FACTORY_HEX_SIZE);
  const overlayWidth = Math.ceil(PAD * 2 + canvasBounds.maxX - canvasBounds.minX);
  const overlayHeight = Math.ceil(PAD * 2 + canvasBounds.maxY - canvasBounds.minY);
  const ghostErase = gestureRef.current?.mode === "erase" || brush.kind === "erase";
  const controlScale = Math.max(1, 0.75 / camera.zoom);
  const ghostClass = `factory-ghost${ghostErase ? " is-erase" : ""}`;
  const marquee = boxGesture === null ? null : (() => {
    const a = factoryCellCenter(boxGesture.start);
    const b = factoryCellCenter(boxGesture.last);
    const x = Math.min(a.x, b.x) - FACTORY_HEX_WIDTH / 2;
    const y = Math.min(a.y, b.y) - FACTORY_HEX_SIZE;
    return { x, y, width: Math.abs(a.x - b.x) + FACTORY_HEX_WIDTH, height: Math.abs(a.y - b.y) + 2 * FACTORY_HEX_SIZE };
  })();
  const hexPoints = (cell: HexCoord) => {
    const center = factoryCellCenter(cell);
    return hexPolygon(center.x, center.y, FACTORY_HEX_SIZE - 1).map((p) => `${p.x},${p.y}`).join(" ");
  };

  return (
    <div className={`game-view factory-workspace facility-${mode}`} data-testid={`${mode}-facility-workspace`}>
      <div className={`world-layout${diagnosticsOpen ? " has-inspector" : ""}`}>
        <section className="world-viewport factory-world" aria-label={`${facilityName} construction workspace`}>
          {rendererError !== null && <div role="alert" data-testid="factory-render-error" className="game-alert factory-render-alert">{rendererError}</div>}
          <div className="transport-bar factory-controls" aria-label={`${facilityName} controls`}>
            {mode === "production" && (
              <div className="control-group">
                {state.deadlocked
                  ? <span className="run-state" data-testid="factory-run-state" role="status" title="Any edit restarts the line">Blocked<span className="sr-only">: any edit restarts the line</span></span>
                  : <span className="sr-only" data-testid="factory-run-state" role="status">{playing ? "Running" : "Paused"}</span>}
                {playing
                  ? <button type="button" onClick={() => setPlaying(false)} className="is-active" data-testid="factory-pause" aria-label="Pause Production" title="Pause (Space)"><CommandGlyph kind="pause" /></button>
                  : <button type="button" onClick={() => setPlaying(true)} disabled={state.deadlocked} data-testid="factory-play" aria-label="Play Production" title="Play (Space)"><CommandGlyph kind="play" /></button>}
                <div className="speed-control" role="group" aria-label="Production speed">
                  {PLAY_SPEEDS.map((option) => (
                    <button key={option} type="button" onClick={() => setSpeed(option)} aria-pressed={speed === option} data-testid={`factory-speed-${option}`} aria-label={`Speed ${option}×`} title={`Speed ${option}×`}>{option}×</button>
                  ))}
                </div>
                <button type="button" onClick={stepOnce} disabled={playing || state.deadlocked} data-testid="factory-step" aria-label="Step Production one tick" title="Step one tick (.)"><CommandGlyph kind="step" /></button>
              </div>
            )}
            <div className="control-group view-group">
              <button type="button" onClick={() => { const fitted = fitCamera(); cameraRef.current = fitted; setCamera(fitted); }} data-testid="factory-camera-reset" aria-label={`Center ${facilityName}`} title="Center"><CommandGlyph kind="center" /></button>
              <button type="button" data-testid="factory-diagnostics" aria-expanded={diagnosticsOpen} onClick={() => setDiagnosticsOpen((open) => !open)} aria-label="Details" title="Details"><CommandGlyph kind="details" /></button>
            </div>
            {onCommand !== undefined && commandLabel !== undefined && (
              <button
                type="button"
                className="facility-command"
                onClick={() => onCommand(layoutRef.current)}
                disabled={commandDisabled}
                data-testid={`${mode}-command`}
                aria-label={commandLabel}
              >
                {commandLabel}
              </button>
            )}
          </div>
          <div className="factory-build-status" aria-label="Current build tool">
            <div className="build-readout">
              <span className="brush-icon" data-testid="brush-selected" role="img" aria-label={brushLabel} title={brushLabel}>
                {held !== null
                  ? <CommandGlyph kind="paste" />
                  : brush.kind === "machine" ? <MachineIcon typeId={brush.typeId} path={entryOf(brush.typeId).path} size={30} variant="token" /> : <ToolGlyph kind={brush.kind} />}
              </span>
              {held !== null ? (
                <span className="brush-icon" data-testid="brush-direction" role="img" aria-label={`Paste ${held * 60}°`} title={`Paste ${held * 60}°`}>
                  <DirectionGlyph dir={held} />
                </span>
              ) : brush.kind !== "erase" && brush.kind !== "select" && (
                <span className="brush-icon" data-testid="brush-direction" role="img" aria-label={brushIsMachine ? `Footprint ${footRot * 60}°` : `Direction ${DIR_LABEL[brushDir]}`} title={brushIsMachine ? `Footprint ${footRot * 60}°` : `Direction ${DIR_LABEL[brushDir]}`}>
                  <DirectionGlyph dir={brushIsMachine ? footRot : brushDir} />
                </span>
              )}
              {brush.kind === "source" && baseLocks.length > 1 && (
                <BasePicker value={sourceBase} locks={baseLocks} onChange={setSourceBase} onHint={setLockedHint} testId="source-base" />
              )}
              {lockedHint !== null
                ? <span className="build-hint" role="status">{lockedHint}</span>
                : quote !== null && <output className={`build-quote${hoverBuildCost === null ? "" : " has-cost"}`} data-testid="factory-quote">{quote}</output>}
            </div>
            <div className="build-actions">
              {selection.length > 0 && <>
                <button type="button" onClick={() => copyItems(false)} data-testid="factory-copy" aria-label="Copy" title="Copy (Ctrl+C)"><CommandGlyph kind="copy" /></button>
                <button type="button" onClick={deleteSelection} data-testid="factory-delete" aria-label="Delete" title="Delete (Del)"><CommandGlyph kind="trash" /></button>
              </>}
              {clipboard !== null && <button type="button" onClick={() => setHeld(heldRef.current === null ? 0 : null)} aria-pressed={held !== null} className={held === null ? undefined : "is-active"} data-testid="factory-paste" aria-label="Paste" title="Paste (Ctrl+V)"><CommandGlyph kind="paste" /></button>}
              <button type="button" onClick={() => rotate(1)} data-testid="brush-rotate" aria-label="Rotate" title="Rotate (R · Shift+R back)"><CommandGlyph kind="rotate" /></button>
              <button type="button" onClick={undoLayout} disabled={history.past.length === 0} data-testid="factory-undo" aria-label="Undo" title="Undo (Ctrl+Z)"><CommandGlyph kind="undo" /></button>
              <button type="button" onClick={redoLayout} disabled={history.future.length === 0} data-testid="factory-redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><CommandGlyph kind="redo" /></button>
            </div>
          </div>
          {hoveredMachine !== undefined && <div className="machine-selection" data-testid="machine-selection">
            <MachineIcon typeId={hoveredMachine.def.typeId} path={hoveredMachine.def.path} size={40} variant="token" />
            <div>
              <strong>{machineName(hoveredMachine.def.typeId)}</strong>
              <dl>
                <dt>Ports</dt><dd>{hoveredMachine.shape.inPorts.length} in · {hoveredMachine.shape.outPorts.length} out</dd>
                <dt>Process</dt><dd>{hoveredMachine.def.speed} ticks · ${hoveredMachine.def.cost}/unit</dd>
                <dt>Rotation</dt><dd>{hoveredMachine.footRot * 60}°</dd>
              </dl>
            </div>
          </div>}
          {analysisError !== "" && <div role="alert" data-testid="factory-analysis-error" className="game-alert factory-render-alert">{analysisError}</div>}

          <div
            className="factory-canvas-frame"
            ref={frameRef}
            data-testid="factory-canvas"
            data-camera-zoom={camera.zoom}
            data-ghost={ghostState}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={finishCanvasGesture}
            onPointerCancel={(event) => {
              if (gestureRef.current?.pointerId === event.pointerId) {
                gestureRef.current = null;
                repaintGesture();
              }
              if (panGestureRef.current?.pointerId === event.pointerId) panGestureRef.current = null;
              if (activeTouchPointerRef.current === event.pointerId) activeTouchPointerRef.current = null;
            }}
            onWheel={onCanvasWheel}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="factory-canvas-transform" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
              <div className="factory-paper" style={{ backgroundImage: factoryPaperTexture() }} aria-hidden="true" />
              <div ref={mountRef} className="factory-canvas-mount" />
              {sourceMarks.map((mark) => (
                <span
                  key={mark.index}
                  className="source-base-mark"
                  data-testid="source-base-mark"
                  aria-hidden="true"
                  style={{ left: mark.x, top: mark.y, transform: `translate(-50%, -50%) scale(${controlScale})` }}
                >{BASE_NAMES[mark.base]}</span>
              ))}
              <svg className="factory-ghost-layer" width={overlayWidth} height={overlayHeight} aria-hidden="true" focusable="false">
                {outlinedSelection.map((cell) => (
                  <polygon key={`s${cell.q},${cell.r}`} className="factory-selected" data-testid="factory-selected" points={hexPoints(cell)} />
                ))}
                {ghostCells.map((cell) => (
                  <polygon key={`${cell.q},${cell.r}`} className={ghostClass} points={hexPoints(cell)} />
                ))}
                {marquee !== null && <rect className={`factory-marquee${boxGesture?.erase === true ? " is-erase" : ""}`} data-testid="factory-marquee" {...marquee} />}
              </svg>
              {hoverCell !== null && hoverBuildCost !== null && (
                <output
                  className="factory-ghost-cost"
                  data-testid="factory-ghost-cost"
                  style={{
                    left: factoryCellCenter(hoverCell).x,
                    top: factoryCellCenter(hoverCell).y,
                    transform: `translate(8px, -30px) scale(${1 / camera.zoom})`,
                  }}
                >${hoverBuildCost}</output>
              )}
            </div>
          </div>

          <div className="toolbelt" role="toolbar" aria-label={`${facilityName} build hotbar`} data-testid="factory-toolbelt">
            {tileBrushBtn("belt", "Belt", "1")}
            {tileBrushBtn("splitter", "Splitter", "2")}
            {tileBrushBtn("merger", "Merger", "3")}
            {tileBrushBtn("source", "Source", "4")}
            {tileBrushBtn("sink", "Sink", "5")}
            {tileBrushBtn("erase", "Erase", "X")}
            {tileBrushBtn("select", "Select", "V")}
            <span className="toolbelt-divider" />
            {DEFAULT_CATALOG.map((entry) => {
              const unlocked = catalog.some((candidate) => candidate.typeId === entry.typeId);
              const shortcutIndex = catalog.findIndex((candidate) => candidate.typeId === entry.typeId);
              const lockReason = unlocked ? null : machineLockReason(entry.typeId);
              return (
                <button
                  key={entry.typeId}
                  type="button"
                  onClick={() => {
                    if (lockReason === null) setBrush({ kind: "machine", typeId: entry.typeId });
                    else setLockedHint(lockReason);
                  }}
                  onMouseEnter={lockReason === null ? undefined : () => setLockedHint(lockReason)}
                  onMouseLeave={lockReason === null ? undefined : () => setLockedHint(null)}
                  onFocus={lockReason === null ? undefined : () => setLockedHint(lockReason)}
                  onBlur={lockReason === null ? undefined : () => setLockedHint(null)}
                  aria-disabled={lockReason === null ? undefined : true}
                  className={`tool-slot is-machine${brush.kind === "machine" && brush.typeId === entry.typeId ? " is-selected" : ""}${unlocked ? "" : " is-locked"}`}
                  aria-pressed={brush.kind === "machine" && brush.typeId === entry.typeId}
                  data-testid={`brush-machine-${entry.typeId}`}
                  title={lockReason ?? machineTooltip(entry)}
                >
                  {shortcutIndex >= 0 && shortcutIndex < 4 && (
                    <span className="hotkey">{(shortcutIndex + 7) % 10}</span>
                  )}
                  {lockReason !== null && <LockGlyph />}
                  <span className="tool-symbol">
                    <MachineIcon typeId={entry.typeId} path={entry.path} size={34} variant="token" />
                  </span>
                  <span className="tool-name">{machineName(entry.typeId)}</span>
                </button>
              );
            })}
          </div>
          <span className="toolbelt-more" data-testid="toolbelt-more" aria-hidden="true"><ChevronGlyph /></span>
        </section>

        <aside className="inspector factory-inspector" data-testid="factory-inspector" hidden={!diagnosticsOpen}>
          <button type="button" className="drawer-close" aria-label="Close factory details" onClick={() => setDiagnosticsOpen(false)}><CloseGlyph /></button>
          <h1>{mode === "pilot" ? "Plan" : "Production"}</h1>
          {mode === "production" ? (
            <div className={`factory-metrics${state.deadlocked ? " is-error" : ""}`} data-testid="factory-status" role="status">
              {state.deadlocked && <p className="factory-blocked-note">Line stuck. Red bars mark open belt ends and unconnected outputs.</p>}
              <div><span>Throughput</span><strong><span data-testid="factory-rate">{rate}</span> units/tick</strong></div>
              <div><span>Bottleneck</span><strong data-testid="factory-bottleneck">{throughput === null ? "unavailable" : throughput.bottleneck === null ? "none" : machineName(throughput.bottleneckType!)}</strong></div>
              <div><span>Units finished</span><strong data-testid="factory-produced">{state.producedTotal}</strong></div>
              <div><span>Waste</span><strong data-testid="factory-waste">{waste}</strong></div>
              <div><span>Tick</span><strong data-testid="factory-tick">{state.tick}</strong></div>
            </div>
          ) : (
            <div className="factory-metrics facility-mode-summary" role="status">
              <div><span>Machines</span><strong>{layout.machines.length}</strong></div>
              <div><span>Throughput</span><strong data-testid="pilot-rate">{rate} units/tick</strong></div>
              <div><span>Bottleneck</span><strong data-testid="pilot-bottleneck">{throughput === null ? "unavailable" : throughput.bottleneck === null ? "none" : machineName(throughput.bottleneckType!)}</strong></div>
              <div><span>Sample</span><strong data-testid="facility-sample-outcome">{sampleSummary}</strong></div>
            </div>
          )}

          <div className="panel-section hover-inspector">
            <div className="panel-heading"><h2>Cursor</h2></div>
            <div data-testid="factory-hover-cell">{hoverCell === null ? "outside" : `${hoverCell.q}, ${hoverCell.r}`}</div>
            <strong data-testid="factory-hover-kind">{hoverCell === null ? "" : hoverKind}</strong>
          </div>

        </aside>
        <span className="inspector-more" data-testid="inspector-more" aria-hidden="true"><ChevronGlyph down /></span>
      </div>
    </div>
  );
}
