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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MachineIcon } from "./MachineIcon";
import { blockingDialogOpen } from "./blockingDialog";
import { createPortal } from "react-dom";
import { machineName } from "./machineLabels";
import { diseaseName, outcomeEffectText } from "./effectLabels";
import { DEFAULT_PATENTS } from "../sim/patent";
import { requiredShippingContractForPatent } from "../sim/game";
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
import { DEFAULT_CATALOG, DEFAULT_SHAPES } from "../sim/phase0_interfaces";
import { initFactory, analyzeThroughput } from "../sim/factory-sim";
import { factoryOutcome } from "../sim/recipe";
import { quoteProductionBuild } from "../sim/construction";
import { worldCells } from "../sim/factory-geom";
import { hexInBounds, hexIndex, rotateHexCoord } from "../sim/hex";
import { buildFactoryTransportTopology, type FactoryTransportEdge } from "../render/factoryTransportTopology";
import { inkJitter } from "../render/ink";
import { hexBoardBounds, hexPolygon, hexToPixel } from "../render/hexProjection";
import type { FactoryRenderer } from "../render/factoryRenderer";
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
  const patent = DEFAULT_PATENTS.find((node) =>
    node.effect.kind === "unlockMachine" && node.effect.typeId === typeId);
  const disease = patent === undefined ? null : requiredShippingContractForPatent(patent.id);
  return disease === null
    ? `${machineName(typeId)} locked · unlock in Technology`
    : `${machineName(typeId)} locked · ship the ${diseaseName(disease)} contract, then unlock in Technology`;
}

export const ROUTING_LOCK_REASON = "Splitter and Merger locked · unlock Split / Merge in Technology";

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

