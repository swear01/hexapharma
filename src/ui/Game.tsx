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
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Template,
  GenOptions,
  GeneratedLevel,
  EconomyState,
  PatentState,
  FactoryLayout,
  GameState,
  DiseaseId,
  MultiMap,
} from "../sim/phase0_interfaces";
import { DEFAULT_CATALOG } from "../sim/phase0_interfaces";
import { generate } from "../sim/mapgen";
import { evaluate, initialState } from "../sim/drug-graph";
import { compileTemplate } from "../sim/recipe";
import { activeEffects, DEFAULT_PATENTS } from "../sim/patent";
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

/**
 * Map dimension for a level with `nMaps` maps. The solver runs during generate and
 * is a BFS over (W·H)^N tuples, so maps must SHRINK as N grows to stay tractable:
 * N=2 stays larger, N=3 → ~7×7, N=4 → ~6×6 (matches the mapgen size guidance).
 */
function dimsForN(nMaps: number): number {
  if (nMaps >= 4) return 6;
  if (nMaps === 3) return 7;
  return 12;
}

/** Default mapgen options for a fresh game (small enough to generate well under ~1s). */
export function defaultGenOptions(seed: number, nMaps = 2): GenOptions {
  const dim = dimsForN(nMaps);
  return {
    seed,
    nMaps,
    width: dim,
    height: dim,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 4, max: 12 },
  };
}

/**
 * Initial options for the game. Defaults to seed 14, N=2; a `?nmaps=` (2..4) and/or
 * `?seed=` query param overrides the STARTING level so a deeper (N≥3) layout can be
 * loaded directly (e.g. for the N-map render test / a deep-map playtest). The default
 * player path to deeper maps is still the new-map patent.
 */
function initialGenOptions(): GenOptions {
  let seed = 14;
  let nMaps = 2;
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    const rawSeed = q.get("seed");
    if (rawSeed !== null) {
      const s = Number(rawSeed);
      if (Number.isInteger(s)) seed = s;
    }
    const rawN = q.get("nmaps");
    if (rawN !== null) {
      const n = Number(rawN);
      if (Number.isInteger(n) && n >= 2 && n <= 4) nMaps = n;
    }
  }
  return defaultGenOptions(seed, nMaps);
}

function genLevel(opts: GenOptions): GeneratedLevel {
  return generate(opts);
}

// ───────────────────────────── persistent fog (UI view-state) ─────────────────────────────
//
// Genuine exploration: the Game keeps ONE Uint8Array per map (0 = fogged, 1 =
// revealed) that PERSISTS across Lab runs/resets. Each Run unions the cells the sim
// reports revealed (`revealAlong`) into it; reveal-aid patents pre-reveal a radius
// around each start. We never mutate the sim's own fog arrays — these are our own.

/** Fresh all-fogged arrays (all 0) sized to a level's maps. */
function freshFog(mm: MultiMap): Uint8Array[] {
  return mm.maps.map((m) => new Uint8Array(m.width * m.height));
}

/** OR `src` fog (the sim-revealed MultiMap) into the persistent `dst`; returns new arrays if anything changed. */
function unionFog(dst: readonly Uint8Array[], src: MultiMap): Uint8Array[] | null {
  let changed = false;
  const out = dst.map((arr, i) => {
    const from = src.maps[i]?.fog;
    if (from === undefined) return arr;
    let copy: Uint8Array | null = null;
    for (let k = 0; k < arr.length; k++) {
      if ((from[k] ?? 0) === 1 && arr[k] === 0) {
        if (copy === null) copy = Uint8Array.from(arr);
        copy[k] = 1;
        changed = true;
      }
    }
    return copy ?? arr;
  });
  return changed ? out : null;
}

/**
 * Reveal a Chebyshev radius `r` (in cells) around each map's `start` into a COPY of
 * the persistent fog. Deterministic; idempotent (only sets bits). r <= 0 is a no-op.
 */
