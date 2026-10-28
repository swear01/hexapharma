import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiseaseId,
  FactoryLayout,
  GameState,
  GeneratedLevel,
  GenOptions,
  DrugState,
  EffectMap,
  Machine,
  MultiMap,
  Template,
  Vec2,
} from "../sim/phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  CellKind,
  DEFAULT_CATALOG,
  MAX_TEMPLATE_STEPS,
} from "../sim/phase0_interfaces";
import { atlasContains, generate } from "../sim/mapgen";
import { baseView, initialState, previewStep } from "../sim/drug-graph";
import { hexDistance, hexIndex } from "../sim/hex";
import { serializeSnapshot } from "../sim/save";
import {
  applyGameIntent,
  availableCatalog,
  BASE_NAMES,
  baseAvailable,
  createGameState,
  DEFAULT_STARTING_CASH,
  shippingContracts,
  type GameIntent,
} from "../sim/game";
import { activeEffects, DEFAULT_PATENTS } from "../sim/patent";
import { quoteProductionBuild } from "../sim/construction";
import { BlueprintLibrary } from "./BlueprintLibrary";
import { Factory, factoryLineProgram } from "./Factory";
import { Patents } from "./Patents";
import { Shop } from "./Shop";
import { blockingDialogOpen } from "./blockingDialog";
import { hexToPixel } from "../render/hexProjection";
import type { ResearchDeviation } from "../render/labRenderer";
import { machineName } from "./machineLabels";
import { ResearchWorkspace, researchMachineCost } from "./ResearchWorkspace";
import { researchDrugPoint, researchKnownCureLocations } from "./App";
import { FieldGuide } from "./FieldGuide";
import { currentObjective, type ObjectiveTarget } from "./objective";
import { profitableMarketProducts } from "./Shop";
import {
  readSlot,
  recoverSlot,
  rewindSlot,
  saveSlot,
  type SlotRead,
  type SlotRecovery,
} from "./checkpointStorage";

const SAVE_SLOTS = 3;
const LAB_WORLD_SIZE = 49;
/** Shared empty plan: a loaded game shows its last trial until the plan is edited. */
const NO_RESEARCH_PLAN: readonly Machine[] = [];

/** The one-map level Research shows for `base`: a drug lives on one base. */
export function researchBaseLevel(level: GeneratedLevel, base: number): GeneratedLevel {
  const mm = baseView(level.mm, base);
  return { ...level, mm, start: initialState(mm) };
}

export function researchPlanningMap(
  mm: MultiMap,
  fog: readonly Uint8Array[],
): MultiMap {
  return {
    maps: mm.maps.map((map, mapIndex) => {
      const known = fog[mapIndex];
      if (known === undefined || known.length !== map.cell.length) {
        throw new Error("research planning: fog does not match the Atlas");
      }
      const cell = Uint8Array.from(map.cell);
      const cureId = Int16Array.from(map.cureId);
      const cureTier = Uint8Array.from(map.cureTier);
      const regionId = Uint16Array.from(map.regionId);
      const sideEffectId = Int32Array.from(map.sideEffectId);
      const portalTo = Int32Array.from(map.portalTo);
      for (let index = 0; index < cell.length; index++) {
        // Unrevealed ground plans as open floor (mountains included): only the Atlas outline is known.
        if (known[index] !== 1 && atlasContains(map, index % map.width, Math.floor(index / map.width))) {
          cell[index] = CellKind.Empty;
          cureId[index] = -1;
          cureTier[index] = 0;
          regionId[index] = 0;
          sideEffectId[index] = -1;
          portalTo[index] = -1;
        }
      }
      for (let index = 0; index < cell.length; index++) {
        if (cell[index] !== CellKind.Portal) continue;
        const destination = portalTo[index] ?? -1;
        if (
          known[index] !== 1 ||
          destination < 0 ||
          destination >= known.length ||
          known[destination] !== 1
        ) {
          cell[index] = CellKind.Empty;
          portalTo[index] = -1;
        }
      }
      return { ...map, cell, cureId, cureTier, regionId, sideEffectId, portalTo, fog: known };
    }),
  };
}

export interface ResearchRoute {
  /** Per map: drawn points (cell + half the swamp offset), with `null` breaks at portal jumps. */
  readonly trails: readonly (readonly (Vec2 | null)[])[];
  /** Drug after the last executed step. */
  readonly drug: DrugState;
  /** Map-0 point after each executed step: the controls of the course. */
  readonly controls: readonly Vec2[];
  /** Map-0 trail index where each executed step ends. */
  readonly legEnds: readonly number[];
}

/** Run `program` (up to `limit` steps) on `mm` and collect the drawn route. */
export function researchRoute(
  mm: MultiMap,
  start: DrugState,
  program: Template,
  limit = program.steps.length,
): ResearchRoute {
  const trails: (Vec2 | null)[][] = mm.maps.map((_map, index) => {
    const point = researchDrugPoint(start, index);
    return point === undefined ? [] : [point];
  });
  const controls: Vec2[] = [];
  const legEnds: number[] = [];
  let drug = start;
  for (let step = 0; step < Math.min(limit, program.steps.length); step++) {
    const machine = program.steps[step];
    if (machine === undefined || drug.failed) break;
    const preview = previewStep(mm, drug, machine);
    for (let mapIndex = 0; mapIndex < trails.length; mapIndex++) {
      const map = mm.maps[mapIndex];
      const cells = preview.trails[mapIndex] ?? [];
      const points = preview.points[mapIndex] ?? [];
      let previous = drug.pos[mapIndex];
      for (let index = 0; index < cells.length; index++) {
        const cell = cells[index]!;
        const point = points[index]!;
        if (previous !== undefined && map !== undefined) {
          const previousKind = map.cell[hexIndex(map.width, previous.q, previous.r)];
          const jumped = hexDistance(previous.q, previous.r, cell.q, cell.r) > 1;
          if (previousKind === CellKind.Portal || jumped) trails[mapIndex]!.push(null);
        }
        trails[mapIndex]!.push({ q: point.q / 2, r: point.r / 2 });
        previous = cell;
      }
    }
    drug = preview.next;
    const control = researchDrugPoint(drug, 0);
    if (control !== undefined) controls.push(control);
    legEnds.push((trails[0]?.length ?? 0) - 1);
  }
  return { trails, drug, controls, legEnds };
}

