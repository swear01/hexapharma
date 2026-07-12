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
 *    the anchor; `def.orientation` (the recipe-locked drug effect) is independent.
 *  - Belts/splitters/mergers/source/sink are tiles; splitter fans one input out
 *    round-robin, merger fans inputs into one output → REAL parallelism: a
 *    source→splitter→[two machines]→merger→sink out-produces a single machine.
 *
 * The default layout is a compiled recipe line (compileTemplate) with one slow
 * stage as the bottleneck, so something runs immediately and there is a bottleneck
 * to relieve. Preset buttons load a single vs a parallel layout to demonstrate the
 * throughput rise; full editing lets the player build it by hand.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MachineIcon } from "./MachineIcon";
import type {
  Dir,
  Vec2,
  Rotation,
  Orientation,
  Template,
  Machine,
  PlacedMachine,
  MachineShape,
  FactoryTile,
  FactoryLayout,
  FactoryMachineDef,
  FactoryRuntime,
  MachineCatalogEntry,
  MachineTypeId,
  GeneratedLevel,
  ThroughputReport,
  Outcome,
} from "../sim/phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  IDENTITY,
} from "../sim/phase0_interfaces";
import { initFactory, analyzeThroughput } from "../sim/factory-sim";
import { compileTemplate, factoryOutcome } from "../sim/recipe";
import { evaluate } from "../sim/drug-graph";
import type { FactoryRenderer } from "../render/factoryRenderer";
import {
  appendUniqueCells,
  clampCamera,
  createEditorHistory,
  panCamera,
  pushEditorHistory,
  rasterizeGridLine,
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
const S: Dir = 1;
const W: Dir = 2;
const N: Dir = 3;

const GRID_W = BASE_GAME_FACTORY_WIDTH;
const GRID_H = BASE_GAME_FACTORY_HEIGHT;

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

function nextMachineId(layout: FactoryLayout): number {
  let max = -1;
  for (const m of layout.machines) if (m.id > max) max = m.id;
  return max + 1;
}

// ───────────────────────────── default + preset layouts ─────────────────────────────

function entryOf(typeId: MachineTypeId): MachineCatalogEntry {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`Factory: unknown machine type "${typeId}"`);
  return entry;
}

function fixtureStep(typeId: MachineTypeId): Machine {
  const entry = entryOf(typeId);
  return { typeId, transform: entry.transform, orientation: IDENTITY };
}

function machineDef(typeId: MachineTypeId, requestedOrientation: Orientation = IDENTITY): FactoryMachineDef {
  const entry = entryOf(typeId);
  const orientation = entry.orientable && entry.transform.kind === "translate"
    ? requestedOrientation
    : IDENTITY;
  return {
    typeId,
    transform: entry.transform,
    orientation,
    cost: entry.cost,
    speed: entry.speed,
  };
}

/**
 * Default factory: compile a 3-stage template (push → pull → push2) with the
 * catalog's real multi-cell footprints, then pad it onto the base floor.
 */
function defaultLayout(): FactoryLayout {
  const fixture: Template = {
    steps: [fixtureStep("push"), fixtureStep("pull"), fixtureStep("push2")],
  };
  return recipeLayout(fixture);
}

/**
 * Lay the WHOLE compiled recipe on a roomy grid (all speed 1). compileTemplate now
 * returns a real-shaped, multi-row layout (L / 2×2 machines routed on lower rows), so
 * we copy its full tiles + machines verbatim onto a canvas at least GRID_W×GRID_H —
 * leaving empty space below/right for the player to add parallels. The compiled
 * geometry (incl. lower-row belts + multi-cell machines) renders + runs intact.
 */
function recipeLayout(recipe: Template): FactoryLayout {
  const line = compileTemplate(recipe);
  const w = Math.max(GRID_W, line.width);
  const h = Math.max(GRID_H, line.height);
  const tiles = emptyTiles(w, h);
  for (let y = 0; y < line.height; y++) {
    for (let x = 0; x < line.width; x++) {
      tiles[y * w + x] = line.tiles[y * line.width + x]!;
    }
  }
  return { width: w, height: h, tiles, machines: line.machines.slice() };
}

