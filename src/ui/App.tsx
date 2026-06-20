/**
 * HexaPharma — the Lab (Phase 1 minimal visual).
 *
 * React owns all state: the template the player is building, the computed drug
 * states (via the sim functions), and the revealed MultiMap. It hands plain sim
 * state to the dumb PixiJS renderer (src/render). NO sweep/evaluate logic lives
 * here — we only CALL the sim. See AGENTS.md layering rule.
 *
 * The level is produced by mapgen `generate()` from a seed (no hand fixture), so
 * the Lab plays the real cross-map-tension levels. A debug "Reveal level" toggle
 * paints a fully-revealed COPY of the MultiMap (sim state is untouched).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  MultiMap,
  EffectMap,
  DrugState,
  Machine,
  Template,
  Outcome,
  Rotation,
  Orientation,
  MachineCatalogEntry,
  Transform,
  DiseaseId,
  GeneratedLevel,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { applyStep, evaluate, revealAlong } from "../sim/drug-graph";
import { generate } from "../sim/mapgen";
import { createLabRenderer, type LabRenderer } from "../render/labRenderer";

// ───────────────────────────── level generation ─────────────────────────────

const catalog: readonly MachineCatalogEntry[] = DEFAULT_CATALOG;

/** Mapgen options for the Lab. Small enough to generate in well under ~1s. */
function genLevel(seed: number): GeneratedLevel {
  return generate({
    seed,
    nMaps: 2,
    width: 12,
    height: 12,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 4, max: 12 },
  });
}

/** A COPY of the MultiMap with all fog cleared — debug-only render aid (no sim mutation). */
function revealedCopy(mm: MultiMap): MultiMap {
  return {
    maps: mm.maps.map((m): EffectMap => ({ ...m, fog: new Uint8Array(m.fog.length).fill(1) })),
  };
}

// ───────────────────────────── helpers (display only) ─────────────────────────────

const ROT_LABEL: Record<Rotation, string> = { 0: "0°", 1: "90°", 2: "180°", 3: "270°" };

function isOrientableTranslate(entry: MachineCatalogEntry): boolean {
  return entry.transform.kind === "translate" && entry.orientable;
}

/** Short human label for a transform kind (palette + template list). */
function transformLabel(t: Transform): string {
  if (t.kind === "translate") return `translate ${t.relation} (${t.delta.x},${t.delta.y})`;
  if (t.kind === "scale") return `scale ${t.num}/${t.den}`;
  return `swap ${t.a}↔${t.b}`;
}

/** One template step, described for the ordered list. */
function stepLabel(m: Machine): string {
  const base = transformLabel(m.transform);
  if (m.transform.kind === "translate") {
    return `${m.typeId} · ${base} · rot ${ROT_LABEL[m.orientation.rot]}${m.orientation.flip ? " · flip" : ""}`;
  }
  return `${m.typeId} · ${base}`;
}

// ───────────────────────────── outcome banner ─────────────────────────────

function outcomeText(outcome: Outcome | null, won: boolean): string {
  if (outcome === null) return "Build a template, then press Run.";
  if (outcome.failed) return "FAILED — the drug hit a hazard and spoiled.";
  if (won) return `WIN! All target diseases cured: [${[...outcome.cured].sort((a, b) => a - b).join(", ")}].`;
  const cured = outcome.cured.length ? `cured [${outcome.cured.join(", ")}]` : "cured nothing";
  const se = outcome.sideEffects.length ? `, side-effects [${outcome.sideEffects.join(", ")}]` : "";
  return `Run complete: ${cured}${se}. Not all targets cured yet.`;
}

