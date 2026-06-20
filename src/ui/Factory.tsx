/**
 * HexaPharma — the Factory (Phase 2 visual).
 *
 * React owns all state: the FactoryLayout the player edits, the running
 * FactoryState (advanced by calling the sim `stepFactory`), and the level
 * (MultiMap + start) produced by mapgen. It hands plain sim state to the dumb
 * PixiJS renderer (src/render/factoryRenderer). NO tick/throughput logic lives
 * here — we only CALL the sim. See AGENTS.md layering rule.
 *
 * The default layout is seeded from a small fixture Template compiled with
 * `compileTemplate`, then re-laid onto a roomy grid so the player can rearrange
 * tiles and add a parallel machine to relieve a bottleneck.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Dir,
  Orientation,
  Template,
  Machine,
  Transform,
  FactoryTile,
  FactoryLayout,
  FactoryMachineDef,
  FactoryState,
  MachineCatalogEntry,
  MachineTypeId,
  GeneratedLevel,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG, IDENTITY } from "../sim/phase0_interfaces";
import { initFactory, stepFactory, analyzeThroughput } from "../sim/factory-sim";
import { compileTemplate } from "../sim/recipe";
import { createFactoryRenderer, type FactoryRenderer } from "../render/factoryRenderer";

// ───────────────────────────── default layout ─────────────────────────────

const E: Dir = 0;
const W: Dir = 2;

const GRID_W = 9;
const GRID_H = 6;

function emptyTiles(w: number, h: number): FactoryTile[] {
  return new Array<FactoryTile>(w * h).fill({ kind: "empty" });
}

function fixtureStep(typeId: MachineTypeId): Machine {
  const entry = entryOf(typeId)!;
  return { typeId, transform: entry.transform, orientation: IDENTITY };
}

/**
 * A small fixture template (three DISTINCT machine stages) compiled to a straight
 * line, then re-laid on a roomy GRID_W×GRID_H grid: source on the left of row 1,
 * the compiled machines back-to-back, sink at the end. The middle stage (`pull`)
 * is slowed to speed 3 so it is the bottleneck; the rest are speed 1. There is
 * empty space below for the player to build a parallel path that relieves it.
 *
 * (Distinct typeIds matter: analyzeThroughput sums machines of the SAME typeId as
 * parallel copies of one stage, so a parallel copy of `pull` raises the pull
 * stage's rate above the bottleneck.)
 */
function defaultLayout(): FactoryLayout {
  const fixture: Template = {
    steps: [fixtureStep("push"), fixtureStep("pull"), fixtureStep("push2")],
  };
  const line = compileTemplate(fixture); // height 1: source, machines..., sink

  const tiles = emptyTiles(GRID_W, GRID_H);
  const row = 1;
  for (let x = 0; x < line.width && x < GRID_W; x++) {
    const t = line.tiles[x]!;
    if (t.kind === "machine") {
      // `pull` (x === 2) is the bottleneck stage at speed 3; others run at speed 1.
      const speed = t.def.typeId === "pull" ? 3 : 1;
      const def: FactoryMachineDef = { ...t.def, speed };
      tiles[row * GRID_W + x] = { kind: "machine", def, inDir: W, outDir: E };
    } else {
      tiles[row * GRID_W + x] = t;
    }
  }
  return { width: GRID_W, height: GRID_H, tiles };
}

/**
 * Lay a compiled recipe line onto a roomy grid (source → machines → sink on one
 * row, all at speed 1), leaving space below for parallel paths. Falls back to the
 * fixture default if the recipe is empty/too wide for the grid.
 */
function recipeLayout(recipe: Template): FactoryLayout {
  const line = compileTemplate(recipe);
  const w = Math.max(GRID_W, line.width);
  const tiles = emptyTiles(w, GRID_H);
  const row = 1;
  for (let x = 0; x < line.width; x++) {
    const t = line.tiles[x]!;
    if (t.kind === "machine") {
      tiles[row * w + x] = { kind: "machine", def: { ...t.def, speed: 1 }, inDir: W, outDir: E };
    } else {
      tiles[row * w + x] = t;
    }
  }
  return { width: w, height: GRID_H, tiles };
}

// ───────────────────────────── palette / editing ─────────────────────────────

type Brush =
  | { kind: "belt" }
  | { kind: "source" }
  | { kind: "sink" }
  | { kind: "erase" }
  | { kind: "machine"; typeId: MachineTypeId };

const DIR_LABEL: Record<Dir, string> = { 0: "→ E", 1: "↓ S", 2: "← W", 3: "↑ N" };

function machineEntries(): readonly MachineCatalogEntry[] {
  return DEFAULT_CATALOG;
}

