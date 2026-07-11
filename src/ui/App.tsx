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
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
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
import {
  LAB_VIEWPORT,
  clampLabCamera,
  focusLabCamera,
  labTrailsForFrames,
  panLabCamera,
  zoomLabCameraAt,
  type LabCamera,
} from "../render/labCamera";

// ───────────────────────────── level generation ─────────────────────────────

/**
 * A display COPY of `mm` whose each map's `fog` is the persistent exploration fog
 * (or fully-revealed when `revealAll`). We never mutate the sim's fog arrays — the
 * renderer reads `map.fog`, drawing fogged cells as UNKNOWN. The persistent arrays
 * must match the level exactly; authority mismatches are shown as renderer errors.
 */
function withFog(mm: MultiMap, fog: readonly Uint8Array[], revealAll: boolean): MultiMap {
  return {
    maps: mm.maps.map((m, i): EffectMap => {
      if (revealAll) return { ...m, fog: new Uint8Array(m.fog.length).fill(1) };
      return { ...m, fog: fog[i]! };
    }),
  };
}

export function validateLabFogAuthority(mm: MultiMap, fog: readonly Uint8Array[]): string | null {
  if (fog.length !== mm.maps.length) return "Lab fog authority does not match the active layer count";
  for (let i = 0; i < mm.maps.length; i++) {
    if (fog[i]?.length !== mm.maps[i]!.fog.length) {
      return `Lab fog authority does not match layer ${String.fromCharCode(65 + i)}`;
    }
  }
  return null;
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
  return `Phase Exchange ${String.fromCharCode(65 + t.a)}↔${String.fromCharCode(65 + t.b)}`;
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
  readonly active: boolean;
  readonly level: GeneratedLevel;
  /** Persistent exploration fog (one Uint8Array per map), owned by the Game. */
  readonly fog: readonly Uint8Array[];
  readonly catalog: readonly MachineCatalogEntry[];
  readonly onExplore: (template: Template) => void;
  /** Called with the winning template when the player saves a cure to the Factory. */
  readonly onSaveRecipe: (winning: Template) => void;
}