// ───────────────────────────── component ─────────────────────────────

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);

  // The generated level (regenerated on New level / Random).
  const [seedInput, setSeedInput] = useState<number>(1);
  const [level, setLevel] = useState<GeneratedLevel>(() => genLevel(1));
  const { mm, start } = level;
  const targets = useMemo<readonly DiseaseId[]>(() => level.diseases.map((d) => d.id), [level]);

  // Debug aid: show the full map ignoring fog (pure render; never touches sim).
  const [reveal, setReveal] = useState<boolean>(false);

  // Player-built recipe.
  const [steps, setSteps] = useState<readonly Machine[]>([]);
  // Pending orientation for the NEXT orientable translate machine added.
  const [rot, setRot] = useState<Rotation>(0);
  const [flip, setFlip] = useState<boolean>(false);

  // What the renderer currently shows (the revealed-by-play MultiMap + drug state).
  const [shownMap, setShownMap] = useState<MultiMap>(mm);
  const [shownDrug, setShownDrug] = useState<DrugState>(start);

  // Result of the last Run.
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState<boolean>(false);

  const won = useMemo(() => {
    if (outcome === null || outcome.failed) return false;
    const cured = new Set(outcome.cured);
    return targets.every((t) => cured.has(t));
  }, [outcome, targets]);

  // Cancel token so a Reset (or unmount) stops an in-flight animation.
  const runIdRef = useRef(0);

  // The map handed to the renderer: a fully-revealed copy when the debug toggle is on.
  const renderMap = useMemo(() => (reveal ? revealedCopy(shownMap) : shownMap), [reveal, shownMap]);

  // ── mount / unmount the Pixi renderer ─────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let local: LabRenderer | null = null;
    void (async () => {
      const r = await createLabRenderer(mm);
      if (disposed) {
        r.destroy();
        return;
      }
      local = r;
      rendererRef.current = r;
      if (mountRef.current) mountRef.current.appendChild(r.canvas);
      r.render(mm, start);
    })();
    return () => {
      disposed = true;
      runIdRef.current++; // cancel any running animation
      rendererRef.current = null;
      if (local) local.destroy();
    };
    // mm/start identity changes only when a new level is generated; remount the
    // renderer then so the canvas is resized for the new level shape.
  }, [mm, start]);

  // ── repaint whenever shown state (or reveal toggle) changes ────────────────
  useEffect(() => {
    rendererRef.current?.render(renderMap, shownDrug);
  }, [renderMap, shownDrug]);

  // ── palette / template editing ────────────────────────────────────────────
  const addMachine = useCallback(
    (entry: MachineCatalogEntry) => {
      if (running) return;
      const orientation: Orientation = isOrientableTranslate(entry)
        ? { rot, flip }
        : { rot: 0, flip: false };
      const machine: Machine = {
        typeId: entry.typeId,
        transform: entry.transform,
        orientation,
      };
      setSteps((s) => [...s, machine]);
    },
    [running, rot, flip],
  );

  const removeLast = useCallback(() => {
    if (running) return;
    setSteps((s) => s.slice(0, -1));
  }, [running]);

  const clearTemplate = useCallback(() => {
    if (running) return;
    setSteps([]);
  }, [running]);

  // ── Run: reveal fog, animate the drug across BOTH maps, then evaluate ──────
  const run = useCallback(() => {
    if (running || steps.length === 0) return;
    setRunning(true);
    setOutcome(null);

    const t: Template = { steps };
    // Reveal fog along every sweep path (sim does the work).
    const revealed = revealAlong(mm, start, t);
    setShownMap(revealed);
    setShownDrug(start);

    // Precompute the per-step drug states by folding applyStep (sim only).
    const frames: DrugState[] = [start];
    let s = start;
    for (const m of steps) {
      s = applyStep(mm, s, m);
      frames.push(s);
    }

    const myRun = ++runIdRef.current;
    let k = 0;
    const tick = () => {
      if (runIdRef.current !== myRun) return; // cancelled by reset/unmount
      k++;
      const frame = frames[k];
      if (frame !== undefined) setShownDrug(frame);
      if (k < frames.length - 1) {
        window.setTimeout(tick, 260);
      } else {
        setOutcome(evaluate(mm, start, t));
        setRunning(false);
      }
    };
    window.setTimeout(tick, 260);
  }, [running, steps, mm, start]);

  // ── Reset: back to start, fog restored, empty template ────────────────────
  const reset = useCallback(() => {
    runIdRef.current++; // cancel any in-flight animation
    setRunning(false);
    setSteps([]);
    setRot(0);
    setFlip(false);
    setOutcome(null);
    setShownMap(mm);
    setShownDrug(start);
  }, [mm, start]);

  // ── New level: regenerate from a seed and reset all play state ────────────
  const loadSeed = useCallback((seed: number) => {
    runIdRef.current++; // cancel any in-flight animation
    const next = genLevel(seed);
    setSeedInput(seed);
    setLevel(next);
    setRunning(false);
    setSteps([]);
    setRot(0);
    setFlip(false);
    setOutcome(null);
    setShownMap(next.mm);
    setShownDrug(next.start);
  }, []);

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

  return (
    <div
      style={{
        fontFamily: "Arial, sans-serif",
        color: "#1d242c",
        maxWidth: 980,
        margin: "0 auto",
        padding: 16,
      }}
    >
      <h1 style={{ margin: "0 0 4px" }}>HexaPharma Lab</h1>
      <p style={{ margin: "0 0 14px", color: "#5a6470" }}>
        Place machines into a template, then Run to sweep the drug across both effect
        maps. Cure all targets ({targets.join(", ")}) to win.
      </p>

      {/* level controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Seed
          <input
            type="number"
            value={seedInput}
            onChange={(e) => setSeedInput(Number(e.target.value))}
            data-testid="seed-input"
            style={{ width: 90, padding: "5px 6px", border: "1px solid #b8c2cc", borderRadius: 6, fontSize: 13 }}
          />
        </label>
        <button
          type="button"
          onClick={() => loadSeed(seedInput)}
          style={btn}
          data-testid="new-level"
        >
          New level
        </button>
        <button
          type="button"
          onClick={() => loadSeed(seedInput + 1)}
          style={btn}
          data-testid="random-level"
        >
          Random (seed+1)
        </button>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginLeft: 8 }}
        >
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            data-testid="reveal"
          />
          Reveal level (debug)
        </label>
      </div>

      {/* level info */}
      <div data-testid="level-info" style={{ fontSize: 12, color: "#5a6470", marginBottom: 10 }}>
        seed {level.seed} ·{" "}
        {level.diseases
          .map((d) => `disease ${d.id} (map ${d.map}): difficulty ${d.difficulty}, price ${d.basePrice}`)
          .join(" · ")}
      </div>

      {/* canvas */}
      <div
        ref={mountRef}
        data-testid="lab-canvas"
        style={{
          display: "inline-block",
          border: "1px solid #d4dce4",
          borderRadius: 8,
          overflow: "hidden",
          lineHeight: 0,
        }}
      />

      {/* status / outcome */}
      <div
        data-testid="status"
        role="status"
        style={{
          margin: "12px 0",
          padding: "10px 12px",
          borderRadius: 8,
          fontSize: 15,
          fontWeight: 600,
          background: outcome?.failed ? "#fdeaea" : won ? "#e7f7ef" : "#eef2f6",
          color: outcome?.failed ? "#a11d1d" : won ? "#15724a" : "#3a4450",
          border: `1px solid ${outcome?.failed ? "#f3c4c4" : won ? "#bce6d2" : "#d9e0e7"}`,
        }}
      >
        {outcomeText(outcome, won)}
      </div>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        {/* palette */}
        <div style={{ flex: "1 1 320px" }}>
          <h2 style={sectionTitle}>Machine palette</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {catalog.map((entry) => (
              <button
                key={entry.typeId}
                type="button"
                onClick={() => addMachine(entry)}
                disabled={running}
                style={btn}
                title={transformLabel(entry.transform)}
                data-testid={`palette-${entry.typeId}`}
              >
                + {entry.typeId}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 12 }}>
            <h2 style={sectionTitle}>Orientation (for orientable translate machines)</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => setRot((r) => ((r + 1) % 4) as Rotation)}
                disabled={running}
                style={btn}
                data-testid="rotate"
              >
                Rotate ↻ ({ROT_LABEL[rot]})
              </button>
              <button
                type="button"
                onClick={() => setFlip((f) => !f)}
                disabled={running}
                style={{ ...btn, background: flip ? "#e7f0ff" : "#fff" }}
                data-testid="flip"
              >
                Flip: {flip ? "on" : "off"}
              </button>
            </div>
          </div>
        </div>

        {/* template */}
        <div style={{ flex: "1 1 320px" }}>
          <h2 style={sectionTitle}>Template ({steps.length} step{steps.length === 1 ? "" : "s"})</h2>
          <ol
            data-testid="template-list"
            style={{
              margin: 0,
              paddingLeft: 22,
              minHeight: 60,
              maxHeight: 180,
              overflowY: "auto",
              fontSize: 13,
              border: "1px solid #e1e7ed",
              borderRadius: 6,
              padding: "8px 8px 8px 28px",
              background: "#fafcfe",
            }}
          >
            {steps.length === 0 ? (
              <li style={{ listStyle: "none", marginLeft: -16, color: "#8a94a0" }}>
                (empty — add machines from the palette)
              </li>
            ) : (
              steps.map((m, i) => <li key={i}>{stepLabel(m)}</li>)
            )}
          </ol>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              type="button"
              onClick={removeLast}
              disabled={running || steps.length === 0}
              style={btn}
              data-testid="remove-last"
            >
              Remove last
            </button>
            <button
              type="button"
              onClick={clearTemplate}
              disabled={running || steps.length === 0}
              style={btn}
              data-testid="clear"
            >
              Clear
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={run}
              disabled={running || steps.length === 0}
              style={{
                ...btn,
                background: "#1d6fe0",
                color: "#fff",
                borderColor: "#1862c6",
                fontWeight: 700,
                padding: "8px 18px",
              }}
              data-testid="run"
            >
              {running ? "Running…" : "Run"}
            </button>
            <button
              type="button"
              onClick={reset}
              style={{ ...btn, padding: "8px 18px" }}
              data-testid="reset"
            >
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
