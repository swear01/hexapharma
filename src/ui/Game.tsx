import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DiseaseId,
  FactoryLayout,
  GameState,
  GenOptions,
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

function dimsForN(nMaps: number): number {
  if (nMaps >= 4) return 6;
  if (nMaps === 3) return 7;
  return 12;
}

export function defaultGenOptions(seed: number, nMaps = 2): GenOptions {
  const dim = dimsForN(nMaps);
  return {
    seed,
    nMaps,
    width: dim,
    height: dim,
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
  const requestedMaps = queryInt("nmaps", 2);
  const nMaps = requestedMaps >= 2 && requestedMaps <= 4 ? requestedMaps : 2;
  return defaultGenOptions(seed, nMaps);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Tab = "lab" | "factory" | "shop" | "patents";

export function Game() {
  const [tab, setTab] = useState<Tab>("lab");
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
  const catalog = useMemo(() => availableCatalog(game.patents), [game.patents]);
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

  const saveRecipe = useCallback((recipe: Template) => {
    if (dispatch({ kind: "saveRecipe", recipe })) setTab("factory");
  }, [dispatch]);

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

  const tabStyle: React.CSSProperties = {
    padding: "8px 18px",
    border: "1px solid #b8c2cc",
    borderBottom: "none",
    borderRadius: "8px 8px 0 0",
    background: "#eef2f6",
    cursor: "pointer",
    fontSize: 14,
    fontFamily: "Arial, sans-serif",
    fontWeight: 600,
    color: "#475260",
  };
  const activeTab: React.CSSProperties = { background: "#fff", color: "#1d6fe0" };
  const bar: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid #b8c2cc",
    borderRadius: 6,
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };

  const tabBtn = (id: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{ ...tabStyle, ...(tab === id ? activeTab : {}) }}
      data-testid={`view-${id}`}
    >
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 16, fontFamily: "Arial, sans-serif" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 12,
          padding: "8px 12px",
          border: "1px solid #d9e0e7",
          borderRadius: 8,
          background: "#f7fafc",
        }}
      >
        <strong style={{ fontSize: 16, color: "#15724a" }}>
          Cash: <span data-testid="cash">{game.economy.cash}</span>
        </strong>
        <strong style={{ fontSize: 14, color: "#5a4b9c" }}>
          R&amp;D: <span data-testid="research">{game.economy.research}</span>
        </strong>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 12 }}>
          Slot{" "}
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
        <button type="button" onClick={save} style={bar} data-testid="save">Save</button>
        <button type="button" onClick={load} style={bar} data-testid="load">Load</button>
        <button type="button" onClick={doRewind} style={bar} data-testid="rewind" disabled={historyCount < 2}>
          Rewind
        </button>
        {canRecover && (
          <button type="button" onClick={recoverStorage} style={bar} data-testid="recover-storage">
            {slotRecovery === null ? "Replace invalid slot with current game" : "Recover validated timeline"}
          </button>
        )}
        <span
          data-testid="save-msg"
          role="status"
          aria-live="polite"
          style={{ fontSize: 12, color: "#5a6470" }}
        >
          {saveMsg}
        </span>
      </div>

      {intentError !== "" && (
        <div
          role="alert"
          data-testid="game-intent-error"
          style={{ marginBottom: 10, color: "#a32222", fontWeight: 600 }}
        >
          {intentError}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #b8c2cc" }}>
        {tabBtn("lab", "Lab")}
        {tabBtn("factory", "Factory")}
        {tabBtn("shop", "Shop")}
        {tabBtn("patents", "Patents")}
      </div>

      <div style={{ paddingTop: 16 }}>
        {tab === "lab" && (
          <App
            level={level}
            fog={game.fog}
            catalog={catalog}
            onExplore={explore}
            onSaveRecipe={saveRecipe}
          />
        )}
        {tab === "factory" && (
          <Factory
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
        {tab === "shop" && (
          <Shop
            level={level}
            economy={game.economy}
            inventory={game.inventory}
            onSell={sellProducts}
          />
        )}
        {tab === "patents" && (
          <Patents
            economy={game.economy}
            patents={game.patents}
            onUnlock={unlock}
          />
        )}
      </div>
    </div>
  );
}