/** The planned route traversed on the known (fog-masked) map. */
export function researchPlanningPreview(
  mm: MultiMap,
  fog: readonly Uint8Array[],
  start: DrugState,
  program: Template,
): ResearchRoute {
  return researchRoute(researchPlanningMap(mm, fog), start, program);
}

export function researchPlanningTrails(
  mm: MultiMap,
  fog: readonly Uint8Array[],
  start: DrugState,
  program: Template,
): readonly (readonly (Vec2 | null)[])[] {
  return researchPlanningPreview(mm, fog, start, program).trails;
}

export interface ResearchPlanDeviation extends ResearchDeviation {
  /** Index into `program.steps` of the step that left the estimate. */
  readonly step: number;
}

/** First place a Run left the estimate planned on `known`, and the true terrain that moved it. */
export function researchDeviation(
  mm: MultiMap,
  known: MultiMap,
  start: DrugState,
  program: Template,
): ResearchPlanDeviation | null {
  const map = mm.maps[0]!;
  const knownMap = known.maps[0]!;
  const kind = (target: EffectMap, cell: Vec2) => target.cell[hexIndex(target.width, cell.q, cell.r)];
  let actual = start;
  let estimate = start;
  for (const [step, machine] of program.steps.entries()) {
    if (actual.failed || estimate.failed) return null;
    const from = actual.pos[0]!;
    const real = previewStep(mm, actual, machine);
    const planned = previewStep(known, estimate, machine);
    const realPoints = real.points[0]!;
    const plannedPoints = planned.points[0]!;
    const realCells = real.trails[0]!;
    for (let index = 0; index < Math.max(realPoints.length, plannedPoints.length); index++) {
      const a = realPoints[index];
      const e = plannedPoints[index];
      if (a !== undefined && e !== undefined && a.q === e.q && a.r === e.r) continue;
      const before = index === 0 ? from : realCells[index - 1]!;
      if (a === undefined && real.next.failed) return { step, pos: before, reason: "Abyss" };
      if (kind(map, before) === CellKind.Swamp && kind(knownMap, before) !== CellKind.Swamp) {
        return { step, pos: before, reason: "Swamp" };
      }
      const blocked = planned.trails[0]![index];
      if (blocked !== undefined && kind(map, blocked) === CellKind.Wall) return { step, pos: blocked, reason: "Wall" };
      return null;
    }
    if (real.next.failed && !planned.next.failed) return { step, pos: realCells.at(-1) ?? from, reason: "Abyss" };
    actual = real.next;
    estimate = planned.next;
  }
  return null;
}

/** Steps a deviated plan keeps: the blind tail goes; the deviating step stays unless Abyss ended the drug there. */
export function researchKeptSteps(deviation: ResearchPlanDeviation): number {
  return deviation.step + (deviation.reason === "Abyss" ? 0 : 1);
}

export type ResearchKeyAction = "run" | "undo";

export function researchKeyboardAction(key: string, modifier = false): ResearchKeyAction | null {
  if (key === "Enter" && !modifier) return "run";
  if (key === "Backspace" && !modifier) return "undo";
  if (modifier && key.toLowerCase() === "z") return "undo";
  return null;
}

export function researchAssaySector(start: Vec2, target: Vec2): string {
  const q = target.q - start.q;
  const r = target.r - start.r;
  if (q === 0 && r === 0) return "local";
  const projected = hexToPixel(q, r, 1);
  const direction = ((Math.round(Math.atan2(projected.y, projected.x) / (Math.PI / 3)) % 6) + 6) % 6;
  return ["east", "south-east", "south-west", "west", "north-west", "north-east"][direction]!;
}

export function researchProgramCost(program: Template): number {
  let total = 0;
  for (const step of program.steps) total += researchMachineCost(step.typeId);
  return total;
}

export function researchRunBlockReason(cash: number, plan: Template): string | null {
  if (plan.steps.length === 0) return "Add a machine to plan a route.";
  const cost = researchProgramCost(plan);
  return cash < cost ? `Need $${cost} to run this route.` : null;
}

export function researchTrailsForProgram(
  mm: MultiMap,
  start: DrugState,
  program: Template,
  completedSteps: number,
): readonly (readonly (Vec2 | null)[])[] {
  return researchRoute(mm, start, program, completedSteps).trails;
}

export function defaultGenOptions(seed: number): GenOptions {
  return {
    seed,
    nMaps: 1,
    width: LAB_WORLD_SIZE,
    height: LAB_WORLD_SIZE,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 6,
    difficulty: { min: 4, max: 12 },
  };
}

function queryInt(
  name: string,
  fallback: number,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof window === "undefined") return fallback;
  const raw = new URLSearchParams(window.location.search).get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
}

