import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiseaseId,
  FactoryLayout,
  GameState,
  GenOptions,
  DrugState,
  Machine,
  MultiMap,
  Outcome,
  Template,
  Vec2,
} from "../sim/phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  CellKind,
  DEFAULT_CATALOG,
} from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";
import { applyTemplate, previewStep } from "../sim/drug-graph";
import { serializeGameAuthority } from "../sim/save";
import {
  applyGameIntent,
  availableCatalog,
  createGameState,
  DEFAULT_STARTING_CASH,
  type GameIntent,
} from "../sim/game";
import { activeEffects, DEFAULT_PATENTS } from "../sim/patent";
import { quoteProductionBuild } from "../sim/construction";
import { App } from "./App";
import { BlueprintLibrary } from "./BlueprintLibrary";
import { Factory } from "./Factory";
import { Patents } from "./Patents";
import { Shop } from "./Shop";
import { MachineIcon } from "./MachineIcon";
import { machineName, machineShortName } from "./machineLabels";
import {
  finishMigration,
  readSlot,
  recoverSlot,
  rewindSlot,
  saveSlot,
  type SlotRead,
  type SlotRecovery,
} from "./checkpointStorage";

const SAVE_SLOTS = 3;
const LAB_WORLD_SIZE = 63;

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
      const sideEffectId = Int32Array.from(map.sideEffectId);
      const portalTo = Int32Array.from(map.portalTo);
      for (let index = 0; index < cell.length; index++) {
        if (known[index] !== 1 && cell[index] !== CellKind.Wall) {
          cell[index] = CellKind.Empty;
          cureId[index] = -1;
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
      return { ...map, cell, cureId, sideEffectId, portalTo, fog: known };
    }),
  };
}

interface ResearchPlanningPreview {
  readonly trails: readonly (readonly (Vec2 | null)[])[];
  readonly drug: DrugState;
}

function researchPlanningPreview(
  mm: MultiMap,
  fog: readonly Uint8Array[],
  start: DrugState,
  program: Template,
): ResearchPlanningPreview {
  const planningMap = researchPlanningMap(mm, fog);
  return {
    trails: researchTrailsForProgram(planningMap, start, program, program.steps.length),
    drug: applyTemplate(planningMap, start, program),
  };
}

export function researchPlanningTrails(
  mm: MultiMap,
  fog: readonly Uint8Array[],
  start: DrugState,
  program: Template,
): readonly (readonly (Vec2 | null)[])[] {
  return researchPlanningPreview(mm, fog, start, program).trails;
}

export function researchCandidateTrails(
  committed: readonly (readonly (Vec2 | null)[])[],
  combined: readonly (readonly (Vec2 | null)[])[],
): readonly (readonly (Vec2 | null)[])[] {
  return combined.map((trail, mapIndex) => {
    const prefix = committed[mapIndex] ?? [];
    let endpoint: Vec2 | null = null;
    for (let index = prefix.length - 1; index >= 0; index--) {
      const point = prefix[index];
      if (point !== null && point !== undefined) {
        endpoint = point;
        break;
      }
    }
    const suffix = trail.slice(Math.min(prefix.length, trail.length));
    return endpoint === null ? suffix : [endpoint, ...suffix];
  });
}

export function researchKeyboardAction(key: string): "dispense" | "erase" | null {
  if (key === "Enter") return "dispense";
  if (key === "Backspace") return "erase";
  return null;
}

function researchMachineCost(typeId: string): number {
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`Research machine "${typeId}" has no cash cost`);
  return entry.cost;
}

export function researchProgramCost(program: Template): number {
  let total = 0;
  for (const step of program.steps) total += researchMachineCost(step.typeId);
  return total;
}

