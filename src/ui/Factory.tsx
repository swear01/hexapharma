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
 *    Its WORLD footprint = local shape rotated by `footRot` quarter-turns CW about
 *    the anchor; `def.path` remains fixed.
 *  - Belts/splitters/mergers/source/sink are tiles; splitter fans one input out
 *    round-robin, merger fans inputs into one output → REAL parallelism: a
 *    source→splitter→[two machines]→merger→sink out-produces a single machine.
 *
 * A facility with no authority opens as an empty entitled floor. Nothing is
 * auto-packed or committed: the player builds geometry directly, and Production
 * sends edits to the game reducer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MachineIcon } from "./MachineIcon";
import { machineName, machineShortName } from "./machineLabels";
import { GameModalPortal } from "./GameModalPortal";
import { outcomeEffectText } from "./effectLabels";
import type {
  Dir,
  Vec2,
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
  return ((d + 2) & 3) as Dir;
}

function emptyTiles(w: number, h: number): FactoryTile[] {
  return Array.from({ length: w * h }, () => ({ kind: "empty" }));
}

// ───────────────────────────── machine geometry (mirrors the sim) ─────────────────────────────

/** Rotate a LOCAL vector `rot` quarter-turns CW (y-down): (x,y)->(-y,x). */
function rotateVec(v: Vec2, rot: Rotation): Vec2 {
  let x = v.x;
  let y = v.y;
  for (let i = 0; i < rot; i++) {
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
  }
  return { x, y };
}

function worldCells(m: PlacedMachine): Vec2[] {
  return m.shape.cells.map((c) => {
    const r = rotateVec(c, m.footRot);
    return { x: r.x + m.anchor.x, y: r.y + m.anchor.y };
  });
}

/** The machine (if any) whose rotated footprint covers world cell (x,y). */
function machineAt(layout: FactoryLayout, x: number, y: number): PlacedMachine | undefined {
  for (const m of layout.machines) {
    for (const c of worldCells(m)) {
      if (c.x === x && c.y === y) return m;
    }
  }
  return undefined;
}

export function directGestureMachineAt(
  layout: FactoryLayout,
  x: number,
  y: number,
  eraseActive: boolean,
): PlacedMachine | undefined {
  return eraseActive ? undefined : machineAt(layout, x, y);
}

export function factoryErasePreviewCells(
  layout: FactoryLayout,
  x: number,
  y: number,
): readonly Vec2[] {
  const machine = machineAt(layout, x, y);
  return machine === undefined ? [{ x, y }] : worldCells(machine);
}