function revealAidFog(fog: readonly Uint8Array[], mm: MultiMap, r: number): Uint8Array[] | null {
  if (r <= 0) return null;
  let changed = false;
  const out = fog.map((arr, i) => {
    const map = mm.maps[i];
    if (map === undefined) return arr;
    const { x: sx, y: sy } = map.start;
    let copy: Uint8Array | null = null;
    for (let dy = -r; dy <= r; dy++) {
      const y = sy + dy;
      if (y < 0 || y >= map.height) continue;
      for (let dx = -r; dx <= r; dx++) {
        const x = sx + dx;
        if (x < 0 || x >= map.width) continue;
        const k = y * map.width + x;
        if (arr[k] === 0) {
          if (copy === null) copy = Uint8Array.from(arr);
          copy[k] = 1;
          changed = true;
        }
      }
    }
    return copy ?? arr;
  });
  return changed ? out : null;
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
  const [genOptions, setGenOptions] = useState<GenOptions>(() => initialGenOptions());
  const level = useMemo<GeneratedLevel>(() => genLevel(genOptions), [genOptions]);

  const [economy, setEconomy] = useState<EconomyState>({ cash: START_CASH, sold: [] });
  const [patents, setPatents] = useState<PatentState>({ unlocked: [] });
  const [recipe, setRecipe] = useState<Template | null>(null);
  const [factory, setFactory] = useState<FactoryLayout | null>(null);
  // produced units per disease id, not yet sold.
  const [inventory, setInventory] = useState<Record<DiseaseId, number>>({});

  // Persistent exploration fog (one Uint8Array per map), accumulated across runs.
  const [fog, setFog] = useState<readonly Uint8Array[]>(() => freshFog(level.mm));

  // rewind history of whole-game snapshots.
  const [history, setHistory] = useState<readonly GameState[]>([]);
  const [saveMsg, setSaveMsg] = useState<string>("");

  // Patent effects (reveal-aid amount, etc.) summarized from the unlocked nodes.
  const eff = useMemo(() => activeEffects(DEFAULT_PATENTS, patents), [patents]);

  // A NEW level (different mm identity) starts fresh fog, immediately seeded with the
  // current reveal-aid radius around each start (deterministic). Loading/regenerating
  // a level swaps `level`, so this resets exploration correctly.
  // Depends ONLY on the level identity (not revealAid) so a later patent unlock never
  // wipes accumulated exploration; the next effect folds revealAid growth in-place.
  useEffect(() => {
    const base = freshFog(level.mm);
    const aided = revealAidFog(base, level.mm, eff.revealAid);
    setFog(aided ?? base);
  }, [level.mm]);

  // When reveal-aid grows (a patent unlock) on the SAME level, union the new radius
  // into the existing fog without un-exploring anything.
  useEffect(() => {
    setFog((f) => revealAidFog(f, level.mm, eff.revealAid) ?? f);
  }, [eff.revealAid, level.mm]);

  // Union the cells a Lab run revealed (sim `revealAlong` output) into persistent fog.
  const revealFromRun = useCallback((revealed: MultiMap) => {
    setFog((f) => unionFog(f, revealed) ?? f);
  }, []);

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

  // ── Patents → unlock; the new-map patent regenerates a DEEPER level ──
  // Deeper = one more ingredient map (capped at 4); dims shrink with N so the solver
  // (run during generate) stays tractable. Recipe/factory/inventory reset + the level
  // swap re-fogs via the level effect; cash + patents are kept.
  const onPatents = useCallback(
    (nextPatents: PatentState, nextCash: number, regenDeeper: boolean) => {
      setPatents(nextPatents);
      setEconomy((e) => ({ ...e, cash: nextCash }));
      if (regenDeeper) {
        setGenOptions((g) => {
          const nMaps = Math.min(4, g.nMaps + 1);
          const dim = dimsForN(nMaps);
          return { ...g, seed: g.seed + 1, nMaps, width: dim, height: dim };
        });
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
        {tab === "lab" && (
          <App level={level} fog={fog} onReveal={revealFromRun} onSaveRecipe={saveRecipe} />
        )}
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
