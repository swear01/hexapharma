/**
 * HexaPharma — the full game loop root.
 *
 * Holds ONE shared game state for every tab (Lab | Factory | Shop | Patents) and
 * a persistent Cash + Save/Load bar. React owns all state; every gameplay mutation
 * is computed by CALLING the pure sim functions (mapgen / drug-graph / recipe /
 * factory-sim / economy / patent / save). No sim logic is reimplemented here.
 * See AGENTS.md layering rule.
 *
 * The loop: cure in the Lab → "Save recipe → Factory" → produce units in the
 * Factory → Sell in the Shop for cash → buy Patents (incl. a new, deeper map) →
 * continue.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  Template,
  GenOptions,
  GeneratedLevel,
  EconomyState,
  PatentState,
  FactoryLayout,
  GameState,
  DiseaseId,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";
import { evaluate, initialState } from "../sim/drug-graph";
import { compileTemplate } from "../sim/recipe";
import {
  serializeGame,
  deserializeGame,
  pushSnapshot,
  rewind,
} from "../sim/save";
import { App } from "./App";
import { Factory } from "./Factory";
import { Shop } from "./Shop";
import { Patents } from "./Patents";

// ───────────────────────────── level generation ─────────────────────────────

const START_CASH = 200;
const SAVE_SLOT = "hexapharma.save.slot0";

/** Default mapgen options for a fresh game (small enough to generate well under ~1s). */
export function defaultGenOptions(seed: number): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 12,
    height: 12,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 4, max: 12 },
  };
}

function genLevel(opts: GenOptions): GeneratedLevel {
  return generate(opts);
}

/** Cumulative recipe step cost = production cost per produced unit (cold path). */
export function recipeCost(recipe: Template | null): number {
  if (recipe === null) return 0;
  let total = 0;
  for (const step of recipe.steps) {
    const entry = DEFAULT_CATALOG.find((e) => e.typeId === step.typeId);
    total += entry?.cost ?? 0;
  }
  return total;
}

// ───────────────────────────── component ─────────────────────────────

type Tab = "lab" | "factory" | "shop" | "patents";