export function transformPlacedMachine(
  layout: FactoryLayout,
  machineId: number,
  anchor: Vec2,
  footRot: Rotation,
): FactoryLayout {
  const machineIndex = layout.machines.findIndex((machine) => machine.id === machineId);
  const current = layout.machines[machineIndex];
  if (current === undefined) return layout;
  if (
    current.anchor.x === anchor.x &&
    current.anchor.y === anchor.y &&
    current.footRot === footRot
  ) {
    return layout;
  }

  const transformed: PlacedMachine = { ...current, anchor, footRot };
  for (const cell of worldCells(transformed)) {
    if (cell.x < 0 || cell.y < 0 || cell.x >= layout.width || cell.y >= layout.height) {
      return layout;
    }
    if (layout.tiles[cell.y * layout.width + cell.x]?.kind !== "empty") return layout;
    const occupied = machineAt(layout, cell.x, cell.y);
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

function factoryLayoutFocus(layout: FactoryLayout): Vec2 | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const machine of layout.machines) {
    for (const cell of worldCells(machine)) {
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
    }
  }
  if (minX === Infinity) {
    for (let index = 0; index < layout.tiles.length; index++) {
      if (layout.tiles[index]?.kind === "empty") continue;
      const x = index % layout.width;
      const y = Math.floor(index / layout.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return minX === Infinity
    ? null
    : { x: (minX + maxX + 1) / 2, y: (minY + maxY + 1) / 2 };
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
      readonly anchorOffset: Vec2;
      readonly footRot: Rotation;
    };

const DIR_LABEL: Record<Dir, string> = { 0: "→ E", 1: "↓ S", 2: "← W", 3: "↑ N" };

/** A belt-grid tile for the current brush + direction (machines handled separately). */
function makeTile(brush: Brush, dir: Dir): FactoryTile | null {
  switch (brush.kind) {
    case "belt":
      return { kind: "belt", dir };
    case "splitter":
      // in from behind; fan out forward + one perpendicular (CW). brushDir=E → in W, out [E,S].
      return { kind: "splitter", inDir: opposite(dir), outDirs: [dir, ((dir + 1) & 3) as Dir] };
    case "merger":
      // out forward; accept from behind + one perpendicular (CW). brushDir=E → out E, in [W,S].
      return { kind: "merger", inDirs: [opposite(dir), ((dir + 1) & 3) as Dir], outDir: dir };
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
  x: number,
  y: number,
): FactoryTile | null {
  if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) return null;
  if (machineAt(layout, x, y) !== undefined) return null;
  const tile = layout.tiles[y * layout.width + x];
  return tile === undefined || tile.kind === "empty" ? null : cloneFactoryTile(tile);
}

export function placeFactoryTile(
  layout: FactoryLayout,
  x: number,
  y: number,
  tile: FactoryTile,
): FactoryLayout {
  if (
    tile.kind === "empty" ||
    x < 0 ||
    y < 0 ||
    x >= layout.width ||
    y >= layout.height ||
    machineAt(layout, x, y) !== undefined
  ) {
    return layout;
  }
  const index = y * layout.width + x;
  const current = layout.tiles[index];
  if (current !== undefined && JSON.stringify(current) === JSON.stringify(tile)) return layout;
  const tiles = layout.tiles.slice();
  tiles[index] = cloneFactoryTile(tile);
  return { ...layout, tiles };
}

function brushAt(layout: FactoryLayout, cell: GridCell): ClipboardBrush | null {
  const machine = machineAt(layout, cell.x, cell.y);
  if (machine !== undefined) {
    return {
      brush: { kind: "machine", typeId: machine.def.typeId },
      dir: E,
      footRot: machine.footRot,
      tile: null,
    };
  }
  const tile = copyFactoryTile(layout, cell.x, cell.y);
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

/** Apply a click at (x,y) with the current brush, returning a new layout. */
function paint(
  layout: FactoryLayout,
  x: number,
  y: number,
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
      anchor: { x, y },
      footRot,
      shape,
    };
    for (const cell of worldCells(m)) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= layout.width || cell.y >= layout.height) return layout;
      if (machineAt(layout, cell.x, cell.y) !== undefined) return layout;
      if (layout.tiles[cell.y * layout.width + cell.x]?.kind !== "empty") return layout;
    }
    return { ...layout, machines: [...layout.machines, m] };
  }

  if (brush.kind === "erase") {
    // remove any machine covering the cell AND clear the tile.
    const hit = machineAt(layout, x, y);
    const currentTile = layout.tiles[y * layout.width + x];
    if (hit === undefined && currentTile?.kind === "empty") return layout;
    const machines = hit ? layout.machines.filter((m) => m.id !== hit.id) : layout.machines;
    const tiles = layout.tiles.slice();
    tiles[y * layout.width + x] = { kind: "empty" };
    return { ...layout, tiles, machines };
  }

  const tile = makeTile(brush, dir);
  if (tile === null) return layout;
  return placeFactoryTile(layout, x, y, tile);
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
    next = paint(next, cell.x, cell.y, { kind: "belt" }, directions[index] ?? fallbackDirection, 0);
  }
  return next;
}

