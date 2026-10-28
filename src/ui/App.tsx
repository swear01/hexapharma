import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { CellKind } from "../sim/phase0_interfaces";
import type {
  DrugState,
  EffectMap,
  GeneratedLevel,
  MultiMap,
  Outcome,
  Vec2,
} from "../sim/phase0_interfaces";
import type { LabRenderer, ResearchDeviation } from "../render/labRenderer";
import { drugDrawPoint, type PixelPoint } from "../render/hexProjection";
import { hexInBounds, hexIndex } from "../sim/hex";
import {
  LAB_CELL_PIXELS,
  LAB_MIN_ZOOM,
  LAB_VIEWPORT,
  clampLabCamera,
  labCellCenter,
  focusLabCamera,
  labScreenToWorld,
  panLabCamera,
  zoomLabCameraAt,
  type LabCamera,
} from "../render/labCamera";
import { blockingDialogOpen } from "./blockingDialog";
import { TERRAIN_NOTES, diseaseName, outcomeEffectText } from "./effectLabels";

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
): "place" | "erase" | "inspect" | null {
  if (completion === "cancel") return null;
  if (moved) return null;
  if (button === 0) return candidateEndpointHit ? "place" : "inspect";
  if (button === 2) return "erase";
  return null;
}

/**
 * Room (CSS px) a cell note needs beside and above its cell before it would leave the frame; follows
 * `.research-cell-note` (260px wide, up to five 13px lines, padding, border, 20px offset).
 */
const NOTE_HALF_WIDTH = 140;
const NOTE_HEIGHT = 120;

/**
 * Which way a cell note hangs so the clipped map frame keeps it in view: below the cell near the
 * top, and anchored on its near side close to the left or right edge. `point` is in viewport
 * pixels, `visible` the visible viewport, `frame` the frame's CSS size.
 */
export function researchNotePlacement(
  point: PixelPoint,
  visible: { readonly width: number; readonly height: number },
  frame: { readonly width: number; readonly height: number },
): string {
  const x = (point.x - (LAB_VIEWPORT.width - visible.width) / 2) / visible.width * frame.width;
  const y = (point.y - (LAB_VIEWPORT.height - visible.height) / 2) / visible.height * frame.height;
  const vertical = y < NOTE_HEIGHT ? "is-below" : "is-above";
  let horizontal = "is-center";
  if (x < NOTE_HALF_WIDTH) horizontal = "is-left";
  else if (x > frame.width - NOTE_HALF_WIDTH) horizontal = "is-right";
  return `${vertical} ${horizontal}`;
}

/** What a clicked Atlas cell does, once revealed; null for plain ground, portals, fog or outside the map. */
export function researchCellNote(map: EffectMap, cell: Vec2): string | null {
  if (!hexInBounds(map.width, map.height, cell.q, cell.r)) return null;
  const index = hexIndex(map.width, cell.q, cell.r);
  if (map.fog[index] !== 1) return null;
  const note = ([name, meaning]: readonly [string, string]) => `${name}: ${meaning}`;
  switch (map.cell[index]) {
    case CellKind.Wall: return note(TERRAIN_NOTES.wall);
    case CellKind.Swamp: return note(TERRAIN_NOTES.marsh);
    case CellKind.Abyss: return note(TERRAIN_NOTES.abyss);
    case CellKind.SideEffect: return note(TERRAIN_NOTES.sideEffect);
    case CellKind.Cure: {
      const cureId = map.cureId[index];
      if (cureId === undefined || cureId < 0) return null;
      const parts = [diseaseName(cureId), `Tier ${map.cureTier[index] === 2 ? "2 ★" : "1"}`];
      if ((map.sideEffectId[index] ?? -1) >= 0) parts.push(TERRAIN_NOTES.sideEffect[0]);
      return parts.join(" · ");
    }
    default: return null;
  }
}

/**
 * True when the pointer's cell touches the drawn endpoint. A swamp half-step endpoint sits on the
 * edge between two cells, so either cell (hex distance ≤ ½ from the drawn point) counts.
 */
export function researchPreviewEndpointHit(
  pointerWorld: Vec2,
  endpoint: Vec2 | undefined,
): boolean {
  if (endpoint === undefined) return false;
  const dq = pointerWorld.q - endpoint.q;
  const dr = pointerWorld.r - endpoint.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) <= 0.5;
}

/** A run worth a readout: it failed, cured something or picked up a side effect. */
export function researchOutcomeNoteworthy(outcome: Outcome): boolean {
  return outcome.failed || outcome.cured.length > 0 || outcome.sideEffects.length > 0;
}

