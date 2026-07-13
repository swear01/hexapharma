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

export function withFog(mm: MultiMap, fog: readonly Uint8Array[]): MultiMap {
  return {
    maps: mm.maps.map((map, index): EffectMap => ({ ...map, fog: fog[index]! })),
  };
}

export function validateLabFogAuthority(mm: MultiMap, fog: readonly Uint8Array[]): string | null {
  if (fog.length !== mm.maps.length) return "Research fog does not match the active layer count";
  for (let index = 0; index < mm.maps.length; index++) {
    if (fog[index]?.length !== mm.maps[index]!.fog.length) {
      return `Research fog does not match layer ${String.fromCharCode(65 + index)}`;
    }
  }
  return null;
}

interface AppProps {
  readonly active: boolean;
  readonly level: GeneratedLevel;
  readonly fog: readonly Uint8Array[];
  readonly drug: DrugState;
  readonly trails: readonly (readonly (Vec2 | null)[])[];
  readonly shotStep: number | null;
  readonly lastOutcome: Outcome | null;
}

export function App({ active, level, fog, drug, trails, shotStep, lastOutcome }: AppProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [activeMap, setActiveMap] = useState(0);
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
    () => ({ activeMap, camera, trail: trails[activeMap] ?? [] }),
    [activeMap, camera, trails],
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
    setActiveMap(0);
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

  const panRef = useRef<{ readonly pointerId: number; readonly x: number; readonly y: number } | null>(null);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }, []);
  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panRef.current;
    const map = mm.maps[activeMap];
    if (drag === null || drag.pointerId !== event.pointerId || map === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - drag.x) * LAB_VIEWPORT.width / rect.width;
    const dy = (event.clientY - drag.y) * LAB_VIEWPORT.height / rect.height;
    panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    setCameras((current) => {
      const next = [...current];
      next[activeMap] = panLabCamera(current[activeMap] ?? camera, dx, dy, LAB_VIEWPORT, map);
      return next;
    });
  }, [activeMap, camera, mm.maps]);
  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const map = mm.maps[activeMap];
    if (map === undefined) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left) * LAB_VIEWPORT.width / rect.width,
      y: (event.clientY - rect.top) * LAB_VIEWPORT.height / rect.height,
    };
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
  }, [activeMap, camera, mm.maps]);

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
      ? "Planning is safe. Fog changes only after Dispense."
      : "Dose is travelling through the physical route."
    : lastOutcome.failed
      ? "Dose failed. The spent shot is not refunded."
      : lastOutcome.cured.length > 0
        ? `Validated cure ${lastOutcome.cured.join(", ")}. Ready for Pilot Plant.`
        : "Route completed without a cure.";

  return (
    <div className="game-view lab-workspace research-atlas" data-testid="research-atlas">
      <section className="world-viewport lab-world" aria-label="Research effect atlas">
        {rendererError !== null && <div role="alert" className="game-alert">{rendererError}</div>}
        <div className="lab-layer-tabs" role="tablist" aria-label="Effect atlas layers">
          {mm.maps.map((_map, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={activeMap === index}
              className={activeMap === index ? "is-active" : ""}
              onClick={() => setActiveMap(index)}
              data-testid={`lab-layer-${index}`}
            >
              <strong>{String.fromCharCode(65 + index)}</strong>
              <span>Layer {index + 1}</span>
            </button>
          ))}
        </div>
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
          <span className="lab-map-count" data-testid="map-count">{mm.maps.length} {mm.maps.length === 1 ? "map" : "maps"}</span>
          <span className="lab-seed" data-testid="level-info">seed {level.seed}</span>
          <strong data-testid="research-atlas-outcome">{outcomeText}</strong>
        </div>
      </section>
    </div>
  );
}
