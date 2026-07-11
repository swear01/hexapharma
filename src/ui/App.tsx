/**
 * HexaPharma — the Lab (Phase 1 minimal visual).
 *
 * React owns all state: the template the player is building, the computed drug
 * states (via the sim functions), and the revealed MultiMap. It hands plain sim
 * state to the dumb PixiJS renderer (src/render). NO sweep/evaluate logic lives
 * here — we only CALL the sim. See AGENTS.md layering rule.
 *
 * The level is produced by mapgen `generate()` from a seed (no hand fixture), so
 * the Lab plays the real cross-map-tension levels.
 *
 * FOG = genuine exploration. The Game owns a PERSISTENT per-map fog (Uint8Array,
 * accumulated across runs); the Lab overlays it onto the MultiMap it hands the
 * renderer, so unrevealed cells render as UNKNOWN. Each Run reveals cells via the
 * sim (`revealAlong`) and reports them up (`onReveal`) to be unioned into that
 * persistent fog — Reset keeps what's explored. A debug "Reveal all" toggle paints
 * a fully-revealed COPY for convenience (sim + persistent fog untouched).
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
import { applyStep, evaluate } from "../sim/drug-graph";
import type { LabRenderer } from "../render/labRenderer";

// ───────────────────────────── level generation ─────────────────────────────

/**
 * A display COPY of `mm` whose each map's `fog` is the persistent exploration fog
 * (or fully-revealed when `revealAll`). We never mutate the sim's fog arrays — the
 * renderer reads `map.fog`, drawing fogged cells as UNKNOWN. The persistent arrays
 * are sized to the level by the Game; fall back to the sim's own fog if a map is
 * momentarily missing (e.g. a frame during a level swap).
 */
