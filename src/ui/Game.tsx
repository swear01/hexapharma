import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiseaseId,
  FactoryLayout,
  GameState,
  GenOptions,
  MachineCatalogEntry,
  Template,
} from "../sim/phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
} from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";
import {
  applyGameIntent,
  availableCatalog,
  createGameState,
  type GameIntent,
} from "../sim/game";
import { App } from "./App";
import { Factory } from "./Factory";
import { Shop } from "./Shop";
import { Patents } from "./Patents";
import { activeEffects, DEFAULT_PATENTS } from "../sim/patent";
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

type Tab = "lab" | "factory" | "shop" | "patents";

export function Game() {
  const [tab, setTab] = useState<Tab>("lab");
  const [visited, setVisited] = useState<Record<Tab, boolean>>({
    lab: true,
    factory: false,
    shop: false,
    patents: false,
  });
  const openTab = useCallback((next: Tab) => {
    setVisited((current) => current[next] ? current : { ...current, [next]: true });
    setTab(next);
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

  const saveRecipe = useCallback((recipe: Template, factory: FactoryLayout) => {
    if (dispatch({ kind: "saveRecipe", recipe, factory })) openTab("factory");
  }, [dispatch, openTab]);

  const explore = useCallback((template: Template) => {
    dispatch({ kind: "runLab", template });
  }, [dispatch]);
  const changeFactory = useCallback((factory: FactoryLayout) => {
    return dispatch({ kind: "setFactory", factory });
  }, [dispatch]);
  const advanceFactory = useCallback((ticks: number) => {
    if (gameRef.current.factory === null) {
      setIntentError("Action rejected: no authoritative factory layout is active");
      return false;
    }
    return dispatch({ kind: "factoryTicks", ticks });
  }, [dispatch]);
  const resetFactory = useCallback(() => {
    return dispatch({ kind: "resetFactory" });
  }, [dispatch]);
  const sellProducts = useCallback((productIds: readonly number[], disease: DiseaseId) => {
    dispatch({ kind: "sellProducts", productIds, disease });
  }, [dispatch]);
  const unlock = useCallback((id: string) => {
    dispatch({ kind: "unlockPatent", id });
  }, [dispatch]);

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
        ? ` Replaced the slot's previous ${saved.pruned}-snapshot timeline because it belongs to a different run or branch.`
        : saved.pruned > 0
          ? ` Rewind history dropped ${saved.pruned} oldest snapshot(s) to stay within storage limits.`
          : "";
      setSaveMsg(
        `Saved slot ${slot + 1} (cash ${game.economy.cash}, seed ${game.genOptions.seed}).${pruning}`,
      );
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
    try {
      const loaded = existing.head;
      replaceGame(loaded);
      setHistoryCount(existing.history?.length ?? 0);
      setSlotRecovery(existing.recovery);
      setCanRecover(false);
      setSaveMsg(`Loaded slot ${slot + 1} (cash ${loaded.economy.cash}, seed ${loaded.genOptions.seed}).`);
    } catch (error) {
      setSaveMsg(`Could not load slot ${slot + 1}: ${errorMessage(error)}`);
    }
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
      const pruning = recalled.pruned > 0
        ? ` Dropped ${recalled.pruned} oldest snapshot(s) to stay within storage limits.`
        : "";
      setSaveMsg(`Rewound slot ${slot + 1} (cash ${recalled.head.economy.cash}).${pruning}`);
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
      const pruning = recovered.pruned > 0
        ? ` Dropped ${recovered.pruned} oldest snapshot(s) to stay within storage limits.`
        : "";
      setSaveMsg(`Recovered slot ${slot + 1} with a validated checkpoint.${pruning}`);
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
      ) {
        return;
      }
      const viewByKey: Partial<Record<string, Tab>> = {
        F1: "lab",
        F2: "factory",
        F3: "shop",
        F4: "patents",
      };
      const view = viewByKey[event.key];
      if (view !== undefined) {
        event.preventDefault();
        openTab(view);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openTab, save]);

  const tabBtn = (id: Tab, label: string, glyph: string, hotkey: string) => (
    <button
      type="button"
      onClick={() => openTab(id)}
      className={`nav-button${tab === id ? " is-active" : ""}`}
      data-testid={`view-${id}`}
      aria-current={tab === id ? "page" : undefined}
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
        <div className="resource-strip" aria-label="Factory resources">
          <span className="resource-chip">Cash <strong data-testid="cash">{game.economy.cash}</strong></span>
          <span className="resource-chip">R&amp;D <strong data-testid="research">{game.economy.research}</strong></span>
          <span className="resource-chip">Stock <strong>{game.inventory.length}</strong></span>
          <span className="resource-chip">Seed <strong>{game.genOptions.seed}</strong></span>
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
          <button
            type="button"
            onClick={recoverStorage}
            className="hud-button is-warning"
            data-testid="recover-storage"
            title={slotRecovery === null ? "Replace invalid slot with current game" : "Recover validated timeline"}
            aria-label={slotRecovery === null ? "Replace invalid slot with current game" : "Recover validated timeline"}
          >
            !
          </button>
        )}
        </div>
      </header>

      <nav className="nav-rail" data-testid="nav-rail" aria-label="Game views">
        {tabBtn("lab", "Lab", "⌬", "F1")}
        {tabBtn("factory", "Factory", "▦", "F2")}
        {tabBtn("shop", "Market", "¤", "F3")}
        {tabBtn("patents", "R&D", "⌁", "F4")}
      </nav>

      <main className="game-stage" data-testid="game-stage">
        <section className="view-layer" hidden={tab !== "lab"}>
        {visited.lab && (
          <App
            active={tab === "lab"}
            level={level}
            fog={game.fog}
            catalog={catalog}
            pilotWidth={BASE_GAME_FACTORY_WIDTH + patentEffects.factoryDw}
            pilotHeight={BASE_GAME_FACTORY_HEIGHT + patentEffects.factoryDh}
            onExplore={explore}
            onSaveRecipe={saveRecipe}
          />
        )}
        </section>
        <section className="view-layer" hidden={tab !== "factory"}>
        {visited.factory && (
          <Factory
            active={tab === "factory"}
            level={level}
            recipe={game.recipe}
            factory={game.factory}
            factoryState={game.factoryState}
            factoryWaste={game.factoryWaste}
            entitledWidth={game.factory?.width ?? BASE_GAME_FACTORY_WIDTH + patentEffects.factoryDw}
            entitledHeight={game.factory?.height ?? BASE_GAME_FACTORY_HEIGHT + patentEffects.factoryDh}
            catalog={catalog}
            onFactoryChange={changeFactory}
            onAdvance={advanceFactory}
            onReset={resetFactory}
          />
        )}
        </section>
        <section className="view-layer" hidden={tab !== "shop"}>
        {visited.shop && (
          <Shop
            level={level}
            economy={game.economy}
            inventory={game.inventory}
            onSell={sellProducts}
          />
        )}
        </section>
        <section className="view-layer" hidden={tab !== "patents"}>
        {visited.patents && (
          <Patents
            active={tab === "patents"}
            economy={game.economy}
            patents={game.patents}
            onUnlock={unlock}
          />
        )}
        </section>
        <div className="message-layer" aria-live="polite">
          {intentError !== "" && (
            <div role="alert" data-testid="game-intent-error" className="game-alert">{intentError}</div>
          )}
          <span data-testid="save-msg" role="status" className={saveMsg === "" ? "sr-only" : "game-toast"}>
            {saveMsg}
          </span>
        </div>
      </main>
    </div>
  );
}
