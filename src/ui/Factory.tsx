/**
 * HexaPharma — the Factory (Phase 2 visual, NEW model).
 *
 * React owns ALL state: the FactoryLayout the player edits (belt-grid tiles +
 * multi-cell shaped machines in `layout.machines`), the running FactoryState
 * (advanced by CALLING the sim `stepFactory`), and the level (MultiMap + start).
 * It hands plain sim state to the dumb PixiJS renderer (src/render/factoryRenderer).
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
import type {
  Dir,
  Vec2,
  Rotation,
  Template,
  Machine,
  Transform,
  PlacedMachine,
  MachineShape,
  FactoryTile,
  FactoryLayout,
  FactoryMachineDef,
  FactoryState,
  MachineCatalogEntry,
  MachineTypeId,
  GeneratedLevel,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, DEFAULT_SHAPES, IDENTITY } from "../sim/phase0_interfaces";
import { initFactory, stepFactory, analyzeThroughput } from "../sim/factory-sim";
import { compileTemplate } from "../sim/recipe";
import { createFactoryRenderer, type FactoryRenderer } from "../render/factoryRenderer";

// ───────────────────────────── directions ─────────────────────────────

const E: Dir = 0;
const S: Dir = 1;
const W: Dir = 2;
const N: Dir = 3;

const GRID_W = 9;
const GRID_H = 6;

function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

function emptyTiles(w: number, h: number): FactoryTile[] {
  return new Array<FactoryTile>(w * h).fill({ kind: "empty" });
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

function entryOf(typeId: MachineTypeId): MachineCatalogEntry | undefined {
  return DEFAULT_CATALOG.find((e) => e.typeId === typeId);
}

function fixtureStep(typeId: MachineTypeId): Machine {
  const entry = entryOf(typeId);
  const transform: Transform = entry?.transform ?? DEFAULT_CATALOG[0]!.transform;
  return { typeId, transform, orientation: IDENTITY };
}

function machineDef(typeId: MachineTypeId, speed: number): FactoryMachineDef {
  const entry = entryOf(typeId);
  return {
    typeId,
    transform: entry?.transform ?? DEFAULT_CATALOG[0]!.transform,
    orientation: IDENTITY,
    cost: entry?.cost ?? 0,
    speed: Math.max(1, speed | 0),
  };
}

/**
 * Default factory: compile a 3-stage template (push → pull → push2) to a straight
 * 1×1-machine line (compileTemplate), then re-lay it onto a roomy GRID_W×GRID_H grid
 * with the middle `pull` slowed to speed 3 (the bottleneck) — leaving empty space
 * below for the player to add a parallel `pull` and raise throughput.
 */