function withFog(mm: MultiMap, fog: readonly Uint8Array[], revealAll: boolean): MultiMap {
  return {
    maps: mm.maps.map((m, i): EffectMap => {
      if (revealAll) return { ...m, fog: new Uint8Array(m.fog.length).fill(1) };
      const f = fog[i];
      return f !== undefined && f.length === m.fog.length ? { ...m, fog: f } : m;
    }),
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

interface AppProps {
  readonly level: GeneratedLevel;
  /** Persistent exploration fog (one Uint8Array per map), owned by the Game. */
  readonly fog: readonly Uint8Array[];
  readonly catalog: readonly MachineCatalogEntry[];
  readonly onExplore: (template: Template) => void;
  /** Called with the winning template when the player saves a cure to the Factory. */
  readonly onSaveRecipe: (winning: Template) => void;
}

export function App({ level, fog, catalog, onExplore, onSaveRecipe }: AppProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);

  const { mm, start } = level;
  const targets = useMemo<readonly DiseaseId[]>(() => level.diseases.map((d) => d.id), [level]);

  // Revealed cells across all maps (sum of fog===1) and the total — a stable signal
  // (non-flaky) that exploration / reveal-aid grew the explored area.
  const revealedCount = useMemo(() => {
    let revealed = 0;
    let total = 0;
    for (const arr of fog) {
      total += arr.length;
      for (let k = 0; k < arr.length; k++) if (arr[k] === 1) revealed++;
    }
    return { revealed, total };
  }, [fog]);

  // Debug aid: show the full map ignoring fog (pure render; never touches sim/fog).
  const [reveal, setReveal] = useState<boolean>(false);

  // Player-built recipe.
  const [steps, setSteps] = useState<readonly Machine[]>([]);
  // Pending orientation for the NEXT orientable translate machine added.
  const [rot, setRot] = useState<Rotation>(0);
  const [flip, setFlip] = useState<boolean>(false);

  // The animating drug token state (fog is external/persistent, not stored here).
  const [shownDrug, setShownDrug] = useState<DrugState>(start);

  // Result of the last Run.
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [running, setRunning] = useState<boolean>(false);

  const won = useMemo(() => {
    if (outcome === null || outcome.failed) return false;
    const cured = new Set(outcome.cured);
    return targets.every((t) => cured.has(t));
  }, [outcome, targets]);

  // A recipe is shippable once it cures at least one target (cross-map tension
  // means a single drug usually cures one disease; each is a sellable product).
  const canShip = useMemo(() => {
    if (outcome === null || outcome.failed) return false;
    const targetSet = new Set(targets);
    return outcome.cured.some((c) => targetSet.has(c));
  }, [outcome, targets]);

  // Cancel token so a Reset (or unmount) stops an in-flight animation.
  const runIdRef = useRef(0);

  // The map handed to the renderer = the level overlaid with the persistent fog
  // (or fully revealed when the debug toggle is on).
  const renderMap = useMemo(() => withFog(mm, fog, reveal), [mm, fog, reveal]);
  // Latest fogged map + drug for the async mount paint (avoids a one-frame unfogged flash).
  const renderMapRef = useRef(renderMap);
  renderMapRef.current = renderMap;
  const shownDrugRef = useRef(shownDrug);
  shownDrugRef.current = shownDrug;

  // ── mount / unmount the Pixi renderer ─────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let local: LabRenderer | null = null;
    setRendererError(null);
    void (async () => {
      try {
        const { createLabRenderer } = await import("../render/labRenderer");
        const r = await createLabRenderer(mm);
        if (disposed) {
          r.destroy();
          return;
        }
        local = r;
        rendererRef.current = r;
        if (mountRef.current) mountRef.current.appendChild(r.canvas);
        r.render(renderMapRef.current, shownDrugRef.current);
      } catch (error) {
        if (local !== null) {
          local.destroy();
          local = null;
        }
        rendererRef.current = null;
        if (!disposed) {
          const detail = error instanceof Error ? error.message : String(error);
          setRendererError(`Could not start the Lab renderer: ${detail}`);
        }
      }
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
      setOutcome(null);
      setShownDrug(start);
      setSteps((s) => [...s, machine]);
    },
    [running, rot, flip, start],
  );

  const removeLast = useCallback(() => {
    if (running) return;
    setOutcome(null);
    setShownDrug(start);
    setSteps((s) => s.slice(0, -1));
  }, [running, start]);

  const clearTemplate = useCallback(() => {
    if (running) return;
    setOutcome(null);
    setShownDrug(start);
    setSteps([]);
  }, [running, start]);

  // ── Run: reveal fog, animate the drug across BOTH maps, then evaluate ──────
  const run = useCallback(() => {
    if (running || steps.length === 0) return;
    setRunning(true);
    setOutcome(null);

    const t: Template = { steps };
    // Reveal fog along every sweep path (sim does the work); the Game unions the
    // revealed cells into the PERSISTENT exploration fog (do not mutate sim arrays).
    onExplore(t);
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
  }, [running, steps, mm, start, onExplore]);

  // ── Reset: clear the TEMPLATE + token; KEEP what's been explored (fog persists) ──
  const reset = useCallback(() => {
    runIdRef.current++; // cancel any in-flight animation
    setRunning(false);
    setSteps([]);
    setRot(0);
    setFlip(false);
    setOutcome(null);
    setShownDrug(start);
  }, [start]);

  // ── new level handed down by the Game (e.g. new-map patent): reset play state ──
  // (The persistent fog is reset by the Game; here we only clear the template/token.)
  useEffect(() => {
    runIdRef.current++;
    setRunning(false);
    setSteps([]);
    setRot(0);
    setFlip(false);
    setOutcome(null);
    setShownDrug(start);
  }, [mm, start]);

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
        The maps start FOGGED (shown as “?”). Place machines into a template, then Run
        to sweep the drug across the effect maps — each run reveals the cells it passes
        (exploration persists). Cure all targets ({targets.join(", ")}) to win.
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
          <input
            type="checkbox"
            checked={reveal}
            onChange={(e) => setReveal(e.target.checked)}
            data-testid="reveal"
          />
          Reveal all (debug)
        </label>
        {canShip && (
          <button
            type="button"
            onClick={() => onSaveRecipe({ steps })}
            style={{
              ...btn,
              background: "#15724a",
              color: "#fff",
              borderColor: "#0f5c3a",
              fontWeight: 700,
            }}
            data-testid="save-recipe"
          >
            {won ? "Save recipe → Factory (cures all)" : "Save recipe → Factory"}
          </button>
        )}
      </div>

      {/* level info */}
      <div data-testid="level-info" style={{ fontSize: 12, color: "#5a6470", marginBottom: 10 }}>
        seed {level.seed} · <span data-testid="map-count">{mm.maps.length} maps</span> ·{" "}
        <span data-testid="revealed-count">
          revealed {revealedCount.revealed}/{revealedCount.total}
        </span>{" "}
        ·{" "}
        {level.diseases
          .map((d) => `disease ${d.id} (map ${d.map}): difficulty ${d.difficulty}, price ${d.basePrice}`)
          .join(" · ")}
      </div>

      {/* canvas */}
      {rendererError !== null && (
        <div
          role="alert"
          data-testid="lab-render-error"
          style={{ color: "#a11d1d", marginBottom: 10, fontSize: 13 }}
        >
          {rendererError}
        </div>
      )}
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
            {DEFAULT_CATALOG.map((entry) => {
              const unlocked = catalog.some((candidate) => candidate.typeId === entry.typeId);
              return (
              <button
                key={entry.typeId}
                type="button"
                onClick={() => addMachine(entry)}
                disabled={running || !unlocked}
                style={btn}
                title={transformLabel(entry.transform)}
                data-testid={`palette-${entry.typeId}`}
              >
                + {entry.typeId}{unlocked ? "" : " (locked)"}
              </button>
              );
            })}
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