export function researchOutcomeText(lastOutcome: Outcome | null): string | null {
  return lastOutcome === null ? null : outcomeEffectText(lastOutcome);
}

/** Drawn point of a drug on one map: its cell plus half of its doubled-unit swamp offset. */
export const researchDrugPoint = drugDrawPoint;

/** True only when a new trial outcome arrived that cures something (fit the course once). */
export function researchTrialResolvedCure(previous: Outcome | null, next: Outcome | null): boolean {
  return next !== null && next !== previous && !next.failed && next.cured.length > 0;
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
  const candidate = previewDrug === undefined ? undefined : researchDrugPoint(previewDrug, mapIndex);
  if (candidate !== undefined) {
    return { label: "Next", position: candidate };
  }
  return { label: "Dose", position: researchDrugPoint(drug, mapIndex) };
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

const RESEARCH_PAN_BUTTONS = [
  { side: "up", dx: 0, dy: -1, rotate: 0 },
  { side: "left", dx: -1, dy: 0, rotate: -90 },
  { side: "right", dx: 1, dy: 0, rotate: 90 },
  { side: "down", dx: 0, dy: 1, rotate: 180 },
] as const;

interface AppProps {
  readonly active: boolean;
  readonly level: GeneratedLevel;
  readonly fog: readonly Uint8Array[];
  /** Actual drug after the last trial (or the start). */
  readonly drug: DrugState;
  /** Actual trail of the last trial (solid). */
  readonly trails: readonly (readonly (Vec2 | null)[])[];
  /** Map-0 trail index where each machine ends (a chevron per leg). */
  readonly legEnds?: readonly number[];
  /** Planned route on the known map (dashed). */
  readonly previewTrails?: readonly (readonly (Vec2 | null)[])[];
  readonly previewLegEnds?: readonly number[];
  readonly lineTrails?: readonly (readonly (Vec2 | null)[])[];
  readonly previewDrug?: DrugState;
  /** The preview is the estimate the last Run was planned on (faint). */
  readonly estimate?: boolean;
  readonly deviation?: ResearchDeviation | null;
  /** Planned step endpoints: the numbered controls. */
  readonly controls: readonly Vec2[];
  readonly lastOutcome: Outcome | null;
  /** Center the camera on this point whenever a new request arrives. */
  readonly focusRequest?: { readonly point: Vec2 } | null;
  /** Click on the last control. */
  readonly onWorldActivate?: () => void;
  readonly onWorldErase?: () => void;
}

export function App({
  active,
  level,
  fog,
  drug,
  trails,
  legEnds,
  previewTrails,
  previewLegEnds,
  lineTrails,
  previewDrug,
  estimate = false,
  deviation = null,
  controls,
  lastOutcome,
  focusRequest = null,
  onWorldActivate,
  onWorldErase,
}: AppProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<LabRenderer | null>(null);
  const visibleViewportRef = useRef<{ width: number; height: number }>(LAB_VIEWPORT);
  /** The map frame's CSS size, measured with the visible viewport. */
  const frameSizeRef = useRef<{ width: number; height: number }>(LAB_VIEWPORT);
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
  const planned = controls.length > 0 ? previewDrug : undefined;
  const view = useMemo(
    () => ({
      activeMap,
      camera,
      startHeading: start.heading,
      trail: trails[activeMap] ?? [],
      legEnds,
      previewTrail: planned === undefined ? undefined : previewTrails?.[activeMap],
      previewLegEnds,
      lineTrail: lineTrails?.[activeMap],
      previewDrug: estimate ? undefined : planned,
      estimate,
      deviation: deviation ?? undefined,
      controls,
    }),
    [activeMap, camera, controls, deviation, estimate, legEnds, lineTrails, planned, previewLegEnds, previewTrails, start.heading, trails],
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
  const focusTarget = researchFocusTarget(
    drug,
    planned,
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
      frameSizeRef.current = { width: visible.width, height: visible.height };
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

  // Only a trial that resolves a Cure fits its actual course; a stale outcome never moves the camera.
  const resolvedOutcomeRef = useRef(lastOutcome);
  useEffect(() => {
    const previous = resolvedOutcomeRef.current;
    resolvedOutcomeRef.current = lastOutcome;
    if (!researchTrialResolvedCure(previous, lastOutcome)) return;
    const map = mm.maps[activeMap];
    const canvasWidth = mountRef.current?.getBoundingClientRect().width ?? 0;
    if (map === undefined || canvasWidth === 0) return;
    const points: Vec2[] = [];
    for (const point of trails[activeMap] ?? []) if (point !== null) points.push(point);
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
  }, [activeMap, camera, cancelCameraEase, lastOutcome, mm.maps, trails]);

  const centerOn = useCallback((position: Vec2 | undefined) => {
    cancelCameraEase();
    const map = mm.maps[activeMap];
    if (position === undefined || map === undefined) return;
    setCameras((current) => {
      const next = [...current];
      next[activeMap] = clampLabCamera(focusLabCamera(position), visibleViewportRef.current, map);
      return next;
    });
  }, [activeMap, cancelCameraEase, mm.maps]);
  const focusResearch = useCallback(() => centerOn(focusTarget.position), [centerOn, focusTarget.position]);
  // Only a new request moves the camera, not a changed callback.
  const centerOnRef = useRef(centerOn);
  centerOnRef.current = centerOn;
  useEffect(() => {
    if (focusRequest !== null) centerOnRef.current(focusRequest.point);
  }, [focusRequest]);
  /** Move the view a third of the visible map toward a side (dx, dy in -1..1). */
  const panStep = useCallback((dx: number, dy: number) => {
    cancelCameraEase();
    const map = mm.maps[activeMap];
    if (map === undefined) return;
    const viewport = visibleViewportRef.current;
    setCameras((current) => {
      const next = [...current];
      next[activeMap] = panLabCamera(current[activeMap] ?? camera, -dx * viewport.width / 3, -dy * viewport.height / 3, viewport, map);
      return next;
    });
  }, [activeMap, camera, cancelCameraEase, mm.maps]);

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
  /** The revealed cell the player clicked and what it does. */
  const [cellNote, setCellNote] = useState<{ readonly cell: Vec2; readonly text: string } | null>(null);
  // A note belongs to the map it was read on: another base or a new reveal drops it.
  useEffect(() => setCellNote(null), [renderMap]);
  const notePoint = cellNote === null ? null : labCellCenter(camera, cellNote.cell);
  useEffect(() => {
    setEndpointHovered(false);
  }, [activeMap, camera.x, camera.y, camera.zoom, planned?.pos]);
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    cancelCameraEase();
    setCellNote(null);
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
      setEndpointHovered(researchPreviewEndpointHit(pointerWorld, planned === undefined ? undefined : researchDrugPoint(planned, activeMap)));
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
  }, [activeMap, camera, mm.maps, planned]);
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
    const candidateEndpoint = planned === undefined ? undefined : researchDrugPoint(planned, activeMap);
    const action = researchPointerAction(
      drag.button,
      drag.moved,
      researchPreviewEndpointHit(pointerWorld, candidateEndpoint),
      completion,
    );
    if (action === "place") onWorldActivate?.();
    else if (action === "erase") onWorldErase?.();
    else if (action === "inspect") {
      const map = renderMap.maps[activeMap];
      const text = map === undefined ? null : researchCellNote(map, pointerWorld);
      if (text !== null) setCellNote({ cell: pointerWorld, text });
    }
    setEndpointHovered(false);
  }, [activeMap, camera, onWorldActivate, onWorldErase, planned, renderMap]);
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
          data-revealed={revealed}
          data-plan-line={lineTrails?.[activeMap]?.length ?? 0}
          data-trail={view.trail.length}
          data-placement-target={endpointHovered}
          tabIndex={-1}
          title={endpointHovered ? "Remove last step" : undefined}
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
          {cellNote !== null && notePoint !== null && (
            <div className="lab-canvas-notes">
              <p
                className={`research-cell-note ${researchNotePlacement(notePoint, visibleViewportRef.current, frameSizeRef.current)}`}
                role="status"
                data-testid="research-cell-note"
                style={{
                  left: `${notePoint.x / LAB_VIEWPORT.width * 100}%`,
                  top: `${notePoint.y / LAB_VIEWPORT.height * 100}%`,
                }}
              >
                {cellNote.text}
              </p>
            </div>
          )}
        </div>
        <div className="research-atlas-status research-dpad" role="group" aria-label="Pan map">
          {RESEARCH_PAN_BUTTONS.map(({ side, dx, dy, rotate }) => (
            <button
              key={side}
              type="button"
              className={`research-dpad-${side}`}
              onClick={() => panStep(dx, dy)}
              data-testid={`lab-pan-${side}`}
              aria-label={`Pan ${side}`}
              title={`Pan ${side}`}
            >
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                <path d="M4 10l4-4 4 4" transform={`rotate(${rotate} 8 8)`} />
              </svg>
            </button>
          ))}
          <button
            type="button"
            className="research-dpad-center"
            onClick={focusResearch}
            data-testid="lab-focus"
            aria-label={`Focus ${focusDescription}`}
            title={`Focus ${focusDescription} (F)`}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <circle cx="8" cy="8" r="2.5" />
            </svg>
          </button>
        </div>
      </section>
    </div>
  );
}
