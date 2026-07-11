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
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type {
  MultiMap,
  EffectMap,
  DrugState,
  Machine,
  Template,
  Outcome,
  Rotation,
  MachineCatalogEntry,
  DiseaseId,
  GeneratedLevel,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { evaluate } from "../sim/drug-graph";
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
import { MachineIcon } from "./MachineIcon";
import { createRecipeEditor, recipeEditorReducer } from "./recipeEditor";
import { buildFogSafeRecipePreview, buildRecipePreview, maskRecipeTrailForFog } from "./recipePreview";

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

const MACHINE_NAMES: Readonly<Record<string, string>> = {
  push: "Push",
  push2: "Long Push",
  pull: "Pull",
  shear: "Shear",
  skew: "Skew",
  dilute: "Dilute",
  swap01: "Phase Exchange",
};

function machineName(machine: Pick<Machine, "typeId">): string {
  return MACHINE_NAMES[machine.typeId] ?? machine.typeId;
}

function machineEffect(machine: Machine): string {
  if (machine.transform.kind === "translate") {
    const distance = Math.max(Math.abs(machine.transform.delta.x), Math.abs(machine.transform.delta.y));
    const direction = machine.transform.relation === "reverse"
      ? "pulls backward"
      : machine.transform.relation === "perpendicular"
        ? "turns movement right"
        : machine.transform.relation === "offset"
          ? "moves diagonally"
          : `pushes ${distance} ${distance === 1 ? "cell" : "cells"}`;
    return `${direction} · ${ROT_LABEL[machine.orientation.rot]}${machine.orientation.flip ? " · mirrored" : ""}`;
  }
  if (machine.transform.kind === "scale") return "draws every layer toward its origin";
  return `exchanges layer ${String.fromCharCode(65 + machine.transform.a)} and ${String.fromCharCode(65 + machine.transform.b)}`;
}

function insertMachine(steps: readonly Machine[], machine: Machine, requested: number): readonly Machine[] {
  const index = Math.min(steps.length, Math.max(0, Math.trunc(requested)));
  const next = [...steps];
  next.splice(index, 0, machine);
  return next;
}

function moveMachine(steps: readonly Machine[], from: number, insertion: number): readonly Machine[] {
  if (steps[from] === undefined) return steps;
  const target = insertion > from ? insertion - 1 : insertion;
  if (target === from) return steps;
  const next = [...steps];
  const [machine] = next.splice(from, 1);
  if (machine === undefined) return steps;
  next.splice(Math.min(next.length, Math.max(0, target)), 0, machine);
  return next;
}

function drugIsRevealed(mm: MultiMap, drug: DrugState, mapIndex: number): boolean {
  const map = mm.maps[mapIndex];
  const pos = drug.pos[mapIndex];
  if (map === undefined || pos === undefined) return false;
  if (pos.x < 0 || pos.y < 0 || pos.x >= map.width || pos.y >= map.height) return false;
  return map.fog[pos.y * map.width + pos.x] === 1;
}

export function recipeCandidateFailedAtInsertion(
  slotIndex: number,
  heldInsertion: number,
  failedStep: number | null,
): boolean {
  return slotIndex === heldInsertion && failedStep === heldInsertion;
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

  const [editor, edit] = useReducer(recipeEditorReducer, undefined, () => createRecipeEditor());
  const steps = editor.steps;

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
  const [runStep, setRunStep] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ readonly from: number; readonly over: number; readonly moved: boolean } | null>(null);

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
  const committedDisplaySteps = useMemo(
    () => editor.selectedIndex === null ? steps : steps.slice(0, editor.selectedIndex + 1),
    [editor.selectedIndex, steps],
  );
  const committedPreview = useMemo(
    () => buildFogSafeRecipePreview(renderMap, start, committedDisplaySteps),
    [committedDisplaySteps, renderMap, start],
  );
  const candidateSteps = useMemo(() => {
    if (drag?.moved) return moveMachine(steps, drag.from, drag.over);
    if (editor.held !== null) {
      return insertMachine(steps, editor.held, editor.insertionIndex ?? steps.length);
    }
    return null;
  }, [drag, editor.held, editor.insertionIndex, steps]);
  const candidatePreview = useMemo(
    () => candidateSteps === null ? null : buildFogSafeRecipePreview(renderMap, start, candidateSteps),
    [candidateSteps, renderMap, start],
  );
  const visibleCommittedTrail = useMemo(() => {
    const map = renderMap.maps[activeMap];
    return map === undefined
      ? []
      : maskRecipeTrailForFog(map, committedPreview.trails[activeMap] ?? []);
  }, [activeMap, committedPreview.trails, renderMap.maps]);
  const visibleCandidateTrail = useMemo(() => {
    const map = renderMap.maps[activeMap];
    if (map === undefined || candidatePreview === null) return undefined;
    return maskRecipeTrailForFog(map, candidatePreview.trails[activeMap] ?? []);
  }, [activeMap, candidatePreview, renderMap.maps]);
  const displayPreview = candidatePreview ?? committedPreview;
  const displayPreviewHasSteps = (candidateSteps ?? committedDisplaySteps).length > 0;
  const visiblePreviewDrug = displayPreviewHasSteps && displayPreview.uncertainStep === null &&
    drugIsRevealed(renderMap, displayPreview.final, activeMap)
    ? displayPreview.final
    : undefined;
  const committedFailureStep = candidatePreview === null ? committedPreview.failedStep : null;
  const renderView = useMemo(() => running
    ? { activeMap, camera, trail: trails[activeMap] ?? [] }
    : {
        activeMap,
        camera,
        trail: visibleCommittedTrail,
        previewTrail: visibleCandidateTrail,
        previewDrug: visiblePreviewDrug,
      }, [activeMap, camera, running, trails, visibleCandidateTrail, visibleCommittedTrail, visiblePreviewDrug]);
  // Latest fogged map + drug for the async mount paint (avoids a one-frame unfogged flash).
  const renderMapRef = useRef(renderMap);
  renderMapRef.current = renderMap;
  const shownDrugRef = useRef(shownDrug);
  shownDrugRef.current = shownDrug;
  const viewRef = useRef(renderView);
  viewRef.current = renderView;

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
    rendererRef.current?.render(renderMap, shownDrug, renderView);
  }, [fogError, renderMap, renderView, shownDrug]);

  useEffect(() => {
    if (!followingDrug) return;
    const focusTarget = !running && visiblePreviewDrug !== undefined ? visiblePreviewDrug : shownDrug;
    const pos = focusTarget.pos[activeMap];
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
  }, [activeMap, followingDrug, mm.maps, running, shownDrug, visiblePreviewDrug]);

  // ── palette / template editing ────────────────────────────────────────────
  const invalidateOutcome = useCallback(() => {
    setOutcome(null);
    setRunStep(null);
    setShownDrug(start);
    setTrails(labTrailsForFrames([start], mm.maps.length));
  }, [mm.maps.length, start]);

  const pickMachine = useCallback(
    (entry: MachineCatalogEntry) => {
      if (running || (entry.transform.kind === "swap" && mm.maps.length < 2)) return;
      const machine: Machine = {
        typeId: entry.typeId,
        transform: entry.transform,
        orientation: { rot: 0, flip: false },
      };
      edit({ type: "pick", machine });
    },
    [mm.maps.length, running],
  );

  const commitHeld = useCallback((index: number) => {
    if (running || editor.held === null) return;
    invalidateOutcome();
    edit({ type: "commitHeld", index });
  }, [editor.held, invalidateOutcome, running]);

  const clearTemplate = useCallback(() => {
    if (running || steps.length === 0) return;
    invalidateOutcome();
    edit({ type: "clear" });
  }, [invalidateOutcome, running, steps.length]);

  // ── Run: reveal fog, animate the drug across BOTH maps, then evaluate ──────
  const run = useCallback(() => {
    if (running || steps.length === 0) return;
    setRunning(true);
    setOutcome(null);
    setRunStep(null);
    edit({ type: "cancel" });

    const t: Template = { steps };
    // Reveal fog along every sweep path (sim does the work); the Game unions the
    // revealed cells into the PERSISTENT exploration fog (do not mutate sim arrays).
    onExplore(t);
    setShownDrug(start);

    const frames = buildRecipePreview(mm, start, steps).frames;
    setTrails(buildRecipePreview(mm, start, []).trails);

    const myRun = ++runIdRef.current;
    let k = 0;
    const tick = () => {
      if (runIdRef.current !== myRun) return; // cancelled by reset/unmount
      k++;
      const frame = frames[k];
      if (frame !== undefined) {
        setRunStep(k - 1);
        setShownDrug(frame);
        setTrails(buildRecipePreview(mm, start, steps.slice(0, k)).trails);
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
    setRunStep(null);
    setOutcome(null);
    setShownDrug(start);
    setTrails(labTrailsForFrames([start], mm.maps.length));
  }, [mm.maps.length, start]);

  // ── Reset: clear the TEMPLATE + token; KEEP what's been explored (fog persists) ──
  const reset = useCallback(() => {
    runIdRef.current++; // cancel any in-flight animation
    setRunning(false);
    setRunStep(null);
    setDrag(null);
    edit({ type: "reset" });
    setOutcome(null);
    setShownDrug(start);
    setTrails(labTrailsForFrames([start], mm.maps.length));
  }, [mm.maps.length, start]);

  // ── new level handed down by the Game (e.g. new-map patent): reset play state ──
  // (The persistent fog is reset by the Game; here we only clear the template/token.)
  useEffect(() => {
    runIdRef.current++;
    setRunning(false);
    setRunStep(null);
    setDrag(null);
    edit({ type: "reset" });
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

  const recipeDragRef = useRef<{ readonly pointerId: number; readonly startX: number } | null>(null);
  const onRecipePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (running || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    recipeDragRef.current = { pointerId: event.pointerId, startX: event.clientX };
    setDrag({ from: index, over: index, moved: false });
    edit({ type: "select", index });
  }, [running]);

  const onRecipePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = recipeDragRef.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    const moved = Math.abs(event.clientX - current.startX) > 6;
    if (!moved && !drag?.moved) return;
    const track = event.currentTarget.closest("[data-recipe-track]");
    const cards = track?.querySelectorAll<HTMLElement>("[data-recipe-step-index]");
    let over = 0;
    cards?.forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (event.clientX > rect.left + rect.width / 2) over++;
    });
    setDrag((previous) => previous === null ? null : { ...previous, over, moved: true });
  }, [drag?.moved]);

  const onRecipePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = recipeDragRef.current;
    if (current === null || current.pointerId !== event.pointerId) return;
    recipeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag?.moved) {
      invalidateOutcome();
      edit({ type: "move", from: drag.from, toInsertionIndex: drag.over });
    }
    setDrag(null);
  }, [drag, invalidateOutcome]);

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
      if (running && event.code !== "Space" && event.key.toLowerCase() !== "f") return;
      if (/^Digit[1-9]$/.test(event.code)) {
        const index = Number(event.code.slice(5)) - 1;
        const entry = DEFAULT_CATALOG[index];
        if (
          entry !== undefined &&
          catalog.some((candidate) => candidate.typeId === entry.typeId) &&
          (entry.transform.kind !== "swap" || mm.maps.length > 1)
        ) {
          event.preventDefault();
          pickMachine(entry);
        }
        return;
      }
      if (event.key.toLowerCase() === "r") {
        const machine = editor.held ?? (editor.selectedIndex === null ? null : steps[editor.selectedIndex] ?? null);
        if (machine?.transform.kind !== "translate") return;
        event.preventDefault();
        if (editor.selectedIndex !== null) invalidateOutcome();
        edit({ type: "rotate" });
      } else if (event.key.toLowerCase() === "h") {
        const machine = editor.held ?? (editor.selectedIndex === null ? null : steps[editor.selectedIndex] ?? null);
        if (machine?.transform.kind !== "translate") return;
        event.preventDefault();
        if (editor.selectedIndex !== null) invalidateOutcome();
        edit({ type: "flip" });
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusDrug();
      } else if (event.key.toLowerCase() === "q" && editor.selectedIndex !== null) {
        const machine = steps[editor.selectedIndex];
        if (machine !== undefined) {
          event.preventDefault();
          edit({ type: "pick", machine });
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        edit({ type: "cancel" });
      } else if (event.key === "Backspace" || event.key === "Delete") {
        if (editor.selectedIndex !== null) {
          event.preventDefault();
          invalidateOutcome();
          edit({ type: "removeSelected" });
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (event.shiftKey ? editor.future.length === 0 : editor.past.length === 0) return;
        event.preventDefault();
        invalidateOutcome();
        edit({ type: event.shiftKey ? "redo" : "undo" });
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        if (editor.future.length === 0) return;
        event.preventDefault();
        invalidateOutcome();
        edit({ type: "redo" });
      } else if (event.code === "Space") {
        event.preventDefault();
        if (running) cancelRun();
        else run();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, cancelRun, catalog, editor, focusDrug, invalidateOutcome, mm.maps, pickMachine, run, running, steps]);

  const activeMachine = editor.held ?? (
    editor.selectedIndex === null ? null : steps[editor.selectedIndex] ?? null
  );
  const canOrientActive = activeMachine?.transform.kind === "translate";
  const previewStatusBase = drag?.moved
    ? `Preview move: step ${drag.from + 1} to slot ${drag.over + 1}`
    : editor.held !== null
      ? `Preview step ${(editor.insertionIndex ?? steps.length) + 1}: place ${machineName(editor.held)}`
      : editor.selectedIndex !== null
        ? `Step ${editor.selectedIndex + 1} selected · R rotate · H mirror · drag to reorder`
        : steps.length === 0
          ? "Pick a machine, inspect its route, then choose an insertion slot."
          : "Route ready · select a step to inspect or drag it to reorder.";
  const previewStatus = displayPreview.uncertainStep !== null
    ? `${previewStatusBase} · route enters unknown territory`
    : displayPreview.failedStep !== null
      ? `${previewStatusBase} · hazard at step ${displayPreview.failedStep + 1}`
      : previewStatusBase;

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

          <section className="lab-command-deck" aria-label="Recipe editor">
            <header className="recipe-dock-header">
              <div>
                <strong>Recipe track</strong>
                <span data-testid="template-count">{steps.length}</span>
              </div>
              <output className="recipe-preview-state" data-testid="lab-preview-state">
                {previewStatus}
              </output>
              {editor.held !== null && (
                <div className="recipe-held" data-testid="recipe-held">
                  <MachineIcon {...editor.held} size={24} />
                  <span>{machineName(editor.held)}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => onSaveRecipe({ steps })}
                className="recipe-ship"
                disabled={!canShip}
                title="Send valid recipe to Factory"
              >
                ⇢ Factory
              </button>
              <div className="recipe-edit-actions" role="toolbar" aria-label="Recipe editing controls">
                <button
                  type="button"
                  onClick={() => {
                    if (editor.selectedIndex !== null) invalidateOutcome();
                    edit({ type: "rotate" });
                  }}
                  disabled={running || !canOrientActive}
                  className="game-control"
                  data-testid="rotate"
                  title="Rotate held or selected machine (R)"
                >
                  ↻ <span>{activeMachine === null ? "R" : ROT_LABEL[activeMachine.orientation.rot]}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editor.selectedIndex !== null) invalidateOutcome();
                    edit({ type: "flip" });
                  }}
                  disabled={running || !canOrientActive}
                  className={`game-control${activeMachine?.orientation.flip ? " is-active" : ""}`}
                  data-testid="flip"
                  title="Mirror held or selected machine (H)"
                >
                  ⇋ <span>H</span>
                </button>
                <button type="button" onClick={() => { invalidateOutcome(); edit({ type: "undo" }); }} disabled={running || editor.past.length === 0} className="game-control" data-testid="recipe-undo" title="Undo (Ctrl+Z)">↶</button>
                <button type="button" onClick={() => { invalidateOutcome(); edit({ type: "redo" }); }} disabled={running || editor.future.length === 0} className="game-control" data-testid="recipe-redo" title="Redo (Ctrl+Y)">↷</button>
                <button type="button" onClick={clearTemplate} disabled={running || steps.length === 0} className="game-control" data-testid="clear" title="Clear recipe">Clear</button>
              </div>
            </header>

            <div
              className={`recipe-track${editor.held !== null ? " is-placing" : ""}${drag?.moved ? " is-dragging" : ""}`}
              data-testid="template-list"
              data-recipe-track
            >
              {steps.length === 0 && editor.held === null && (
                <span className="recipe-empty">Choose a machine from the hotbar.</span>
              )}
              {Array.from({ length: steps.length + 1 }, (_, index) => {
                const machine = steps[index];
                const previewing = (
                  editor.held !== null && (editor.insertionIndex ?? steps.length) === index
                ) || (drag?.moved === true && drag.over === index);
                const heldInsertion = editor.insertionIndex ?? steps.length;
                const candidateFailedHere = editor.held !== null && recipeCandidateFailedAtInsertion(
                  index,
                  heldInsertion,
                  candidatePreview?.failedStep ?? null,
                );
                return (
                  <div className="recipe-track-slot" key={index}>
                    <button
                      type="button"
                      className={`recipe-insertion${previewing ? " is-previewing" : ""}${candidateFailedHere ? " is-failed" : ""}`}
                      disabled={running || editor.held === null}
                      aria-label={`Insert machine at step ${index + 1}`}
                      data-testid={`recipe-insert-${index}`}
                      data-insertion-index={index}
                      data-previewing={previewing ? "true" : "false"}
                      onPointerEnter={() => edit({ type: "hoverInsertion", index })}
                      onFocus={() => edit({ type: "hoverInsertion", index })}
                      onClick={() => commitHeld(index)}
                    >
                      <span aria-hidden="true">＋</span>
                    </button>
                    {machine !== undefined && (
                      <button
                        type="button"
                        disabled={running}
                        className={`recipe-step${editor.selectedIndex === index ? " is-selected" : ""}${runStep === index ? " is-running" : ""}${committedFailureStep === index ? " is-failed" : ""}${drag?.from === index && drag.moved ? " is-drag-source" : ""}`}
                        aria-selected={editor.selectedIndex === index}
                        aria-label={`Step ${index + 1}: ${machineName(machine)}, ${machineEffect(machine)}`}
                        data-testid={`recipe-step-${index}`}
                        data-recipe-step-index={index}
                        data-rotation={machine.orientation.rot}
                        title={`${machineName(machine)} · ${machineEffect(machine)} · drag to reorder`}
                        onClick={() => {
                          if (!running) edit({ type: "select", index });
                        }}
                        onPointerDown={(event) => onRecipePointerDown(event, index)}
                        onPointerMove={onRecipePointerMove}
                        onPointerUp={onRecipePointerUp}
                        onPointerCancel={onRecipePointerUp}
                      >
                        <span className="recipe-step-number">{index + 1}</span>
                        <MachineIcon {...machine} size={31} />
                        <span className="recipe-step-name">{machineName(machine)}</span>
                        {machine.transform.kind === "translate" && (
                          <span className="recipe-orientation-badge">{ROT_LABEL[machine.orientation.rot]}{machine.orientation.flip ? " ⇋" : ""}</span>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="toolbelt" role="toolbar" aria-label="Lab machine hotbar" data-testid="lab-toolbelt">
              {DEFAULT_CATALOG.map((entry, index) => {
                const unlocked = catalog.some((candidate) => candidate.typeId === entry.typeId);
                const phaseExchange = entry.transform.kind === "swap";
                const available = unlocked && (!phaseExchange || mm.maps.length > 1);
                const machine: Machine = {
                  typeId: entry.typeId,
                  transform: entry.transform,
                  orientation: { rot: 0, flip: false },
                };
                return (
                  <button
                    key={entry.typeId}
                    type="button"
                    onClick={() => pickMachine(entry)}
                    disabled={running || !available}
                    className={`tool-slot${available ? "" : " is-locked"}${editor.held?.typeId === entry.typeId ? " is-selected" : ""}`}
                    title={`${machineName(machine)} · ${machineEffect(machine)} · ${index + 1}`}
                    data-testid={`palette-${entry.typeId}`}
                  >
                    <MachineIcon {...machine} size={29} />
                    <span className="tool-name">{machineName(machine)}</span>
                    <span className="hotkey">{index + 1}</span>
                  </button>
                );
              })}
            </div>
          </section>
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

          <div className="panel-section machine-inspector" data-testid="recipe-inspector">
            <div className="panel-heading">
              <h2>{editor.held !== null ? "Placing machine" : editor.selectedIndex !== null ? "Selected step" : "Recipe editing"}</h2>
              {editor.selectedIndex !== null && <span>#{editor.selectedIndex + 1}</span>}
            </div>
            {activeMachine === null ? (
              <p className="panel-copy">Choose a pictogram below, then inspect the orange route before placing it between two steps.</p>
            ) : (
              <div className="machine-inspector-card">
                <MachineIcon {...activeMachine} size={54} title={machineName(activeMachine)} />
                <div>
                  <strong>{machineName(activeMachine)}</strong>
                  <span>{machineEffect(activeMachine)}</span>
                </div>
              </div>
            )}
            <div className="machine-effect-diagram" aria-label="Machine effect preview">
              <span className="effect-capsule">●</span>
              <span aria-hidden="true">→</span>
              <span className="effect-machine">{activeMachine === null ? "?" : <MachineIcon {...activeMachine} size={28} />}</span>
              <span aria-hidden="true">→</span>
              <span className="effect-capsule is-result">●</span>
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
          <div className="key-help"><span className="hotkey">1–7</span> hold machine · <span className="hotkey">R/H</span> orient · <span className="hotkey">Q</span> pipette · <span className="hotkey">⌫</span> delete · <span className="hotkey">Ctrl Z/Y</span> undo/redo · <span className="hotkey">Space</span> run</div>
        </aside>
      </div>
    </div>
  );
}