const CELL = 42;
const PAD = 12;

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

  useEffect(() => {
    const next = initialFacilityLayout(authoritativeLayout, entitledWidth, entitledHeight);
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
    if (brush.kind === "machine") setFootRot((value) => ((value + 1) & 3) as Rotation);
    else setBrushDir((value) => ((value + 1) & 3) as Dir);
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
    const focus = factoryLayoutFocus(layoutRef.current);
    if (focus === null) {
      pendingViewportFocusRef.current = false;
      return true;
    }
    const toolbelt = frame.closest(".factory-workspace")?.querySelector<HTMLElement>(".toolbelt");
    const toolbeltTop = toolbelt?.getBoundingClientRect().top ?? frameRect.bottom;
    const visibleBottom = Math.min(frameRect.bottom, toolbeltTop);
    const targetX = frameRect.left + frameRect.width / 2;
    const targetY = frameRect.top + Math.max(0, visibleBottom - frameRect.top) / 2;
    const focusX = canvasRect.left + (PAD + focus.x * CELL) * canvasRect.width / canvas.width;
    const focusY = canvasRect.top + (PAD + focus.y * CELL) * canvasRect.height / canvas.height;
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
      if (!playingRef.current) return;
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
        cellSize: CELL * baseWidth / canvas.width,
        origin: {
          x: PAD * baseWidth / canvas.width,
          y: PAD * baseHeight / canvas.height,
        },
      },
    );
    const layout = layoutRef.current;
    return cell.x < 0 || cell.y < 0 || cell.x >= layout.width || cell.y >= layout.height
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
      const machine = directGestureMachineAt(base, cell.x, cell.y, brush.kind === "erase");
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
            anchorOffset: { x: machine.anchor.x - cell.x, y: machine.anchor.y - cell.y },
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
      ? directGestureMachineAt(base, cell.x, cell.y, brush.kind === "erase")
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
          anchorOffset: { x: machine.anchor.x - cell.x, y: machine.anchor.y - cell.y },
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
      ? routeBeltGesture(gesture.cells, cell, brushDir)
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
          x: gesture.last.x + gesture.anchorOffset.x,
          y: gesture.last.y + gesture.anchorOffset.y,
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
        next = paint(next, cell.x, cell.y, activeBrush, brushDir, footRot);
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
      commitLayout(paint(layoutRef.current, hoverCell.x, hoverCell.y, { kind: "erase" }, E, 0));
    }
  }, [commitLayout, hoverCell]);

  const pasteHovered = useCallback(() => {
    const copied = clipboardRef.current;
    if (copied === null || hoverCell === null) return;
    commitLayout(copied.tile === null
      ? paint(
          layoutRef.current,
          hoverCell.x,
          hoverCell.y,
          copied.brush,
          copied.dir,
          copied.footRot,
        )
      : placeFactoryTile(layoutRef.current, hoverCell.x, hoverCell.y, copied.tile));
  }, [commitLayout, hoverCell]);

  const rotateHoveredMachine = useCallback(() => {
    if (hoverCell === null) return false;
    const current = layoutRef.current;
    const machine = machineAt(current, hoverCell.x, hoverCell.y);
    if (machine === undefined) return false;
    commitLayout(transformPlacedMachine(
      current,
      machine.id,
      machine.anchor,
      ((machine.footRot + 1) & 3) as Rotation,
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
      if (document.querySelector('[role="alertdialog"][aria-modal="true"]') !== null) return;
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
    : throughput.rateDen === 0 ? "0" : `${throughput.rateNum}/${throughput.rateDen}`;
  const sampleSummary = sampleAnalysis.outcome === null
    ? "not runnable"
    : formatFacilityOutcome(sampleAnalysis.outcome);
  const resetAvailable = mode === "production" && onReset !== undefined && factoryRuntimeMayReset(state);
  const hoveredMachine = hoverCell === null ? undefined : machineAt(layout, hoverCell.x, hoverCell.y);
  const hoveredTile = hoverCell === null
    ? undefined
    : layout.tiles[hoverCell.y * layout.width + hoverCell.x];
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
        x: moveGesture.last.x + moveGesture.anchorOffset.x,
        y: moveGesture.last.y + moveGesture.anchorOffset.y,
      };
  const moveBase = moveGesture?.base ?? null;
  const moveCandidate = moveBase === null || moveMachine === undefined || moveAnchor === null
    ? null
    : transformPlacedMachine(moveBase, moveMachine.id, moveAnchor, moveMachine.footRot);
  const beltGestureCandidate = activeGesture?.mode === "paint" && brush.kind === "belt"
    ? paintBeltRoute(activeGesture.base, activeGesture.cells, brushDir)
    : null;
  const idleDirectMachine = activeGesture === null && hoverCell !== null
    ? directGestureMachineAt(layout, hoverCell.x, hoverCell.y, brush.kind === "erase")
    : undefined;
  const hoverCandidate = moveCandidate ?? beltGestureCandidate ?? (idleDirectMachine !== undefined
    ? layout
    : hoverCell === null
    ? layout
    : paint(layout, hoverCell.x, hoverCell.y, brush, brushDir, footRot));
  const moveUnchanged = moveMachine !== undefined && moveAnchor !== null &&
    moveMachine.anchor.x === moveAnchor.x && moveMachine.anchor.y === moveAnchor.y;
  const hoverPlacementValid = moveBase !== null
    ? moveUnchanged || moveCandidate !== moveBase
    : idleDirectMachine !== undefined || hoverCell === null || brush.kind === "erase" || hoverCandidate !== layout;
  const hoverBuildCost = previewProductionBuildCost(mode, layout, hoverCandidate);
  const erasePreviewCells = hoverCell !== null &&
    (brush.kind === "erase" || activeGesture?.mode === "erase")
    ? factoryErasePreviewCells(layout, hoverCell.x, hoverCell.y)
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
          const rotated = rotateVec(cell, footRot);
          return { x: hoverCell.x + rotated.x, y: hoverCell.y + rotated.y };
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

  const facilityName = mode === "pilot" ? "Pilot Plant" : "Production";

  return (
    <div className={`game-view factory-workspace facility-${mode}`} data-testid={`${mode}-facility-workspace`}>
      <div className="world-layout">
        <section className="world-viewport factory-world" aria-label={`${facilityName} construction workspace`}>
          {rendererError !== null && <div role="alert" data-testid="factory-render-error" className="game-alert factory-render-alert">{rendererError}</div>}
          <div className="transport-bar" aria-label={`${facilityName} controls`}>
            {mode === "production" && (
              <>
                <button type="button" onClick={() => setPlaying(true)} disabled={playing || state.deadlocked} className={playing ? "is-active" : ""} data-testid="factory-play" aria-label="Play Production" title="Play (Space)">▶</button>
                <button type="button" onClick={() => setPlaying(false)} disabled={!playing} data-testid="factory-pause" aria-label="Pause Production" title="Pause (Space)">Ⅱ</button>
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
            <button type="button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })} data-testid="factory-camera-reset" aria-label={`Reset ${facilityName} camera`}>⌖</button>
            <output className="zoom-readout" data-testid="factory-zoom">{Math.round(camera.zoom * 100)}%</output>
          </div>

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
              {ghostCells.map((cell) => (
                <div
                  key={`${cell.x},${cell.y}`}
                  className={`factory-ghost${gestureRef.current?.mode === "erase" || brush.kind === "erase" ? " is-erase" : ""}${hoverPlacementValid ? "" : " is-invalid"}`}
                  style={{ left: PAD + cell.x * CELL, top: PAD + cell.y * CELL }}
                />
              ))}
              {hoverCell !== null && hoverBuildCost !== null && (
                <output
                  className="factory-ghost-cost"
                  data-testid="factory-ghost-cost"
                  style={{ left: PAD + hoverCell.x * CELL, top: PAD + hoverCell.y * CELL }}
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
                    <MachineIcon typeId={entry.typeId} path={entry.path} size={26} />
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

        <aside className="inspector factory-inspector" data-testid="factory-inspector">
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
              {mode === "pilot" && <div><span>Throughput</span><strong data-testid="pilot-rate">{rate}/tick</strong></div>}
              {mode === "pilot" && <div><span>Bottleneck</span><strong data-testid="pilot-bottleneck">{throughput === null ? "unavailable" : throughput.bottleneck === null ? "none" : machineName(throughput.bottleneckType!)}</strong></div>}
            </div>
          )}

          <div className="panel-section hover-inspector">
            <div className="panel-heading"><h2>Cursor</h2><span className="hotkey">Q pick</span></div>
            <div data-testid="factory-hover-cell">{hoverCell === null ? "outside" : `${hoverCell.x}, ${hoverCell.y}`}</div>
            <strong data-testid="factory-hover-kind">{hoverCell === null ? "" : hoverKind}</strong>
          </div>

          <div className="panel-section">
            <div className="panel-heading"><h2>Build tool</h2><strong data-testid="brush-selected">{brushLabel}</strong></div>
            <div className="brush-readout" data-testid="brush-direction">
              {brushIsMachine ? `Footprint ${footRot * 90}°` : `Direction ${DIR_LABEL[brushDir]}`}
            </div>
            <div className="panel-actions">
              <button type="button" onClick={rotateHoveredOrActive} className="game-control" data-testid="brush-rotate">R · Rotate</button>
            </div>
            {brushIsMachine && <p>{entryOf(brush.typeId).speed} ticks</p>}
          </div>

          {analysisError !== "" && <div role="alert" data-testid="factory-analysis-error" className="game-alert">{analysisError}</div>}

          <div className="panel-section">
            <h2>Layout operations</h2>
            <div className="brush-readout" data-testid="factory-clipboard">Clipboard {clipboardLabel}</div>
            <div className="panel-actions">
              <button type="button" onClick={undoLayout} disabled={history.past.length === 0} className="game-control" data-testid="factory-undo">↶ Undo</button>
              <button type="button" onClick={redoLayout} disabled={history.future.length === 0} className="game-control" data-testid="factory-redo">↷ Redo</button>
              <button type="button" onClick={() => copyHovered(false)} disabled={hoverCell === null || brushAt(layout, hoverCell) === null} className="game-control" data-testid="factory-copy">Copy</button>
              <button type="button" onClick={() => copyHovered(true)} disabled={hoverCell === null || brushAt(layout, hoverCell) === null} className="game-control" data-testid="factory-cut">Cut</button>
              <button type="button" onClick={pasteHovered} disabled={clipboardLabel === "empty" || hoverCell === null} className="game-control" data-testid="factory-paste">Paste</button>
            </div>
          </div>
        </aside>
        <span className="inspector-more" data-testid="inspector-more" aria-hidden="true">⌄</span>
      </div>
      {resetPending && (
        <GameModalPortal>
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
          </div>
        </GameModalPortal>
      )}
    </div>
  );
}