export function App({ active, level, fog, catalog, onExplore, onSaveRecipe }: AppProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);

  const { mm, start } = level;
  const fogError = useMemo(() => validateLabFogAuthority(mm, fog), [fog, mm]);
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
  const [activeMap, setActiveMap] = useState(0);
  const [cameras, setCameras] = useState<readonly LabCamera[]>(() =>
    mm.maps.map((map, index) =>
      clampLabCamera(
        focusLabCamera(start.pos[index] ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) }),
        LAB_VIEWPORT,
        map,
      ),
    ),
  );
  const [followingDrug, setFollowingDrug] = useState(true);
  const [trails, setTrails] = useState<readonly (readonly ({ readonly x: number; readonly y: number } | null)[])[]>(
    () => labTrailsForFrames([start], mm.maps.length),
  );
  const camera = cameras[activeMap] ?? focusLabCamera(shownDrug.pos[activeMap] ?? { x: 0, y: 0 });

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
  const renderMap = useMemo(
    () => fogError === null ? withFog(mm, fog, reveal) : mm,
    [fog, fogError, mm, reveal],
  );
  // Latest fogged map + drug for the async mount paint (avoids a one-frame unfogged flash).
  const renderMapRef = useRef(renderMap);
  renderMapRef.current = renderMap;
  const shownDrugRef = useRef(shownDrug);
  shownDrugRef.current = shownDrug;
  const viewRef = useRef({ activeMap, camera, trail: trails[activeMap] ?? [] });
  viewRef.current = { activeMap, camera, trail: trails[activeMap] ?? [] };

  // ── mount / unmount the Pixi renderer ─────────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let local: LabRenderer | null = null;
    if (fogError !== null) {
      setRendererError(fogError);
      return () => undefined;
    }
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
        r.render(renderMapRef.current, shownDrugRef.current, viewRef.current);
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
  }, [fogError, mm, start]);

  // ── repaint whenever shown state (or reveal toggle) changes ────────────────
  useEffect(() => {
    if (fogError !== null) return;
    rendererRef.current?.render(renderMap, shownDrug, { activeMap, camera, trail: trails[activeMap] ?? [] });
  }, [activeMap, camera, fogError, renderMap, shownDrug, trails]);

  useEffect(() => {
    if (!followingDrug) return;
    const pos = shownDrug.pos[activeMap];
    const map = mm.maps[activeMap];
    if (pos === undefined || map === undefined) return;
    setCameras((current) => {
      const previous = current[activeMap] ?? focusLabCamera(pos);
      const next = clampLabCamera(
        { x: pos.x + 0.5, y: pos.y + 0.5, zoom: previous.zoom },
        LAB_VIEWPORT,
        map,
      );
      if (next.x === previous.x && next.y === previous.y && next.zoom === previous.zoom) return current;
      const updated = [...current];
      updated[activeMap] = next;
      return updated;
    });
  }, [activeMap, followingDrug, mm.maps, shownDrug]);

  // ── palette / template editing ────────────────────────────────────────────
  const addMachine = useCallback(
    (entry: MachineCatalogEntry) => {
      if (running || (entry.transform.kind === "swap" && mm.maps.length < 2)) return;
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
      setTrails(labTrailsForFrames([start], mm.maps.length));
      setSteps((s) => [...s, machine]);
    },
    [mm.maps.length, running, rot, flip, start],
  );

  const removeLast = useCallback(() => {
    if (running) return;
    setOutcome(null);
    setShownDrug(start);
    setTrails(labTrailsForFrames([start], mm.maps.length));
    setSteps((s) => s.slice(0, -1));
  }, [mm.maps.length, running, start]);

  const clearTemplate = useCallback(() => {
    if (running) return;
    setOutcome(null);
    setShownDrug(start);
    setTrails(labTrailsForFrames([start], mm.maps.length));
    setSteps([]);
  }, [mm.maps.length, running, start]);

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
    const trailBreaks = [false, ...steps.map((machine) => machine.transform.kind === "swap")];
    setTrails(labTrailsForFrames(frames.slice(0, 1), mm.maps.length));

    const myRun = ++runIdRef.current;
    let k = 0;
    const tick = () => {
      if (runIdRef.current !== myRun) return; // cancelled by reset/unmount
      k++;
      const frame = frames[k];
      if (frame !== undefined) {
        setShownDrug(frame);
        setTrails(labTrailsForFrames(
          frames.slice(0, k + 1),
          mm.maps.length,
          trailBreaks.slice(0, k + 1),
        ));
      }
      if (k < frames.length - 1) {
        window.setTimeout(tick, 260);
      } else {
        setOutcome(evaluate(mm, start, t));
        setRunning(false);
      }
    };
    window.setTimeout(tick, 260);
  }, [running, steps, mm, start, onExplore]);

  const cancelRun = useCallback(() => {
    runIdRef.current++;
    setRunning(false);
    setOutcome(null);
    setShownDrug(start);
    setTrails(labTrailsForFrames([start], mm.maps.length));
  }, [mm.maps.length, start]);

  // ── Reset: clear the TEMPLATE + token; KEEP what's been explored (fog persists) ──
  const reset = useCallback(() => {
    runIdRef.current++; // cancel any in-flight animation
    setRunning(false);
    setSteps([]);
    setRot(0);
    setFlip(false);
    setOutcome(null);
    setShownDrug(start);
    setTrails(labTrailsForFrames([start], mm.maps.length));
  }, [mm.maps.length, start]);

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
    setTrails(labTrailsForFrames([start], mm.maps.length));
    setActiveMap(0);
    setFollowingDrug(true);
    setCameras(
      mm.maps.map((map, index) =>
        clampLabCamera(
          focusLabCamera(start.pos[index] ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) }),
          LAB_VIEWPORT,
          map,
        ),
      ),
    );
  }, [mm, start]);

  const focusDrug = useCallback(() => {
    const pos = shownDrug.pos[activeMap];
    const map = mm.maps[activeMap];
    if (pos === undefined || map === undefined) return;
    setFollowingDrug(true);
    setCameras((current) => {
      const updated = [...current];
      updated[activeMap] = clampLabCamera(focusLabCamera(pos), LAB_VIEWPORT, map);
      return updated;
    });
  }, [activeMap, mm.maps, shownDrug]);

  const panRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const onMapPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setFollowingDrug(false);
  }, []);

  const onMapPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    const map = mm.maps[activeMap];
    if (drag === null || drag.pointerId !== event.pointerId || map === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = LAB_VIEWPORT.width / rect.width;
    const scaleY = LAB_VIEWPORT.height / rect.height;
    const dx = (event.clientX - drag.x) * scaleX;
    const dy = (event.clientY - drag.y) * scaleY;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setCameras((current) => {
      const updated = [...current];
      updated[activeMap] = panLabCamera(current[activeMap] ?? camera, dx, dy, LAB_VIEWPORT, map);
      return updated;
    });
  }, [activeMap, camera, mm.maps]);

  const onMapPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onMapWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const map = mm.maps[activeMap];
    if (map === undefined) return;
    event.preventDefault();
    setFollowingDrug(false);
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) * LAB_VIEWPORT.width / rect.width,
      y: (event.clientY - rect.top) * LAB_VIEWPORT.height / rect.height,
    };
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setCameras((current) => {
      const updated = [...current];
      const previous = current[activeMap] ?? camera;
      updated[activeMap] = zoomLabCameraAt(
        previous,
        previous.zoom * factor,
        point,
        LAB_VIEWPORT,
        map,
      );
      return updated;
    });
  }, [activeMap, camera, mm.maps]);

  useEffect(() => {
    if (!active) return;
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
      if (/^Key[A-D]$/.test(event.code)) {
        const index = event.code.charCodeAt(3) - 65;
        if (mm.maps[index] !== undefined) {
          event.preventDefault();
          setFollowingDrug(false);
          setActiveMap(index);
        }
        return;
      }
      if (/^Digit[1-9]$/.test(event.code)) {
        const index = Number(event.code.slice(5)) - 1;
        const entry = DEFAULT_CATALOG[index];
        if (
          entry !== undefined &&
          catalog.some((candidate) => candidate.typeId === entry.typeId) &&
          (entry.transform.kind !== "swap" || mm.maps.length > 1)
        ) {
          event.preventDefault();
          addMachine(entry);
        }
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setRot((value) => ((value + 1) % 4) as Rotation);
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setFlip((value) => !value);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusDrug();
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeLast();
      } else if (event.code === "Space") {
        event.preventDefault();
        if (running) cancelRun();
        else run();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, addMachine, cancelRun, catalog, focusDrug, mm.maps, removeLast, run, running]);

  return (
    <div className="game-view lab-workspace" data-testid="lab-workspace">
      <div className="world-layout">
        <section className="world-viewport lab-world" aria-label="Effect map workspace">
          {rendererError !== null && (
            <div role="alert" data-testid="lab-render-error" className="game-alert lab-render-alert">
              {rendererError}
            </div>
          )}
          <div className="lab-layer-tabs" role="tablist" aria-label="Effect atlas layers">
            {mm.maps.map((_map, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={activeMap === index}
                className={activeMap === index ? "is-active" : ""}
                data-testid={`lab-layer-${index}`}
                onClick={() => {
                  setFollowingDrug(false);
                  setActiveMap(index);
                }}
              >
                <strong>{String.fromCharCode(65 + index)}</strong>
                <span>Layer {index + 1}</span>
              </button>
            ))}
          </div>
          <div
            className="lab-map-frame"
            onPointerDown={onMapPointerDown}
            onPointerMove={onMapPointerMove}
            onPointerUp={onMapPointerUp}
            onPointerCancel={onMapPointerUp}
            onWheel={onMapWheel}
            data-testid="lab-map-frame"
          >
            <div ref={mountRef} data-testid="lab-canvas" className="lab-canvas" />
          </div>

          <div className="transport-bar" aria-label="Lab run controls">
            <button type="button" onClick={running ? cancelRun : run} disabled={steps.length === 0} className={running ? "is-active" : ""} data-testid="run">
              {running ? "■ Stop" : "▶ Run"}
            </button>
            <button type="button" onClick={reset} data-testid="reset">↺ Reset</button>
            <button type="button" onClick={focusDrug} data-testid="lab-focus">
              ◎ Focus
            </button>
            <output className="camera-readout" data-testid="lab-zoom">
              {Math.round(camera.zoom * 100)}%{followingDrug ? " · follow" : ""}
            </output>
            <label className="debug-toggle">
              <input type="checkbox" checked={reveal} onChange={(event) => setReveal(event.target.checked)} data-testid="reveal" />
              Reveal
            </label>
          </div>

          <div className={`lab-status${outcome?.failed ? " is-error" : won ? " is-success" : ""}`} data-testid="status" role="status">
            {outcomeText(outcome, won)}
          </div>

          <div className="toolbelt" role="toolbar" aria-label="Lab machine hotbar" data-testid="lab-toolbelt">
            {DEFAULT_CATALOG.map((entry, index) => {
              const unlocked = catalog.some((candidate) => candidate.typeId === entry.typeId);
              const phaseExchange = entry.transform.kind === "swap";
              const available = unlocked && (!phaseExchange || mm.maps.length > 1);
              const phaseCue = phaseExchange
                ? ` · Before A(${shownDrug.pos[0]?.x ?? "–"},${shownDrug.pos[0]?.y ?? "–"}) B(${shownDrug.pos[1]?.x ?? "–"},${shownDrug.pos[1]?.y ?? "–"}) → after A takes B, B takes A`
                : "";
              return (
                <button
                  key={entry.typeId}
                  type="button"
                  onClick={() => addMachine(entry)}
                  disabled={running || !available}
                  className={`tool-slot${available ? "" : " is-locked"}`}
                  title={`${transformLabel(entry.transform)}${phaseCue} · ${index + 1}`}
                  data-testid={`palette-${entry.typeId}`}
                >
                  <span className="tool-symbol" aria-hidden="true">{phaseExchange ? "A↔B" : entry.typeId.slice(0, 2).toUpperCase()}</span>
                  <span className="tool-name">{phaseExchange ? "Phase Exchange" : entry.typeId}</span>
                  <span className="hotkey">{index + 1}</span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="inspector lab-inspector" data-testid="lab-inspector">
          <div className="panel-kicker">Research workspace</div>
          <h1>Effect Atlas</h1>
          <div data-testid="level-info" className="level-readout">
            seed {level.seed} · <span data-testid="map-count">{mm.maps.length} {mm.maps.length === 1 ? "map" : "maps"}</span><br />
            <span data-testid="revealed-count">revealed {revealedCount.revealed}/{revealedCount.total}</span>
          </div>
          <div className="disease-stack">
            {level.diseases.map((disease) => (
              <div className="disease-chip" key={disease.id}>
                <strong>D{disease.id}</strong>
                <span>map {disease.map} · diff {disease.difficulty}</span>
                <output>{disease.basePrice}</output>
              </div>
            ))}
          </div>

          <div className="panel-section">
            <div className="panel-heading">
              <h2>Recipe timeline</h2>
              <span data-testid="template-count">{steps.length}</span>
            </div>
            <ol data-testid="template-list" className="recipe-timeline">
              {steps.length === 0 ? (
                <li className="is-empty">Choose a machine from the hotbar.</li>
              ) : (
                steps.map((machine, index) => <li key={index}><span>{index + 1}</span>{stepLabel(machine)}</li>)
              )}
            </ol>
            <div className="panel-actions">
              <button type="button" onClick={removeLast} disabled={running || steps.length === 0} className="game-control" data-testid="remove-last">⌫ Last</button>
              <button type="button" onClick={clearTemplate} disabled={running || steps.length === 0} className="game-control" data-testid="clear">Clear</button>
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-heading">
              <h2>Active layer</h2>
              <span>{String.fromCharCode(65 + activeMap)}</span>
            </div>
            <p className="panel-copy">
              Viewing one local region of layer {String.fromCharCode(65 + activeMap)}. Drag to inspect, wheel to zoom, then Focus to follow the drug.
            </p>
            {mm.maps.length > 1 && (
              <div className="phase-cue" data-testid="phase-exchange-cue">
                <strong>Phase Exchange A↔B</strong>
                <span>Before: A keeps A, B keeps B</span>
                <span>After: A receives B, B receives A</span>
              </div>
            )}
          </div>

          <div className="panel-section">
            <h2>Next machine orientation</h2>
            <div className="panel-actions">
              <button type="button" onClick={() => setRot((value) => ((value + 1) % 4) as Rotation)} disabled={running} className="game-control" data-testid="rotate">
                R · {ROT_LABEL[rot]}
              </button>
              <button type="button" onClick={() => setFlip((value) => !value)} disabled={running} className={`game-control${flip ? " is-active" : ""}`} data-testid="flip">
                H · Flip {flip ? "on" : "off"}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSaveRecipe({ steps })}
            className="primary-action"
            data-testid="save-recipe"
            disabled={!canShip}
          >
            {canShip
              ? won ? "Send complete cure to Factory" : "Send recipe to Factory"
              : "Run a valid recipe to ship"}
          </button>
          <div className="key-help"><span className="hotkey">Space</span> run · <span className="hotkey">A–D</span> layers · <span className="hotkey">F</span> focus · <span className="hotkey">R</span> rotate · <span className="hotkey">H</span> mirror · <span className="hotkey">⌫</span> remove</div>
        </aside>
      </div>
    </div>
  );
}
