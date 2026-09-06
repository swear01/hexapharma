import { describe, expect, it } from "vitest";
import {
  BASE_GAME_FACTORY_HEIGHT, BASE_GAME_FACTORY_WIDTH, DEFAULT_CATALOG,
  type FactoryLayout, type GameState, type GenOptions, type Template,
} from "../sim/phase0_interfaces";
import { applyGameIntent, availableCatalog, createGameState, hashGame } from "../sim/game";
import { generate } from "../sim/mapgen";
import { compileEntitledPrototype, compilePrototype } from "../sim/recipe";
import { SAVE_VERSION, serializeGame, serializeSnapshot } from "../sim/save";
import {
  SLOT_CHECKPOINT_CHARACTER_LIMIT, SLOT_HISTORY_LIMIT,
  readSlot, saveSlot, rewindSlot, recoverSlot,
} from "./checkpointStorage";

const key = `hexapharma.save.v${SAVE_VERSION}.checkpoint.0`;
function checkpoint(head: string, history: readonly string[] = []): string {
  return JSON.stringify({ version: 2, head, history });
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;
  failOnSet: string | null = null;
  failOnGet: string | null = null;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    if (key === this.failOnGet) throw new Error("storage access denied");
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    if (key === this.failOnSet) throw new Error(`storage write rejected for ${key}`);
    this.writes += 1;
    this.values.set(key, value);
  }
}

const options: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 32,
  height: 32,
  catalog: availableCatalog({ unlocked: [] }),
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
const fastOptions: GenOptions = {
  ...options,
  nMaps: 1,
  catalog: [push],
  diseaseCount: 1,
  difficulty: { min: 1, max: 1 },
};
const PRODUCTION_CASH = 100_000;

