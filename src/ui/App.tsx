import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type {
  DrugState,
  EffectMap,
  GeneratedLevel,
  MultiMap,
  Outcome,
  Vec2,
} from "../sim/phase0_interfaces";
import type { LabRenderer } from "../render/labRenderer";
import {
  LAB_VIEWPORT,
  clampLabCamera,
  focusLabCamera,
  panLabCamera,
  zoomLabCameraAt,
  type LabCamera,
} from "../render/labCamera";

interface LabSurfaceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function labPointerToViewport(
  clientX: number,
  clientY: number,
  rect: LabSurfaceRect,
): Vec2 {
  return {
    x: (clientX - rect.left) * LAB_VIEWPORT.width / rect.width,
    y: (clientY - rect.top) * LAB_VIEWPORT.height / rect.height,
  };
}

export function researchPointerAction(
  button: number,
  moved: boolean,
): "place" | "erase" | null {
  if (moved) return null;
  if (button === 0) return "place";
  if (button === 2) return "erase";
  return null;
}

export function researchPointerMoved(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
): boolean {
  return Math.hypot(clientX - startX, clientY - startY) >= 3;
}

export function withFog(mm: MultiMap, fog: readonly Uint8Array[]): MultiMap {
  return {
    maps: mm.maps.map((map, index): EffectMap => ({ ...map, fog: fog[index]! })),
  };
}

export function validateLabFogAuthority(mm: MultiMap, fog: readonly Uint8Array[]): string | null {
  if (mm.maps.length !== 1) return "Research requires a single Research Atlas";
  if (fog.length !== 1) return "Research fog must contain one Atlas";
  if (fog[0]?.length !== mm.maps[0]!.fog.length) return "Research fog does not match the Atlas";
  return null;
}

interface AppProps {
  readonly active: boolean;
  readonly level: GeneratedLevel;
  readonly fog: readonly Uint8Array[];
  readonly drug: DrugState;
  readonly trails: readonly (readonly (Vec2 | null)[])[];
  readonly previewTrails?: readonly (readonly (Vec2 | null)[])[];
  readonly previewDrug?: DrugState;
  readonly shotStep: number | null;
  readonly lastOutcome: Outcome | null;
  readonly onWorldActivate?: () => void;
  readonly onWorldErase?: () => void;
  readonly onCalibrationWheel?: (direction: -1 | 1) => void;
}

