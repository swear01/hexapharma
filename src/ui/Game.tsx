import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiseaseId,
  FactoryLayout,
  GameState,
  GenOptions,
  MachineCatalogEntry,
  DrugState,
  MultiMap,
  Vec2,
} from "../sim/phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
} from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";
import { previewStep } from "../sim/drug-graph";
import { deriveLinearRoute } from "../sim/recipe";
import {
  applyGameIntent,
  availableCatalog,
  createGameState,
  type GameIntent,
} from "../sim/game";
import { activeEffects, DEFAULT_PATENTS } from "../sim/patent";
import { App } from "./App";
import { BlueprintLibrary } from "./BlueprintLibrary";
import { Factory } from "./Factory";
import { Patents } from "./Patents";
import { Shop } from "./Shop";
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

export function researchTrailsForLayout(
  mm: MultiMap,
  start: DrugState,
  layout: FactoryLayout,
  completedSteps: number,
): readonly (readonly (Vec2 | null)[])[] {
  const route = deriveLinearRoute(layout);
  const trails: (Vec2 | null)[][] = mm.maps.map((_map, index) => {
    const position = start.pos[index];
    return position === undefined ? [] : [{ x: position.x, y: position.y }];
  });
  let drug = start;
  const limit = Math.min(completedSteps, route.template.steps.length);
  for (let step = 0; step < limit; step++) {
    const machine = route.template.steps[step];
    if (machine === undefined) break;
    const preview = previewStep(mm, drug, machine);
    for (let mapIndex = 0; mapIndex < trails.length; mapIndex++) {
      const entered = preview.trails[mapIndex] ?? [];
      if (entered.length === 0) {
        const endpoint = preview.next.pos[mapIndex];
        if (endpoint !== undefined) trails[mapIndex]!.push(null, endpoint);
      } else {
        trails[mapIndex]!.push(...entered);
      }
    }
    drug = preview.next;
    if (drug.failed) break;
  }
  return trails;
}

export function catalogForLayers(
  catalog: readonly MachineCatalogEntry[],
  nMaps: number,
): readonly MachineCatalogEntry[] {
  return catalog.filter((entry) => {
    const transform = entry.transform;
    return transform.kind !== "swap" || (transform.a < nMaps && transform.b < nMaps);
  });
}