/** Control numbers: machines in the order flow reaches them from the Sources (matches a formula's step order on a straight line). */
export function factoryMachineFlowOrder(layout: FactoryLayout): ReadonlyMap<number, number> {
  const topology = buildFactoryTransportTopology(layout);
  const area = layout.width * layout.height;
  const owner = new Int32Array(area).fill(-1);
  const byId = new Map<number, PlacedMachine>();
  for (const machine of layout.machines) {
    byId.set(machine.id, machine);
    for (const cell of worldCells(machine)) owner[hexIndex(layout.width, cell.q, cell.r)] = machine.id;
  }
  const next: number[][] = Array.from({ length: area }, () => []);
  for (const edge of topology.edges) {
    next[hexIndex(layout.width, edge.from.q, edge.from.r)]!.push(hexIndex(layout.width, edge.to.q, edge.to.r));
  }
  const order = new Map<number, number>();
  const seen = new Uint8Array(area);
  const queue: number[] = [];
  for (let index = 0; index < area; index++) {
    if (layout.tiles[index]?.kind === "source") {
      seen[index] = 1;
      queue.push(index);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    for (const to of next[queue[head]!]!) {
      if (seen[to] === 1) continue;
      const id = owner[to]!;
      const machine = id >= 0 ? byId.get(id) : undefined;
      if (machine === undefined) {
        seen[to] = 1;
        queue.push(to);
        continue;
      }
      if (!order.has(id)) order.set(id, order.size + 1);
      for (const cell of worldCells(machine)) {
        const index = hexIndex(layout.width, cell.q, cell.r);
        if (seen[index] === 1) continue;
        seen[index] = 1;
        queue.push(index);
      }
    }
  }
  for (const machine of layout.machines) {
    if (!order.has(machine.id)) order.set(machine.id, order.size + 1);
  }
  return order;
}

/** Machines the first unit from the first Source passes through on its way to a Sink (a Splitter sends it out its first output). */
export function factoryLineProgram(layout: FactoryLayout): Template | null {
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
  while (at >= 0 && seen[at] === 0) {
    const tile = layout.tiles[at];
    if (tile?.kind === "sink") return steps.length > 0 ? { steps } : null;
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
    const edge = (tile?.kind === "splitter" ? options.find((candidate) => candidate.dir === tile.outDirs[0]) : undefined) ?? options[0];
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
  | { kind: "machine"; typeId: MachineTypeId };

interface ClipboardBrush {
  readonly brush: Brush;
  readonly dir: Dir;
  readonly footRot: Rotation;
  readonly tile: FactoryTile | null;
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
    };

const DIR_LABEL: Record<Dir, string> = {
  0: "E",
  1: "SE",
  2: "SW",
  3: "W",
  4: "NW",
  5: "NE",
};

type TileBrushKind = Brush["kind"] & ("belt" | "splitter" | "merger" | "source" | "sink" | "erase");

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

function LockGlyph() {
  return (
    <svg className="tool-lock" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M3.5 5.5V4a2.5 2.5 0 015 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor" />
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

type RunState = "running" | "paused" | "blocked";

function RunStateGlyph({ state }: { readonly state: RunState }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {state === "running" && <path d="M2.5 1.5l8 4.5-8 4.5z" fill="currentColor" />}
      {state === "paused" && <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" />}
      {state === "blocked" && <path d="M1.5 6h9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  );
}

/** A belt-grid tile for the current brush + direction (machines handled separately). */
function makeTile(brush: Brush, dir: Dir): FactoryTile | null {
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
      return { kind: "source", dir, period: 1 };
    case "sink":
      return { kind: "sink" };
    case "erase":
      return { kind: "empty" };
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
      return { kind: "source", dir: tile.dir, period: tile.period };
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

function brushAt(layout: FactoryLayout, cell: GridCell): ClipboardBrush | null {
  const machine = machineAt(layout, cell.q, cell.r);
  if (machine !== undefined) {
    return {
      brush: { kind: "machine", typeId: machine.def.typeId },
      dir: E,
      footRot: machine.footRot,
      tile: null,
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
    footRot: 0,
    tile,
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

  const tile = makeTile(brush, dir);
  if (tile === null) return layout;
  return placeFactoryTile(layout, q, r, tile);
}

export function paintBeltRoute(
  layout: FactoryLayout,
  cells: readonly GridCell[],
  fallbackDirection: Dir,
): FactoryLayout {
  const directions = orientBeltGesture(cells, fallbackDirection);
  let next = layout;
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    next = paint(next, cell.q, cell.r, { kind: "belt" }, directions[index] ?? fallbackDirection, 0);
  }
  return next;
}

const CELL = 42;
const FACTORY_HEX_SIZE = CELL / 2;
const FACTORY_HEX_WIDTH = Math.sqrt(3) * FACTORY_HEX_SIZE;
const PAD = 12;
const MIN_ZOOM = 0.35;
/** On a phone a built line opens no smaller than this, so ports and step numbers stay legible. */
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

export function factoryRuntimeMayReset(runtime: FactoryRuntime): boolean {
  return runtime.tick !== 0 ||
    runtime.unitCount !== 0 ||
    runtime.nextUnitId !== 0 ||
    runtime.producedTotal !== 0 ||
    runtime.producedEvents.count !== 0 ||
    runtime.deadlocked ||
    runtime.splitterCursors.some((cursor) => cursor !== 0);
}

type FactoryResetCloseOutcome = "cancel" | "accepted" | "rejected";

export function factoryResetPlaybackAfterClose(
  wasPlaying: boolean,
  outcome: FactoryResetCloseOutcome,
  deadlocked: boolean,
): boolean {
  return wasPlaying && outcome !== "accepted" && !deadlocked;
}

type FactoryHotkeyTargetKind = "text" | "control" | "world";

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
  readonly onReset?: () => boolean;
  readonly commandLabel?: string;
  readonly commandDisabled?: boolean;
  readonly onCommand?: (layout: FactoryLayout) => void;
}

export function Factory({
  active,
  mode,
  level,
  planningMap,
  layout: authoritativeLayout,
  runtime,
  waste,
  entitledWidth,
  entitledHeight,
  catalog,
  routing,
  onLayoutChange,
  onAdvance,
  onReset,
  commandLabel,
  commandDisabled = false,
  onCommand,
}: FactoryProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<FactoryRenderer | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);

  const { mm, start } = level;

  const [layout, setLayout] = useState<FactoryLayout>(() =>
    initialFacilityLayout(authoritativeLayout, entitledWidth, entitledHeight)
  );
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [playing, setPlaying] = useState<boolean>(false);
  const [resetPending, setResetPending] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // editing brush + parameters.
  const [brush, setBrush] = useState<Brush>({ kind: "belt" });
  const [lockedHint, setLockedHint] = useState<string | null>(null);
  // Any new tool choice (click, hotkey, pipette) retires a stale locked-machine hint.
  useEffect(() => setLockedHint(null), [brush]);
  const [brushDir, setBrushDir] = useState<Dir>(E);
  const [footRot, setFootRot] = useState<Rotation>(0);
  const [clipboardLabel, setClipboardLabel] = useState("empty");
  const [hoverCell, setHoverCell] = useState<GridCell | null>(null);
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
  const clipboardRef = useRef<ClipboardBrush | null>(null);
  const resetTriggerRef = useRef<HTMLButtonElement | null>(null);
  const resetConfirmRef = useRef<HTMLButtonElement | null>(null);
  const resetCancelRef = useRef<HTMLButtonElement | null>(null);
  const resetWasPlayingRef = useRef(false);
  const gestureRef = useRef<CanvasGesture | null>(null);
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
    () => runtime ?? initFactory(layout, mm, start),
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
  const machineOrder = useMemo(() => factoryMachineFlowOrder(layout), [layout]);
  const machineControls = useMemo(() => layout.machines.map((machine) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of worldCells(machine)) {
      const center = factoryCellCenter(cell);
      minX = Math.min(minX, center.x);
      minY = Math.min(minY, center.y);
      maxX = Math.max(maxX, center.x);
      maxY = Math.max(maxY, center.y);
    }
    return { id: machine.id, number: machineOrder.get(machine.id) ?? 0, x: (minX + maxX) / 2 - 16, y: (minY + maxY) / 2 - 14 };
  }), [layout, machineOrder]);
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
      return { outcome: factoryOutcome(layout, outcomeMap, start), error: null };
    } catch (error) {
      return {
        outcome: null,
        error: `Sample unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }, [authoritativeLayout, layout, mode, planningMap, start, throughput]);
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

  const rotateActiveBrush = useCallback(() => {
    if (brush.kind === "machine") setFootRot((value) => ((value + 1) % 6) as Rotation);
    else setBrushDir((value) => ((value + 1) % 6) as Dir);
  }, [brush.kind]);

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
        rendererRef.current = null;
        if (!disposed) {
          const detail = error instanceof Error ? error.message : String(error);
          setRendererError(`Could not start the Factory renderer: ${detail}`);
        }
      }
    })();
    return () => {
      disposed = true;
      if (focusRequest !== 0) window.cancelAnimationFrame(focusRequest);
      rendererRef.current = null;
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

  // ── play timer: advance the sim by one tick per interval ──
  useEffect(() => {
    if (!playing || mode !== "production" || onAdvance === undefined) return;
    const id = window.setInterval(() => {
      if (!playingRef.current || blockingDialogOpen()) return;
      if (!onAdvance(8)) {
        playingRef.current = false;
        setPlaying(false);
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [mode, onAdvance, playing]);

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

  const openResetConfirmation = useCallback(() => {
    resetWasPlayingRef.current = playingRef.current;
    if (playingRef.current) {
      playingRef.current = false;
      setPlaying(false);
    }
    setResetPending(true);
  }, []);

  const closeResetConfirmation = useCallback((
    restoreFocus = true,
    outcome: FactoryResetCloseOutcome = "cancel",
  ) => {
    const resume = factoryResetPlaybackAfterClose(
      resetWasPlayingRef.current,
      outcome,
      stateRef.current.deadlocked,
    );
    resetWasPlayingRef.current = false;
    setResetPending(false);
    if (resume) {
      playingRef.current = true;
      setPlaying(true);
    }
    if (restoreFocus) window.requestAnimationFrame(() => resetTriggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!resetPending) return;
    resetConfirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeResetConfirmation();
      } else if (event.key === "Tab") {
        event.preventDefault();
        if (document.activeElement === resetConfirmRef.current) resetCancelRef.current?.focus();
        else resetConfirmRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeResetConfirmation, resetPending]);

  const confirmReset = useCallback(() => {
    const accepted = onReset?.() === true;
    closeResetConfirmation(false, accepted ? "accepted" : "rejected");
    if (!accepted) return;
    playingRef.current = false;
    setPlaying(false);
  }, [closeResetConfirmation, onReset]);

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

  const onCanvasPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && event.button === 0) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      if (
        activeTouchPointerRef.current !== null &&
        activeTouchPointerRef.current !== event.pointerId
      ) {
        gestureRef.current = null;
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
      const base = layoutRef.current;
      const machine = directGestureMachineAt(base, cell.q, cell.r, brush.kind === "erase");
      gestureRef.current = machine === undefined
        ? {
            pointerId: event.pointerId,
            mode: "paint",
            base,
            cells: [cell],
            last: cell,
          }
        : {
            pointerId: event.pointerId,
            mode: "move",
            base,
            cells: [cell],
            last: cell,
            machineId: machine.id,
            anchorOffset: { q: machine.anchor.q - cell.q, r: machine.anchor.r - cell.r },
            footRot: machine.footRot,
          };
      return;
    }
    if (event.button === 1 || (event.button === 0 && event.shiftKey)) {
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
    if (event.button !== 0 && event.button !== 2) return;
    const cell = pointerCell(event.clientX, event.clientY);
    if (cell === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setHoverCell(cell);
    const base = layoutRef.current;
    const machine = event.button === 0
      ? directGestureMachineAt(base, cell.q, cell.r, brush.kind === "erase")
      : undefined;
    gestureRef.current = machine === undefined
      ? {
          pointerId: event.pointerId,
          mode: event.button === 2 ? "erase" : "paint",
          base,
          cells: [cell],
          last: cell,
        }
      : {
          pointerId: event.pointerId,
          mode: "move",
          base,
          cells: [cell],
          last: cell,
          machineId: machine.id,
          anchorOffset: { q: machine.anchor.q - cell.q, r: machine.anchor.r - cell.r },
          footRot: machine.footRot,
        };
  }, [brush.kind, camera.x, camera.y, pointerCell]);

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
    if (gesture.mode === "move") {
      gestureRef.current = { ...gesture, last: cell };
      return;
    }
    const cells = gesture.mode === "paint" && brush.kind === "belt"
      ? routeBeltGesture(gesture.cells, cell)
      : appendUniqueCells(gesture.cells, rasterizeGridLine(gesture.last, cell));
    gestureRef.current = {
      ...gesture,
      cells,
      last: cell,
    };
  }, [brush.kind, brushDir, pointerCell, updateCamera]);

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
    if (gesture.mode === "move") {
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
    }
    const activeBrush: Brush = gesture.mode === "erase" ? { kind: "erase" } : brush;
    let next = activeBrush.kind === "belt"
      ? paintBeltRoute(gesture.base, gesture.cells, brushDir)
      : gesture.base;
    if (activeBrush.kind !== "belt") {
      for (const cell of gesture.cells) {
        next = paint(next, cell.q, cell.r, activeBrush, brushDir, footRot);
      }
    }
    commitLayout(next);
  }, [brush, brushDir, commitLayout, footRot]);

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
    if (hoverCell === null) return;
    const picked = brushAt(layout, hoverCell);
    if (picked === null) return;
    setBrush(picked.brush);
    setBrushDir(picked.dir);
    setFootRot(picked.footRot);
  }, [hoverCell, layout]);

  const copyHovered = useCallback((cut: boolean) => {
    if (hoverCell === null) return;
    const copied = brushAt(layoutRef.current, hoverCell);
    if (copied === null) return;
    clipboardRef.current = copied;
    setClipboardLabel(copied.brush.kind === "machine"
      ? machineName(copied.brush.typeId)
      : copied.brush.kind);
    if (cut) {
      commitLayout(paint(layoutRef.current, hoverCell.q, hoverCell.r, { kind: "erase" }, E, 0));
    }
  }, [commitLayout, hoverCell]);

  const pasteHovered = useCallback(() => {
    const copied = clipboardRef.current;
    if (copied === null || hoverCell === null) return;
    commitLayout(copied.tile === null
      ? paint(
          layoutRef.current,
          hoverCell.q,
          hoverCell.r,
          copied.brush,
          copied.dir,
          copied.footRot,
        )
      : placeFactoryTile(layoutRef.current, hoverCell.q, hoverCell.r, copied.tile));
  }, [commitLayout, hoverCell]);

  const rotateHoveredMachine = useCallback(() => {
    if (hoverCell === null) return false;
    const current = layoutRef.current;
    const machine = machineAt(current, hoverCell.q, hoverCell.r);
    if (machine === undefined) return false;
    commitLayout(transformPlacedMachine(
      current,
      machine.id,
      machine.anchor,
      ((machine.footRot + 1) % 6) as Rotation,
    ));
    return true;
  }, [commitLayout, hoverCell]);

  const rotateHoveredOrActive = useCallback(() => {
    if (!rotateHoveredMachine()) rotateActiveBrush();
  }, [rotateActiveBrush, rotateHoveredMachine]);

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
      const target = event.target;
      const textTarget = target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      const controlTarget = target instanceof Element &&
        target.closest("button, a, [role]") !== null;
      const targetKind: FactoryHotkeyTargetKind = textTarget
        ? "text"
        : controlTarget ? "control" : "world";
      if (factoryHotkeyTargetConsumesKey(targetKind, event.key)) return;
      const lower = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && lower === "z") {
        event.preventDefault();
        if (event.shiftKey) redoLayout();
        else undoLayout();
      } else if ((event.ctrlKey || event.metaKey) && lower === "y") {
        event.preventDefault();
        redoLayout();
      } else if ((event.ctrlKey || event.metaKey) && lower === "c") {
        event.preventDefault();
        copyHovered(false);
      } else if ((event.ctrlKey || event.metaKey) && lower === "x") {
        event.preventDefault();
        copyHovered(true);
      } else if ((event.ctrlKey || event.metaKey) && lower === "v") {
        event.preventDefault();
        pasteHovered();
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
        rotateHoveredOrActive();
      } else if (lower === "q") {
        event.preventDefault();
        pickHovered();
      } else if (event.code === "Space") {
        if (mode === "production") {
          event.preventDefault();
          setPlaying((value) => !value && !state.deadlocked);
        }
      } else if (event.key === ".") {
        if (mode === "production") {
          event.preventDefault();
          if (!playing) stepOnce();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, catalog, routing, copyHovered, mode, pasteHovered, pickHovered, playing, redoLayout, rotateHoveredOrActive, state.deadlocked, stepOnce, undoLayout]);

  const brushIsMachine = brush.kind === "machine";
  const brushLabel = brush.kind === "machine" ? machineName(brush.typeId) : brush.kind;
  const rate = throughput === null
    ? "unavailable"
    : throughput.rateDen === 0 ? "0" : (throughput.rateNum / throughput.rateDen).toLocaleString(undefined, { maximumSignificantDigits: 3 });
  const sampleSummary = sampleAnalysis.outcome === null
    ? "not runnable"
    : formatFacilityOutcome(sampleAnalysis.outcome);
  const resetAvailable = mode === "production" && onReset !== undefined && factoryRuntimeMayReset(state);
  const hoveredMachine = hoverCell === null ? undefined : machineAt(layout, hoverCell.q, hoverCell.r);
  const hoveredControl = hoveredMachine === undefined ? undefined : machineOrder.get(hoveredMachine.id);
  const hoveredTile = hoverCell === null
    ? undefined
    : layout.tiles[hexIndex(layout.width, hoverCell.q, hoverCell.r)];
  const hoverKind = hoveredMachine === undefined
    ? hoveredTile?.kind ?? "outside"
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
  const idleDirectMachine = activeGesture === null && hoverCell !== null
    ? directGestureMachineAt(layout, hoverCell.q, hoverCell.r, brush.kind === "erase")
    : undefined;
  const hoverCandidate = moveCandidate ?? beltGestureCandidate ?? (idleDirectMachine !== undefined
    ? layout
    : hoverCell === null
    ? layout
    : paint(layout, hoverCell.q, hoverCell.r, brush, brushDir, footRot));
  const moveUnchanged = moveMachine !== undefined && moveAnchor !== null &&
    moveMachine.anchor.q === moveAnchor.q && moveMachine.anchor.r === moveAnchor.r;
  const hoverPlacementValid = moveBase !== null
    ? moveUnchanged || moveCandidate !== moveBase
    : idleDirectMachine !== undefined || hoverCell === null || brush.kind === "erase" || hoverCandidate !== layout;
  const hoverBuildCost = previewProductionBuildCost(mode, layout, hoverCandidate);
  const erasePreviewCells = hoverCell !== null &&
    (brush.kind === "erase" || activeGesture?.mode === "erase")
    ? factoryErasePreviewCells(layout, hoverCell.q, hoverCell.r)
    : null;
  const ghostCells = moveMachine !== undefined && moveAnchor !== null
    ? worldCells({ ...moveMachine, anchor: moveAnchor })
    : beltGestureCandidate !== null && activeGesture !== null
    ? activeGesture.cells
    : erasePreviewCells !== null
    ? erasePreviewCells
    : idleDirectMachine !== undefined
    ? worldCells(idleDirectMachine)
    : hoverCell === null
    ? []
    : brush.kind === "machine"
      ? DEFAULT_SHAPES[brush.typeId]!.cells.map((cell) => {
          const rotated = rotateHexCoord(cell, footRot);
          return { q: hoverCell.q + rotated.q, r: hoverCell.r + rotated.r };
        })
      : [hoverCell];

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
  const runState: RunState = state.deadlocked ? "blocked" : playing ? "running" : "paused";
  const quote = mode === "pilot"
    ? null
    : brush.kind === "erase"
    ? "No refund"
    : hoverBuildCost === null
    ? null
    : `${moveCandidate === null ? "Build" : "Move"} $${hoverBuildCost}`;
  const canvasBounds = hexBoardBounds(layout.width, layout.height, FACTORY_HEX_SIZE);
  const overlayWidth = Math.ceil(PAD * 2 + canvasBounds.maxX - canvasBounds.minX);
  const overlayHeight = Math.ceil(PAD * 2 + canvasBounds.maxY - canvasBounds.minY);
  const ghostErase = gestureRef.current?.mode === "erase" || brush.kind === "erase";
  const controlScale = Math.max(1, 0.75 / camera.zoom);
  const ghostClass = `factory-ghost${ghostErase ? " is-erase" : ""}${hoverPlacementValid ? "" : " is-invalid"}`;

  return (
    <div className={`game-view factory-workspace facility-${mode}`} data-testid={`${mode}-facility-workspace`}>
      <div className={`world-layout${diagnosticsOpen ? " has-inspector" : ""}`}>
        <section className="world-viewport factory-world" aria-label={`${facilityName} construction workspace`}>
          {rendererError !== null && <div role="alert" data-testid="factory-render-error" className="game-alert factory-render-alert">{rendererError}</div>}
          {mode === "pilot" ? (
            <div className="factory-mode-mark is-plan" data-testid="factory-mode-mark">Plan · Free</div>
          ) : (
            <div className={`factory-mode-mark is-${runState}`} data-testid="factory-mode-mark" role="status">
              Production
              <span className="run-state"><RunStateGlyph state={runState} />{runState === "blocked" ? "Blocked" : runState === "running" ? "Running" : "Paused"}</span>
            </div>
          )}
          <div className="transport-bar factory-controls" aria-label={`${facilityName} controls`}>
            {mode === "production" && (
              <div className="control-group">
                <button type="button" onClick={() => setPlaying(true)} disabled={playing || state.deadlocked} className={playing ? "is-active" : ""} data-testid="factory-play" aria-label="Play Production" title="Play (Space)">Play</button>
                <button type="button" onClick={() => setPlaying(false)} disabled={!playing} data-testid="factory-pause" aria-label="Pause Production" title="Pause (Space)">Pause</button>
                <button type="button" onClick={stepOnce} disabled={playing} data-testid="factory-step" aria-label="Step Production one tick" title="Step one tick (.)">Step</button>
                <button
                  ref={resetTriggerRef}
                  type="button"
                  onClick={openResetConfirmation}
                  disabled={!resetAvailable}
                  data-testid="factory-reset"
                  aria-label="Reset Production"
                  title="Reset Production"
                >Reset</button>
              </div>
            )}
            <div className="control-group view-group">
              <button type="button" onClick={() => { const fitted = fitCamera(); cameraRef.current = fitted; setCamera(fitted); }} data-testid="factory-camera-reset" aria-label={`Reset ${facilityName} camera`}>Center</button>
              <output className="zoom-readout" data-testid="factory-zoom">{Math.round(camera.zoom * 100)}%</output>
              <button type="button" data-testid="factory-diagnostics" aria-expanded={diagnosticsOpen} onClick={() => setDiagnosticsOpen((open) => !open)}>Details</button>
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
              <strong data-testid="brush-selected" className={brushIsMachine ? "" : "is-transport"}>{brushLabel}</strong>
              <span data-testid="brush-direction">{brushIsMachine ? `Footprint ${footRot * 60}°` : <><DirectionGlyph dir={brushDir} />Direction {DIR_LABEL[brushDir]}</>}</span>
              {lockedHint !== null
                ? <span className="build-hint" role="status">{lockedHint}</span>
                : quote !== null && <output className={`build-quote${hoverBuildCost === null ? "" : " has-cost"}`} data-testid="factory-quote">{quote}</output>}
            </div>
            <div className="build-actions">
              <button type="button" onClick={rotateHoveredOrActive} data-testid="brush-rotate">Rotate <kbd>R</kbd></button>
              <button type="button" onClick={undoLayout} disabled={history.past.length === 0} data-testid="factory-undo">Undo</button>
              <button type="button" onClick={redoLayout} disabled={history.future.length === 0} data-testid="factory-redo">Redo</button>
            </div>
          </div>
          {hoveredMachine !== undefined && <div className="machine-selection" data-testid="machine-selection">
            <MachineIcon typeId={hoveredMachine.def.typeId} path={hoveredMachine.def.path} size={40} variant="token" />
            <div>
              <strong>{hoveredControl !== undefined && <span className="machine-control is-inline">{hoveredControl}</span>}{machineName(hoveredMachine.def.typeId)}</strong>
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
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={finishCanvasGesture}
            onPointerCancel={(event) => {
              if (gestureRef.current?.pointerId === event.pointerId) gestureRef.current = null;
              if (panGestureRef.current?.pointerId === event.pointerId) panGestureRef.current = null;
              if (activeTouchPointerRef.current === event.pointerId) activeTouchPointerRef.current = null;
            }}
            onWheel={onCanvasWheel}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="factory-canvas-transform" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
              <div className="factory-paper" style={{ backgroundImage: factoryPaperTexture() }} aria-hidden="true" />
              <div ref={mountRef} className="factory-canvas-mount" />
              {machineControls.map((control) => (
                <span
                  key={control.id}
                  className="machine-control"
                  data-testid="machine-control"
                  aria-hidden="true"
                  style={{ left: control.x, top: control.y, transform: `translate(-50%, -50%) scale(${controlScale})` }}
                >{control.number}</span>
              ))}
              <svg className="factory-ghost-layer" width={overlayWidth} height={overlayHeight} aria-hidden="true" focusable="false">
                {ghostCells.map((cell) => {
                  const center = factoryCellCenter(cell);
                  return (
                    <polygon
                      key={`${cell.q},${cell.r}`}
                      className={ghostClass}
                      points={hexPolygon(center.x, center.y, FACTORY_HEX_SIZE - 1).map((p) => `${p.x},${p.y}`).join(" ")}
                    />
                  );
                })}
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
            {tileBrushBtn("erase", "Erase", "6")}
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
            <div className="panel-heading"><h2>Cursor</h2><span className="hotkey">Q pick</span></div>
            <div data-testid="factory-hover-cell">{hoverCell === null ? "outside" : `${hoverCell.q}, ${hoverCell.r}`}</div>
            <strong data-testid="factory-hover-kind">{hoverCell === null ? "" : hoverKind}</strong>
          </div>

          <div className="panel-section">
            <h2>Layout operations</h2>
            <div className="brush-readout" data-testid="factory-clipboard">Clipboard {clipboardLabel}</div>
            <div className="panel-actions">
              <button type="button" onClick={() => copyHovered(false)} disabled={hoverCell === null || brushAt(layout, hoverCell) === null} className="game-control" data-testid="factory-copy">Copy</button>
              <button type="button" onClick={() => copyHovered(true)} disabled={hoverCell === null || brushAt(layout, hoverCell) === null} className="game-control" data-testid="factory-cut">Cut</button>
              <button type="button" onClick={pasteHovered} disabled={clipboardLabel === "empty" || hoverCell === null} className="game-control" data-testid="factory-paste">Paste</button>
            </div>
          </div>
        </aside>
        <span className="inspector-more" data-testid="inspector-more" aria-hidden="true"><ChevronGlyph down /></span>
      </div>
      {resetPending && createPortal(
        <div
          className="game-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeResetConfirmation();
          }}
        >
          <section
            className="game-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="factory-reset-title"
            aria-describedby="factory-reset-warning factory-reset-preserved"
            data-testid="factory-reset-confirm"
          >
            <h2 id="factory-reset-title">Reset Production?</h2>
            <p id="factory-reset-warning">Runtime and in-flight units will be cleared.</p>
            <p id="factory-reset-preserved">Inventory and waste will stay.</p>
            <div className="modal-actions">
              <button ref={resetCancelRef} type="button" onClick={() => closeResetConfirmation()}>Cancel</button>
              <button
                ref={resetConfirmRef}
                type="button"
                className="danger-action"
                onClick={confirmReset}
              >
                Reset runtime
              </button>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
