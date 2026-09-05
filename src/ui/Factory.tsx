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
import { machineName, machineShortName } from "./machineLabels";
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
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, DEFAULT_SHAPES } from "../sim/phase0_interfaces";
import { initFactory, analyzeThroughput } from "../sim/factory-sim";
import { factoryOutcome } from "../sim/recipe";
import { quoteProductionBuild } from "../sim/construction";
import { worldCells } from "../sim/factory-geom";
import { hexInBounds, hexIndex, rotateHexCoord } from "../sim/hex";
import { hexToPixel } from "../render/hexProjection";
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

function machineDef(typeId: MachineTypeId): FactoryMachineDef {
  const entry = entryOf(typeId);
  return {
    typeId,
    path: entry.path,
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

function factoryLayoutFocus(layout: FactoryLayout): HexCoord | null {
  let minQ = Infinity;
  let minR = Infinity;
  let maxQ = -Infinity;
  let maxR = -Infinity;
  for (const machine of layout.machines) {
    for (const cell of worldCells(machine)) {
      minQ = Math.min(minQ, cell.q);
      minR = Math.min(minR, cell.r);
      maxQ = Math.max(maxQ, cell.q);
      maxR = Math.max(maxR, cell.r);
    }
  }
  if (minQ === Infinity) {
    for (let index = 0; index < layout.tiles.length; index++) {
      if (layout.tiles[index]?.kind === "empty") continue;
      const q = index % layout.width;
      const r = Math.floor(index / layout.width);
      minQ = Math.min(minQ, q);
      minR = Math.min(minR, r);
      maxQ = Math.max(maxQ, q);
      maxR = Math.max(maxR, r);
    }
  }
  return minQ === Infinity
    ? null
    : { q: (minQ + maxQ) / 2, r: (minR + maxR) / 2 };
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
  0: "→ E",
  1: "↘ SE",
  2: "↙ SW",
  3: "← W",
  4: "↖ NW",
  5: "↗ NE",
};

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
  const focusLayoutInViewport = useCallback(() => {
    const frame = frameRef.current;
    const canvas = rendererRef.current?.canvas;
    if (!activeRef.current || frame === null || canvas === undefined) return false;
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    if (frameRect.width === 0 || frameRect.height === 0 || canvasRect.width === 0 || canvasRect.height === 0) {
      return false;
    }
    const focus = factoryLayoutFocus(layoutRef.current) ?? {
      q: (layoutRef.current.width - 1) / 2,
      r: (layoutRef.current.height - 1) / 2,
    };
    const toolbelt = frame.closest(".factory-workspace")?.querySelector<HTMLElement>(".toolbelt");
    const toolbeltTop = toolbelt?.getBoundingClientRect().top ?? frameRect.bottom;
    const visibleBottom = Math.min(frameRect.bottom, toolbeltTop);
    const targetX = frameRect.left + frameRect.width / 2;
    const targetY = frameRect.top + Math.max(0, visibleBottom - frameRect.top) / 2;
    const projectedFocus = factoryCellCenter(focus);
    const focusX = canvasRect.left + projectedFocus.x * canvasRect.width / canvas.width;
    const focusY = canvasRect.top + projectedFocus.y * canvasRect.height / canvas.height;
    if (frame.scrollWidth > frame.clientWidth) frame.scrollLeft += focusX - targetX;
    if (frame.scrollHeight > frame.clientHeight) frame.scrollTop += focusY - targetY;
    pendingViewportFocusRef.current = false;
    return true;
  }, []);
  useEffect(() => {
    let disposed = false;
    let local: FactoryRenderer | null = null;
    let focusRequest = 0;
    setRendererError(null);
    void (async () => {
      try {
        const { createFactoryRenderer } = await import("../render/factoryRenderer");
        const r = await createFactoryRenderer(layoutRef.current);
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
  }, [focusLayoutInViewport, layout.width, layout.height]);

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
          minZoom: 0.65,
          maxZoom: 2.25,
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
        minZoom: 0.65,
        maxZoom: 2.25,
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
        cellSize: FACTORY_HEX_SIZE * baseWidth / canvas.width,
        origin: {
          x: (PAD + FACTORY_HEX_WIDTH / 2) * baseWidth / canvas.width,
          y: (PAD + FACTORY_HEX_SIZE) * baseHeight / canvas.height,
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
      { minZoom: 0.65, maxZoom: 2.25 },
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
      ? machineShortName(copied.brush.typeId)
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
        if (next !== undefined) setBrush(next);
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
  }, [active, catalog, copyHovered, mode, pasteHovered, pickHovered, playing, redoLayout, rotateHoveredOrActive, state.deadlocked, stepOnce, undoLayout]);

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

  const tileBrushBtn = (
    kind: Brush["kind"] & ("belt" | "splitter" | "merger" | "source" | "sink" | "erase"),
    label: string,
    symbol: string,
    hotkey: string,
  ) => (
    <button
      type="button"
      onClick={() => setBrush({ kind })}
      className={`tool-slot${brush.kind === kind ? " is-selected" : ""}`}
      aria-pressed={brush.kind === kind}
      data-testid={`brush-${kind}`}
      title={`${label} (${hotkey})`}
    >
      <span className="tool-symbol" aria-hidden="true">{symbol}</span>
      <span className="tool-name">{label}</span>
      <span className="hotkey">{hotkey}</span>
    </button>
  );

  const facilityName = mode === "pilot" ? "Production Plan" : "Production";

  return (
    <div className={`game-view factory-workspace facility-${mode}`} data-testid={`${mode}-facility-workspace`}>
      <div className={`world-layout${diagnosticsOpen ? " has-inspector" : ""}`}>
        <section className="world-viewport factory-world" aria-label={`${facilityName} construction workspace`}>
          {rendererError !== null && <div role="alert" data-testid="factory-render-error" className="game-alert factory-render-alert">{rendererError}</div>}
          <div className="transport-bar factory-controls" aria-label={`${facilityName} controls`}>
            {mode === "production" && (
              <>
                <button type="button" onClick={() => setPlaying(true)} disabled={playing || state.deadlocked} className={playing ? "is-active" : ""} data-testid="factory-play" aria-label="Play Production" title="Play (Space)">Play</button>
                <button type="button" onClick={() => setPlaying(false)} disabled={!playing} data-testid="factory-pause" aria-label="Pause Production" title="Pause (Space)">Pause</button>
                <button type="button" onClick={stepOnce} disabled={playing} data-testid="factory-step" aria-label="Step Production one tick" title="Step one tick (.)">▶|</button>
                <button
                  ref={resetTriggerRef}
                  type="button"
                  onClick={openResetConfirmation}
                  disabled={!resetAvailable}
                  data-testid="factory-reset"
                  aria-label="Reset Production"
                  title="Reset Production"
                >↺</button>
              </>
            )}
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
            <button type="button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })} data-testid="factory-camera-reset" aria-label={`Reset ${facilityName} camera`}>Center</button>
            <output className="zoom-readout" data-testid="factory-zoom">{Math.round(camera.zoom * 100)}%</output>
            <button type="button" data-testid="factory-diagnostics" aria-expanded={diagnosticsOpen} onClick={() => setDiagnosticsOpen((open) => !open)}>Details</button>
          </div>
          <div className="factory-build-status" aria-label="Current build tool">
            <strong data-testid="brush-selected">{brushLabel}</strong>
            <span data-testid="brush-direction">{brushIsMachine ? `Footprint ${footRot * 60}°` : `Direction ${DIR_LABEL[brushDir]}`}</span>
            <span>{mode === "pilot" ? "Free plan" : brush.kind === "erase" ? "No refund" : hoverBuildCost === null ? "Point to quote" : `${moveCandidate === null ? "Placement" : "Move"} $${hoverBuildCost}`}</span>
            <button type="button" onClick={rotateHoveredOrActive} data-testid="brush-rotate">Rotate <kbd>R</kbd></button>
            <button type="button" onClick={undoLayout} disabled={history.past.length === 0} data-testid="factory-undo">Undo</button>
            <button type="button" onClick={redoLayout} disabled={history.future.length === 0} data-testid="factory-redo">Redo</button>
          </div>
          {hoveredMachine !== undefined && <div className="machine-selection" data-testid="machine-selection">
            <strong>{machineName(hoveredMachine.def.typeId)}</strong>
            <span>{hoveredMachine.shape.inPorts.length} input · {hoveredMachine.shape.outPorts.length} output · {hoveredMachine.def.speed} ticks/unit · ${hoveredMachine.def.cost}/unit · {hoveredMachine.footRot * 60}°</span>
          </div>}
          {state.deadlocked && <div className="factory-blocked" role="status">Line blocked · check ports and open Details</div>}
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
              <div ref={mountRef} className="factory-canvas-mount" />
              {ghostCells.map((cell) => {
                const center = factoryCellCenter(cell);
                return (
                  <div
                    key={`${cell.q},${cell.r}`}
                    className={`factory-ghost${gestureRef.current?.mode === "erase" || brush.kind === "erase" ? " is-erase" : ""}${hoverPlacementValid ? "" : " is-invalid"}`}
                    style={{
                      left: center.x - FACTORY_HEX_WIDTH / 2,
                      top: center.y - FACTORY_HEX_SIZE,
                      width: FACTORY_HEX_WIDTH,
                      height: CELL,
                      clipPath: "polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)",
                    }}
                  />
                );
              })}
              {hoverCell !== null && hoverBuildCost !== null && (
                <output
                  className="factory-ghost-cost"
                  data-testid="factory-ghost-cost"
                  style={{
                    left: factoryCellCenter(hoverCell).x,
                    top: factoryCellCenter(hoverCell).y,
                  }}
                >${hoverBuildCost}</output>
              )}
            </div>
          </div>

          <div className="toolbelt" role="toolbar" aria-label={`${facilityName} build hotbar`} data-testid="factory-toolbelt">
            {tileBrushBtn("belt", "Belt", "➜", "1")}
            {tileBrushBtn("splitter", "Split", "⑂", "2")}
            {tileBrushBtn("merger", "Merge", "⑃", "3")}
            {tileBrushBtn("source", "Source", "S", "4")}
            {tileBrushBtn("sink", "Sink", "◎", "5")}
            {tileBrushBtn("erase", "Erase", "×", "6")}
            <span className="toolbelt-divider" />
            {DEFAULT_CATALOG.map((entry) => {
              const unlocked = catalog.some((candidate) => candidate.typeId === entry.typeId);
              const shortcutIndex = catalog.findIndex((candidate) => candidate.typeId === entry.typeId);
              return (
                <button
                  key={entry.typeId}
                  type="button"
                  onClick={() => {
                    setBrush({ kind: "machine", typeId: entry.typeId });
                  }}
                  disabled={!unlocked}
                  className={`tool-slot${brush.kind === "machine" && brush.typeId === entry.typeId ? " is-selected" : ""}${unlocked ? "" : " is-locked"}`}
                  aria-pressed={brush.kind === "machine" && brush.typeId === entry.typeId}
                  data-testid={`brush-machine-${entry.typeId}`}
                  title={machineTooltip(entry)}
                >
                  <span className="tool-symbol">
                    <MachineIcon typeId={entry.typeId} path={entry.path} size={36} footprint />
                  </span>
                  <span className="tool-name">{machineShortName(entry.typeId)}</span>
                  {shortcutIndex >= 0 && shortcutIndex < 4 && (
                    <span className="hotkey">{(shortcutIndex + 7) % 10}</span>
                  )}
                </button>
              );
            })}
          </div>
          <span className="toolbelt-more" data-testid="toolbelt-more" aria-hidden="true">›</span>
        </section>

        <aside className="inspector factory-inspector" data-testid="factory-inspector" hidden={!diagnosticsOpen}>
          <button type="button" className="drawer-close" aria-label="Close factory details" onClick={() => setDiagnosticsOpen(false)}>×</button>
          <h1>{facilityName}</h1>
          {mode === "production" ? (
            <div className={`factory-metrics${state.deadlocked ? " is-error" : ""}`} data-testid="factory-status" role="status">
              <div><span>Tick</span><strong data-testid="factory-tick">{state.tick}</strong></div>
              <div><span>Total sink outcomes</span><strong data-testid="factory-produced">{state.producedTotal}</strong></div>
              <div><span>Waste</span><strong data-testid="factory-waste">{waste}</strong></div>
              <div><span>Throughput</span><strong><span data-testid="factory-rate">{rate}</span>/tick</strong></div>
              <div><span>Bottleneck</span><strong data-testid="factory-bottleneck">{throughput === null ? "unavailable" : throughput.bottleneck === null ? "none" : machineName(throughput.bottleneckType!)}</strong></div>
            </div>
          ) : (
            <div className="factory-metrics facility-mode-summary" role="status">
              <div><span>Clock</span><strong>Stopped</strong></div>
              <div><span>Build cost</span><strong>Free</strong></div>
              <div><span>Machines</span><strong>{layout.machines.length}</strong></div>
              <div><span>Sample</span><strong data-testid="facility-sample-outcome">{sampleSummary}</strong></div>
              {mode === "pilot" && <div><span>Throughput</span><strong data-testid="pilot-rate">{rate} units/tick</strong></div>}
              {mode === "pilot" && <div><span>Bottleneck</span><strong data-testid="pilot-bottleneck">{throughput === null ? "unavailable" : throughput.bottleneck === null ? "none" : machineName(throughput.bottleneckType!)}</strong></div>}
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
        <span className="inspector-more" data-testid="inspector-more" aria-hidden="true">⌄</span>
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