export function defaultGenOptions(seed: number, nMaps = 1): GenOptions {
  return {
    seed,
    nMaps,
    width: LAB_WORLD_SIZE,
    height: LAB_WORLD_SIZE,
    catalog: availableCatalog({ unlocked: [] }),
    diseaseCount: nMaps,
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
  const requestedMaps = queryInt("nmaps", 1);
  const nMaps = requestedMaps >= 1 && requestedMaps <= 4 ? requestedMaps : 1;
  return defaultGenOptions(seed, nMaps);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Building = "research" | "pilot" | "production";
type Drawer = "market" | "technology" | "blueprints" | null;
type ResearchSurface = "atlas" | "floor";

export function Game() {
  const [building, setBuilding] = useState<Building>("research");
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [researchSurface, setResearchSurface] = useState<ResearchSurface>("atlas");
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
  const catalog = useMemo(
    () => catalogForLayers(availableCatalog(game.patents), game.genOptions.nMaps),
    [game.genOptions.nMaps, game.patents],
  );
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

  const changeResearch = useCallback((layout: FactoryLayout) => {
    return dispatch({ kind: "setResearchLayout", layout });
  }, [dispatch]);
  const changePilot = useCallback((layout: FactoryLayout) => {
    return dispatch({ kind: "setPilotLayout", layout });
  }, [dispatch]);
  const changeProduction = useCallback((layout: FactoryLayout) => {
    return dispatch({ kind: "setProductionLayout", layout });
  }, [dispatch]);
  const advanceProduction = useCallback((ticks: number) => {
    return dispatch({ kind: "productionTicks", ticks });
  }, [dispatch]);
  const resetProduction = useCallback(() => dispatch({ kind: "resetProduction" }), [dispatch]);
  const sellProducts = useCallback((productIds: readonly number[], disease: DiseaseId) => {
    dispatch({ kind: "sellProducts", productIds, disease });
  }, [dispatch]);
  const unlock = useCallback((id: string) => dispatch({ kind: "unlockPatent", id }), [dispatch]);

  const researchHasCure = game.research.lastOutcome !== null &&
    !game.research.lastOutcome.failed && game.research.lastOutcome.cured.length > 0;
  const researchTrails = useMemo(() => {
    if (
      game.research.layout === null ||
      (game.research.shot === null && game.research.lastOutcome === null)
    ) {
      return level.mm.maps.map(() => []);
    }
    const completedSteps = game.research.shot?.step ??
      (game.research.lastOutcome === null ? 0 : Number.MAX_SAFE_INTEGER);
    return researchTrailsForLayout(
      level.mm,
      level.start,
      game.research.layout,
      completedSteps,
    );
  }, [game.research.lastOutcome, game.research.layout, game.research.shot, level]);
  const researchActiveMachineId = useMemo(() => {
    if (game.research.layout === null || game.research.shot === null) return null;
    return deriveLinearRoute(game.research.layout).machineIds[game.research.shot.step] ?? null;
  }, [game.research.layout, game.research.shot]);
  const researchAction = useCallback(() => {
    const current = gameRef.current;
    const outcome = current.research.lastOutcome;
    if (outcome !== null && !outcome.failed && outcome.cured.length > 0) {
      if (dispatch({ kind: "sendResearchToPilot" })) openBuilding("pilot");
      return;
    }
    if (dispatch({ kind: "beginResearchShot" })) setResearchSurface("atlas");
  }, [dispatch, openBuilding]);
  const commissionProduction = useCallback(() => {
    if (dispatch({ kind: "sendPilotToProduction" })) openBuilding("production");
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
  }, [drawer, openBuilding, save]);

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
              <div className="research-modebar" role="toolbar" aria-label="Research workspace mode">
                <button type="button" className={researchSurface === "atlas" ? "is-active" : ""} onClick={() => setResearchSurface("atlas")} data-testid="research-show-atlas">Effect Atlas</button>
                <button type="button" className={researchSurface === "floor" ? "is-active" : ""} onClick={() => setResearchSurface("floor")} data-testid="research-show-floor">Route Floor</button>
                <span className="research-modebar-spacer" />
                {game.research.shot !== null && (
                  <button type="button" className="is-warning" onClick={() => dispatch({ kind: "abortResearchShot" })} data-testid="research-abort">Abort · no refund</button>
                )}
                <button
                  type="button"
                  className="facility-command"
                  disabled={game.research.layout === null || game.research.shot !== null}
                  onClick={researchAction}
                  data-testid="research-command"
                >
                  {researchHasCure ? "Send to Pilot Plant" : "Dispense"}
                </button>
              </div>
              <div className="research-surface" hidden={researchSurface !== "atlas"}>
                <App
                  active={building === "research" && researchSurface === "atlas"}
                  level={level}
                  fog={game.fog}
                  drug={game.research.shot?.drug ?? level.start}
                  trails={researchTrails}
                  shotStep={game.research.shot?.step ?? null}
                  lastOutcome={game.research.lastOutcome}
                />
              </div>
              <div className="research-surface" hidden={researchSurface !== "floor"}>
                <Factory
                  active={building === "research" && researchSurface === "floor"}
                  mode="research"
                  level={level}
                  contract={null}
                  layout={game.research.layout}
                  runtime={null}
                  waste={0}
                  entitledWidth={entitledWidth}
                  entitledHeight={entitledHeight}
                  catalog={catalog}
                  onLayoutChange={changeResearch}
                  activeMachineId={researchActiveMachineId}
                />
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
              contract={game.pilot.contract}
              layout={game.pilot.layout}
              runtime={null}
              waste={0}
              entitledWidth={entitledWidth}
              entitledHeight={entitledHeight}
              catalog={catalog}
              onLayoutChange={changePilot}
              commandLabel="Commission"
              commandDisabled={game.pilot.layout === null || game.pilot.contract === null}
              onCommand={commissionProduction}
            />
          )}
        </section>
        <section className="view-layer" hidden={building !== "production"}>
          {visited.production && (
            game.production.contract === null || game.production.layout === null ? (
              <div className="facility-empty-state" data-testid="production-uncommissioned">
                <span className="nav-glyph">▦</span>
                <div className="panel-kicker">Production floor offline</div>
                <h1>Production</h1>
                <p>Validate a Research contract in Pilot Plant before this floor can run or be edited.</p>
                <button type="button" onClick={() => openBuilding("pilot")}>Go to Pilot Plant</button>
              </div>
            ) : (
              <Factory
                active={building === "production"}
                mode="production"
                level={level}
                contract={game.production.contract}
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
            )
          )}
        </section>

        {drawer !== null && (
          <aside className="game-drawer" data-testid={`${drawer}-drawer`}>
            <button type="button" className="drawer-close" onClick={() => setDrawer(null)} aria-label={`Close ${drawer}`}>×</button>
            {drawer === "market" ? (
              <Shop level={level} economy={game.economy} inventory={game.inventory} onSell={sellProducts} />
            ) : drawer === "technology" ? (
              <Patents active economy={game.economy} patents={game.patents} onUnlock={unlock} />
            ) : (
              <BlueprintLibrary
                researchLayout={game.research.layout}
                pilotLayout={game.pilot.layout}
                onLoadResearch={changeResearch}
                onLoadPilot={changePilot}
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