function initialGenOptions(): GenOptions {
  const requestedSeed = queryInt("seed", 14);
  const seed = requestedSeed >= 0 && requestedSeed <= 0xffff_ffff ? requestedSeed : 14;
  return defaultGenOptions(seed);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function playerFacingIntentError(error: unknown): string {
  const message = errorMessage(error);
  const machineFailure = /^game intent: machine "([^"]+)" (is locked|path does not match catalog|definition does not match catalog)$/u.exec(message);
  if (machineFailure !== null) {
    const typeId = machineFailure[1];
    const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
    if (entry === undefined) return "This Blueprint uses an unknown machine.";
    if (machineFailure[2] === "is locked") {
      return `${machineName(entry.typeId)} is off. Turn it on in Technology.`;
    }
    return machineFailure[2] === "path does not match catalog"
      ? `${machineName(entry.typeId)} has an incompatible Blueprint path.`
      : `${machineName(entry.typeId)} has incompatible layout data.`;
  }
  const machinePlacement = /^game intent: machine \d+ (.+)$/u.exec(message)?.[1];
  if (machinePlacement !== undefined) {
    const placementMessages: Readonly<Record<string, string>> = {
      "placement is invalid": "Machine placement is invalid.",
      "shape or port count exceeds bounds": "Machine footprint or ports are outside the factory.",
      "footprint is out of bounds": "Machine footprint is outside the factory.",
      "footprint overlaps another machine": "Machine footprint overlaps another machine.",
      "footprint must cover only empty tiles": "Machine footprint must cover empty floor.",
    };
    return placementMessages[machinePlacement] ?? "Machine layout is invalid.";
  }
  const researchCash = /^game intent: Research trial requires (\d+) cash$/u.exec(message)?.[1];
  if (researchCash !== undefined) return `Need $${researchCash} to run this route.`;
  const productionCash = /^game intent: Production construction requires (\d+) cash$/u.exec(message)?.[1];
  if (productionCash !== undefined) return `Need $${productionCash} to build in Production.`;
  if (/^game intent: product \d+ is duplicated, unavailable, or not a cure$/u.test(message)) {
    return "That product is no longer available to ship.";
  }
  if (/^game intent: (?:factory (?:tile|splitter|merger) \d+|duplicate factory machine id \d+)/u.test(message)) {
    return "Factory layout is invalid.";
  }
  if (/^game intent: sale references unknown disease \d+$/u.test(message)) {
    return "That market is unavailable.";
  }
  if (/^game intent: unknown patent /u.test(message)) return "That Technology is unavailable.";
  if (/^game intent: Technology "[^"]+" is still in use/u.test(message)) {
    return "Still in use · remove it from Plan and Production first.";
  }
  const reason = /^game intent: (.+)$/u.exec(message)?.[1];
  return reason === undefined ? message : reason.charAt(0).toUpperCase() + reason.slice(1);
}

export function transientSaveMessage(message: string): boolean {
  return /^(?:Started|Saved|Loaded|Rewound|Recovered|No save found|Nothing to rewind)\b/u.test(message);
}

export function parseNewGameSeed(value: string): number | null {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) return null;
  const seed = Number(value);
  return Number.isSafeInteger(seed) && seed <= 0xffff_ffff ? seed : null;
}

type Building = "research" | "pilot" | "production";

/** Top-bar drawer icons, drawn as legend ink: a shipping crate, a branch, a ruled sheet, a menu. */
function HudGlyph({ kind }: { readonly kind: "market" | "technology" | "blueprints" | "menu" }) {
  return (
    <svg className="hud-glyph" viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      {kind === "market" && <path d="M2.5 6.5h13v9h-13zM1.5 3h15v3.5h-15zM7 9.5h4" />}
      {kind === "technology" && <><path d="M4.8 9h2.7m0 0 4-4.5h1.7M7.5 9l4 4.5h1.7" /><circle cx="3" cy="9" r="1.8" /><circle cx="15" cy="4.5" r="1.8" /><circle cx="15" cy="13.5" r="1.8" /></>}
      {kind === "blueprints" && <path d="M3 2.5h12v13H3zM3 7h12M3 11h12M7.5 2.5v13" />}
      {kind === "menu" && <path d="M2.5 4.5h13M2.5 9h13M2.5 13.5h13" />}
    </svg>
  );
}

function objectiveIsHere(target: ObjectiveTarget, building: Building, drawer: string | null): boolean {
  return target === "market" || target === "technology" ? drawer === target : drawer === null && building === target;
}
type Drawer = "market" | "technology" | "blueprints" | "menu" | "help" | null;
type PendingSaveAction =
  | {
      readonly kind: "load";
      readonly slot: number;
      readonly head: GameState;
      readonly historyCount: number;
      readonly recovery: SlotRecovery | null;
    }
  | {
      readonly kind: "rewind";
      readonly slot: number;
      readonly history: readonly GameState[];
    };

function sameGameState(first: GameState, second: GameState): boolean {
  return first === second || serializeSnapshot(first) === serializeSnapshot(second);
}

