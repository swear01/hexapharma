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
  labScreenToWorld,
  panLabCamera,
  zoomLabCameraAt,
  type LabCamera,
} from "../render/labCamera";
import { outcomeEffectText } from "./effectLabels";

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
  candidateEndpointHit: boolean,
  completion: "commit" | "cancel",
): "place" | "erase" | null {
  if (completion === "cancel") return null;
  if (moved) return null;
  if (button === 0 && candidateEndpointHit) return "place";
  if (button === 2) return "erase";
  return null;
}

export function researchPreviewEndpointHit(
  pointerWorld: Vec2,
  endpoint: Vec2 | undefined,
): boolean {
  if (endpoint === undefined) return false;
  const dx = pointerWorld.x - (endpoint.x + 0.5);
  const dy = pointerWorld.y - (endpoint.y + 0.5);
  return dx * dx + dy * dy <= 0.55 * 0.55;
}

export function researchOutcomeText(
  lastOutcome: Outcome | null,
  shotStep: number | null,
): string | null {
  if (lastOutcome === null) return shotStep === null ? null : `Step ${shotStep + 1}`;
  return outcomeEffectText(lastOutcome);
}

export interface ResearchFocusTarget {
  readonly label: "Next" | "Dose";
  readonly position: Vec2 | undefined;
}

export function researchFocusTarget(
  drug: DrugState,
  previewDrug: DrugState | undefined,
  mapIndex: number,
  focusDose: boolean,
): ResearchFocusTarget {
  const candidate = previewDrug?.pos[mapIndex];
  if (!focusDose && candidate !== undefined) {
    return { label: "Next", position: candidate };
  }
  return { label: "Dose", position: drug.pos[mapIndex] };
}

export function researchKnownCureCount(
  mm: MultiMap,
  fog: readonly Uint8Array[],
): number {
  return researchKnownCureLocations(mm, fog).length;
}

export function researchKnownCureLabel(count: number): string {
  return `Cure sites ${count}`;
}

export interface KnownCureLocation {
  readonly mapIndex: number;
  readonly cureId: number;
  readonly pos: Vec2;
}

export function researchKnownCureLocations(
  mm: MultiMap,
  fog: readonly Uint8Array[],
): readonly KnownCureLocation[] {
  const known = new Set<number>();
  const locations: KnownCureLocation[] = [];
  for (let mapIndex = 0; mapIndex < mm.maps.length; mapIndex++) {
    const map = mm.maps[mapIndex];
    const layer = fog[mapIndex];
    if (map === undefined || layer === undefined || layer.length !== map.cureId.length) {
      throw new Error("Research cure count requires matching Atlas fog");
    }
    for (let index = 0; index < map.cureId.length; index++) {
      const cure = map.cureId[index];
      if (layer[index] !== 1 || cure === undefined || cure < 0 || known.has(cure)) continue;
      known.add(cure);
      locations.push({
        mapIndex,
        cureId: cure,
        pos: { x: index % map.width, y: Math.floor(index / map.width) },
      });
    }
  }
  return locations;
}

