import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import type {
  DrugState,
  EffectMap,
  GeneratedLevel,
  MultiMap,
  Outcome,
  Template,
  Vec2,
} from "../sim/phase0_interfaces";
import { previewStep } from "../sim/drug-graph";
import type { LabRenderer } from "../render/labRenderer";
import type { PixelPoint } from "../render/hexProjection";
import {
  LAB_CELL_PIXELS,
  LAB_MIN_ZOOM,
  LAB_VIEWPORT,
  clampLabCamera,
  focusLabCamera,
  labScreenToWorld,
  panLabCamera,
  zoomLabCameraAt,
  type LabCamera,
} from "../render/labCamera";
import { blockingDialogOpen } from "./blockingDialog";
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
): PixelPoint {
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
  return endpoint !== undefined && pointerWorld.q === endpoint.q && pointerWorld.r === endpoint.r;
}

export function researchOutcomeText(lastOutcome: Outcome | null): string | null {
  return lastOutcome === null ? null : outcomeEffectText(lastOutcome);
}

/** Endpoint of each executed step from the run start: the numbered controls of the course. */
export function researchControlPoints(
  mm: MultiMap,
  start: DrugState,
  program: Template,
  mapIndex: number,
): readonly Vec2[] {
  const controls: Vec2[] = [];
  let drug = start;
  for (const machine of program.steps) {
    drug = previewStep(mm, drug, machine).next;
    const position = drug.pos[mapIndex];
    if (position !== undefined) controls.push(position);
    if (drug.failed) break;
  }
  return controls;
}

/** True only when `next` is `previous` plus one freshly resolved step (or the first step of a new run). */
export function researchStepResolved(previous: Template, next: Template): boolean {
  if (next === previous || next.steps.length === 0) return false;
  if (next.steps.length === 1) return true;
  return next.steps.length === previous.steps.length + 1
    && previous.steps.every((step, index) => step.typeId === next.steps[index]?.typeId);
}

export interface LabFitInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Camera that shows every point inside the visible viewport minus insets (logical pixels). It never
 * zooms in; a course too long for minimum zoom keeps its longest tail ending at the last point.
 */