export function Game() {
  const [building, setBuilding] = useState<Building>("research");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const worldInputActive = drawer === null;
  const [visited, setVisited] = useState<Record<Building, boolean>>({
    research: true,
    pilot: false,
    production: false,
  });
  const openBuilding = useCallback((next: Building) => {
    setVisited((current) => current[next] ? current : { ...current, [next]: true });
    setBuilding(next);
    setDrawer(null);
  }, []);

  const [game, setGame] = useState<GameState>(() =>
    createGameState(
      initialGenOptions(),
      queryInt("cash", DEFAULT_STARTING_CASH),
    ),
  );
  const gameRef = useRef(game);
  const [intentError, setIntentError] = useState("");
  const selectedSlotRef = useRef(0);
  const initialSlot = useMemo(() => readSlot(localStorage, 0), []);
  const [historyCount, setHistoryCount] = useState(() => initialSlot.history?.length ?? 0);
  const [saveMsg, setSaveMsg] = useState(() => initialSlot.error ?? initialSlot.notice ?? "");
  const [slotRecovery, setSlotRecovery] = useState<SlotRecovery | null>(() => initialSlot.recovery);
  const [canRecover, setCanRecover] = useState(() => initialSlot.error !== null && initialSlot.canRecover);
  const [pendingSaveAction, setPendingSaveAction] = useState<PendingSaveAction | null>(null);
  const [newGameSeed, setNewGameSeed] = useState<string | null>(null);
  const loadButtonRef = useRef<HTMLButtonElement | null>(null);
  const rewindButtonRef = useRef<HTMLButtonElement | null>(null);
  const saveActionTriggerRef = useRef<HTMLButtonElement | null>(null);
  const saveActionConfirmRef = useRef<HTMLButtonElement | null>(null);
  const saveActionCancelRef = useRef<HTMLButtonElement | null>(null);
  const newGameTriggerRef = useRef<HTMLButtonElement | null>(null);
  const newGameSeedRef = useRef<HTMLInputElement | null>(null);
  const newGameConfirmRef = useRef<HTMLButtonElement | null>(null);
  const newGameCancelRef = useRef<HTMLButtonElement | null>(null);
  const closeSaveConfirmation = useCallback((restoreFocus = true) => {
    const trigger = saveActionTriggerRef.current;
    setPendingSaveAction(null);
    if (restoreFocus) window.requestAnimationFrame(() => trigger?.focus());
  }, []);
  useEffect(() => {
    if (pendingSaveAction === null) return;
    saveActionConfirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeSaveConfirmation();
      } else if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (document.activeElement === saveActionConfirmRef.current) {
          saveActionCancelRef.current?.focus();
        } else {
          saveActionConfirmRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeSaveConfirmation, pendingSaveAction]);
  const closeNewGameConfirmation = useCallback((restoreFocus = true) => {
    setNewGameSeed(null);
    if (restoreFocus) window.requestAnimationFrame(() => newGameTriggerRef.current?.focus());
  }, []);
  useEffect(() => {
    if (newGameSeed === null) return;
    newGameSeedRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeNewGameConfirmation();
        return;
      }
      if (event.key !== "Tab") {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
        }
        event.stopImmediatePropagation();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      const controls: HTMLElement[] = [];
      if (newGameSeedRef.current !== null) controls.push(newGameSeedRef.current);
      if (newGameCancelRef.current !== null) controls.push(newGameCancelRef.current);
      if (newGameConfirmRef.current !== null && !newGameConfirmRef.current.disabled) {
        controls.push(newGameConfirmRef.current);
      }
      if (controls.length === 0) return;
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const offset = event.shiftKey ? -1 : 1;
      controls[(current + offset + controls.length) % controls.length]?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeNewGameConfirmation, newGameSeed]);
  useEffect(() => {
    if (!transientSaveMessage(saveMsg)) return;
    const timer = window.setTimeout(() => {
      setSaveMsg((current) => current === saveMsg ? "" : current);
    }, 2_600);
    return () => window.clearTimeout(timer);
  }, [saveMsg]);

  const showSlotRead = useCallback((read: SlotRead) => {
    setHistoryCount(read.history?.length ?? 0);
    setSaveMsg(read.error ?? read.notice ?? "");
    setSlotRecovery(read.recovery);
    setCanRecover(read.error !== null && read.canRecover);
  }, []);
  const resolvedSlot = useCallback((slot: number): SlotRead => {
    return readSlot(localStorage, slot);
  }, []);


  const level = useMemo(() => generate(game.genOptions), [game.genOptions]);
  const contracts = useMemo(
    () => shippingContracts(game),
    [game.economy.sold, game.genOptions],
  );
  const activeContract = contracts.find((contract) => !contract.completed) ?? contracts[contracts.length - 1]!;
  const knownCureDiseases = useMemo(
    () => researchKnownCureLocations(level.mm, game.fog).map((location) => location.cureId),
    [game.fog, level.mm],
  );
  const researchMission = level.diseases.find((disease) => disease.id === activeContract.disease)!;
  const researchMissionStart = level.start.pos[researchMission.map]!;
  const researchMissionSector = researchAssaySector(researchMissionStart, researchMission.node);
  const [researchBase, setResearchBase] = useState(0);
  const researchLevel = useMemo(() => researchBaseLevel(level, researchBase), [level, researchBase]);
  const researchFog = useMemo(() => [game.fog[researchBase]!], [game.fog, researchBase]);
  const baseLocks = useMemo(
    () => level.mm.maps.map((_map, base) => baseAvailable(game, base) ? null : `${BASE_NAMES[base]} off · turn it on in Technology`),
    [game.genOptions, game.patents, level.mm],
  );
  const objective = useMemo(() => currentObjective({
    contracts,
    knownCureDiseases,
    profitableUnits: (disease) => {
      const spec = level.diseases.find((candidate) => candidate.id === disease);
      if (spec === undefined) return 0;
      const sold = game.economy.sold.find((entry) => entry.disease === disease)?.count ?? 0;
      return profitableMarketProducts(game.inventory, spec, sold).length;
    },
    stockFor: (disease) => game.inventory.filter((product) => product.outcome.cured.includes(disease)).length,
    planHasMachines: (game.pilot.layout?.machines.length ?? 0) > 0,
    productionHasMachines: game.production.layout.machines.length > 0,
    producingOther: game.inventory.some((product) => product.outcome.cured.length > 0)
      && !game.inventory.some((product) => product.outcome.cured.includes(activeContract.disease)),
    sector: researchMissionSector,
    base: level.mm.maps.length > 1 ? BASE_NAMES[researchMission.map]! : null,
    baseLocked: baseLocks[researchMission.map] !== null,
  }), [activeContract.disease, baseLocks, contracts, knownCureDiseases, game.economy.sold, game.inventory, game.pilot.layout, game.production.layout.machines.length, level.diseases, level.mm.maps.length, researchMission.map, researchMissionSector]);
  const knownResearchMap = useMemo(
    () => researchPlanningMap(level.mm, game.fog),
    [game.fog, level.mm],
  );
  const catalog = useMemo(() => availableCatalog(game.patents), [game.patents]);
  const planLineTrails = useMemo(() => {
    const line = game.pilot.layout === null ? null : factoryLineProgram(game.pilot.layout);
    if (line === null || line.base !== researchBase) return undefined;
    const known = baseView(knownResearchMap, researchBase);
    return researchRoute(known, initialState(known), line.program).trails;
  }, [game.pilot.layout, knownResearchMap, researchBase]);
  const [researchPlan, setResearchPlan] = useState<readonly Machine[]>(NO_RESEARCH_PLAN);
  /** The plan the shown trial belongs to; editing the plan hides the last trial. */
  const [trialPlan, setTrialPlan] = useState<readonly Machine[]>(NO_RESEARCH_PLAN);
  const patentEffects = useMemo(
    () => activeEffects(DEFAULT_PATENTS, game.patents),
    [game.patents],
  );
  const entitledWidth = BASE_GAME_FACTORY_WIDTH + patentEffects.factoryDw;
  const entitledHeight = BASE_GAME_FACTORY_HEIGHT + patentEffects.factoryDh;

  useEffect(() => {
    gameRef.current = game;
  }, [game]);
  const replaceGame = useCallback((next: GameState) => {
    gameRef.current = next;
    setGame(next);
    setResearchPlan(NO_RESEARCH_PLAN);
    setTrialPlan(NO_RESEARCH_PLAN);
    setResearchBase(next.research.lastTrial?.base ?? 0);
    setIntentError("");
  }, []);
  const openNewGameConfirmation = useCallback(() => {
    const currentSeed = gameRef.current.genOptions.seed;
    setNewGameSeed(String(currentSeed === 0xffff_ffff ? 0 : currentSeed + 1));
  }, []);
  const startNewGame = useCallback(() => {
    if (newGameSeed === null) return;
    const seed = parseNewGameSeed(newGameSeed);
    if (seed === null) return;
    replaceGame(createGameState(defaultGenOptions(seed), DEFAULT_STARTING_CASH));
    setBuilding("research");
    setDrawer(null);
    setVisited({ research: true, pilot: false, production: false });
    closeNewGameConfirmation(false);
    setSaveMsg(`Started seed ${seed}. Saved checkpoints and Blueprints were kept.`);
  }, [closeNewGameConfirmation, newGameSeed, replaceGame]);
  const dispatch = useCallback((intent: GameIntent) => {
    if (intent.kind === "productionTicks" && blockingDialogOpen()) return false;
    try {
      const next = applyGameIntent(gameRef.current, intent);
      gameRef.current = next;
      setGame(next);
      setIntentError("");
      return true;
    } catch (error) {
      setIntentError(`Action rejected: ${playerFacingIntentError(error)}`);
      return false;
    }
  }, []);

  const changePilot = useCallback((layout: FactoryLayout) => {
    return dispatch({ kind: "setPilotLayout", layout });
  }, [dispatch]);
  const changeProduction = useCallback((layout: FactoryLayout) => {
    return dispatch({ kind: "buildProductionLayout", layout });
  }, [dispatch]);
  const advanceProduction = useCallback((ticks: number) => {
    return dispatch({ kind: "productionTicks", ticks });
  }, [dispatch]);
  const resetProduction = useCallback(() => dispatch({ kind: "resetProduction" }), [dispatch]);
  const sellProducts = useCallback((productIds: readonly number[], disease: DiseaseId) => {
    return dispatch({ kind: "sellProducts", productIds, disease });
  }, [dispatch]);
  const switchPatent = useCallback((id: string, enabled: boolean) => dispatch({ kind: "setPatent", id, enabled }), [dispatch]);

  const researchProgram = useMemo<Template>(() => ({ steps: researchPlan }), [researchPlan]);
  const planningPreview = useMemo(
    () => researchPlanningPreview(researchLevel.mm, researchFog, researchLevel.start, researchProgram),
    [researchFog, researchLevel, researchProgram],
  );
  const lastTrial = game.research.lastTrial?.base === researchBase && researchPlan === trialPlan ? game.research.lastTrial : null;
  const actualRoute = useMemo(
    () => researchRoute(researchLevel.mm, researchLevel.start, lastTrial?.program ?? { steps: [] }),
    [lastTrial, researchLevel],
  );
  const clearResearchPlan = useCallback(() => setResearchPlan((plan) => plan.length === 0 ? plan : []), []);
  const researchBlockReason = researchRunBlockReason(game.economy.cash, researchProgram);
  /** The estimate the last Run was planned on; shown until the route is edited. */
  const [runEstimate, setRunEstimate] = useState<{
    readonly plan: readonly Machine[];
    readonly base: number;
    readonly trails: readonly (readonly (Vec2 | null)[])[];
    readonly legEnds: readonly number[];
    readonly deviation: ResearchPlanDeviation | null;
  } | null>(null);
  const shownEstimate = runEstimate !== null && runEstimate.plan === researchPlan && runEstimate.base === researchBase ? runEstimate : null;
  /** The first edit after a Run that left its estimate trims the plan to `researchKeptSteps`. */
  const editablePlan = useCallback((plan: readonly Machine[]) => (
    shownEstimate?.plan === plan && shownEstimate.deviation !== null
      ? plan.slice(0, researchKeptSteps(shownEstimate.deviation))
      : plan
  ), [shownEstimate]);
  const appendResearchStep = useCallback((typeId: string) => {
    const entry = catalog.find((candidate) => candidate.typeId === typeId);
    if (entry === undefined) return;
    setResearchPlan((plan) => {
      const kept = editablePlan(plan);
      return kept.length >= MAX_TEMPLATE_STEPS
        ? kept
        : [...kept, { typeId: entry.typeId, path: entry.path, turn: entry.turn }];
    });
  }, [catalog, editablePlan]);
  const undoResearchStep = useCallback(() => setResearchPlan((plan) => {
    const kept = editablePlan(plan);
    if (kept.length < plan.length) return kept;
    return plan.length === 0 ? plan : plan.slice(0, -1);
  }), [editablePlan]);
  const runResearch = useCallback(() => {
    const blockReason = researchRunBlockReason(gameRef.current.economy.cash, researchProgram);
    if (blockReason !== null) {
      setIntentError(`Action rejected: ${blockReason}`);
      return;
    }
    const known = researchPlanningMap(researchLevel.mm, [gameRef.current.fog[researchBase]!]);
    const estimateRoute = researchRoute(known, researchLevel.start, researchProgram);
    const estimate = {
      plan: researchPlan,
      base: researchBase,
      trails: estimateRoute.trails,
      legEnds: estimateRoute.legEnds,
      deviation: researchDeviation(researchLevel.mm, known, researchLevel.start, researchProgram),
    };
    if (dispatch({ kind: "runResearchTrial", program: researchProgram, base: researchBase })) {
      setRunEstimate(estimate);
      setTrialPlan(researchPlan);
    }
  }, [dispatch, researchBase, researchLevel, researchPlan, researchProgram]);
  const buildPilotInProduction = useCallback((layout: FactoryLayout) => {
    if (gameRef.current.pilot.layout !== layout && !dispatch({ kind: "setPilotLayout", layout })) return;
    if (dispatch({ kind: "buildProductionLayout", layout })) openBuilding("production");
  }, [dispatch, openBuilding]);


  const save = useCallback(() => {
    const slot = selectedSlotRef.current;
    const existing = resolvedSlot(slot);
    if (existing.history === null) {
      showSlotRead(existing);
      return;
    }
    try {
      const saved = saveSlot(localStorage, slot, existing.history, game);
      setHistoryCount(saved.history.length);
      setSlotRecovery(saved);
      setCanRecover(false);
      const pruning = saved.replacedTimeline
        ? ` Replaced ${saved.pruned} checkpoint(s) from another run.`
        : saved.pruned > 0
          ? ` Dropped ${saved.pruned} old checkpoint(s).`
          : "";
      setSaveMsg(`Saved slot ${slot + 1}.${pruning}`);
    } catch (error) {
      setSaveMsg(`Could not save slot ${slot + 1}: ${errorMessage(error)}`);
    }
  }, [game, resolvedSlot, showSlotRead]);
  const applyLoadedGame = useCallback((
    slot: number,
    head: GameState,
    savedHistoryCount: number,
    recovery: SlotRecovery | null,
    replaceCurrent: boolean,
  ) => {
    if (replaceCurrent) {
      replaceGame(head);
      setDrawer(null);
    }
    setHistoryCount(savedHistoryCount);
    setSlotRecovery(recovery);
    setCanRecover(false);
    setSaveMsg(`Loaded slot ${slot + 1}.`);
  }, [replaceGame]);
  const load = useCallback(() => {
    const slot = selectedSlotRef.current;
    const existing = resolvedSlot(slot);
    if (existing.error !== null) {
      showSlotRead(existing);
      return;
    }
    if (existing.head === null) {
      setSaveMsg(`No save found in slot ${slot + 1}.`);
      return;
    }
    if (sameGameState(existing.head, gameRef.current)) {
      applyLoadedGame(
        slot,
        existing.head,
        existing.history?.length ?? 0,
        existing.recovery,
        false,
      );
      return;
    }
    saveActionTriggerRef.current = loadButtonRef.current;
    setPendingSaveAction({
      kind: "load",
      slot,
      head: existing.head,
      historyCount: existing.history?.length ?? 0,
      recovery: existing.recovery,
    });
  }, [applyLoadedGame, resolvedSlot, showSlotRead]);
  const rewind = useCallback((slot: number, history: readonly GameState[]) => {
    try {
      const recalled = rewindSlot(localStorage, slot, history);
      replaceGame(recalled.head);
      setDrawer(null);
      setHistoryCount(recalled.history.length);
      setSlotRecovery(recalled);
      setCanRecover(false);
      setSaveMsg(`Rewound slot ${slot + 1}.`);
    } catch (error) {
      setSaveMsg(`Could not rewind slot ${slot + 1}: ${errorMessage(error)}`);
    }
  }, [replaceGame]);
  const doRewind = useCallback(() => {
    const slot = selectedSlotRef.current;
    const existing = resolvedSlot(slot);
    if (existing.history === null) {
      showSlotRead(existing);
      return;
    }
    if (existing.history.length < 2) {
      setSaveMsg("Nothing to rewind.");
      return;
    }
    saveActionTriggerRef.current = rewindButtonRef.current;
    setPendingSaveAction({ kind: "rewind", slot, history: existing.history });
  }, [resolvedSlot, showSlotRead]);
  const confirmSaveAction = useCallback(() => {
    const action = pendingSaveAction;
    if (action === null) return;
    closeSaveConfirmation(false);
    if (action.kind === "load") {
      applyLoadedGame(
        action.slot,
        action.head,
        action.historyCount,
        action.recovery,
        true,
      );
    } else {
      rewind(action.slot, action.history);
    }
  }, [applyLoadedGame, closeSaveConfirmation, pendingSaveAction, rewind]);
  const recoverStorage = useCallback(() => {
    const slot = selectedSlotRef.current;
    try {
      const recovered = recoverSlot(localStorage, slot, game, slotRecovery);
      setHistoryCount(recovered.history.length);
      setSlotRecovery(recovered);
      setCanRecover(false);
      setSaveMsg(`Recovered slot ${slot + 1}.`);
    } catch (error) {
      setSaveMsg(`Could not recover slot ${slot + 1}: ${errorMessage(error)}`);
    }
  }, [game, slotRecovery]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (blockingDialogOpen()) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
        }
        return;
      }
      if (pendingSaveAction !== null || newGameSeed !== null) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
        return;
      }
      if (event.key === "Escape" && drawer !== null) {
        event.preventDefault();
        setDrawer(null);
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        ((event.key === "Enter" || event.key === " ") &&
          target instanceof HTMLElement &&
          target.closest("button, a, [role='button'], [role='link']") !== null)
      ) return;
      const viewByKey: Partial<Record<string, Building>> = {
        F1: "research",
        F2: "pilot",
        F3: "production",
      };
      const view = viewByKey[event.key];
      if (view !== undefined) {
        event.preventDefault();
        openBuilding(view);
      } else if (building === "research" && worldInputActive && /^Digit[1-9]$/.test(event.code)) {
        const entry = catalog[Number(event.code.slice(5)) - 1];
        if (entry !== undefined) {
          event.preventDefault();
          appendResearchStep(entry.typeId);
        }
      } else if (
        building === "research" &&
        worldInputActive &&
        researchKeyboardAction(event.key, event.ctrlKey || event.metaKey) !== null
      ) {
        event.preventDefault();
        if (researchKeyboardAction(event.key, event.ctrlKey || event.metaKey) === "run") runResearch();
        else undoResearchStep();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setDrawer((current) => current === "market" ? null : "market");
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setDrawer((current) => current === "technology" ? null : "technology");
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setDrawer((current) => current === "blueprints" ? null : "blueprints");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    building,
    appendResearchStep,
    catalog,
    drawer,
    openBuilding,
    pendingSaveAction,
    newGameSeed,
    runResearch,
    save,
    undoResearchStep,
    worldInputActive,
  ]);

  const followObjective = (target: ObjectiveTarget) => {
    if (target === "market" || target === "technology") setDrawer(target);
    else openBuilding(target);
  };
  const toggleDrawer = (next: Exclude<Drawer, null>) => setDrawer((current) => current === next ? null : next);
  const drawerButton = (id: "market" | "technology" | "blueprints", label: string, hotkey: string) => (
    <button type="button" data-testid={`view-${id}`} aria-pressed={drawer === id} onClick={() => toggleDrawer(id)}
      aria-label={`${label} (${hotkey})`} title={`${label} (${hotkey})`}>
      <HudGlyph kind={id} /><span className="hud-link-label">{label}</span><kbd>{hotkey}</kbd>
    </button>
  );

  const buildingButton = (id: Building, label: string, hotkey: string) => (
    <button type="button" onClick={() => openBuilding(id)}
      className={`nav-button${building === id ? " is-active" : ""}`}
      data-testid={`view-${id}`} aria-current={building === id ? "page" : undefined}
      aria-label={`${label === "Plan" ? "Production Plan" : label} (${hotkey})`} title={`${label} (${hotkey})`}>
      {label}<kbd>{hotkey}</kbd>
    </button>
  );

  return (
    <div className="game-shell" data-testid="game-shell">
      <header className="top-hud" data-testid="top-hud">
        <span className="wordmark" aria-hidden="true">HexaPharma</span>
        <nav className="nav-rail" data-testid="nav-rail" aria-label="Facilities">
          {buildingButton("research", "Research", "F1")}
          {buildingButton("pilot", "Plan", "F2")}
          {buildingButton("production", "Production", "F3")}
        </nav>
        <div className="resource-strip" aria-label="Company resources">
          <span className="resource-chip" aria-label={`Cash ${game.economy.cash}`} title={`Cash ${game.economy.cash}`}>
            <span className="resource-label" aria-hidden="true">Cash</span>
            <strong><span className="resource-unit" aria-hidden="true">$</span><span data-testid="cash">{game.economy.cash}</span></strong>
          </span>
          <button type="button" className="resource-chip stock-chip" onClick={() => toggleDrawer("market")} aria-label={`Stock ${game.inventory.length}, open Market`} title="Stock · open Market (M)">
            <span className="resource-label" aria-hidden="true">Stock</span>
            <strong data-testid="stock">{game.inventory.length}</strong>
          </button>
        </div>
        <nav className="hud-links" aria-label="Management">
          {drawerButton("market", "Market", "M")}
          {drawerButton("technology", "Technology", "T")}
          {drawerButton("blueprints", "Blueprints", "B")}
        </nav>
        <button type="button" className="menu-trigger" data-testid="view-menu" aria-expanded={drawer === "menu" || drawer === "help"} onClick={() => setDrawer((current) => current === "menu" || current === "help" ? null : "menu")} aria-label="Menu" title="Menu">
          <HudGlyph kind="menu" /><span className="hud-link-label">Menu</span>
        </button>
      </header>

      <main className="game-stage" data-testid="game-stage">
        {/* In Research the map itself is the search; the card returns once the objective points elsewhere. */}
        <section className="goal-card" data-testid="objective" aria-label="Objective" hidden={building === "research" && objective.target === "research"}>
          <p className="goal-step" aria-live="polite">
            <span className="objective-text" data-testid="objective-text">{objective.text}</span>
            <span className="goal-contract" data-testid="shipping-contract" aria-label={`Disease ${activeContract.disease + 1} contract ${activeContract.sold} of ${activeContract.quota}`}>
              <span aria-hidden="true">Contract</span> <strong aria-hidden="true">{activeContract.sold} / {activeContract.quota}</strong>
            </span>
          </p>
          {!objectiveIsHere(objective.target, building, drawer) && (
            <button type="button" className="objective-action" data-testid="objective-action" onClick={() => followObjective(objective.target)}>{objective.actionLabel}</button>
          )}
        </section>
        <section className="view-layer" hidden={building !== "research"}>
          {visited.research && (
            <ResearchWorkspace
              active={building === "research" && worldInputActive}
              level={researchLevel}
              fog={researchFog}
              base={researchBase}
              baseLocks={baseLocks}
              onBase={setResearchBase}
              plan={researchProgram}
              planCost={researchProgramCost(researchProgram)}
              cash={game.economy.cash}
              catalog={catalog}
              lineTrails={planLineTrails}
              blockReason={researchBlockReason}
              drug={actualRoute.drug}
              trails={actualRoute.trails}
              legEnds={actualRoute.legEnds}
              previewTrails={shownEstimate?.trails ?? planningPreview.trails}
              previewLegEnds={shownEstimate?.legEnds ?? planningPreview.legEnds}
              previewDrug={planningPreview.drug}
              estimate={shownEstimate !== null}
              deviation={shownEstimate?.deviation ?? null}
              controls={planningPreview.controls}
              lastOutcome={lastTrial?.outcome ?? null}
              onAppend={appendResearchStep}
              onUndo={undoResearchStep}
              onClear={clearResearchPlan}
              onRun={runResearch}
            />
          )}
        </section>
        <section className="view-layer" hidden={building !== "pilot"}>
          {visited.pilot && (
            <Factory
              active={building === "pilot" && worldInputActive}
              mode="pilot"
              level={level}
              planningMap={knownResearchMap}
              baseLocks={baseLocks}
              layout={game.pilot.layout}
              runtime={null}
              waste={0}
              entitledWidth={entitledWidth}
              entitledHeight={entitledHeight}
              catalog={catalog}
              routing={patentEffects.routing}
              onLayoutChange={changePilot}
              commandLabel={`Commission $${quoteProductionBuild(game.production.layout, game.pilot.layout ?? game.production.layout)}`}
              commandDisabled={game.pilot.layout === null}
              onCommand={buildPilotInProduction}
            />
          )}
        </section>
        <section className="view-layer" hidden={building !== "production"}>
          {visited.production && (
            <Factory
              active={building === "production" && worldInputActive}
              mode="production"
              level={level}
              planningMap={knownResearchMap}
              baseLocks={baseLocks}
              layout={game.production.layout}
              runtime={game.production.runtime}
              waste={game.production.waste}
              entitledWidth={entitledWidth}
              entitledHeight={entitledHeight}
              catalog={catalog}
              routing={patentEffects.routing}
              onLayoutChange={changeProduction}
              onAdvance={advanceProduction}
              onReset={resetProduction}
            />
          )}
        </section>

        <aside className="game-drawer menu-drawer" data-testid="menu-drawer" aria-label="Menu" hidden={drawer !== "menu"}>
          <button type="button" className="drawer-close" onClick={() => setDrawer(null)} aria-label="Close menu"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 3 13 13M13 3 3 13" /></svg></button>
          <section className="menu-panel">
            <p className="menu-seed" aria-label={`Seed ${game.genOptions.seed}`}>
              <span aria-hidden="true">Seed</span> <strong data-testid="seed">{game.genOptions.seed}</strong>
            </p>
            <div className="system-strip" aria-label="Game controls">
              <button ref={newGameTriggerRef} type="button" onClick={openNewGameConfirmation} className="new-game-button" data-testid="new-game" title="New game" aria-label="New game">New game</button>
              <label className="save-slot-control" title="Save slot">
                <span>Slot</span>
                <select
                  data-testid="save-slot"
                  defaultValue={selectedSlotRef.current}
                  onChange={(event) => {
                    const slot = Number(event.target.value);
                    selectedSlotRef.current = slot;
                    showSlotRead(resolvedSlot(slot));
                  }}
                >
                  {Array.from({ length: SAVE_SLOTS }, (_, slot) => (
                    <option key={slot} value={slot}>{slot + 1}</option>
                  ))}
                </select>
              </label>
              <button type="button" onClick={save} data-testid="save" title="Save (Ctrl+S)" aria-label="Save game">Save</button>
              <button ref={loadButtonRef} type="button" onClick={load} data-testid="load" title="Load" aria-label="Load game">Load</button>
              <button ref={rewindButtonRef} type="button" onClick={doRewind} data-testid="rewind" disabled={historyCount < 2} title="Rewind" aria-label="Rewind save history">Rewind</button>
              {canRecover && (
                <button type="button" onClick={recoverStorage} className="is-warning" data-testid="recover-storage" title="Recover slot" aria-label="Recover save slot">Recover</button>
              )}
            </div>
            <button type="button" className="menu-guide" data-testid="view-help" onClick={() => setDrawer("help")}>Guide</button>
          </section>
        </aside>
        {drawer !== null && drawer !== "menu" && (
          <aside className="game-drawer" data-testid={`${drawer}-drawer`}>
            <button type="button" className="drawer-close" onClick={() => setDrawer(null)} aria-label={`Close ${drawer}`}><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M3 3 13 13M13 3 3 13" /></svg></button>
            {drawer === "market" ? (
              <Shop level={level} economy={game.economy} inventory={game.inventory} onSell={sellProducts} />
            ) : drawer === "technology" ? (
              <Patents
                patents={game.patents}
                baseCount={level.mm.maps.length}
                expansionResetsProduction={game.production.runtime.tick > 0 || game.production.runtime.unitCount > 0 || game.production.waste > 0}
                onSwitch={switchPatent}
              />
            ) : drawer === "blueprints" ? (
              <BlueprintLibrary
                pilotLayout={game.pilot.layout}
                productionLayout={game.production.layout}
                onLoadPilot={changePilot}
                onBuildProduction={changeProduction}
                quoteProduction={(layout) => quoteProductionBuild(game.production.layout, layout)}
              />
            ) : (
              <FieldGuide />
            )}
          </aside>
        )}

        <div className="message-layer" aria-live="polite">
          {intentError !== "" && <div role="alert" data-testid="game-intent-error" className="game-alert">{intentError}</div>}
          <span data-testid="save-msg" role="status" className={saveMsg === "" ? "sr-only" : "game-toast"}>{saveMsg}</span>
        </div>
      </main>
      {pendingSaveAction !== null && (
        <div
          className="game-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeSaveConfirmation();
          }}
        >
          <section
            className="game-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="save-action-confirm-title"
            aria-describedby="save-action-confirm-warning"
            data-testid="save-action-confirm"
          >
            <h2 id="save-action-confirm-title">
              {pendingSaveAction.kind === "load" ? "Load saved game?" : "Rewind save history?"}
            </h2>
            <p id="save-action-confirm-warning">
              {pendingSaveAction.kind === "load"
                ? `Loading slot ${pendingSaveAction.slot + 1} will replace the current unsaved state with its saved checkpoint.`
                : `Rewinding slot ${pendingSaveAction.slot + 1} will permanently drop the latest saved checkpoint. The next older checkpoint will replace the current game.`}
            </p>
            <div className="modal-actions">
              <button
                ref={saveActionCancelRef}
                type="button"
                onClick={() => closeSaveConfirmation()}
              >
                Cancel
              </button>
              <button
                ref={saveActionConfirmRef}
                type="button"
                className="danger-action"
                onClick={confirmSaveAction}
              >
                {pendingSaveAction.kind === "load" ? "Load saved game" : "Rewind"}
              </button>
            </div>
          </section>
        </div>
      )}
      {newGameSeed !== null && (
        <div
          className="game-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) closeNewGameConfirmation();
          }}
        >
          <section
            className="game-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="new-game-title"
            aria-describedby="new-game-warning new-game-preserved"
            data-testid="new-game-confirm"
          >
            <h2 id="new-game-title">Start new game?</h2>
            <p id="new-game-warning">The current unsaved state will be replaced.</p>
            <p id="new-game-preserved">Saved checkpoints and Blueprints will stay.</p>
            <label className="game-field">
              <span>Seed</span>
              <input
                ref={newGameSeedRef}
                type="number"
                min="0"
                max="4294967295"
                step="1"
                value={newGameSeed}
                aria-invalid={parseNewGameSeed(newGameSeed) === null}
                aria-describedby={parseNewGameSeed(newGameSeed) === null ? "new-game-seed-error" : undefined}
                onChange={(event) => setNewGameSeed(event.target.value)}
              />
            </label>
            {parseNewGameSeed(newGameSeed) === null && (
              <p id="new-game-seed-error" className="game-field-error">Enter a whole number from 0 to 4294967295.</p>
            )}
            <div className="modal-actions">
              <button ref={newGameCancelRef} type="button" onClick={() => closeNewGameConfirmation()}>Cancel</button>
              <button
                ref={newGameConfirmRef}
                type="button"
                className="danger-action"
                disabled={parseNewGameSeed(newGameSeed) === null}
                onClick={startNewGame}
              >
                Start
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