function defaultLayout(): FactoryLayout {
  const fixture: Template = {
    steps: [fixtureStep("push"), fixtureStep("pull"), fixtureStep("push2")],
  };
  const line = compileTemplate(fixture); // height 1: source, belt, m, belt, ... , sink
  const tiles = emptyTiles(GRID_W, GRID_H);
  const w = Math.min(line.width, GRID_W);
  for (let x = 0; x < w; x++) tiles[x] = line.tiles[x]!;

  const machines: PlacedMachine[] = [];
  for (const m of line.machines) {
    if (m.anchor.x >= GRID_W) continue;
    const speed = m.def.typeId === "pull" ? 3 : 1;
    machines.push({ ...m, def: { ...m.def, speed } });
  }
  return { width: GRID_W, height: GRID_H, tiles, machines };
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

/** Preset: single speed-3 push on one row (the slow baseline). Rate ≈ 1/3. */
function singlePreset(): FactoryLayout {
  const tiles = emptyTiles(GRID_W, GRID_H);
  const at = (x: number, y: number) => y * GRID_W + x;
  tiles[at(0, 0)] = { kind: "source", dir: E, period: 1 };
  tiles[at(1, 0)] = { kind: "belt", dir: E };
  tiles[at(3, 0)] = { kind: "belt", dir: E };
  tiles[at(4, 0)] = { kind: "belt", dir: E };
  tiles[at(5, 0)] = { kind: "sink" };
  const machines: PlacedMachine[] = [
    { id: 0, def: machineDef("push", 3), anchor: { x: 2, y: 0 }, footRot: 0, shape: DEFAULT_SHAPES.push! },
  ];
  return { width: GRID_W, height: GRID_H, tiles, machines };
}

/**
 * Preset: source → splitter → two speed-3 push machines (rows 0 + 1) → merger → sink.
 * Mirrors the sim's verified parallel fixture; rate ≈ 2/3 (≈2× the single preset).
 */
function parallelPreset(): FactoryLayout {
  const tiles = emptyTiles(GRID_W, GRID_H);
  const at = (x: number, y: number) => y * GRID_W + x;
  tiles[at(0, 0)] = { kind: "source", dir: E, period: 1 };
  tiles[at(1, 0)] = { kind: "splitter", inDir: W, outDirs: [E, S] };
  tiles[at(1, 1)] = { kind: "belt", dir: E };
  tiles[at(3, 0)] = { kind: "belt", dir: E };
  tiles[at(4, 0)] = { kind: "merger", inDirs: [W, S], outDir: E };
  tiles[at(5, 0)] = { kind: "sink" };
  tiles[at(3, 1)] = { kind: "belt", dir: E };
  tiles[at(4, 1)] = { kind: "belt", dir: N };
  const machines: PlacedMachine[] = [
    { id: 0, def: machineDef("push", 3), anchor: { x: 2, y: 0 }, footRot: 0, shape: DEFAULT_SHAPES.push! },
    { id: 1, def: machineDef("push", 3), anchor: { x: 2, y: 1 }, footRot: 0, shape: DEFAULT_SHAPES.push! },
  ];
  return { width: GRID_W, height: GRID_H, tiles, machines };
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

/** Apply a click at (x,y) with the current brush, returning a new layout. */
function paint(
  layout: FactoryLayout,
  x: number,
  y: number,
  brush: Brush,
  dir: Dir,
  footRot: Rotation,
  speed: number,
): FactoryLayout {
  if (brush.kind === "machine") {
    const shape: MachineShape = DEFAULT_SHAPES[brush.typeId] ?? DEFAULT_SHAPES.push!;
    const m: PlacedMachine = {
      id: nextMachineId(layout),
      def: machineDef(brush.typeId, speed),
      anchor: { x, y },
      footRot,
      shape,
    };
    return { ...layout, machines: [...layout.machines, m] };
  }

  if (brush.kind === "erase") {
    // remove any machine covering the cell AND clear the tile.
    const hit = machineAt(layout, x, y);
    const machines = hit ? layout.machines.filter((m) => m.id !== hit.id) : layout.machines;
    const tiles = layout.tiles.slice();
    tiles[y * layout.width + x] = { kind: "empty" };
    return { ...layout, tiles, machines };
  }

  const tile = makeTile(brush, dir);
  if (tile === null) return layout;
  // painting a tile onto a machine cell first removes that machine.
  const hit = machineAt(layout, x, y);
  const machines = hit ? layout.machines.filter((m) => m.id !== hit.id) : layout.machines;
  const tiles = layout.tiles.slice();
  tiles[y * layout.width + x] = tile;
  return { ...layout, tiles, machines };
}

// ───────────────────────────── geometry: canvas → grid ─────────────────────────────

const CELL = 56;
const PAD = 12;

function cellFromCanvas(layout: FactoryLayout, px: number, py: number): { x: number; y: number } | null {
  const gx = Math.floor((px - PAD) / CELL);
  const gy = Math.floor((py - PAD) / CELL);
  if (gx < 0 || gy < 0 || gx >= layout.width || gy >= layout.height) return null;
  return { x: gx, y: gy };
}

// ───────────────────────────── component ─────────────────────────────

const TICK_MS = 220;

interface FactoryProps {
  readonly level: GeneratedLevel;
  /** The winning recipe from the Lab (drives the default layout), or null. */
  readonly recipe: Template | null;
  /** The shared/persisted factory layout, or null to use the recipe/fixture default. */
  readonly factory: FactoryLayout | null;
  /** Lift the current layout into the shared game state. */
  readonly onFactoryChange: (layout: FactoryLayout) => void;
  /** Report newly produced units (delta since the last report) to the Game inventory. */
  readonly onProduced: (count: number) => void;
}

/** Pick the starting layout: the persisted one, else the recipe line, else the fixture. */
function startingLayout(factory: FactoryLayout | null, recipe: Template | null): FactoryLayout {
  if (factory !== null) return factory;
  if (recipe !== null && recipe.steps.length > 0) return recipeLayout(recipe);
  return defaultLayout();
}

export function Factory({ level, recipe, factory, onFactoryChange, onProduced }: FactoryProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<FactoryRenderer | null>(null);

  const { mm, start } = level;

  const [layout, setLayout] = useState<FactoryLayout>(() => startingLayout(factory, recipe));
  const [state, setState] = useState<FactoryState>(() => initFactory(startingLayout(factory, recipe), mm, start));
  const [playing, setPlaying] = useState<boolean>(false);

  // editing brush + parameters.
  const [brush, setBrush] = useState<Brush>({ kind: "belt" });
  const [brushDir, setBrushDir] = useState<Dir>(E);
  const [footRot, setFootRot] = useState<Rotation>(0);
  const [brushSpeed, setBrushSpeed] = useState<number>(1);

  // keep the latest layout/level in refs so the play timer reads fresh values.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const mmRef = useRef(mm);
  mmRef.current = mm;

  // produced units already reported to the Game (so we only report the delta).
  const reportedRef = useRef(0);

  const throughput = useMemo(() => analyzeThroughput(layout, mm), [layout, mm]);

  // re-init the running sim for a fresh layout (shared by editing + presets + reset).
  const reinit = useCallback(
    (next: FactoryLayout) => {
      setLayout(next);
      onFactoryChange(next);
      setPlaying(false);
      reportedRef.current = 0;
      setState(initFactory(next, mmRef.current, start));
    },
    [onFactoryChange, start],
  );

  // ── mount / unmount the Pixi renderer ──
  useEffect(() => {
    let disposed = false;
    let local: FactoryRenderer | null = null;
    void (async () => {
      const r = await createFactoryRenderer(layoutRef.current);
      if (disposed) {
        r.destroy();
        return;
      }
      local = r;
      rendererRef.current = r;
      if (mountRef.current) mountRef.current.appendChild(r.canvas);
      r.render(layoutRef.current, state, throughput.bottleneck);
    })();
    return () => {
      disposed = true;
      rendererRef.current = null;
      if (local) local.destroy();
    };
  }, []);

  // ── repaint whenever layout / state / bottleneck changes ──
  useEffect(() => {
    rendererRef.current?.render(layout, state, throughput.bottleneck);
  }, [layout, state, throughput.bottleneck]);

  // ── play timer: advance the sim by one tick per interval ──
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setState((s) => stepFactory(layoutRef.current, mmRef.current, s));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  // stop playing automatically on deadlock.
  useEffect(() => {
    if (state.deadlocked && playing) setPlaying(false);
  }, [state.deadlocked, playing]);

  // ── report newly produced units to the Game inventory (delta only) ──
  useEffect(() => {
    const total = state.produced.length;
    if (total > reportedRef.current) {
      onProduced(total - reportedRef.current);
      reportedRef.current = total;
    }
  }, [state.produced.length, onProduced]);

  // ── a new recipe / deeper level arrives: rebuild the line + reset the sim ──
  useEffect(() => {
    const next = startingLayout(factory, recipe);
    setLayout(next);
    setPlaying(false);
    reportedRef.current = 0;
    setState(initFactory(next, mm, start));
    // intentionally keyed on recipe + level identity (not the editable factory).
  }, [recipe, mm, start, factory]);

  // ── controls ──
  const stepOnce = useCallback(() => {
    setState((s) => stepFactory(layoutRef.current, mmRef.current, s));
  }, []);

  const reset = useCallback(() => {
    setPlaying(false);
    reportedRef.current = 0;
    setState(initFactory(layoutRef.current, mmRef.current, start));
  }, [start]);

  // ── editing: click a cell to paint the current brush ──
  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const canvas = rendererRef.current?.canvas;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * canvas.width;
      const py = ((e.clientY - rect.top) / rect.height) * canvas.height;
      const cell = cellFromCanvas(layout, px, py);
      if (!cell) return;
      reinit(paint(layout, cell.x, cell.y, brush, brushDir, footRot, brushSpeed));
    },
    [layout, brush, brushDir, footRot, brushSpeed, reinit],
  );

  // ───────────────────────────── styles ─────────────────────────────

  const btn: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #b8c2cc",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };
  const sectionTitle: React.CSSProperties = { margin: "0 0 6px", fontSize: 14, color: "#475260" };
  const active: React.CSSProperties = { background: "#1d6fe0", color: "#fff", border: "1px solid #1862c6" };

  const brushIsMachine = brush.kind === "machine";
  const brushLabel = brush.kind === "machine" ? `machine: ${brush.typeId}` : brush.kind;

  const rate = throughput.rateDen === 0 ? "0" : `${throughput.rateNum}/${throughput.rateDen}`;

  const tileBrushBtn = (kind: Brush["kind"] & ("belt" | "splitter" | "merger" | "source" | "sink" | "erase"), label: string) => (
    <button
      type="button"
      onClick={() => setBrush({ kind })}
      style={{ ...btn, ...(brush.kind === kind ? active : {}) }}
      data-testid={`brush-${kind}`}
    >
      {label}
    </button>
  );

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#1d242c", maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 4px" }}>HexaPharma Factory</h1>
      <p style={{ margin: "0 0 14px", color: "#5a6470" }}>
        Units flow source → machines → sink. Machines are multi-cell shapes you place,
        rotate (footRot) and wire with belts, splitters and mergers. Play to run the belt
        sim; the bottleneck machine is outlined in red. Split one feed across two machines
        with a splitter + merger and watch throughput rise — real parallelism.
      </p>

      {/* recipe status */}
      <div data-testid="factory-recipe" style={{ fontSize: 12, color: "#5a6470", marginBottom: 12 }}>
        {recipe === null
          ? "No saved recipe — build a cure in the Lab and Save recipe → Factory, or hand-build a line below."
          : `Producing the saved recipe (${recipe.steps.length} step${recipe.steps.length === 1 ? "" : "s"}). Each unit that reaches the sink is added to your inventory for the Shop.`}
      </div>

      {/* run controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => setPlaying(true)}
          disabled={playing || state.deadlocked}
          style={{ ...btn, ...(playing ? active : {}) }}
          data-testid="factory-play"
        >
          ▶ Play
        </button>
        <button type="button" onClick={() => setPlaying(false)} disabled={!playing} style={btn} data-testid="factory-pause">
          ❚❚ Pause
        </button>
        <button type="button" onClick={stepOnce} disabled={playing} style={btn} data-testid="factory-step">
          ▶| Step
        </button>
        <button type="button" onClick={reset} style={btn} data-testid="factory-reset">
          ⟲ Reset
        </button>
        <span style={{ width: 12 }} />
        <button type="button" onClick={() => reinit(singlePreset())} style={btn} data-testid="preset-single">
          Preset: single
        </button>
        <button type="button" onClick={() => reinit(parallelPreset())} style={btn} data-testid="preset-parallel">
          Preset: parallel
        </button>
      </div>

      {/* status */}
      <div
        data-testid="factory-status"
        role="status"
        style={{
          margin: "0 0 12px",
          padding: "10px 12px",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 600,
          background: state.deadlocked ? "#fdeaea" : "#eef2f6",
          color: state.deadlocked ? "#a11d1d" : "#3a4450",
          border: `1px solid ${state.deadlocked ? "#f3c4c4" : "#d9e0e7"}`,
        }}
      >
        tick <span data-testid="factory-tick">{state.tick}</span> · produced{" "}
        <span data-testid="factory-produced">{state.produced.length}</span> · throughput{" "}
        <span data-testid="factory-rate">{rate}</span> units/tick · bottleneck{" "}
        <span data-testid="factory-bottleneck">
          {throughput.bottleneck === null ? "none" : `#${throughput.bottleneck} (${throughput.bottleneckType})`}
        </span>
        {state.deadlocked ? " · DEADLOCKED" : ""}
      </div>

      {/* canvas (click to edit) */}
      <div
        ref={mountRef}
        onClick={onCanvasClick}
        data-testid="factory-canvas"
        style={{
          display: "inline-block",
          border: "1px solid #d4dce4",
          borderRadius: 8,
          overflow: "hidden",
          lineHeight: 0,
          cursor: "crosshair",
        }}
      />

      {/* palette / editing */}
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 14 }}>
        <div style={{ flex: "1 1 320px" }}>
          <h2 style={sectionTitle}>Tile palette (click a cell to place)</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tileBrushBtn("belt", "Belt")}
            {tileBrushBtn("splitter", "Splitter")}
            {tileBrushBtn("merger", "Merger")}
            {tileBrushBtn("source", "Source")}
            {tileBrushBtn("sink", "Sink")}
            {tileBrushBtn("erase", "Erase")}
          </div>

          <div style={{ marginTop: 12 }}>
            <h2 style={sectionTitle}>Machine types (footprint = its shape)</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {DEFAULT_CATALOG.map((entry) => (
                <button
                  key={entry.typeId}
                  type="button"
                  onClick={() => setBrush({ kind: "machine", typeId: entry.typeId })}
                  style={{
                    ...btn,
                    ...(brush.kind === "machine" && brush.typeId === entry.typeId ? active : {}),
                  }}
                  data-testid={`brush-machine-${entry.typeId}`}
                >
                  {entry.typeId}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ flex: "1 1 280px" }}>
          <h2 style={sectionTitle}>Brush settings</h2>
          <div style={{ fontSize: 13, color: "#5a6470", marginBottom: 8 }}>
            Selected: <strong data-testid="brush-selected">{brushLabel}</strong>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setBrushDir((d) => ((d + 1) & 3) as Dir)}
              style={btn}
              data-testid="brush-rotate"
            >
              Direction: {DIR_LABEL[brushDir]}
            </button>
            <button
              type="button"
              onClick={() => setFootRot((r) => ((r + 1) & 3) as Rotation)}
              style={btn}
              data-testid="brush-footrot"
            >
              footRot: {footRot} × 90°
            </button>
          </div>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              opacity: brushIsMachine ? 1 : 0.5,
            }}
          >
            Machine speed (ticks/unit)
            <input
              type="number"
              min={1}
              value={brushSpeed}
              onChange={(e) => setBrushSpeed(Math.max(1, Number(e.target.value) | 0))}
              disabled={!brushIsMachine}
              data-testid="brush-speed"
              style={{ width: 70, padding: "5px 6px", border: "1px solid #b8c2cc", borderRadius: 6, fontSize: 13 }}
            />
          </label>
          <p style={{ fontSize: 12, color: "#8a94a0", marginTop: 14 }}>
            Tip: the default line has a slow <code>pull</code> (speed 3) bottleneck. Drop a
            splitter before it, a second <code>pull</code> on the row below, and a merger
            after — the throughput rate rises. Or hit <strong>Preset: parallel</strong> to
            see it vs <strong>Preset: single</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