export function researchTrailsForProgram(
  mm: MultiMap,
  start: DrugState,
  program: Template,
  completedSteps: number,
): readonly (readonly (Vec2 | null)[])[] {
  const trails: (Vec2 | null)[][] = mm.maps.map((_map, index) => {
    const position = start.pos[index];
    return position === undefined ? [] : [{ x: position.x, y: position.y }];
  });
  let drug = start;
  const limit = Math.min(completedSteps, program.steps.length);
  for (let step = 0; step < limit; step++) {
    const machine = program.steps[step];
    if (machine === undefined) break;
    const preview = previewStep(mm, drug, machine);
    for (let mapIndex = 0; mapIndex < trails.length; mapIndex++) {
      const map = mm.maps[mapIndex];
      const entered = preview.trails[mapIndex] ?? [];
      if (entered.length > 0) {
        let previous = drug.pos[mapIndex];
        for (const position of entered) {
          if (previous !== undefined && map !== undefined) {
            const previousKind = map.cell[previous.y * map.width + previous.x];
            const jumped = Math.abs(position.x - previous.x) + Math.abs(position.y - previous.y) !== 1;
            if (previousKind === CellKind.Portal || jumped) trails[mapIndex]!.push(null);
          }
          trails[mapIndex]!.push(position);
          previous = position;
        }
      }
    }
    drug = preview.next;
    if (drug.failed) break;
  }
  return trails;
}

export function researchDisplayDrug(
  start: DrugState,
  shotDrug: DrugState | null,
  lastOutcome: Outcome | null,
): DrugState {
  if (shotDrug !== null) return shotDrug;
  if (lastOutcome !== null) return { pos: lastOutcome.final, failed: lastOutcome.failed };
  return start;
}