/** Preset: one catalog-speed pull on one row (the slow baseline). */
function singlePreset(): FactoryLayout {
  return recipeLayout({ steps: [fixtureStep("pull")] });
}

/**
 * Preset: source → splitter → two pull machines (rows 0 + 1) → merger → sink.
 * Mirrors the sim's verified parallel fixture at about 2× the single preset.
 */
function parallelPreset(): FactoryLayout {
  const tiles = emptyTiles(GRID_W, GRID_H);
  const at = (x: number, y: number) => y * GRID_W + x;
  tiles[at(0, 2)] = { kind: "source", dir: E, period: 1 };
  tiles[at(1, 2)] = { kind: "splitter", inDir: W, outDirs: [N, S] };
  tiles[at(1, 1)] = { kind: "belt", dir: E };
  tiles[at(2, 1)] = { kind: "belt", dir: E };
  tiles[at(1, 3)] = { kind: "belt", dir: S };
  tiles[at(1, 4)] = { kind: "belt", dir: E };
  tiles[at(2, 4)] = { kind: "belt", dir: E };
  tiles[at(5, 2)] = { kind: "belt", dir: E };
  tiles[at(6, 2)] = { kind: "belt", dir: E };
  tiles[at(5, 5)] = { kind: "belt", dir: E };
  tiles[at(6, 5)] = { kind: "belt", dir: E };
  tiles[at(7, 5)] = { kind: "belt", dir: N };
  tiles[at(7, 4)] = { kind: "belt", dir: N };
  tiles[at(7, 3)] = { kind: "belt", dir: N };
  tiles[at(7, 2)] = { kind: "merger", inDirs: [W, S], outDir: E };
  tiles[at(8, 2)] = { kind: "belt", dir: E };
  tiles[at(9, 2)] = { kind: "sink" };
  const machines: PlacedMachine[] = [
    { id: 0, def: machineDef("pull"), anchor: { x: 3, y: 1 }, footRot: 0, shape: DEFAULT_SHAPES.pull! },
    { id: 1, def: machineDef("pull"), anchor: { x: 3, y: 4 }, footRot: 0, shape: DEFAULT_SHAPES.pull! },
  ];
  return { width: GRID_W, height: GRID_H, tiles, machines };
}

function fitPreset(preset: FactoryLayout, width: number, height: number): FactoryLayout {
  if (width < 6 || height < 2) return preset;
  const tiles = emptyTiles(width, height);
  for (let y = 0; y < Math.min(preset.height, height); y++) {
    for (let x = 0; x < Math.min(preset.width, width); x++) {
      tiles[y * width + x] = preset.tiles[y * preset.width + x]!;
    }
  }
  return { width, height, tiles, machines: preset.machines.slice() };
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
  readonly effectOrientation: Orientation;
}

const DIR_LABEL: Record<Dir, string> = { 0: "→ E", 1: "↓ S", 2: "← W", 3: "↑ N" };

function machineUiName(typeId: MachineTypeId): string {
  return typeId === "swap01" ? "phase exchange A↔B" : typeId;
}

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

