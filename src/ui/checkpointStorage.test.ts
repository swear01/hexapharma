import { describe, expect, it } from "vitest";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  type FactoryLayout,
  type GameState,
  type GenOptions,
  type Template,
} from "../sim/phase0_interfaces";
import { applyGameIntent, availableCatalog, createGameState, hashGame } from "../sim/game";
import { generate } from "../sim/mapgen";
import { compileEntitledPrototype, compilePrototype } from "../sim/recipe";
import { serializeGame, serializeGameAuthority, serializeSlots } from "../sim/save";
import {
  SLOT_CHECKPOINT_CHARACTER_LIMIT,
  SLOT_HISTORY_REPLAY_TICK_LIMIT,
  SLOT_HISTORY_REPLAY_WORK_LIMIT,
  SLOT_HISTORY_TRACE_ENTRY_LIMIT,
  finishMigration,
  readSlot,
  saveSlot,
} from "./checkpointStorage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  writes = 0;
  failOnSet: string | null = null;

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

function withProduction(
  game: GameState,
  recipe: Template,
  layout: FactoryLayout = compileEntitledPrototype(
    recipe,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout,
): GameState {
  let next = applyGameIntent(game, { kind: "setResearchProgram", program: recipe });
  next = applyGameIntent(next, { kind: "beginResearchShot" });
  for (let guard = 0; next.research.shot !== null && guard <= recipe.steps.length; guard++) {
    next = applyGameIntent(next, { kind: "advanceResearchShot" });
  }
  if (next.research.shot !== null) throw new Error("test Research shot did not finish");
  next = applyGameIntent(next, { kind: "setPilotLayout", layout });
  return applyGameIntent(next, { kind: "sendPilotToProduction" });
}

describe("checkpoint storage budget", () => {
  it("retains rewind lineage across normalized tick, sale, program, and layout extensions", () => {
    const recipe = generate(options).diseases[0]!.reference;
    const layout = compileEntitledPrototype(
      recipe,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    let ticksEarlier = withProduction(createGameState(options, 200, 0), recipe, layout);
    ticksEarlier = applyGameIntent(ticksEarlier, { kind: "productionTicks", ticks: 500 });
    const ticksLater = applyGameIntent(ticksEarlier, { kind: "productionTicks", ticks: 5 });

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

    const firstTiles = layout.tiles.slice();
    const sourceCell = firstTiles.findIndex((tile) => tile.kind === "source");
    firstTiles[sourceCell] = { kind: "source", dir: 0, period: 2 };
    const firstLayout = { ...layout, tiles: firstTiles };
    const secondTiles = firstTiles.slice();
    secondTiles[sourceCell] = { kind: "source", dir: 0, period: 3 };
    const secondLayout = { ...firstLayout, tiles: secondTiles };
    const shorterProgram = { steps: recipe.steps.slice(0, -1) };
    const programEarlier = applyGameIntent(createGameState(options, 200, 0), {
      kind: "setResearchProgram",
      program: shorterProgram,
    });
    const programLater = applyGameIntent(programEarlier, {
      kind: "setResearchProgram",
      program: recipe,
    });
    const programWrite = saveSlot(new MemoryStorage(), 0, [programEarlier], programLater);
    expect(programWrite.replacedTimeline).toBe(false);
    expect(programWrite.history).toHaveLength(2);

    for (const kind of ["setPilotLayout", "setProductionLayout"] as const) {
      const origin = kind === "setProductionLayout"
        ? withProduction(createGameState(options, 200, 0), recipe, layout)
        : createGameState(options, 200, 0);
      const layoutEarlier = applyGameIntent(origin, {
        kind,
        layout: firstLayout,
      });
      const layoutLater = applyGameIntent(layoutEarlier, { kind, layout: secondLayout });
      const layoutWrite = saveSlot(new MemoryStorage(), 0, [layoutEarlier], layoutLater);
      expect(layoutWrite.replacedTimeline).toBe(false);
      expect(layoutWrite.history).toHaveLength(2);
    }
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

  it("persists v6 ResearchProgram and independent no-contract Pilot commission authority", () => {
    const recipe = generate(fastOptions).diseases[0]!.reference;
    const game = withProduction(createGameState(fastOptions, 200, 0), recipe);
    const storage = new MemoryStorage();
    saveSlot(storage, 0, [], game);

    const checkpoint = JSON.parse(storage.getItem("hexapharma.save.checkpoint.0")!) as {
      head: string;
    };
    expect(checkpoint.head).toContain('"version":6');
    expect(checkpoint.head).toContain('"kind":"setResearchProgram"');
    expect(checkpoint.head).toContain('"kind":"setPilotLayout"');
    expect(checkpoint.head).toContain('"kind":"sendPilotToProduction"');
    expect(checkpoint.head).not.toContain("setResearchLayout");
    expect(checkpoint.head).not.toContain("sendResearchToPilot");
    expect(checkpoint.head).not.toContain('"contract"');

    const loaded = readSlot(storage, 0).head!;
    expect(loaded.research.program).toEqual(recipe);
    expect(loaded.production.layout).toEqual(loaded.pilot.layout);
    expect(loaded.production.layout).not.toBe(loaded.pilot.layout);
    expect("contract" in loaded.pilot).toBe(false);
    expect("contract" in loaded.production).toBe(false);
  });

  it("migrates only validated v6 data from legacy storage keys and makes write failure visible", () => {
    const machine = options.catalog[0]!;
    const game = applyGameIntent(createGameState(options, 200, 0), {
      kind: "setResearchProgram",
      program: { steps: [{ typeId: machine.typeId, path: machine.path, stroke: 1 }] },
    });
    const head = serializeGame(game);
    const history = serializeSlots([game]);
    const storage = new MemoryStorage();
    storage.setItem("hexapharma.save.slot.0", head);
    storage.setItem("hexapharma.save.history.0", history);

    const pending = readSlot(storage, 0);
    expect(pending.error).toBeNull();
    expect(pending.notice).toMatch(/validated.*ready to migrate/i);
    expect(pending.migration).not.toBeNull();
    expect(storage.getItem("hexapharma.save.checkpoint.0")).toBeNull();

    storage.failOnSet = "hexapharma.save.checkpoint.0";
    const failed = finishMigration(storage, 0, pending);
    expect(failed.error).toMatch(/migration failed.*write rejected/i);
    expect(failed.recovery?.head).toEqual(game);
    expect(failed.migration).toBeNull();
    expect(storage.getItem("hexapharma.save.slot.0")).toBe(head);
    expect(storage.getItem("hexapharma.save.checkpoint.0")).toBeNull();
    expect(storage.writes).toBe(2);

    storage.failOnSet = null;
    const migrated = finishMigration(storage, 0, pending);
    expect(migrated.error).toBeNull();
    expect(migrated.notice).toMatch(/migrated slot 1/i);
    expect(migrated.migration).toBeNull();
    expect(storage.writes).toBe(3);
    expect(readSlot(storage, 0).head).toEqual(game);
  });

  it("visibly rejects v5 legacy saves without reinterpreting or overwriting them", () => {
    const game = createGameState(options, 200, 0);
    const parsed = JSON.parse(serializeGame(game)) as { version: number };
    parsed.version = 5;
    const rawV5 = JSON.stringify(parsed);
    const storage = new MemoryStorage();
    storage.setItem("hexapharma.save.slot.0", rawV5);

    const read = readSlot(storage, 0);
    expect(read.error).toMatch(/legacy version 5.*not supported.*v6/i);
    expect(read.head).toBeNull();
    expect(read.recovery).toBeNull();
    expect(read.migration).toBeNull();
    expect(storage.getItem("hexapharma.save.slot.0")).toBe(rawV5);
    expect(storage.getItem("hexapharma.save.checkpoint.0")).toBeNull();
  });

  it("offers v6 history recovery when a checkpoint head is an explicitly rejected v5 authority", () => {
    const game = createGameState(options, 200, 0);
    const good = serializeGameAuthority(game);
    const parsed = JSON.parse(good) as { version: number };
    parsed.version = 5;
    const oldHead = JSON.stringify(parsed);
    const raw = JSON.stringify({ version: 2, head: oldHead, history: [good] });
    const storage = new MemoryStorage();
    storage.setItem("hexapharma.save.checkpoint.0", raw);

    const read = readSlot(storage, 0);
    expect(read.error).toMatch(/legacy version 5.*not supported.*v6/i);
    expect(read.recovery?.head).toEqual(game);
    expect(read.recovery?.history).toEqual([game]);
    expect(read.migration).toBeNull();
    expect(storage.getItem("hexapharma.save.checkpoint.0")).toBe(raw);
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
    const recipe = generate(fastOptions).diseases[0]!.reference;
    let game = withProduction(createGameState(fastOptions, 200, 0), recipe);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 12_000 });
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
    authority.authority.intentTrace = new Array(4_096).fill({ kind: "resetProduction" });
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
    const recipe = generate(authority.authority.origin.genOptions).diseases[0]!.reference;
    authority.authority.intentTrace = [
      { kind: "setResearchProgram", program: recipe },
      ...new Array(3_000).fill({ kind: "advanceResearchShot" }),
    ];
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
    const recipe = generate(options).diseases[0]!.reference;
    let game = withProduction(createGameState(options, 200, 0), recipe);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 20 });
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

  it("recovers compact history whose materialized full-save wire exceeds the checkpoint slot budget", () => {
    let game = createGameState(fastOptions, 200, 0);
    const recipe = generate(fastOptions).diseases[0]!.reference;
    const row = Math.floor(BASE_GAME_FACTORY_HEIGHT / 2);
    const factory = compilePrototype(
      recipe,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
      recipe.steps.map((_, index) => ({ anchor: { x: 1 + index * 2, y: row }, footRot: 0 })),
    );
    game = withProduction(game, recipe, factory);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 49_022 });
    expect(game.inventory).toHaveLength(24_500);
    const beforeRejectedBatch = game;
    const beforeRejectedHash = hashGame(game);
    expect(() => applyGameIntent(game, { kind: "productionTicks", ticks: 200 })).toThrow(
      /inventory exceeds/i,
    );
    expect(game).toBe(beforeRejectedBatch);
    expect(hashGame(game)).toBe(beforeRejectedHash);
    expect(serializeGame(game).length).toBeGreaterThan(SLOT_CHECKPOINT_CHARACTER_LIMIT);
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
    const recipe = generate(options).diseases[0]!.reference;
    const game = withProduction(createGameState(options, 200, 0), recipe);
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
    expect(saved.head.production).not.toBe(game.production);
    expect(saved.head.production.runtime).not.toBe(game.production.runtime);
    const slot = game.production.runtime!.capacity - 1;
    const retained = saved.head.production.runtime!.unitX[slot];
    game.production.runtime!.unitX[slot] = retained === 0 ? 1 : 0;
    expect(saved.head.production.runtime!.unitX[slot]).toBe(retained);
  });
});