function withProduction(
  game: GameState,
  recipe: Template,
  layout: FactoryLayout = compileEntitledPrototype(
    recipe,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout,
): GameState {
  let next = applyGameIntent(game, { kind: "beginResearchShot" });
  for (const machine of recipe.steps) {
    next = applyGameIntent(next, { kind: "advanceResearchShot", machine });
    if (next.research.shot === null) break;
  }
  if (next.research.shot !== null) throw new Error("test Research shot did not finish");
  next = applyGameIntent(next, { kind: "setPilotLayout", layout });
  return applyGameIntent(next, { kind: "buildProductionLayout", layout });
}

describe("open snapshot checkpoint storage", () => {
  it("continues saving and rewinding beyond the old lifetime budgets with bounded history", () => {
    const storage = new MemoryStorage();
    let game = createGameState(options, 1000, 0);
    let history: readonly GameState[] = [];
    for (let index = 0; index < 41; index++) {
      game = applyGameIntent(game, { kind: "productionTicks", ticks: 5000 });
      history = saveSlot(storage, 0, history, game).history;
    }
    expect(game.production.runtime.tick).toBe(205000);
    expect(history).toHaveLength(SLOT_HISTORY_LIMIT);
    const loaded = readSlot(storage, 0);
    expect(loaded.error).toBeNull();
    expect(hashGame(loaded.head!)).toBe(hashGame(game));
    const recalled = rewindSlot(storage, 0, loaded.history!);
    expect(recalled.head.production.runtime.tick).toBe(200000);
    expect(readSlot(storage, 0).history).toHaveLength(SLOT_HISTORY_LIMIT - 1);
    expect(readSlot(storage, 0).head).toEqual(recalled.head);
  });

  it("preserves edited resource values without proving a trace-prefix lineage", () => {
    const storage = new MemoryStorage();
    const first = createGameState(options, 1000, 0);
    const edited = { ...first, economy: { ...first.economy, cash: 999999, research: 500 } };
    const saved = saveSlot(storage, 0, [first], edited);
    expect(saved.replacedTimeline).toBe(false);
    expect(readSlot(storage, 0).head!.economy).toEqual(edited.economy);
    expect(rewindSlot(storage, 0, saved.history).head).toEqual(first);
    const raw = JSON.parse(storage.getItem(key)!) as { head: string; history: string[] };
    const head = JSON.parse(raw.head);
    head.snapshot.economy.cash = 123;
    storage.setItem(key, checkpoint(JSON.stringify(head), raw.history));
    expect(readSlot(storage, 0).head!.economy.cash).toBe(123);
  });

  it("replaces a different map when saving and preserves old namespaces without migration", () => {
    const storage = new MemoryStorage();
    storage.setItem("hexapharma.save.v10.checkpoint.0", "old alpha save");
    expect(readSlot(storage, 0).head).toBeNull();
    const first = createGameState(options, 200, 0);
    const second = createGameState({ ...options, seed: 15 }, 200, 0);
    const saved = saveSlot(storage, 0, [first], second);
    expect(saved.replacedTimeline).toBe(true);
    expect(saved.pruned).toBe(1);
    expect(readSlot(storage, 0).history).toEqual([second]);
    expect(storage.getItem("hexapharma.save.v10.checkpoint.0")).toBe("old alpha save");
  });

  it("rejects mixed-map stored history and offers the current map's valid suffix", () => {
    const storage = new MemoryStorage();
    const first = createGameState(options, 200, 0);
    const second = createGameState({ ...options, seed: 15 }, 200, 0);
    storage.setItem(key, checkpoint(serializeSnapshot(second), [serializeSnapshot(first)]));
    const read = readSlot(storage, 0);
    expect(read.error).toMatch(/different maps/i);
    expect(read.recovery?.history).toEqual([second]);
  });

  it("preserves Research, Plan, paid Production and in-flight state without replay", () => {
    const recipe = generate(options).diseases[0]!.reference;
    let game = withProduction(createGameState(options, PRODUCTION_CASH, 0), recipe);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 80 });
    expect(game.production.runtime.unitCount).toBeGreaterThan(0);
    const storage = new MemoryStorage();
    saveSlot(storage, 0, [], game);
    const raw = storage.getItem(key)!;
    expect(raw).not.toContain("intentTrace");
    expect(raw).not.toContain("stateHash");
    const loaded = readSlot(storage, 0).head!;
    expect(loaded).toEqual(game);
    expect(loaded.production.runtime).not.toBe(game.production.runtime);
    const intent = { kind: "productionTicks", ticks: 100 } as const;
    expect(applyGameIntent(loaded, intent)).toEqual(applyGameIntent(game, intent));
  });

  it("bounds raw characters, version and snapshot count before attempting state recovery", () => {
    const storage = new MemoryStorage();
    const good = serializeSnapshot(createGameState(options, 200, 0));
    for (const raw of [
      JSON.stringify({ version: 2, head: good, history: [], extra: "x".repeat(SLOT_CHECKPOINT_CHARACTER_LIMIT) }),
      checkpoint(good, new Array(SLOT_HISTORY_LIMIT).fill(good)),
      JSON.stringify({ version: 1, head: good, history: [] }),
      JSON.stringify({ version: 2, head: good, history: [] }).slice(0, -1),
    ]) {
      storage.setItem(key, raw);
      const read = readSlot(storage, 0);
      expect(read.error).not.toBeNull();
      expect(read.recovery).toBeNull();
      expect(storage.getItem(key)).toBe(raw);
    }
  });

  it("offers explicit recovery from bounded partial envelopes while Load remains strict", () => {
    const game = createGameState(options, 200, 0);
    const good = serializeSnapshot(game);
    for (const envelope of [
      { version: 2, head: null, history: [good] },
      { version: 2, head: good, history: [], extra: true },
      { version: 2, history: [false, good, null] },
    ]) {
      const storage = new MemoryStorage();
      const raw = JSON.stringify(envelope);
      storage.setItem(key, raw);
      const read = readSlot(storage, 0);
      expect(read.error).not.toBeNull();
      expect(read.head).toBeNull();
      expect(read.history).toBeNull();
      expect(read.recovery?.history).toEqual([game]);
      expect(storage.writes).toBe(1);
      expect(storage.getItem(key)).toBe(raw);
      storage.failOnSet = key;
      expect(() => recoverSlot(storage, 0, game, read.recovery)).toThrow(/write rejected/);
      expect(storage.getItem(key)).toBe(raw);
      storage.failOnSet = null;
      recoverSlot(storage, 0, game, read.recovery);
      expect(readSlot(storage, 0).head).toEqual(game);
      expect(readSlot(storage, 0).error).toBeNull();
    }
  });

  it("reports storage read failures with their cause and disables overwrite recovery", () => {
    const storage = new MemoryStorage();
    const raw = checkpoint(serializeSnapshot(createGameState(options, 200, 0)));
    storage.setItem(key, raw);
    storage.failOnGet = key;
    const read = readSlot(storage, 0);
    expect(read.error).toMatch(/cannot read storage: storage access denied/i);
    expect(read.canRecover).toBe(false);
    expect(read.recovery).toBeNull();
    expect(storage.writes).toBe(1);
    storage.failOnGet = null;
    expect(storage.getItem(key)).toBe(raw);
    expect(readSlot(storage, 0).error).toBeNull();
  });

  it("does not join older snapshots across a non-string corruption gap", () => {
    const first = createGameState(options, 200, 0);
    const latest = applyGameIntent(first, { kind: "productionTicks", ticks: 1 });
    const raw = JSON.stringify({
      version: 2,
      head: serializeSnapshot(latest),
      history: [serializeSnapshot(first), null],
    });
    const storage = new MemoryStorage();
    storage.setItem(key, raw);
    const read = readSlot(storage, 0);
    expect(read.head).toBeNull();
    expect(read.error).toMatch(/entry must be a string/);
    expect(read.recovery?.history).toEqual([latest]);
    expect(storage.getItem(key)).toBe(raw);
    expect(storage.writes).toBe(1);
  });

  it("recovers only a valid suffix after invalid snapshots without writing during read", () => {
    const game = createGameState(options, 200, 0);
    const good = serializeSnapshot(game);
    for (const earlier of [[good], ["bad", good], [good, "bad"]]) {
      const storage = new MemoryStorage();
      const raw = checkpoint("bad head", earlier);
      storage.setItem(key, raw);
      const read = readSlot(storage, 0);
      expect(read.error).not.toBeNull();
      expect(read.recovery?.history).toEqual([game]);
      expect(storage.writes).toBe(1);
      expect(storage.getItem(key)).toBe(raw);
      recoverSlot(storage, 0, game, read.recovery);
      expect(readSlot(storage, 0).error).toBeNull();
      expect(readSlot(storage, 0).head).toEqual(game);
    }
  });

  it("does not recover a snapshot from a different content build", () => {
    const raw = JSON.parse(serializeSnapshot(createGameState(options, 200, 0)));
    raw.contentBuild = "stale-economy";
    const storage = new MemoryStorage();
    storage.setItem(key, checkpoint(JSON.stringify(raw)));
    expect(readSlot(storage, 0).error).toMatch(/incompatible content build/i);
    expect(readSlot(storage, 0).recovery).toBeNull();
  });

  it("fits a full 24500-product warehouse without increasing the slot budget", () => {
    let game = createGameState(fastOptions, PRODUCTION_CASH, 0);
    const recipe = generate(fastOptions).diseases[0]!.reference;
    const row = Math.floor(BASE_GAME_FACTORY_HEIGHT / 2);
    const layout = compilePrototype(recipe, BASE_GAME_FACTORY_WIDTH, BASE_GAME_FACTORY_HEIGHT,
      recipe.steps.map((_, index) => ({ anchor: { q: 1 + index * 2, r: row }, footRot: 0 })));
    game = withProduction(game, recipe, layout);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 49022 });
    expect(game.inventory).toHaveLength(24500);
    expect(serializeGame(game).length).toBeGreaterThan(SLOT_CHECKPOINT_CHARACTER_LIMIT);
    const before = hashGame(game);
    expect(() => applyGameIntent(game, { kind: "productionTicks", ticks: 200 })).toThrow(/inventory exceeds/i);
    expect(hashGame(game)).toBe(before);
    const storage = new MemoryStorage();
    const saved = saveSlot(storage, 0, new Array(20).fill(game), game);
    expect(saved.pruned).toBeGreaterThan(0);
    expect(storage.getItem(key)!.length).toBeLessThanOrEqual(SLOT_CHECKPOINT_CHARACTER_LIMIT);
    const loaded = readSlot(storage, 0);
    expect(loaded.error).toBeNull();
    expect(loaded.head).toEqual(game);
    const first = loaded.head!.inventory[0]!;
    const sold = applyGameIntent(loaded.head!, {
      kind: "sellProduct", productId: first.inventoryId, disease: first.outcome.cured[0]!,
    });
    expect(() => applyGameIntent(sold, { kind: "productionTicks", ticks: 1 })).not.toThrow();
  }, 15000);

  it("keeps storage unchanged when Save, Rewind or Recover cannot write", () => {
    const storage = new MemoryStorage();
    const first = createGameState(options, 200, 0);
    const next = applyGameIntent(first, { kind: "productionTicks", ticks: 1 });
    const saved = saveSlot(storage, 0, [first], next);
    const raw = storage.getItem(key);
    storage.failOnSet = key;
    expect(() => saveSlot(storage, 0, saved.history, next)).toThrow(/write rejected/i);
    expect(() => rewindSlot(storage, 0, saved.history)).toThrow(/write rejected/i);
    expect(() => recoverSlot(storage, 0, first, null)).toThrow(/write rejected/i);
    expect(storage.getItem(key)).toBe(raw);
  });

  it("rejects invalid state before writing and isolates saved mutable buffers", () => {
    const game = withProduction(createGameState(options, PRODUCTION_CASH, 0), generate(options).diseases[0]!.reference);
    const storage = new MemoryStorage();
    expect(() => saveSlot(storage, 0, [], { ...game, economy: { ...game.economy, cash: NaN } }))
      .toThrow(/cash/i);
    expect(storage.writes).toBe(0);
    const saved = saveSlot(storage, 0, [], game);
    expect(saved.head).not.toBe(game);
    const cell = game.fog[0]![0];
    game.fog[0]![0] = cell === 0 ? 1 : 0;
    expect(saved.head.fog[0]![0]).toBe(cell);
    const slot = game.production.runtime.capacity - 1;
    game.production.runtime.unitX[slot] = 1;
    expect(saved.head.production.runtime.unitX[slot]).toBe(0);
  });
});