function brushAt(layout: FactoryLayout, cell: GridCell): ClipboardBrush | null {
  const machine = machineAt(layout, cell.x, cell.y);
  if (machine !== undefined) {
    return {
      brush: { kind: "machine", typeId: machine.def.typeId },
      dir: E,
      footRot: machine.footRot,
      effectOrientation: machine.def.orientation,
    };
  }
  const tile = layout.tiles[cell.y * layout.width + cell.x];
  if (tile === undefined || tile.kind === "empty") return null;
  const dir = tile.kind === "belt" || tile.kind === "source"
    ? tile.dir
    : tile.kind === "splitter"
      ? tile.outDirs[0] ?? E
      : tile.kind === "merger" ? tile.outDir : E;
  return {
    brush: { kind: tile.kind },
    dir,
    footRot: 0,
    effectOrientation: IDENTITY,
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
  effectOrientation: Orientation,
): FactoryLayout {
  if (brush.kind === "machine") {
    const shape: MachineShape | undefined = DEFAULT_SHAPES[brush.typeId];
    if (shape === undefined) throw new Error(`Factory: unknown machine shape "${brush.typeId}"`);
    const m: PlacedMachine = {
      id: nextMachineId(layout),
      def: machineDef(brush.typeId, effectOrientation),
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
  // painting a tile onto a machine cell first removes that machine.
  const hit = machineAt(layout, x, y);
  const currentTile = layout.tiles[y * layout.width + x];
  if (hit === undefined && JSON.stringify(currentTile) === JSON.stringify(tile)) return layout;
  const machines = hit ? layout.machines.filter((m) => m.id !== hit.id) : layout.machines;
  const tiles = layout.tiles.slice();
  tiles[y * layout.width + x] = tile;
  return { ...layout, tiles, machines };
}

const CELL = 42;
const PAD = 12;

// ───────────────────────────── component ─────────────────────────────

const TICK_MS = 80;

interface FactoryProps {
  readonly active: boolean;
  readonly level: GeneratedLevel;
  /** The winning recipe from the Lab (drives the default layout), or null. */
  readonly recipe: Template | null;
  /** The shared/persisted factory layout, or null to use the recipe/fixture default. */
  readonly factory: FactoryLayout | null;
  readonly factoryState: FactoryRuntime | null;
  readonly factoryWaste: number;
  readonly entitledWidth: number;
  readonly entitledHeight: number;
  readonly catalog: readonly MachineCatalogEntry[];
  /** Lift the current layout into the shared game state. */
  readonly onFactoryChange: (layout: FactoryLayout) => boolean;
  readonly onAdvance: (ticks: number) => boolean;
  readonly onReset: () => boolean;
}

/** Pick the starting layout: the persisted one, else the recipe line, else the fixture. */
function startingLayout(
  factory: FactoryLayout | null,
  recipe: Template | null,
  entitledWidth: number,
  entitledHeight: number,
): FactoryLayout {
  if (factory !== null) return factory;
  if (recipe !== null && recipe.steps.length > 0) return recipeLayout(recipe);
  return fitPreset(defaultLayout(), entitledWidth, entitledHeight);
}

export function Factory({
  active,
  level,
  recipe,
  factory,
  factoryState,
  factoryWaste,
  entitledWidth,
  entitledHeight,
  catalog,
  onFactoryChange,
  onAdvance,
  onReset,
}: FactoryProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<FactoryRenderer | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);

  const { mm, start } = level;

  const [layout, setLayout] = useState<FactoryLayout>(() =>
    startingLayout(factory, recipe, entitledWidth, entitledHeight)
  );
  const [playing, setPlaying] = useState<boolean>(false);

  // editing brush + parameters.
  const [brush, setBrush] = useState<Brush>({ kind: "belt" });
  const [brushDir, setBrushDir] = useState<Dir>(E);
  const [footRot, setFootRot] = useState<Rotation>(0);
  const [effectRot, setEffectRot] = useState<Rotation>(0);
  const [effectFlip, setEffectFlip] = useState(false);
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
  const pendingCommittedKeysRef = useRef<string[]>([]);
  const clipboardRef = useRef<ClipboardBrush | null>(null);
  const gestureRef = useRef<{
    readonly pointerId: number;
    readonly mode: "paint" | "erase";
    readonly base: FactoryLayout;
    readonly cells: readonly GridCell[];
    readonly last: GridCell;
  } | null>(null);
  const panGestureRef = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly startX: number;
    readonly startY: number;
  } | null>(null);
  const touchGestureRef = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly startX: number;
    readonly startY: number;
    readonly cell: GridCell | null;
    moved: boolean;
  } | null>(null);

  // keep the latest layout/level in refs so the play timer reads fresh values.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const state = useMemo(
    () => factoryState ?? initFactory(layout, mm, start),
    [factoryState, layout, mm, start],
  );

  const throughputAnalysis = useMemo<{
    readonly report: ThroughputReport | null;
    readonly error: string | null;
  }>(() => {
    try {
      return { report: analyzeThroughput(layout, mm), error: null };
    } catch (error) {
      return {
        report: null,
        error: `Throughput analysis unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }, [layout, mm]);
  const throughput = throughputAnalysis.report;
  const expectedOutcome = useMemo(
    () => recipe === null ? null : evaluate(mm, start, recipe),
    [mm, recipe, start],
  );
  const sampleAnalysis = useMemo<{
    readonly outcome: Outcome | null;
    readonly error: string | null;
  }>(() => {
    if (expectedOutcome === null) return { outcome: null, error: null };
    try {
      return { outcome: factoryOutcome(layout, mm, start), error: null };
    } catch (error) {
      return {
        outcome: null,
        error: `Recipe sample unavailable: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }, [expectedOutcome, layout, mm, start]);
  const recipeValid = useMemo(() => {
    if (expectedOutcome === null || sampleAnalysis.outcome === null) return null;
    return JSON.stringify(sampleAnalysis.outcome) === JSON.stringify(expectedOutcome);
  }, [expectedOutcome, sampleAnalysis.outcome]);
  const analysisError = [throughputAnalysis.error, sampleAnalysis.error]
    .filter((entry): entry is string => entry !== null)
    .join(" ");

  useEffect(() => {
    const next = startingLayout(factory, recipe, entitledWidth, entitledHeight);
    setPlaying(false);
    if (factory !== null || onFactoryChange(next)) {
      const key = JSON.stringify(next);
      const pendingIndex = pendingCommittedKeysRef.current.indexOf(key);
      if (pendingIndex >= 0) {
        pendingCommittedKeysRef.current.splice(0, pendingIndex + 1);
        if (pendingCommittedKeysRef.current.length > 0) return;
      } else {
        pendingCommittedKeysRef.current.length = 0;
        const resetHistory = createEditorHistory(next);
        historyRef.current = resetHistory;
        setHistory(resetHistory);
      }
      layoutRef.current = next;
      setLayout(next);
    }
  }, [recipe, mm, start, factory, entitledWidth, entitledHeight, onFactoryChange]);

  const commitLayout = useCallback(
    (next: FactoryLayout) => {
      setPlaying(false);
      if (next === layoutRef.current) return false;
      if (!onFactoryChange(next)) return false;
      pendingCommittedKeysRef.current.push(JSON.stringify(next));
      layoutRef.current = next;
      setLayout(next);
      const nextHistory = pushEditorHistory(historyRef.current, next);
      historyRef.current = nextHistory;
      setHistory(nextHistory);
      return true;
    },
    [onFactoryChange],
  );

  const restoreHistory = useCallback((next: EditorHistory<FactoryLayout>) => {
    if (next === historyRef.current || !onFactoryChange(next.present)) return;
    pendingCommittedKeysRef.current.push(JSON.stringify(next.present));
    historyRef.current = next;
    setHistory(next);
    layoutRef.current = next.present;
    setLayout(next.present);
    setPlaying(false);
  }, [onFactoryChange]);

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
  const bottleneckRef = useRef(throughput?.bottleneck ?? null);
  bottleneckRef.current = throughput?.bottleneck ?? null;
  useEffect(() => {
    let disposed = false;
    let local: FactoryRenderer | null = null;
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
      rendererRef.current = null;
      if (local) local.destroy();
    };
  }, [layout.width, layout.height]);

  // ── repaint whenever layout / state / bottleneck changes ──
  useEffect(() => {
    rendererRef.current?.render(layout, state, throughput?.bottleneck ?? null);
  }, [layout, state, state.tick, throughput?.bottleneck]);

  // ── play timer: advance the sim by one tick per interval ──
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (!onAdvance(8)) setPlaying(false);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing, onAdvance]);

  // stop playing automatically on deadlock.
  useEffect(() => {
    if (state.deadlocked && playing) setPlaying(false);
  }, [state.deadlocked, playing]);

  // ── controls ──
  const stepOnce = useCallback(() => {
    onAdvance(1);
  }, [onAdvance]);

  const reset = useCallback(() => {
    setPlaying(false);
    onReset();
  }, [onReset]);

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
      touchGestureRef.current = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        startX: camera.x,
        startY: camera.y,
        cell: pointerCell(event.clientX, event.clientY),
        moved: false,
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
    gestureRef.current = {
      pointerId: event.pointerId,
      mode: event.button === 2 ? "erase" : "paint",
      base: layoutRef.current,
      cells: [cell],
      last: cell,
    };
  }, [camera.x, camera.y, pointerCell]);

  const onCanvasPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const touchGesture = touchGestureRef.current;
    if (touchGesture?.pointerId === event.pointerId) {
      const dx = event.clientX - touchGesture.clientX;
      const dy = event.clientY - touchGesture.clientY;
      if (touchGesture.moved || Math.hypot(dx, dy) >= 6) {
        touchGesture.moved = true;
        updateCamera((current) => panCamera(
          { x: touchGesture.startX, y: touchGesture.startY, zoom: current.zoom },
          { x: dx, y: dy },
        ));
      }
      setHoverCell(pointerCell(event.clientX, event.clientY));
      return;
    }
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
    gestureRef.current = {
      ...gesture,
      cells: appendUniqueCells(gesture.cells, rasterizeGridLine(gesture.last, cell)),
      last: cell,
    };
  }, [pointerCell, updateCamera]);

  const finishCanvasGesture = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const touchGesture = touchGestureRef.current;
    if (touchGesture?.pointerId === event.pointerId) {
      touchGestureRef.current = null;
      if (!touchGesture.moved && touchGesture.cell !== null) {
        commitLayout(paint(
          layoutRef.current,
          touchGesture.cell.x,
          touchGesture.cell.y,
          brush,
          brushDir,
          footRot,
          { rot: effectRot, flip: effectFlip },
        ));
      }
      return;
    }
    const panGesture = panGestureRef.current;
    if (panGesture?.pointerId === event.pointerId) {
      panGestureRef.current = null;
      return;
    }
    const gesture = gestureRef.current;
    if (gesture?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const activeBrush: Brush = gesture.mode === "erase" ? { kind: "erase" } : brush;
    let next = gesture.base;
    for (const cell of gesture.cells) {
      next = paint(next, cell.x, cell.y, activeBrush, brushDir, footRot, {
        rot: effectRot,
        flip: effectFlip,
      });
    }
    commitLayout(next);
  }, [brush, brushDir, commitLayout, effectFlip, effectRot, footRot]);

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
    setEffectRot(picked.effectOrientation.rot);
    setEffectFlip(picked.effectOrientation.flip);
  }, [hoverCell, layout]);

  const copyHovered = useCallback((cut: boolean) => {
    if (hoverCell === null) return;
    const copied = brushAt(layoutRef.current, hoverCell);
    if (copied === null) return;
    clipboardRef.current = copied;
    setClipboardLabel(copied.brush.kind === "machine" ? copied.brush.typeId : copied.brush.kind);
    if (cut) {
      commitLayout(paint(layoutRef.current, hoverCell.x, hoverCell.y, { kind: "erase" }, E, 0, IDENTITY));
    }
  }, [commitLayout, hoverCell]);

  const pasteHovered = useCallback(() => {
    const copied = clipboardRef.current;
    if (copied === null || hoverCell === null) return;
    commitLayout(paint(
      layoutRef.current,
      hoverCell.x,
      hoverCell.y,
      copied.brush,
      copied.dir,
      copied.footRot,
      copied.effectOrientation,
    ));
  }, [commitLayout, hoverCell]);

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
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
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
        setBrush(tileBrushes[Number(event.code.slice(5)) - 1] ?? { kind: "belt" });
      } else if (/^Digit[7-9]$/.test(event.code) || event.code === "Digit0") {
        event.preventDefault();
        const slot = event.code === "Digit0" ? 3 : Number(event.code.slice(5)) - 7;
        const entry = catalog[slot];
        if (entry !== undefined) setBrush({ kind: "machine", typeId: entry.typeId });
      } else if (lower === "r") {
        event.preventDefault();
        rotateActiveBrush();
      } else if (lower === "h") {
        event.preventDefault();
        if (brush.kind === "machine" && entryOf(brush.typeId).orientable) {
          setEffectFlip((value) => !value);
        }
      } else if (lower === "v") {
        event.preventDefault();
        if (brush.kind === "machine" && entryOf(brush.typeId).orientable) {
          setEffectRot((value) => ((value + 1) & 3) as Rotation);
        }
      } else if (lower === "q") {
        event.preventDefault();
        pickHovered();
      } else if (event.code === "Space") {
        event.preventDefault();
        setPlaying((value) => !value && !state.deadlocked);
      } else if (event.key === ".") {
        event.preventDefault();
        if (!playing) stepOnce();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, catalog, copyHovered, pasteHovered, pickHovered, playing, redoLayout, rotateActiveBrush, state.deadlocked, stepOnce, undoLayout]);

  const brushIsMachine = brush.kind === "machine";
  const brushAcceptsEffectOrientation = brush.kind === "machine" &&
    entryOf(brush.typeId).orientable && entryOf(brush.typeId).transform.kind === "translate";
  const brushLabel = brush.kind === "machine" ? `machine: ${machineUiName(brush.typeId)}` : brush.kind;
  const rate = throughput === null
    ? "unavailable"
    : throughput.rateDen === 0 ? "0" : `${throughput.rateNum}/${throughput.rateDen}`;
  const hoveredMachine = hoverCell === null ? undefined : machineAt(layout, hoverCell.x, hoverCell.y);
  const hoveredTile = hoverCell === null
    ? undefined
    : layout.tiles[hoverCell.y * layout.width + hoverCell.x];
  const hoverKind = hoveredMachine === undefined
    ? hoveredTile?.kind ?? "outside"
    : `machine:${machineUiName(hoveredMachine.def.typeId)}`;
  const hoverPlacementValid = hoverCell === null || brush.kind === "erase"
    ? true
    : paint(layout, hoverCell.x, hoverCell.y, brush, brushDir, footRot, {
        rot: effectRot,
        flip: effectFlip,
      }) !== layout;
  const ghostCells = hoverCell === null
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

  return (
    <div className="game-view factory-workspace" data-testid="factory-workspace">
      <div className="world-layout">
        <section className="world-viewport factory-world" aria-label="Factory construction workspace">
          {rendererError !== null && <div role="alert" data-testid="factory-render-error" className="game-alert factory-render-alert">{rendererError}</div>}
          <div className="transport-bar" aria-label="Factory transport controls">
            <button type="button" onClick={() => setPlaying(true)} disabled={playing || state.deadlocked} className={playing ? "is-active" : ""} data-testid="factory-play">▶</button>
            <button type="button" onClick={() => setPlaying(false)} disabled={!playing} data-testid="factory-pause">Ⅱ</button>
            <button type="button" onClick={stepOnce} disabled={playing} data-testid="factory-step">▶|</button>
            <button type="button" onClick={reset} data-testid="factory-reset">↺</button>
            <button type="button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })} data-testid="factory-camera-reset" aria-label="Reset factory camera">⌖</button>
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
              if (touchGestureRef.current?.pointerId === event.pointerId) touchGestureRef.current = null;
            }}
            onWheel={onCanvasWheel}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="factory-canvas-transform" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
              <div ref={mountRef} className="factory-canvas-mount" />
              {ghostCells.map((cell) => (
                <div
                  key={`${cell.x},${cell.y}`}
                  className={`factory-ghost${gestureRef.current?.mode === "erase" ? " is-erase" : ""}${hoverPlacementValid ? "" : " is-invalid"}`}
                  style={{ left: PAD + cell.x * CELL, top: PAD + cell.y * CELL }}
                />
              ))}
            </div>
          </div>

          <div className="toolbelt" role="toolbar" aria-label="Factory build hotbar" data-testid="factory-toolbelt">
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
                  onClick={() => setBrush({ kind: "machine", typeId: entry.typeId })}
                  disabled={!unlocked}
                  className={`tool-slot${brush.kind === "machine" && brush.typeId === entry.typeId ? " is-selected" : ""}${unlocked ? "" : " is-locked"}`}
                  aria-pressed={brush.kind === "machine" && brush.typeId === entry.typeId}
                  data-testid={`brush-machine-${entry.typeId}`}
                  title={`${machineUiName(entry.typeId)} · ${entry.speed} ticks/unit`}
                >
                  <span className="tool-symbol">
                    <MachineIcon typeId={entry.typeId} transform={entry.transform} orientation={IDENTITY} size={26} />
                  </span>
                  <span className="tool-name">{machineUiName(entry.typeId)}</span>
                  {shortcutIndex >= 0 && shortcutIndex < 4 && (
                    <span className="hotkey">{(shortcutIndex + 7) % 10}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <aside className="inspector factory-inspector" data-testid="factory-inspector">
          <div className="panel-kicker">Production floor</div>
          <h1>HexaPharma Factory</h1>
          <div className={`factory-metrics${state.deadlocked ? " is-error" : ""}`} data-testid="factory-status" role="status">
            <div><span>Tick</span><strong data-testid="factory-tick">{state.tick}</strong></div>
            <div><span>Total sink outcomes (includes waste)</span><strong data-testid="factory-produced">{state.producedTotal}</strong></div>
            <div><span>Waste</span><strong data-testid="factory-waste">{factoryWaste}</strong></div>
            <div><span>Throughput</span><strong><span data-testid="factory-rate">{rate}</span>/tick</strong></div>
            <div><span>Bottleneck</span><strong data-testid="factory-bottleneck">{throughput === null ? "unavailable" : throughput.bottleneck === null ? "none" : `#${throughput.bottleneck} (${throughput.bottleneckType})`}</strong></div>
          </div>

          <div className="panel-section hover-inspector">
            <div className="panel-heading"><h2>Cursor</h2><span className="hotkey">Q pick</span></div>
            <div data-testid="factory-hover-cell">{hoverCell === null ? "outside" : `${hoverCell.x}, ${hoverCell.y}`}</div>
            <strong data-testid="factory-hover-kind">{hoverKind}</strong>
          </div>

          <div className="panel-section">
            <div className="panel-heading"><h2>Build tool</h2><strong data-testid="brush-selected">{brushLabel}</strong></div>
            <div className="brush-readout" data-testid="brush-direction">
              {brushIsMachine ? `Footprint ${footRot * 90}°` : `Direction ${DIR_LABEL[brushDir]}`}
            </div>
            <div className="panel-actions">
              <button type="button" onClick={rotateActiveBrush} className="game-control" data-testid="brush-rotate">R · Rotate</button>
              <button type="button" onClick={() => setFootRot((value) => ((value + 1) & 3) as Rotation)} disabled={!brushIsMachine} className="game-control" data-testid="brush-footrot">foot {footRot * 90}°</button>
              <button type="button" onClick={() => setEffectRot((value) => ((value + 1) & 3) as Rotation)} disabled={!brushAcceptsEffectOrientation} className="game-control" data-testid="brush-effect-rotate">V · effect {effectRot * 90}°</button>
              <button type="button" onClick={() => setEffectFlip((value) => !value)} disabled={!brushAcceptsEffectOrientation} className={`game-control${effectFlip ? " is-active" : ""}`} data-testid="brush-effect-flip">H · flip {effectFlip ? "on" : "off"}</button>
            </div>
            {brushIsMachine && <p>Speed {entryOf(brush.typeId).speed} ticks/unit. Footprint rotation and drug effect orientation are independent.</p>}
          </div>

          <div className="panel-section">
            <h2>Recipe contract</h2>
            <div data-testid="factory-recipe">
              {recipe === null
                ? "No saved recipe. Sink output is waste until a cure is sent from the Lab."
                : `Saved recipe · ${recipe.steps.length} steps`}
            </div>
            <div className={recipeValid === false ? "is-error-text" : "is-success-text"} data-testid="factory-validity">
              {sampleAnalysis.error !== null
                ? "Bounded sample unavailable; live validation remains authoritative."
                : recipeValid === null
                  ? "No recipe contract. Sink output is treated as waste."
                  : recipeValid
                    ? "Bounded sample matches the saved recipe."
                    : "Bounded sample diverges; live mismatches are waste."}
            </div>
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
              <button type="button" onClick={() => commitLayout(fitPreset(singlePreset(), layout.width, layout.height))} className="game-control" data-testid="preset-single">Single</button>
              <button type="button" onClick={() => commitLayout(fitPreset(parallelPreset(), layout.width, layout.height))} className="game-control" data-testid="preset-parallel">Parallel</button>
            </div>
          </div>
          <div className="key-help"><span className="hotkey">LMB drag</span> build · <span className="hotkey">RMB drag</span> erase · <span className="hotkey">Shift drag</span> pan · <span className="hotkey">Wheel</span> zoom · <span className="hotkey">Ctrl C/X/V</span> clipboard · <span className="hotkey">Ctrl Z/Y</span> history</div>
        </aside>
      </div>
    </div>
  );
}