export function App({
  active,
  level,
  fog,
  drug,
  trails,
  previewTrails,
  previewDrug,
  shotStep,
  lastOutcome,
  onWorldActivate,
  onWorldErase,
  onCalibrationWheel,
}: AppProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const activeMap = 0;
  const { mm, start } = level;
  const fogError = useMemo(() => validateLabFogAuthority(mm, fog), [fog, mm]);
  const renderMap = useMemo(() => fogError === null ? withFog(mm, fog) : mm, [fog, fogError, mm]);
  const [cameras, setCameras] = useState<readonly LabCamera[]>(() => mm.maps.map((map, index) =>
    clampLabCamera(
      focusLabCamera(start.pos[index] ?? map.start),
      LAB_VIEWPORT,
      map,
    ),
  ));
  const camera = cameras[activeMap] ?? focusLabCamera(drug.pos[activeMap] ?? { x: 0, y: 0 });
  const view = useMemo(
    () => ({
      activeMap,
      camera,
      trail: trails[activeMap] ?? [],
      previewTrail: previewTrails?.[activeMap],
      previewDrug,
    }),
    [activeMap, camera, previewDrug, previewTrails, trails],
  );
  const renderMapRef = useRef(renderMap);
  renderMapRef.current = renderMap;
  const drugRef = useRef(drug);
  drugRef.current = drug;
  const viewRef = useRef(view);
  viewRef.current = view;

  const revealed = useMemo(() => fog.reduce((total, layer) => {
    let count = total;
    for (const cell of layer) count += cell;
    return count;
  }, 0), [fog]);
  const total = useMemo(() => fog.reduce((sum, layer) => sum + layer.length, 0), [fog]);

  useEffect(() => {
    setCameras(mm.maps.map((map, index) => clampLabCamera(
      focusLabCamera(start.pos[index] ?? map.start),
      LAB_VIEWPORT,
      map,
    )));
  }, [mm, start]);

  useEffect(() => {
    let disposed = false;
    let renderer: LabRenderer | null = null;
    if (fogError !== null) {
      setRendererError(fogError);
      return () => undefined;
    }
    setRendererError(null);
    void (async () => {
      try {
        const { createLabRenderer } = await import("../render/labRenderer");
        renderer = await createLabRenderer(mm);
        if (disposed) {
          renderer.destroy();
          return;
        }
        rendererRef.current = renderer;
        if (mountRef.current !== null) mountRef.current.appendChild(renderer.canvas);
        renderer.render(renderMapRef.current, drugRef.current, viewRef.current);
      } catch (error) {
        rendererRef.current = null;
        if (!disposed) {
          setRendererError(
            `Could not start the Research atlas: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    })();
    return () => {
      disposed = true;
      rendererRef.current = null;
      renderer?.destroy();
    };
  }, [fogError, mm]);

  useEffect(() => {
    if (fogError === null) rendererRef.current?.render(renderMap, drug, view);
  }, [drug, fogError, renderMap, view]);

  const focusDrug = useCallback(() => {
    const position = drug.pos[activeMap];
    const map = mm.maps[activeMap];
    if (position === undefined || map === undefined) return;
    setCameras((current) => {
      const next = [...current];
      next[activeMap] = clampLabCamera(focusLabCamera(position), LAB_VIEWPORT, map);
      return next;
    });
  }, [activeMap, drug.pos, mm.maps]);

  const panRef = useRef<{
    readonly pointerId: number;
    readonly button: number;
    readonly startX: number;
    readonly startY: number;
    readonly x: number;
    readonly y: number;
    readonly moved: boolean;
  } | null>(null);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      pointerId: event.pointerId,
      button: event.button,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  }, []);
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    const map = mm.maps[activeMap];
    if (drag === null || drag.pointerId !== event.pointerId || map === undefined) return;
    const rect = mountRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - drag.x) * LAB_VIEWPORT.width / rect.width;
    const dy = (event.clientY - drag.y) * LAB_VIEWPORT.height / rect.height;
    panRef.current = {
      ...drag,
      x: event.clientX,
      y: event.clientY,
      moved: drag.moved || researchPointerMoved(
        drag.startX,
        drag.startY,
        event.clientX,
        event.clientY,
      ),
    };
    setCameras((current) => {
      const next = [...current];
      next[activeMap] = panLabCamera(current[activeMap] ?? camera, dx, dy, LAB_VIEWPORT, map);
      return next;
    });
  }, [activeMap, camera, mm.maps]);
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const action = researchPointerAction(drag.button, drag.moved);
    if (action === "place") onWorldActivate?.();
    else if (action === "erase") onWorldErase?.();
  }, [onWorldActivate, onWorldErase]);
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (event.shiftKey && onCalibrationWheel !== undefined) {
      event.preventDefault();
      onCalibrationWheel(event.deltaY < 0 ? 1 : -1);
      return;
    }
    const map = mm.maps[activeMap];
    if (map === undefined) return;
    event.preventDefault();
    const rect = mountRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const point = labPointerToViewport(event.clientX, event.clientY, rect);
    setCameras((current) => {
      const next = [...current];
      const previous = current[activeMap] ?? camera;
      next[activeMap] = zoomLabCameraAt(
        previous,
        previous.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
        point,
        LAB_VIEWPORT,
        map,
      );
      return next;
    });
  }, [activeMap, camera, mm.maps, onCalibrationWheel]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusDrug();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, focusDrug]);

  const outcomeText = lastOutcome === null
    ? shotStep === null
      ? null
      : `Step ${shotStep + 1}`
    : lastOutcome.failed
      ? "Failed"
      : lastOutcome.cured.length > 0
        ? `Cure ${lastOutcome.cured.join(", ")}`
        : "No cure";

  return (
    <div className="game-view lab-workspace research-atlas" data-testid="research-atlas">
      <section className="world-viewport lab-world" aria-label="Research atlas">
        {rendererError !== null && <div role="alert" className="game-alert">{rendererError}</div>}
        <div
          className="lab-map-frame"
          data-testid="lab-map-frame"
          data-camera-x={camera.x}
          data-camera-y={camera.y}
          data-camera-zoom={camera.zoom}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={onWheel}
        >
          <div ref={mountRef} data-testid="lab-canvas" className="lab-canvas" />
        </div>
        <div className="transport-bar research-atlas-status">
          <button type="button" onClick={focusDrug} data-testid="lab-focus" aria-label="Focus current dose">
            <span aria-hidden="true">◎</span><span className="lab-focus-label">Focus</span><kbd>F</kbd>
          </button>
          <output data-testid="lab-zoom">{Math.round(camera.zoom * 100)}%</output>
          <span data-testid="revealed-count">revealed {revealed}/{total}</span>
          <span className="lab-seed" data-testid="level-info">seed {level.seed}</span>
          {outcomeText !== null && <strong data-testid="research-atlas-outcome">{outcomeText}</strong>}
        </div>
      </section>
    </div>
  );
}