export function researchFitCamera(
  points: readonly Vec2[],
  viewport: { readonly width: number; readonly height: number },
  insets: LabFitInsets,
  current: LabCamera,
  map: { readonly width: number; readonly height: number },
): LabCamera {
  const availableWidth = Math.max(1, viewport.width - insets.left - insets.right);
  const availableHeight = Math.max(1, viewport.height - insets.top - insets.bottom);
  const fit = (subset: readonly Vec2[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of subset) {
      const projected = focusLabCamera(point);
      minX = Math.min(minX, projected.x);
      minY = Math.min(minY, projected.y);
      maxX = Math.max(maxX, projected.x);
      maxY = Math.max(maxY, projected.y);
    }
    const zoom = Math.min(
      current.zoom,
      availableWidth / (maxX - minX + LAB_CELL_PIXELS * 2),
      availableHeight / (maxY - minY + LAB_CELL_PIXELS * 2),
    );
    return { zoom, x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  };
  // Too long to fit at minimum zoom: keep the longest tail of the course that ends at the finish.
  let first = 0;
  let target = fit(points);
  while (target.zoom < LAB_MIN_ZOOM && first < points.length - 1) target = fit(points.slice(++first));
  const zoom = Math.max(LAB_MIN_ZOOM, target.zoom);
  return clampLabCamera({
    x: target.x - (insets.left - insets.right) / 2 / zoom,
    y: target.y - (insets.top - insets.bottom) / 2 / zoom,
    zoom,
  }, viewport, map);
}

/** Clearance (CSS px) for the step list, result card and status row around a Cure fit. */
function researchFitInsets(compact: boolean): LabFitInsets {
  return compact
    ? { top: 72, right: 16, bottom: 250, left: 16 }
    : { top: 24, right: 348, bottom: 72, left: 260 };
}

export interface ResearchFocusTarget {
  readonly label: "Next" | "Dose";
  readonly position: Vec2 | undefined;
}

export function researchFocusTarget(
  drug: DrugState,
  previewDrug: DrugState | undefined,
  mapIndex: number,
): ResearchFocusTarget {
  const candidate = previewDrug?.pos[mapIndex];
  if (candidate !== undefined) {
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
        pos: { q: index % map.width, r: Math.floor(index / map.width) },
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
  readonly program: Template;
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
  program,
  lastOutcome,
  onWorldActivate,
  onWorldErase,
}: AppProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);
  const visibleViewportRef = useRef<{ width: number; height: number }>(LAB_VIEWPORT);
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
  const camera = cameras[activeMap] ?? focusLabCamera(drug.pos[activeMap] ?? { q: 0, r: 0 });
  const controls = useMemo(
    () => researchControlPoints(mm, start, program, activeMap),
    [activeMap, mm, program, start],
  );
  const finish = lastOutcome !== null && lastOutcome.cured.length > 0;
  const view = useMemo(
    () => ({
      activeMap,
      camera,
      trail: trails[activeMap] ?? [],
      previewTrail: previewTrails?.[activeMap],
      previewDrug,
      controls,
      finish,
    }),
    [activeMap, camera, controls, finish, previewDrug, previewTrails, trails],
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
    const mount = mountRef.current;
    const frame = mount?.parentElement;
    if (mount === null || frame === undefined || frame === null) return;
    const observer = new ResizeObserver(() => {
      const canvas = mount.getBoundingClientRect();
      const visible = frame.getBoundingClientRect();
      if (canvas.width === 0 || canvas.height === 0 || visible.width === 0 || visible.height === 0) return;
      const viewport = {
        width: LAB_VIEWPORT.width * Math.min(1, visible.width / canvas.width),
        height: LAB_VIEWPORT.height * Math.min(1, visible.height / canvas.height),
      };
      visibleViewportRef.current = viewport;
      setCameras((current) => current.map((camera, index) => clampLabCamera(camera, viewport, mm.maps[index]!)));
    });
    observer.observe(mount);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [mm]);

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

  const cameraEaseRef = useRef(0);
  const cancelCameraEase = useCallback(() => {
    if (cameraEaseRef.current !== 0) cancelAnimationFrame(cameraEaseRef.current);
    cameraEaseRef.current = 0;
  }, []);
  useEffect(() => cancelCameraEase, [cancelCameraEase]);

  // Only the step that resolves a Cure fits the printed course; a stale outcome never moves the camera.
  const resolvedProgramRef = useRef(program);
  useEffect(() => {
    const previous = resolvedProgramRef.current;
    resolvedProgramRef.current = program;
    if (!researchStepResolved(previous, program) || lastOutcome === null || lastOutcome.cured.length === 0) return;
    const map = mm.maps[activeMap];
    const canvasWidth = mountRef.current?.getBoundingClientRect().width ?? 0;
    if (map === undefined || canvasWidth === 0) return;
    const points: Vec2[] = [];
    for (const point of trails[activeMap] ?? []) if (point !== null) points.push(point);
    const finishControl = controls.at(-1);
    if (finishControl !== undefined) points.push(finishControl);
    const scale = LAB_VIEWPORT.width / canvasWidth;
    const css = researchFitInsets(window.matchMedia("(max-width: 768px)").matches);
    const target = researchFitCamera(points, visibleViewportRef.current, {
      top: css.top * scale,
      right: css.right * scale,
      bottom: css.bottom * scale,
      left: css.left * scale,
    }, camera, map);
    cancelCameraEase();
    const setCamera = (next: LabCamera) => setCameras((current) => {
      const cameras = [...current];
      cameras[activeMap] = next;
      return cameras;
    });
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCamera(target);
      return;
    }
    const from = camera;
    let startTime = -1;
    const step = (now: number) => {
      if (startTime < 0) startTime = now;
      const t = Math.min(1, (now - startTime) / 220);
      const k = t >= 1 ? 1 : 1 - 2 ** (-10 * t);
      setCamera(t >= 1 ? target : {
        x: from.x + (target.x - from.x) * k,
        y: from.y + (target.y - from.y) * k,
        zoom: from.zoom + (target.zoom - from.zoom) * k,
      });
      cameraEaseRef.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    cameraEaseRef.current = requestAnimationFrame(step);
  }, [activeMap, camera, cancelCameraEase, controls, lastOutcome, mm.maps, program, trails]);

  const focusResearch = useCallback(() => {
    cancelCameraEase();
    const position = focusTarget.position;
    const map = mm.maps[activeMap];
    if (position === undefined || map === undefined) return;
    setCameras((current) => {
      const next = [...current];
      next[activeMap] = clampLabCamera(focusLabCamera(position), visibleViewportRef.current, map);
      return next;
    });
  }, [activeMap, cancelCameraEase, focusTarget.position, mm.maps]);

  const focusKnownCure = useCallback(() => {
    if (knownCures.length === 0) return;
    cancelCameraEase();
    const index = cureFocusIndexRef.current % knownCures.length;
    const target = knownCures[index]!;
    const map = mm.maps[target.mapIndex];
    if (map === undefined) return;
    cureFocusIndexRef.current = (index + 1) % knownCures.length;
    setCameras((current) => {
      const next = [...current];
      next[target.mapIndex] = clampLabCamera(
        focusLabCamera(target.pos),
        visibleViewportRef.current,
        map,
      );
      return next;
    });
  }, [cancelCameraEase, knownCures, mm.maps]);

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
    cancelCameraEase();
    event.preventDefault();
    event.currentTarget.focus();
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
  }, [cancelCameraEase]);
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
      next[activeMap] = panLabCamera(current[activeMap] ?? camera, dx, dy, visibleViewportRef.current, map);
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
    cancelCameraEase();
    event.preventDefault();
    const rect = mountRef.current?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
    const point = labPointerToViewport(event.clientX, event.clientY, rect);
    const viewport = visibleViewportRef.current;
    setCameras((current) => {
      const next = [...current];
      const previous = current[activeMap] ?? camera;
      next[activeMap] = zoomLabCameraAt(
        previous,
        previous.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
        {
          x: point.x - (LAB_VIEWPORT.width - viewport.width) / 2,
          y: point.y - (LAB_VIEWPORT.height - viewport.height) / 2,
        },
        viewport,
        map,
      );
      return next;
    });
  }, [activeMap, camera, cancelCameraEase, mm.maps]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (blockingDialogOpen()) return;
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
          tabIndex={-1}
          title={endpointHovered ? "Run step" : "Drag map"}
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
            <svg className="lab-focus-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <circle cx="8" cy="8" r="5" />
              <path d="M8 0v4M8 12v4M0 8h4M12 8h4" />
            </svg>
            <span className="lab-focus-label">{focusTarget.label}</span><kbd>F</kbd>
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
        </div>
      </section>
    </div>
  );
}