export function Game() {
  const [tab, setTab] = useState<Tab>("lab");

  // ── the one shared game state ──
  const [genOptions, setGenOptions] = useState<GenOptions>(() => defaultGenOptions(14));
  const level = useMemo<GeneratedLevel>(() => genLevel(genOptions), [genOptions]);

  const [economy, setEconomy] = useState<EconomyState>({ cash: START_CASH, sold: [] });
  const [patents, setPatents] = useState<PatentState>({ unlocked: [] });
  const [recipe, setRecipe] = useState<Template | null>(null);
  const [factory, setFactory] = useState<FactoryLayout | null>(null);
  // produced units per disease id, not yet sold.
  const [inventory, setInventory] = useState<Record<DiseaseId, number>>({});

  // rewind history of whole-game snapshots.
  const [history, setHistory] = useState<readonly GameState[]>([]);
  const [saveMsg, setSaveMsg] = useState<string>("");

  // ── build the contract GameState value from the current React state ──
  const buildGameState = useCallback((): GameState => {
    // The factory layout the save records: the current one, else the compiled
    // recipe, else an empty 1×1 grid (no production line yet).
    const fac: FactoryLayout =
      factory ?? (recipe ? compileTemplate(recipe) : { width: 1, height: 1, tiles: [{ kind: "empty" }], machines: [] });
    return {
      genOptions,
      economy,
      patents,
      factory: fac,
      rng: { s: genOptions.seed },
    };
  }, [genOptions, economy, patents, factory, recipe]);

  // ── Lab → Factory: store a WINNING template as the recipe ──
  const saveRecipe = useCallback((winning: Template) => {
    setRecipe(winning);
    setFactory(compileTemplate(winning));
    setInventory({});
    setTab("factory");
  }, []);

  // ── Factory → inventory: credit produced units to the diseases they cure ──
  // Every produced unit from the SAME layout has the SAME outcome (INV-7), so the
  // cure set is the recipe's evaluate() cured list; we credit `count` units to each.
  const curedByRecipe = useMemo<readonly DiseaseId[]>(() => {
    if (recipe === null) return [];
    const out = evaluate(level.mm, initialState(level.mm), recipe);
    return out.failed ? [] : out.cured;
  }, [recipe, level.mm]);

  const addProduced = useCallback(
    (count: number) => {
      if (count <= 0 || curedByRecipe.length === 0) return;
      setInventory((inv) => {
        const next = { ...inv };
        for (const d of curedByRecipe) next[d] = (next[d] ?? 0) + count;
        return next;
      });
    },
    [curedByRecipe],
  );

  // ── Shop → sell: mutate economy + decrement inventory ──
  const sell = useCallback(
    (disease: DiseaseId, nextEconomy: EconomyState) => {
      setEconomy(nextEconomy);
      setInventory((inv) => {
        const have = inv[disease] ?? 0;
        if (have <= 0) return inv;
        return { ...inv, [disease]: have - 1 };
      });
    },
    [],
  );

  // ── Patents → unlock; the new-map patent regenerates a deeper level ──
  const onPatents = useCallback(
    (nextPatents: PatentState, nextCash: number, regenDeeper: boolean) => {
      setPatents(nextPatents);
      setEconomy((e) => ({ ...e, cash: nextCash }));
      if (regenDeeper) {
        setGenOptions((g) => ({
          ...g,
          seed: g.seed + 1,
          width: g.width + 2,
          height: g.height + 2,
        }));
        setRecipe(null);
        setFactory(null);
        setInventory({});
      }
    },
    [],
  );

  // ── Save / Load / Rewind ──
  const save = useCallback(() => {
    const g = buildGameState();
    localStorage.setItem(SAVE_SLOT, serializeGame(g));
    setHistory((h) => pushSnapshot(h, g));
    setSaveMsg(`Saved (cash ${g.economy.cash}, seed ${g.genOptions.seed}).`);
  }, [buildGameState]);

  const applyGameState = useCallback((g: GameState) => {
    setGenOptions(g.genOptions);
    setEconomy(g.economy);
    setPatents(g.patents);
    setFactory(g.factory);
    setRecipe(null);
    setInventory({});
  }, []);

  const load = useCallback(() => {
    const raw = localStorage.getItem(SAVE_SLOT);
    if (raw === null) {
      setSaveMsg("No save found.");
      return;
    }
    const g = deserializeGame(raw);
    applyGameState(g);
    setSaveMsg(`Loaded (cash ${g.economy.cash}, seed ${g.genOptions.seed}).`);
  }, [applyGameState]);

  const doRewind = useCallback(() => {
    if (history.length === 0) {
      setSaveMsg("Nothing to rewind.");
      return;
    }
    const { state, history: trimmed } = rewind(history, Math.min(1, history.length - 1));
    applyGameState(state);
    setHistory(trimmed);
    setSaveMsg(`Rewound (cash ${state.economy.cash}, seed ${state.genOptions.seed}).`);
  }, [history, applyGameState]);

  // ───────────────────────────── styles ─────────────────────────────

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
      {/* cash + save/load bar */}
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
          Cash: <span data-testid="cash">{economy.cash}</span>
        </strong>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={save} style={bar} data-testid="save">
          Save
        </button>
        <button type="button" onClick={load} style={bar} data-testid="load">
          Load
        </button>
        <button type="button" onClick={doRewind} style={bar} data-testid="rewind" disabled={history.length === 0}>
          Rewind
        </button>
        <span data-testid="save-msg" style={{ fontSize: 12, color: "#5a6470" }}>
          {saveMsg}
        </span>
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid #b8c2cc" }}>
        {tabBtn("lab", "Lab")}
        {tabBtn("factory", "Factory")}
        {tabBtn("shop", "Shop")}
        {tabBtn("patents", "Patents")}
      </div>

      <div style={{ paddingTop: 16 }}>
        {tab === "lab" && <App level={level} onSaveRecipe={saveRecipe} />}
        {tab === "factory" && (
          <Factory level={level} recipe={recipe} factory={factory} onFactoryChange={setFactory} onProduced={addProduced} />
        )}
        {tab === "shop" && (
          <Shop level={level} economy={economy} inventory={inventory} recipeCost={recipeCost(recipe)} onSell={sell} />
        )}
        {tab === "patents" && <Patents economy={economy} patents={patents} onPatents={onPatents} />}
      </div>
    </div>
  );
}