export function researchPointerMoved(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
): boolean {
  return Math.hypot(clientX - startX, clientY - startY) >= 6;
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
  const knownCures = useMemo(() => researchKnownCureLocations(mm, fog), [fog, mm]);
  const cureFocusIndexRef = useRef(0);
  const focusTarget = researchFocusTarget(
    drug,
    previewDrug,
    activeMap,
    shotStep !== null,
  );
  const focusDescription = focusTarget.label === "Next" ? "next endpoint" : "dose";

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

  const focusResearch = useCallback(() => {
    const position = focusTarget.position;
    const map = mm.maps[activeMap];
    if (position === undefined || map === undefined) return;
    setCameras((current) => {
      const next = [...current];
      next[activeMap] = clampLabCamera(focusLabCamera(position), LAB_VIEWPORT, map);
      return next;
    });
  }, [activeMap, focusTarget.position, mm.maps]);

  const focusKnownCure = useCallback(() => {
    if (knownCures.length === 0) return;
    const index = cureFocusIndexRef.current % knownCures.length;
    const target = knownCures[index]!;
    const map = mm.maps[target.mapIndex];
    if (map === undefined) return;
    cureFocusIndexRef.current = (index + 1) % knownCures.length;
    setCameras((current) => {
      const next = [...current];
      next[target.mapIndex] = clampLabCamera(
        focusLabCamera(target.pos),
        LAB_VIEWPORT,
        map,
      );
      return next;
    });
  }, [knownCures, mm.maps]);

  useEffect(() => {
    if (shotStep === null && lastOutcome === null) return;
    const position = drug.pos[activeMap];
    const map = mm.maps[activeMap];
    if (position === undefined || map === undefined) return;
    setCameras((current) => {
      const next = [...current];
      const previous = current[activeMap] ?? focusLabCamera(position);
      next[activeMap] = clampLabCamera({
        x: position.x + 0.5,
        y: position.y + 0.5,
        zoom: previous.zoom,
      }, LAB_VIEWPORT, map);
      return next;
    });
  }, [activeMap, drug.pos, lastOutcome, mm.maps, shotStep]);

  const panRef = useRef<{
    readonly pointerId: number;
    readonly button: number;
    readonly startX: number;
    readonly startY: number;
    readonly x: number;
    readonly y: number;
    readonly moved: boolean;
  } | null>(null);
  const [endpointHovered, setEndpointHovered] = useState(false);
  useEffect(() => {
    setEndpointHovered(false);
  }, [activeMap, camera.x, camera.y, camera.zoom, previewDrug?.pos]);
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
    const rect = mountRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    if (drag === null) {
      const viewportPoint = labPointerToViewport(event.clientX, event.clientY, rect);
      const pointerWorld = labScreenToWorld(camera, LAB_VIEWPORT, viewportPoint);
      setEndpointHovered(researchPreviewEndpointHit(pointerWorld, previewDrug?.pos[activeMap]));
      return;
    }
    setEndpointHovered(false);
    if (drag.pointerId !== event.pointerId || map === undefined) return;
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
  }, [activeMap, camera, mm.maps, previewDrug?.pos]);
  const finishPointer = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    completion: "commit" | "cancel",
  ) => {
    const drag = panRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    panRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const rect = mountRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const viewportPoint = labPointerToViewport(event.clientX, event.clientY, rect);
    const pointerWorld = labScreenToWorld(camera, LAB_VIEWPORT, viewportPoint);
    const candidateEndpoint = previewDrug?.pos[activeMap];
    const action = researchPointerAction(
      drag.button,
      drag.moved,
      researchPreviewEndpointHit(pointerWorld, candidateEndpoint),
      completion,
    );
    if (action === "place") onWorldActivate?.();
    else if (action === "erase") onWorldErase?.();
    setEndpointHovered(false);
  }, [activeMap, camera, onWorldActivate, onWorldErase, previewDrug?.pos]);
  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
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
  }, [activeMap, camera, mm.maps]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="alertdialog"][aria-modal="true"]') !== null) return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        focusResearch();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, focusResearch]);

  const outcomeText = researchOutcomeText(lastOutcome, shotStep);

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
          data-placement-target={endpointHovered}
          title={endpointHovered ? "Place next path" : "Drag map"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => {
            if (panRef.current === null) setEndpointHovered(false);
          }}
          onPointerUp={(event) => finishPointer(event, "commit")}
          onPointerCancel={(event) => finishPointer(event, "cancel")}
          onContextMenu={(event) => event.preventDefault()}
          onWheel={onWheel}
        >
          <div ref={mountRef} data-testid="lab-canvas" className="lab-canvas" />
        </div>
        <div className="transport-bar research-atlas-status">
          <button
            type="button"
            onClick={focusResearch}
            data-testid="lab-focus"
            aria-label={`Focus ${focusDescription}`}
            title={`Focus ${focusDescription}`}
          >
            <span aria-hidden="true">◎</span><span className="lab-focus-label">{focusTarget.label}</span><kbd>F</kbd>
          </button>
          <output data-testid="lab-zoom">{Math.round(camera.zoom * 100)}%</output>
          <span data-testid="revealed-count">revealed {revealed}/{total}</span>
          <button
            type="button"
            className="research-cure-count"
            data-testid="research-cures"
            disabled={knownCures.length === 0}
            onClick={focusKnownCure}
            aria-label="Focus next discovered Cure site"
            title="Focus next discovered Cure site"
          >
            {researchKnownCureLabel(knownCures.length)}
          </button>
          {outcomeText !== null && <strong data-testid="research-atlas-outcome">{outcomeText}</strong>}
        </div>
      </section>
    </div>
  );
}