export function defaultGenOptions(seed: number): GenOptions {
  return {
    seed,
    nMaps: 1,
    width: LAB_WORLD_SIZE,
    height: LAB_WORLD_SIZE,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 4,
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
      return `${machineName(entry.typeId)} is locked. Unlock it in Technology.`;
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
  const researchCash = /^game intent: Research shot requires (\d+) cash$/u.exec(message)?.[1];
  if (researchCash !== undefined) return `Need $${researchCash} to Dispense.`;
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
type Drawer = "market" | "technology" | "blueprints" | null;
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
  return first === second || serializeGameAuthority(first) === serializeGameAuthority(second);
}

export function Game() {
  const [building, setBuilding] = useState<Building>("research");
  const [drawer, setDrawer] = useState<Drawer>(null);
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
      queryInt("research", 0, 0),
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
    return finishMigration(localStorage, slot, readSlot(localStorage, slot));
  }, []);
  useEffect(() => {
    if (initialSlot.migration !== null) showSlotRead(finishMigration(localStorage, 0, initialSlot));
  }, [initialSlot, showSlotRead]);

  const level = useMemo(() => generate(game.genOptions), [game.genOptions]);
  const knownResearchMap = useMemo(
    () => researchPlanningMap(level.mm, game.fog),
    [game.fog, level.mm],
  );
  const catalog = useMemo(() => availableCatalog(game.patents), [game.patents]);
  const [researchMachineType, setResearchMachineType] = useState(() => catalog[0]?.typeId ?? "");
  const selectedResearchEntry = catalog.find((entry) => entry.typeId === researchMachineType) ?? catalog[0];
  useEffect(() => {
    if (selectedResearchEntry === undefined) return;
    setResearchMachineType(selectedResearchEntry.typeId);
  }, [selectedResearchEntry]);
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
    replaceGame(createGameState(defaultGenOptions(seed), DEFAULT_STARTING_CASH, 0));
    setBuilding("research");
    setDrawer(null);
    setVisited({ research: true, pilot: false, production: false });
    closeNewGameConfirmation(false);
    setSaveMsg(`Started seed ${seed}. Saved checkpoints and Blueprints were kept.`);
  }, [closeNewGameConfirmation, newGameSeed, replaceGame]);
  const dispatch = useCallback((intent: GameIntent) => {
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
  const unlock = useCallback((id: string) => dispatch({ kind: "unlockPatent", id }), [dispatch]);

  const selectedResearchMachine = useMemo<Machine | null>(() => selectedResearchEntry === undefined
    ? null
    : {
        typeId: selectedResearchEntry.typeId,
        path: selectedResearchEntry.path,
      }, [selectedResearchEntry]);
  const previewProgram = useMemo<Template>(() => ({
    steps: game.research.shot === null && selectedResearchMachine !== null
      ? [...game.research.program.steps, selectedResearchMachine]
      : game.research.program.steps,
  }), [game.research.program.steps, game.research.shot, selectedResearchMachine]);
  const planningPreview = useMemo(() => {
    if (game.research.shot !== null) return null;
    const committed = researchPlanningPreview(
      level.mm,
      game.fog,
      level.start,
      game.research.program,
    );
    const combined = selectedResearchMachine === null
      ? committed
      : researchPlanningPreview(level.mm, game.fog, level.start, previewProgram);
    return {
      committed,
      candidateTrails: selectedResearchMachine === null
        ? undefined
        : researchCandidateTrails(committed.trails, combined.trails),
      candidateDrug: selectedResearchMachine === null ? undefined : combined.drug,
    };
  }, [
    game.fog,
    game.research.lastOutcome,
    game.research.program,
    game.research.shot,
    level,
    previewProgram,
    selectedResearchMachine,
  ]);
  const researchTrails = useMemo(() => {
    if (planningPreview !== null && game.research.lastOutcome === null) {
      return planningPreview.committed.trails;
    }
    const completedSteps = game.research.shot?.step ?? game.research.program.steps.length;
    return researchTrailsForProgram(
      level.mm,
      level.start,
      game.research.program,
      completedSteps,
    );
  }, [game.research.lastOutcome, game.research.program, game.research.shot, level, planningPreview]);
  const previewDrug = useMemo(() => {
    return researchDisplayDrug(
      level.start,
      game.research.shot?.drug ?? null,
      game.research.lastOutcome,
    );
  }, [game.research.lastOutcome, game.research.shot, level.start]);
  const placeResearchMachine = useCallback(() => {
    const current = gameRef.current;
    if (current.research.shot !== null || selectedResearchMachine === null) return;
    dispatch({
      kind: "setResearchProgram",
      program: { steps: [...current.research.program.steps, selectedResearchMachine] },
    });
  }, [dispatch, selectedResearchMachine]);
  const undoResearchMachine = useCallback(() => {
    const current = gameRef.current;
    if (current.research.shot !== null || current.research.program.steps.length === 0) return;
    dispatch({
      kind: "setResearchProgram",
      program: { steps: current.research.program.steps.slice(0, -1) },
    });
  }, [dispatch]);
  const removeResearchMachine = useCallback((index: number) => {
    const current = gameRef.current;
    if (
      current.research.shot !== null ||
      index < 0 ||
      index >= current.research.program.steps.length
    ) return;
    dispatch({
      kind: "setResearchProgram",
      program: {
        steps: current.research.program.steps.filter((_step, stepIndex) => stepIndex !== index),
      },
    });
  }, [dispatch]);
  const researchAction = useCallback(() => {
    const current = gameRef.current;
    if (current.research.shot !== null || current.research.program.steps.length === 0) return;
    dispatch({ kind: "beginResearchShot" });
  }, [dispatch]);
  const researchShotCost = useMemo(
    () => researchProgramCost(game.research.program),
    [game.research.program],
  );
  const buildPilotInProduction = useCallback((layout: FactoryLayout) => {
    if (gameRef.current.pilot.layout !== layout && !dispatch({ kind: "setPilotLayout", layout })) return;
    if (dispatch({ kind: "buildProductionLayout", layout })) openBuilding("production");
  }, [dispatch, openBuilding]);

  useEffect(() => {
    if (game.research.shot === null) return;
    const timer = window.setTimeout(() => dispatch({ kind: "advanceResearchShot" }), 320);
    return () => window.clearTimeout(timer);
  }, [dispatch, game.research.shot]);

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
    if (replaceCurrent) replaceGame(head);
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
      if (document.querySelector('[role="alertdialog"][aria-modal="true"]') !== null) {
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
      } else if (building === "research" && drawer === null && /^Digit[1-9]$/.test(event.code)) {
        const entry = catalog[Number(event.code.slice(5)) - 1];
        if (entry !== undefined) {
          event.preventDefault();
          setResearchMachineType(entry.typeId);
        }
      } else if (building === "research" && drawer === null && researchKeyboardAction(event.key) !== null) {
        event.preventDefault();
        if (researchKeyboardAction(event.key) === "dispense") researchAction();
        else undoResearchMachine();
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        setDrawer((current) => current === "market" ? null : "market");
      } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        setDrawer((current) => current === "technology" ? null : "technology");
      } else if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setDrawer((current) => current === "blueprints" ? null : "blueprints");
      } else if (event.key === "Escape" && drawer !== null) {
        event.preventDefault();
        setDrawer(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    building,
    catalog,
    drawer,
    openBuilding,
    pendingSaveAction,
    newGameSeed,
    researchAction,
    save,
    selectedResearchEntry,
    undoResearchMachine,
  ]);

  const buildingButton = (
    id: Building,
    label: string,
    compactLabel: string,
    glyph: string,
    hotkey: string,
  ) => (
    <button
      type="button"
      onClick={() => openBuilding(id)}
      className={`nav-button facility-nav-button${building === id ? " is-active" : ""}`}
      data-testid={`view-${id}`}
      aria-current={building === id ? "page" : undefined}
      aria-label={`${label} (${hotkey})`}
      title={`${label} (${hotkey})`}
    >
      <span className="nav-glyph" aria-hidden="true">{glyph}</span>
      <span className="nav-label" aria-hidden="true">{compactLabel}</span>
      <span className="hotkey">{hotkey}</span>
    </button>
  );

  return (
    <div className="game-shell" data-testid="game-shell">
      <header className="top-hud" data-testid="top-hud">
        <div className="brand-mark">HexaPharma</div>
        <div className="resource-strip" aria-label="Company resources">
          <span className="resource-chip" aria-label={`Cash ${game.economy.cash}`} title={`Cash ${game.economy.cash}`}>
            <span className="resource-label" aria-hidden="true"><span className="resource-label-full">Cash</span><span className="resource-label-compact">Cash</span></span>
            <strong data-testid="cash">{game.economy.cash}</strong>
          </span>
          <span className="resource-chip" aria-label={`Knowledge ${game.economy.research}`} title={`Knowledge ${game.economy.research}`}>
            <span className="resource-label" aria-hidden="true"><span className="resource-label-full">Knowledge</span><span className="resource-label-compact">Know.</span></span>
            <strong data-testid="research">{game.economy.research}</strong>
          </span>
          <span className="resource-chip" aria-label={`Stock ${game.inventory.length}`} title={`Stock ${game.inventory.length}`}>
            <span className="resource-label" aria-hidden="true"><span className="resource-label-full">Stock</span><span className="resource-label-compact">Stock</span></span>
            <strong>{game.inventory.length}</strong>
          </span>
          <span className="resource-chip" aria-label={`Seed ${game.genOptions.seed}`} title={`Seed ${game.genOptions.seed}`}>
            <span className="resource-label" aria-hidden="true"><span className="resource-label-full">Seed</span><span className="resource-label-compact">Seed</span></span>
            <strong data-testid="seed">{game.genOptions.seed}</strong>
          </span>
        </div>
        <div className="system-strip" aria-label="Game controls">
          <button ref={newGameTriggerRef} type="button" onClick={openNewGameConfirmation} className="hud-button new-game-button" data-testid="new-game" title="New game" aria-label="New game"><span aria-hidden="true">+</span><span>New</span></button>
          <label className="save-slot-control" title="Save slot">
            <span className="sr-only">Slot</span>
            <select
              data-testid="save-slot"
              defaultValue={0}
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
          <button type="button" onClick={save} className="hud-button" data-testid="save" title="Save (Ctrl+S)" aria-label="Save game">▣</button>
          <button ref={loadButtonRef} type="button" onClick={load} className="hud-button" data-testid="load" title="Load" aria-label="Load game">↥</button>
          <button ref={rewindButtonRef} type="button" onClick={doRewind} className="hud-button" data-testid="rewind" disabled={historyCount < 2} title="Rewind" aria-label="Rewind save history">↶</button>
          {canRecover && (
            <button type="button" onClick={recoverStorage} className="hud-button is-warning" data-testid="recover-storage" title="Recover slot" aria-label="Recover save slot">!</button>
          )}
        </div>
      </header>

      <nav className="nav-rail" data-testid="nav-rail" aria-label="Facilities">
        {buildingButton("research", "Research", "Research", "⌬", "F1")}
        {buildingButton("pilot", "Pilot Plant", "Pilot", "◇", "F2")}
        {buildingButton("production", "Production", "Production", "▦", "F3")}
        <span className="nav-spacer" />
        <button type="button" className={`nav-button utility-nav-button${drawer === "market" ? " is-active" : ""}`} onClick={() => setDrawer((current) => current === "market" ? null : "market")} data-testid="view-market" aria-label="Market (M)" title="Market (M)">
          <span className="nav-glyph">¤</span><span className="nav-label">Market</span><span className="hotkey">M</span>
        </button>
        <button type="button" className={`nav-button utility-nav-button${drawer === "technology" ? " is-active" : ""}`} onClick={() => setDrawer((current) => current === "technology" ? null : "technology")} data-testid="view-technology" aria-label="Technology (T)" title="Technology (T)">
          <span className="nav-glyph">⌁</span><span className="nav-label">Tech</span><span className="hotkey">T</span>
        </button>
        <button type="button" className={`nav-button utility-nav-button${drawer === "blueprints" ? " is-active" : ""}`} onClick={() => setDrawer((current) => current === "blueprints" ? null : "blueprints")} data-testid="view-blueprints" aria-label="Blueprints (B)" title="Blueprints (B)">
          <span className="nav-glyph">▧</span><span className="nav-label">Plans</span><span className="hotkey">B</span>
        </button>
      </nav>

      <main className="game-stage" data-testid="game-stage">
        <section className="view-layer" hidden={building !== "research"}>
          {visited.research && (
            <div className="research-workspace" data-testid="research-workspace">
              {game.research.program.steps.length > 0 && (
                <div
                  className="research-program-strip"
                  data-testid="research-program-strip"
                  aria-label="Research route"
                >
                  <ol>
                    {game.research.program.steps.map((step, index) => (
                      <li key={`${index}-${step.typeId}`}>
                        <span className="research-step-number" aria-hidden="true">{index + 1}</span>
                        <MachineIcon typeId={step.typeId} path={step.path} size={24} />
                        <span className="research-step-name" title={machineName(step.typeId)}>{machineName(step.typeId)}</span>
                        <span className="research-step-cost">${researchMachineCost(step.typeId)}</span>
                        <button
                          type="button"
                          onClick={() => removeResearchMachine(index)}
                          disabled={game.research.shot !== null}
                          aria-label={`Remove ${machineName(step.typeId)} step ${index + 1}`}
                          title={`Remove ${machineName(step.typeId)}`}
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              <div className="research-commandbar" role="toolbar" aria-label="Research program controls">
                <strong data-testid="research-program-count">{game.research.program.steps.length} placed</strong>
                <output className="research-shot-cost" data-testid="research-shot-cost">${researchShotCost}</output>
                <button type="button" onClick={undoResearchMachine} disabled={game.research.shot !== null || game.research.program.steps.length === 0} data-testid="research-undo" aria-label="Undo last path" title="Undo last path (Backspace)">↶</button>
                {game.research.shot !== null && (
                  <button type="button" className="is-warning" onClick={() => dispatch({ kind: "abortResearchShot" })} data-testid="research-abort">Abort · no refund</button>
                )}
                <button
                  type="button"
                  className="facility-command"
                  disabled={game.research.program.steps.length === 0 || game.research.shot !== null}
                  onClick={researchAction}
                  data-testid="research-command"
                  title="Dispense (Enter)"
                >
                  Dispense
                </button>
              </div>
              <App
                active={building === "research" && drawer === null}
                level={level}
                fog={game.fog}
                drug={previewDrug}
                trails={researchTrails}
                previewTrails={planningPreview?.candidateTrails}
                previewDrug={planningPreview?.candidateDrug}
                shotStep={game.research.shot?.step ?? null}
                lastOutcome={game.research.lastOutcome}
                onWorldActivate={placeResearchMachine}
                onWorldErase={undoResearchMachine}
              />
              <div className="research-path-hotbar" role="toolbar" aria-label="Fixed machine paths" data-testid="research-path-hotbar">
                {catalog.map((entry, index) => (
                  <button
                    key={entry.typeId}
                    type="button"
                    className={selectedResearchEntry?.typeId === entry.typeId ? "is-selected" : ""}
                    aria-pressed={selectedResearchEntry?.typeId === entry.typeId}
                    onClick={() => setResearchMachineType(entry.typeId)}
                    data-testid={`research-machine-${entry.typeId}`}
                    title={`${machineName(entry.typeId)} — previews next path (${index + 1})`}
                  >
                    <MachineIcon typeId={entry.typeId} path={entry.path} size={34} />
                    <span>{machineShortName(entry.typeId)}</span>
                    <kbd>{index + 1}</kbd>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
        <section className="view-layer" hidden={building !== "pilot"}>
          {visited.pilot && (
            <Factory
              active={building === "pilot" && drawer === null}
              mode="pilot"
              level={level}
              planningMap={knownResearchMap}
              layout={game.pilot.layout}
              runtime={null}
              waste={0}
              entitledWidth={entitledWidth}
              entitledHeight={entitledHeight}
              catalog={catalog}
              onLayoutChange={changePilot}
              commandLabel={`Build $${quoteProductionBuild(game.production.layout, game.pilot.layout ?? game.production.layout)}`}
              commandDisabled={game.pilot.layout === null}
              onCommand={buildPilotInProduction}
            />
          )}
        </section>
        <section className="view-layer" hidden={building !== "production"}>
          {visited.production && (
            <Factory
              active={building === "production" && drawer === null}
              mode="production"
              level={level}
              planningMap={knownResearchMap}
              layout={game.production.layout}
              runtime={game.production.runtime}
              waste={game.production.waste}
              entitledWidth={entitledWidth}
              entitledHeight={entitledHeight}
              catalog={catalog}
              onLayoutChange={changeProduction}
              onAdvance={advanceProduction}
              onReset={resetProduction}
            />
          )}
        </section>

        {drawer !== null && (
          <aside className="game-drawer" data-testid={`${drawer}-drawer`}>
            <button type="button" className="drawer-close" onClick={() => setDrawer(null)} aria-label={`Close ${drawer}`}>×</button>
            {drawer === "market" ? (
              <Shop level={level} economy={game.economy} inventory={game.inventory} onSell={sellProducts} />
            ) : drawer === "technology" ? (
              <Patents
                economy={game.economy}
                patents={game.patents}
                expansionResetsProduction={game.production.runtime.tick > 0 || game.production.runtime.unitCount > 0 || game.production.waste > 0}
                onUnlock={unlock}
              />
            ) : (
              <BlueprintLibrary
                researchProgram={game.research.program}
                pilotLayout={game.pilot.layout}
                productionLayout={game.production.layout}
                onLoadResearch={(program) => dispatch({ kind: "setResearchProgram", program })}
                onLoadPilot={changePilot}
                onBuildProduction={changeProduction}
                quoteProduction={(layout) => quoteProductionBuild(game.production.layout, layout)}
              />
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
