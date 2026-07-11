import { describe, expect, it } from "vitest";
import { DEFAULT_CATALOG, type GameState, type GenOptions } from "../sim/phase0_interfaces";
import { applyGameIntent, createGameState, hashGame } from "../sim/game";
import { generate } from "../sim/mapgen";
import { serializeGame, serializeGameAuthority, serializeSlots } from "../sim/save";
import {
  SLOT_CHECKPOINT_CHARACTER_LIMIT,
  SLOT_HISTORY_REPLAY_TICK_LIMIT,
  SLOT_HISTORY_REPLAY_WORK_LIMIT,
  SLOT_HISTORY_TRACE_ENTRY_LIMIT,
  readSlot,
  saveSlot,
} from "./checkpointStorage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }
}

const options: GenOptions = {
  seed: 14,
  nMaps: 2,
  width: 12,
  height: 12,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 2,
  difficulty: { min: 4, max: 12 },
};

describe("checkpoint storage budget", () => {
  it("retains rewind lineage across normalized tick, sale, and layout extensions", () => {
    let ticksEarlier = createGameState(options, 200, 0);
    ticksEarlier = applyGameIntent(ticksEarlier, {
      kind: "saveRecipe",
      recipe: generate(options).diseases[0]!.reference,
    });
    ticksEarlier = applyGameIntent(ticksEarlier, { kind: "factoryTicks", ticks: 20 });
    const ticksLater = applyGameIntent(ticksEarlier, { kind: "factoryTicks", ticks: 5 });

    const tickWrite = saveSlot(new MemoryStorage(), 0, [ticksEarlier], ticksLater);
    expect(tickWrite.replacedTimeline).toBe(false);
    expect(tickWrite.history).toHaveLength(2);

    const first = ticksEarlier.inventory[0]!;
    const second = ticksEarlier.inventory[1]!;
    const disease = first.outcome.cured[0]!;
    const saleEarlier = applyGameIntent(ticksEarlier, {
      kind: "sellProduct",
      productId: first.inventoryId,
      disease,
    });
    const saleLater = applyGameIntent(saleEarlier, {
      kind: "sellProduct",
      productId: second.inventoryId,
      disease,
    });
    const saleWrite = saveSlot(new MemoryStorage(), 0, [saleEarlier], saleLater);
    expect(saleWrite.replacedTimeline).toBe(false);
    expect(saleWrite.history).toHaveLength(2);

    const firstTiles = ticksEarlier.factory!.tiles.slice();
    const sourceCell = firstTiles.findIndex((tile) => tile.kind === "source");
    firstTiles[sourceCell] = { kind: "source", dir: 0, period: 2 };
    const firstLayout = { ...ticksEarlier.factory!, tiles: firstTiles };
    const secondTiles = firstTiles.slice();
    secondTiles[sourceCell] = { kind: "source", dir: 0, period: 3 };
    const layoutEarlier = applyGameIntent(ticksEarlier, {
      kind: "setFactory",
      factory: firstLayout,
    });
    const layoutLater = applyGameIntent(layoutEarlier, {
      kind: "setFactory",
      factory: { ...firstLayout, tiles: secondTiles },
    });
    const layoutWrite = saveSlot(new MemoryStorage(), 0, [layoutEarlier], layoutLater);
    expect(layoutWrite.replacedTimeline).toBe(false);
    expect(layoutWrite.history).toHaveLength(2);
  });

  it("replaces an occupied slot timeline instead of mixing a different run into rewind", () => {
    const storage = new MemoryStorage();
    const firstRun = createGameState(options, 200, 0);
    const secondRun = createGameState({ ...options, seed: 15 }, 200, 0);
    saveSlot(storage, 0, [], firstRun);

    const saved = saveSlot(storage, 0, [firstRun], secondRun);

    expect(saved.replacedTimeline).toBe(true);
    expect(saved.history).toEqual([secondRun]);
    expect(saved.pruned).toBe(1);
    const loaded = readSlot(storage, 0);
    expect(loaded.error).toBeNull();
    expect(loaded.history).toEqual([secondRun]);
  });

  it("rejects a persisted history whose snapshots are not one trace-prefix timeline", () => {
    const firstRun = createGameState(options, 200, 0);
    const secondRun = createGameState({ ...options, seed: 15 }, 200, 0);
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({
        version: 2,
        head: serializeGameAuthority(secondRun),
        history: [serializeGameAuthority(firstRun)],
      }),
    );

    const read = readSlot(storage, 0);
    expect(read.error).toMatch(/timeline|origin|prefix/i);
    expect(read.recovery?.history).toEqual([secondRun]);
  });

  it("reports mixed legacy timelines instead of throwing during migration", () => {
    const firstRun = createGameState(options, 200, 0);
    const secondRun = createGameState({ ...options, seed: 15 }, 200, 0);
    const storage = new MemoryStorage();
    storage.setItem("hexapharma.save.slot.0", serializeGame(secondRun));
    storage.setItem("hexapharma.save.history.0", serializeSlots([firstRun, secondRun]));

    const read = readSlot(storage, 0);

    expect(read.error).toMatch(/timeline|origin|prefix/i);
    expect(read.recovery?.head).toEqual(secondRun);
    expect(read.recovery?.history).toEqual([secondRun]);
  });

  it("rejects oversized canonical blobs without attempting recovery parsing", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      "x".repeat(SLOT_CHECKPOINT_CHARACTER_LIMIT + 1),
    );
    const read = readSlot(storage, 0);
    expect(read.error).toMatch(/exceeds.*slot budget/i);
    expect(read.recovery).toBeNull();
  });

  it("atomically persists long-run physical inventory as compact replay authority", () => {
    let game = createGameState(options, 200, 0);
    game = applyGameIntent(game, {
      kind: "saveRecipe",
      recipe: generate(options).diseases[0]!.reference,
    });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 6_000 });
    expect(game.inventory.length).toBeGreaterThan(5_000);
    const storage = new MemoryStorage();

    const saved = saveSlot(storage, 0, new Array(20).fill(game), game);

    const raw = storage.getItem("hexapharma.save.checkpoint.0")!;
    expect(storage.writes).toBe(1);
    expect(raw.length).toBeLessThanOrEqual(SLOT_CHECKPOINT_CHARACTER_LIMIT);
    expect(saved.pruned).toBeGreaterThan(1);
    expect(
      saved.history.reduce((total, state) => total + state.replayTicks, 0),
    ).toBeLessThanOrEqual(SLOT_HISTORY_REPLAY_TICK_LIMIT);
    const envelope = JSON.parse(raw) as { head: string; history: string[] };
    expect(envelope.history).toHaveLength(saved.history.length - 1);
    expect(envelope.head).toBeTruthy();

    const loaded = readSlot(storage, 0);
    expect(loaded.error).toBeNull();
    expect(loaded.head).toEqual(saved.head);
    expect(loaded.history).toEqual(saved.history);

    const hostile = new MemoryStorage();
    hostile.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({ version: 2, head: envelope.head, history: [envelope.head, envelope.head] }),
    );
    const hostileRead = readSlot(hostile, 0);
    expect(hostileRead.error).toMatch(/replay.*budget|12000/i);
    expect(hostileRead.recovery?.head).toEqual(game);
    expect(hostileRead.recovery?.history).toHaveLength(1);
  }, 15_000);

  it("preflights cumulative trace work before replaying checkpoint history", () => {
    const authority = JSON.parse(serializeGameAuthority(createGameState(options, 200, 0))) as {
      authority: { intentTrace: unknown[]; replayTicks: number };
    };
    authority.authority.intentTrace = new Array(4_096).fill({ kind: "resetFactory" });
    authority.authority.replayTicks = 0;
    const rawAuthority = JSON.stringify(authority);
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({ version: 2, head: rawAuthority, history: [rawAuthority, rawAuthority] }),
    );

    const read = readSlot(storage, 0);
    expect(read.error).toMatch(new RegExp(`trace.*${SLOT_HISTORY_TRACE_ENTRY_LIMIT}|trace.*budget`, "i"));
  });

  it("preflights cumulative weighted work before replaying checkpoint history", () => {
    const authority = JSON.parse(
      serializeGameAuthority(createGameState(options, 200, 0)),
    ) as {
      authority: {
        origin: { genOptions: GenOptions };
        intentTrace: unknown[];
      };
    };
    authority.authority.origin.genOptions = {
      ...options,
      nMaps: 4,
      width: 32,
      height: 32,
      diseaseCount: 4,
    };
    authority.authority.intentTrace = new Array(4_096).fill({
      kind: "runLab",
      template: { steps: [] },
    });
    const rawAuthority = JSON.stringify(authority);
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({ version: 2, head: rawAuthority, history: [rawAuthority] }),
    );

    const read = readSlot(storage, 0);
    expect(read.error).toMatch(
      new RegExp(`weighted.*${SLOT_HISTORY_REPLAY_WORK_LIMIT}|weighted.*budget`, "i"),
    );
  });

  it("computes replay ticks from the raw trace instead of trusting declared metadata", () => {
    let game = createGameState(options, 200, 0);
    game = applyGameIntent(game, {
      kind: "saveRecipe",
      recipe: generate(options).diseases[0]!.reference,
    });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 20 });
    const authority = JSON.parse(serializeGameAuthority(game)) as {
      authority: { replayTicks: number };
    };
    authority.authority.replayTicks = 0;
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({ version: 2, head: JSON.stringify(authority), history: [] }),
    );

    expect(readSlot(storage, 0).error).toMatch(/computed trace total/i);
  });

  it("offers valid earlier-history recovery when the checkpoint head is unusable", () => {
    const game = createGameState(options, 200, 0);
    const good = serializeGameAuthority(game);
    const badHead = JSON.parse(good) as { authority: { replayTicks: number } };
    badHead.authority.replayTicks = SLOT_HISTORY_REPLAY_TICK_LIMIT + 1;
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({ version: 2, head: JSON.stringify(badHead), history: [good] }),
    );

    const read = readSlot(storage, 0);
    expect(read.error).not.toBeNull();
    expect(read.recovery?.head).toEqual(game);
    expect(read.recovery?.history).toEqual([game]);
  });

  it("retains the newest valid recovery suffix when an older history entry is corrupt", () => {
    const game = createGameState(options, 200, 0);
    const good = serializeGameAuthority(game);
    const corrupt = JSON.parse(good) as { authority: { stateHash: number } };
    corrupt.authority.stateHash = (corrupt.authority.stateHash + 1) >>> 0;
    const bad = JSON.stringify(corrupt);
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({ version: 2, head: bad, history: [bad, good] }),
    );

    const read = readSlot(storage, 0);
    expect(read.error).not.toBeNull();
    expect(read.recovery?.head).toEqual(game);
    expect(read.recovery?.history).toEqual([game]);
  });

  it("skips a malformed history tail and recovers the newest earlier valid snapshot", () => {
    const game = createGameState(options, 200, 0);
    const good = serializeGameAuthority(game);
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({
        version: 2,
        head: "invalid authority",
        history: [good, "malformed authority"],
      }),
    );

    const read = readSlot(storage, 0);
    expect(read.error).not.toBeNull();
    expect(read.recovery?.head).toEqual(game);
    expect(read.recovery?.history).toEqual([game]);
  });

  it("recovers compact history whose materialized full-save wire exceeds its separate cap", () => {
    let game = createGameState(options, 200, 0);
    game = applyGameIntent(game, {
      kind: "saveRecipe",
      recipe: generate(options).diseases[0]!.reference,
    });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 24_500 });
    const beforeRejectedBatch = game;
    const beforeRejectedHash = hashGame(game);
    expect(() => applyGameIntent(game, { kind: "factoryTicks", ticks: 20 })).toThrow(
      /inventory exceeds/i,
    );
    expect(game).toBe(beforeRejectedBatch);
    expect(hashGame(game)).toBe(beforeRejectedHash);
    expect(() => serializeGame(game)).toThrow(/save exceeds/i);
    const authority = serializeGameAuthority(game);
    const storage = new MemoryStorage();
    storage.setItem(
      "hexapharma.save.checkpoint.0",
      JSON.stringify({ version: 2, head: "invalid authority", history: [authority] }),
    );

    const read = readSlot(storage, 0);
    expect(read.error).not.toBeNull();
    expect(read.recovery?.head).toEqual(game);
    expect(read.recovery?.history).toEqual([game]);
  }, 15_000);

  it("refuses invalid state before writing and cold-clones retained runtime ownership", () => {
    let game = createGameState(options, 200, 0);
    game = applyGameIntent(game, {
      kind: "saveRecipe",
      recipe: generate(options).diseases[0]!.reference,
    });
    const invalid: GameState = {
      ...game,
      economy: { ...game.economy, cash: game.economy.cash + 1 },
    };
    const rejectedStorage = new MemoryStorage();
    expect(() => saveSlot(rejectedStorage, 0, [], invalid)).toThrow(/replay mismatch|cash/i);
    expect(rejectedStorage.writes).toBe(0);

    const storage = new MemoryStorage();
    const saved = saveSlot(storage, 0, [], game);
    expect(saved.head).not.toBe(game);
    expect(saved.head.factoryState).not.toBe(game.factoryState);
    const slot = game.factoryState!.capacity - 1;
    const retained = saved.head.factoryState!.unitX[slot];
    game.factoryState!.unitX[slot] = retained === 0 ? 1 : 0;
    expect(saved.head.factoryState!.unitX[slot]).toBe(retained);
  });
});
