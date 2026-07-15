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
} from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";
import { applyTemplate, previewStep } from "../sim/drug-graph";
import {
  applyGameIntent,
  availableCatalog,
  createGameState,
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
import {
  finishMigration,
  readSlot,
  recoverSlot,
  rewindSlot,
  saveSlot,
  type SlotRead,
  type SlotRecovery,
} from "./checkpointStorage";

const START_CASH = 200;
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
        if (
          known[index] !== 1 &&
          (cell[index] === CellKind.Cure || cell[index] === CellKind.SideEffect)
        ) {
          cell[index] = CellKind.Empty;
          cureId[index] = -1;
          sideEffectId[index] = -1;
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
    catalog: availableCatalog({ unlocked: [] }),
    diseaseCount: 1,
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

export function transientSaveMessage(message: string): boolean {
  return /^(?:Saved|Loaded|Rewound|Recovered|No save found|Nothing to rewind)\b/u.test(message);
}

type Building = "research" | "pilot" | "production";
type Drawer = "market" | "technology" | "blueprints" | null;
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
    createGameState(initialGenOptions(), queryInt("cash", START_CASH), queryInt("research", 0, 0)),
  );
  const gameRef = useRef(game);
  const [intentError, setIntentError] = useState("");
  const selectedSlotRef = useRef(0);
  const initialSlot = useMemo(() => readSlot(localStorage, 0), []);
  const [historyCount, setHistoryCount] = useState(() => initialSlot.history?.length ?? 0);
  const [saveMsg, setSaveMsg] = useState(() => initialSlot.error ?? initialSlot.notice ?? "");
  const [slotRecovery, setSlotRecovery] = useState<SlotRecovery | null>(() => initialSlot.recovery);
  const [canRecover, setCanRecover] = useState(() => initialSlot.error !== null && initialSlot.canRecover);
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
  const dispatch = useCallback((intent: GameIntent) => {
    try {
      const next = applyGameIntent(gameRef.current, intent);
      gameRef.current = next;
      setGame(next);
      setIntentError("");
      return true;
    } catch (error) {
      setIntentError(`Action rejected: ${errorMessage(error)}`);
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
    dispatch({ kind: "sellProducts", productIds, disease });
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
  const researchAction = useCallback(() => {
    const current = gameRef.current;
    if (current.research.shot !== null || current.research.program.steps.length === 0) return;
    dispatch({ kind: "beginResearchShot" });
  }, [dispatch]);
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
    replaceGame(existing.head);
    setHistoryCount(existing.history?.length ?? 0);
    setSlotRecovery(existing.recovery);
    setCanRecover(false);
    setSaveMsg(`Loaded slot ${slot + 1}.`);
  }, [replaceGame, resolvedSlot, showSlotRead]);
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
    try {
      const recalled = rewindSlot(localStorage, slot, existing.history);
      replaceGame(recalled.head);
      setHistoryCount(recalled.history.length);
      setSlotRecovery(recalled);
      setCanRecover(false);
      setSaveMsg(`Rewound slot ${slot + 1}.`);
    } catch (error) {
      setSaveMsg(`Could not rewind slot ${slot + 1}: ${errorMessage(error)}`);
    }
  }, [replaceGame, resolvedSlot, showSlotRead]);
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
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
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
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [building, catalog, drawer, openBuilding, researchAction, save, selectedResearchEntry, undoResearchMachine]);

  const buildingButton = (id: Building, label: string, glyph: string, hotkey: string) => (
    <button
      type="button"
      onClick={() => openBuilding(id)}
      className={`nav-button${building === id ? " is-active" : ""}`}
      data-testid={`view-${id}`}
      aria-current={building === id ? "page" : undefined}
      title={`${label} (${hotkey})`}
    >
      <span className="nav-glyph" aria-hidden="true">{glyph}</span>
      <span className="nav-label">{label}</span>
      <span className="hotkey">{hotkey}</span>
    </button>
  );

  return (
    <div className="game-shell" data-testid="game-shell">
      <header className="top-hud" data-testid="top-hud">
        <div className="brand-mark">HexaPharma</div>
        <div className="resource-strip" aria-label="Company resources">
          <span className="resource-chip">Cash <strong data-testid="cash">{game.economy.cash}</strong></span>
          <span className="resource-chip">Knowledge <strong data-testid="research">{game.economy.research}</strong></span>
          <span className="resource-chip">Stock <strong>{game.inventory.length}</strong></span>
          <span className="resource-chip">Seed <strong data-testid="seed">{game.genOptions.seed}</strong></span>
        </div>
        <div className="system-strip" aria-label="Save controls">
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
          <button type="button" onClick={load} className="hud-button" data-testid="load" title="Load" aria-label="Load game">↥</button>
          <button type="button" onClick={doRewind} className="hud-button" data-testid="rewind" disabled={historyCount < 2} title="Rewind" aria-label="Rewind save history">↶</button>
          {canRecover && (
            <button type="button" onClick={recoverStorage} className="hud-button is-warning" data-testid="recover-storage" title="Recover slot" aria-label="Recover save slot">!</button>
          )}
        </div>
      </header>

      <nav className="nav-rail" data-testid="nav-rail" aria-label="Facilities">
        {buildingButton("research", "Research", "⌬", "F1")}
        {buildingButton("pilot", "Pilot Plant", "◇", "F2")}
        {buildingButton("production", "Production", "▦", "F3")}
        <span className="nav-spacer" />
        <button type="button" className={`nav-button${drawer === "market" ? " is-active" : ""}`} onClick={() => setDrawer((current) => current === "market" ? null : "market")} data-testid="view-market">
          <span className="nav-glyph">¤</span><span className="nav-label">Market</span><span className="hotkey">M</span>
        </button>
        <button type="button" className={`nav-button${drawer === "technology" ? " is-active" : ""}`} onClick={() => setDrawer((current) => current === "technology" ? null : "technology")} data-testid="view-technology">
          <span className="nav-glyph">⌁</span><span className="nav-label">Technology</span><span className="hotkey">T</span>
        </button>
        <button type="button" className={`nav-button${drawer === "blueprints" ? " is-active" : ""}`} onClick={() => setDrawer((current) => current === "blueprints" ? null : "blueprints")} data-testid="view-blueprints">
          <span className="nav-glyph">▧</span><span className="nav-label">Blueprints</span><span className="hotkey">B</span>
        </button>
      </nav>

      <main className="game-stage" data-testid="game-stage">
        <section className="view-layer" hidden={building !== "research"}>
          {visited.research && (
            <div className="research-workspace" data-testid="research-workspace">
              <div className="research-commandbar" role="toolbar" aria-label="Research program controls">
                <strong data-testid="research-program-count">{game.research.program.steps.length} placed</strong>
                <button type="button" onClick={undoResearchMachine} disabled={game.research.shot !== null || game.research.program.steps.length === 0} data-testid="research-undo" title="Undo last path (Backspace)">↶</button>
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
                active={building === "research"}
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
                    title={`${entry.typeId} (${index + 1})`}
                  >
                    <MachineIcon typeId={entry.typeId} path={entry.path} size={34} />
                    <span>{entry.typeId}</span>
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
              active={building === "pilot"}
              mode="pilot"
              level={level}
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
              active={building === "production"}
              mode="production"
              level={level}
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
    </div>
  );
}