function entryOf(typeId: MachineTypeId): MachineCatalogEntry | undefined {
  return DEFAULT_CATALOG.find((e) => e.typeId === typeId);
}

function makeTile(brush: Brush, dir: Dir, speed: number): FactoryTile {
  switch (brush.kind) {
    case "belt":
      return { kind: "belt", dir };
    case "source":
      return { kind: "source", dir, period: 1 };
    case "sink":
      return { kind: "sink" };
    case "erase":
      return { kind: "empty" };
    case "machine": {
      const entry = entryOf(brush.typeId);
      const transform: Transform = entry?.transform ?? DEFAULT_CATALOG[0]!.transform;
      const orientation: Orientation = IDENTITY;
      const def: FactoryMachineDef = {
        typeId: brush.typeId,
        transform,
        orientation,
        cost: entry?.cost ?? 0,
        speed: Math.max(1, speed | 0),
      };
      // in from the side opposite `dir`, out toward `dir`.
      const inDir = ((dir + 2) & 3) as Dir;
      return { kind: "machine", def, inDir, outDir: dir };
    }
  }
}

function setTile(layout: FactoryLayout, x: number, y: number, tile: FactoryTile): FactoryLayout {
  const tiles = layout.tiles.slice();
  tiles[y * layout.width + x] = tile;
  return { ...layout, tiles };
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

  // editing brush + parameters
  const [brush, setBrush] = useState<Brush>({ kind: "belt" });
  const [brushDir, setBrushDir] = useState<Dir>(E);
  const [brushSpeed, setBrushSpeed] = useState<number>(1);

  // keep the latest layout/level in refs so the play timer reads fresh values.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const mmRef = useRef(mm);
  mmRef.current = mm;

  // produced units already reported to the Game (so we only report the delta).
  const reportedRef = useRef(0);

  const throughput = useMemo(() => analyzeThroughput(layout), [layout]);

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
      const tile = makeTile(brush, brushDir, brushSpeed);
      const nextLayout = setTile(layout, cell.x, cell.y, tile);
      setLayout(nextLayout);
      onFactoryChange(nextLayout);
      // editing the grid resets the running sim (positions may now be invalid).
      setPlaying(false);
      reportedRef.current = 0;
      setState(initFactory(nextLayout, mmRef.current, start));
    },
    [layout, brush, brushDir, brushSpeed, start, onFactoryChange],
  );

  // ───────────────────────────── render ─────────────────────────────

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
  const brushLabel =
    brush.kind === "machine" ? `machine: ${brush.typeId}` : brush.kind;

  const rate =
    throughput.rateDen === 0
      ? "0"
      : `${throughput.rateNum}/${throughput.rateDen}`;

  return (
    <div style={{ fontFamily: "Arial, sans-serif", color: "#1d242c", maxWidth: 980, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 4px" }}>HexaPharma Factory</h1>
      <p style={{ margin: "0 0 14px", color: "#5a6470" }}>
        Units flow source → machines → sink. Play to run the belt sim; the bottleneck
        machine is outlined in red. Slow a machine to create a bottleneck, then add a
        parallel path of the same machine type to raise throughput.
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
        <span data-testid="factory-bottleneck">{throughput.bottleneck ?? "none"}</span>
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
            <button
              type="button"
              onClick={() => setBrush({ kind: "belt" })}
              style={{ ...btn, ...(brush.kind === "belt" ? active : {}) }}
              data-testid="brush-belt"
            >
              Belt
            </button>
            <button
              type="button"
              onClick={() => setBrush({ kind: "source" })}
              style={{ ...btn, ...(brush.kind === "source" ? active : {}) }}
              data-testid="brush-source"
            >
              Source
            </button>
            <button
              type="button"
              onClick={() => setBrush({ kind: "sink" })}
              style={{ ...btn, ...(brush.kind === "sink" ? active : {}) }}
              data-testid="brush-sink"
            >
              Sink
            </button>
            <button
              type="button"
              onClick={() => setBrush({ kind: "erase" })}
              style={{ ...btn, ...(brush.kind === "erase" ? active : {}) }}
              data-testid="brush-erase"
            >
              Erase
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <h2 style={sectionTitle}>Machine types</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {machineEntries().map((entry) => (
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setBrushDir((d) => ((d + 1) & 3) as Dir)}
              style={btn}
              data-testid="brush-rotate"
            >
              Direction: {DIR_LABEL[brushDir]}
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
            Tip: the default factory has a slow <code>push</code> (speed 3) as the
            bottleneck. Place a second <code>push</code> (speed 1) on a parallel belt
            row and the throughput rate rises.
          </p>
        </div>
      </div>
    </div>
  );
}
