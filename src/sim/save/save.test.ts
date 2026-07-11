import { describe, expect, it } from "vitest";
import type { FactoryLayout, GameState, GenOptions } from "../phase0_interfaces";
import {
  DEFAULT_CATALOG,
  MAX_BULK_SALE_PRODUCTS,
  MAX_FACTORY_CELLS,
  MAX_TEMPLATE_STEPS,
} from "../phase0_interfaces";
import { MAX_INTENT_TRACE, applyGameIntent, createGameState } from "../game";
import { generate } from "../mapgen";
import {
  SAVE_VERSION,
  MAX_SLOT_STATES,
  MAX_SAVE_CHARACTERS,
  SaveError,
  deserializeGame,
  deserializeGameAuthority,
  deserializeSlots,
  inspectGameAuthority,
  pushSnapshot,
  rewind,
  serializeGame,
  serializeGameAuthority,
  serializeSlots,
} from "./index";

const OPTIONS: GenOptions = {
  seed: 14,
  nMaps: 2,
  width: 12,
  height: 12,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 2,
  difficulty: { min: 4, max: 12 },
};

function baseGame(): GameState {
  let game = createGameState(OPTIONS, 10_000, 100);
  game = applyGameIntent(game, {
    kind: "saveRecipe",
    recipe: generate(OPTIONS).diseases[0]!.reference,
  });
  return applyGameIntent(game, { kind: "factoryTicks", ticks: 80 });
}

function emptyFactory(base: FactoryLayout): FactoryLayout {
  const tiles: FactoryLayout["tiles"][number][] = Array.from(
    { length: base.width * base.height },
    () => ({ kind: "empty" }),
  );
  tiles[0] = { kind: "source", dir: 0, period: 4 };
  tiles[1] = { kind: "sink" };
  return { width: base.width, height: base.height, tiles, machines: [] };
}

function splitterFactory(base: FactoryLayout): FactoryLayout {
  const tiles: FactoryLayout["tiles"][number][] = Array.from(
    { length: base.width * base.height },
    () => ({ kind: "empty" }),
  );
  tiles[0] = { kind: "source", dir: 0, period: 1 };
  tiles[1] = { kind: "splitter", inDir: 2, outDirs: [0, 1] };
  tiles[2] = { kind: "sink" };
  tiles[base.width + 1] = { kind: "sink" };
  return { width: base.width, height: base.height, tiles, machines: [] };
}

function wire(game = baseGame()): { version: number; game: Record<string, any> } {
  return JSON.parse(serializeGame(game)) as { version: number; game: Record<string, any> };
}

describe("serializeGame / deserializeGame", () => {
  it("round-trips a live mutable factory runtime through a cold snapshot", () => {
    const game = baseGame();
    const loaded = deserializeGame(serializeGame(game));
    expect(loaded).toEqual(game);
    expect(loaded.factoryState).not.toBe(game.factoryState);
  });

  it("round-trips valid states with no factory, an empty factory, and negative cash", () => {
    const empty = createGameState(OPTIONS, 0, 0);
    const saved = applyGameIntent(empty, {
      kind: "saveRecipe",
      recipe: generate(OPTIONS).diseases[0]!.reference,
    });
    const withFactory = applyGameIntent(saved, {
      kind: "setFactory",
      factory: emptyFactory(saved.factory!),
    });
    const negative = createGameState(OPTIONS, -250, 0);
    for (const game of [empty, withFactory, negative]) {
      expect(deserializeGame(serializeGame(game))).toEqual(game);
    }
  });

  it("round-trips a live runtime with cumulative waste", () => {
    let game = baseGame();
    game = applyGameIntent(game, { kind: "setFactory", factory: emptyFactory(game.factory!) });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 5 });
    expect(game.factoryWaste).toBeGreaterThan(0);
    expect(deserializeGame(serializeGame(game))).toEqual(game);
  });

  it("round-trips behavior-affecting splitter round-robin cursors", () => {
    let game = createGameState(OPTIONS, 0, 0);
    game = applyGameIntent(game, {
      kind: "saveRecipe",
      recipe: generate(OPTIONS).diseases[0]!.reference,
    });
    game = applyGameIntent(game, { kind: "setFactory", factory: splitterFactory(game.factory!) });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 2 });
    expect(game.factoryState?.splitterCursors).toEqual(new Int32Array([1]));
    expect(deserializeGame(serializeGame(game))).toEqual(game);
  });

  it("round-trips complete state from compact replay authority", () => {
    const game = baseGame();
    const authority = serializeGameAuthority(game);
    expect(authority.length).toBeLessThan(serializeGame(game).length);
    expect(deserializeGameAuthority(authority)).toEqual(game);

    const forged = JSON.parse(authority) as {
      authority: { replayTicks: number; stateHash: number };
    };
    forged.authority.stateHash = (forged.authority.stateHash + 1) >>> 0;
    expect(() => deserializeGameAuthority(JSON.stringify(forged))).toThrow(/state hash/i);

    forged.authority.stateHash = -1;
    expect(() => deserializeGameAuthority(JSON.stringify(forged))).toThrow(/uint32 checksum/i);

    const wrongTicks = JSON.parse(authority) as { authority: { replayTicks: number } };
    wrongTicks.authority.replayTicks += 1;
    expect(() => deserializeGameAuthority(JSON.stringify(wrongTicks))).toThrow(/computed trace total/i);
  });

  it("accounts for weighted raw authority work before rejecting no-op lab spam", () => {
    const authority = JSON.parse(
      serializeGameAuthority(createGameState(OPTIONS, 0, 0)),
    ) as {
      authority: {
        origin: { genOptions: GenOptions };
        intentTrace: unknown[];
      };
    };
    authority.authority.origin.genOptions = {
      ...OPTIONS,
      nMaps: 4,
      width: 32,
      height: 32,
      diseaseCount: 4,
    };
    authority.authority.intentTrace = new Array(MAX_INTENT_TRACE).fill({
      kind: "runLab",
      template: { steps: [] },
    });
    const raw = JSON.stringify(authority);

    expect(inspectGameAuthority(raw).replayWork).toBeGreaterThan(50_000_000);
    expect(() => deserializeGameAuthority(raw)).toThrow(/canonical/i);
  });

  it("is stable-key deterministic and carries the current version", () => {
    const game = baseGame();
    const reordered: GameState = {
      replayTicks: game.replayTicks,
      intentTrace: game.intentTrace,
      origin: game.origin,
      rng: game.rng,
      fog: game.fog,
      nextInventoryId: game.nextInventoryId,
      inventory: game.inventory,
      factoryWaste: game.factoryWaste,
      factoryState: game.factoryState,
      factory: game.factory,
      recipe: game.recipe,
      patents: game.patents,
      economy: game.economy,
      genOptions: game.genOptions,
    };
    expect(serializeGame(reordered)).toBe(serializeGame(game));
    expect(JSON.parse(serializeGame(game)).version).toBe(SAVE_VERSION);
  });
});

describe("deserializeGame schema validation", () => {
  it("preflights aggregate weighted work for legacy full-slot histories", () => {
    const maximumOptions: GenOptions = {
      ...OPTIONS,
      nMaps: 4,
      width: 32,
      height: 32,
      diseaseCount: 4,
    };
    const full = JSON.parse(serializeGame(createGameState(maximumOptions, 0, 0))) as {
      game: Record<string, unknown>;
    };
    full.game.intentTrace = new Array(MAX_INTENT_TRACE).fill({
      kind: "runLab",
      template: { steps: [] },
    });
    const raw = JSON.stringify({ version: SAVE_VERSION, slots: [full.game, full.game] });

    expect(() => deserializeSlots(raw)).toThrow(/aggregate.*replay work|history.*work/i);
  });

  it("preflights one legacy full save's raw trace before semantic replay", () => {
    const maximumOptions: GenOptions = {
      ...OPTIONS,
      nMaps: 4,
      width: 32,
      height: 32,
      diseaseCount: 4,
    };
    const full = JSON.parse(serializeGame(createGameState(maximumOptions, 0, 0))) as {
      game: Record<string, unknown>;
    };
    const push = DEFAULT_CATALOG[0]!;
    const step = {
      typeId: push.typeId,
      transform: push.transform,
      orientation: { rot: 0, flip: false },
    };
    full.game.intentTrace = new Array(MAX_INTENT_TRACE).fill({
      kind: "runLab",
      template: { steps: [step, step] },
    });

    expect(() => deserializeGame(JSON.stringify(full))).toThrow(/replay work/i);
  });

  it("rejects malformed JSON, missing version, incompatible version, and missing payload", () => {
    expect(() => deserializeGame("{not json")).toThrow(SaveError);
    expect(() => deserializeGame(JSON.stringify({ game: {} }))).toThrow(/missing version/);
    expect(() => deserializeGame(JSON.stringify({ version: SAVE_VERSION + 1, game: {} }))).toThrow(
      /incompatible version/,
    );
    expect(() => deserializeGame(JSON.stringify({ version: SAVE_VERSION }))).toThrow(/missing game/);
    expect(() => deserializeGame("x".repeat(MAX_SAVE_CHARACTERS + 1))).toThrow(/save exceeds/i);
  });

  it("rejects missing and wrongly typed nested fields", () => {
    const missing = wire();
    missing.game.economy = { sold: [] };
    expect(() => deserializeGame(JSON.stringify(missing))).toThrow(/economy\.cash/);

    const wrong = wire();
    wrong.game.rng = { s: "nope" };
    expect(() => deserializeGame(JSON.stringify(wrong))).toThrow(/rng\.s/);
  });

  it("fails fast on oversized traces, templates, layouts, and slot arrays", () => {
    const trace = wire();
    trace.game.intentTrace = new Array(MAX_INTENT_TRACE + 1).fill({ kind: "resetFactory" });
    expect(() => deserializeGame(JSON.stringify(trace))).toThrow(/intentTrace.*exceeds/i);

    const template = wire();
    template.game.recipe.steps = new Array(MAX_TEMPLATE_STEPS + 1).fill(
      template.game.recipe.steps[0],
    );
    expect(() => deserializeGame(JSON.stringify(template))).toThrow(/steps.*exceeds/i);

    const layout = wire();
    layout.game.factory = {
      width: MAX_FACTORY_CELLS,
      height: 2,
      tiles: [],
      machines: [],
    };
    layout.game.factoryState = null;
    expect(() => deserializeGame(JSON.stringify(layout))).toThrow(/dimensions.*exceed|area.*exceed/i);

    const oversizedSlots = {
      version: SAVE_VERSION,
      slots: new Array(MAX_SLOT_STATES + 1).fill({}),
    };
    expect(() => deserializeSlots(JSON.stringify(oversizedSlots))).toThrow(/state count.*exceeds/i);

    const authority = JSON.parse(serializeGameAuthority(baseGame()));
    authority.authority.intentTrace = [{
      kind: "sellProducts",
      productIds: new Array(MAX_BULK_SALE_PRODUCTS + 1).fill(0),
      disease: 0,
    }];
    expect(() => deserializeGameAuthority(JSON.stringify(authority))).toThrow(
      /productIds.*exceeds|bulk sale.*bounds/i,
    );
  });

  it("rejects unknown tiles and tile-count mismatches", () => {
    const unknown = wire();
    unknown.game.factory = { width: 1, height: 1, tiles: [{ kind: "wormhole" }], machines: [] };
    unknown.game.factoryState = null;
    expect(() => deserializeGame(JSON.stringify(unknown))).toThrow(/unknown FactoryTile kind/);

    const mismatch = wire();
    mismatch.game.factory = { width: 4, height: 4, tiles: [{ kind: "empty" }], machines: [] };
    mismatch.game.factoryState = null;
    expect(() => deserializeGame(JSON.stringify(mismatch))).toThrow(/factory\.tiles/);
  });
});

describe("deserializeGame semantic authority", () => {
  it("rejects tampered catalog and factory machine cost/speed", () => {
    for (const [field, value] of [["cost", -999], ["speed", 0]] as const) {
      const parsed = wire();
      parsed.game.factory.machines[0].def[field] = value;
      expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/catalog|cost|speed/i);
    }

    const catalog = wire();
    catalog.game.genOptions.catalog[0].cost = -1;
    expect(() => deserializeGame(JSON.stringify(catalog))).toThrow(/catalog|cost/i);
  });

  it("rejects unknown, duplicate, and prerequisite-skipping patents", () => {
    for (const unlocked of [["bogus"], ["bench-2", "bench-2"], ["new-map"]]) {
      const parsed = wire();
      parsed.game.patents = { unlocked };
      expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/patent|prerequisite/i);
    }
  });

  it("rejects forged inventory outcomes and duplicate inventory ids", () => {
    const forged = wire();
    forged.game.inventory[0].outcome.cured = [];
    expect(() => deserializeGame(JSON.stringify(forged))).toThrow(/inventory.*outcome/i);

    const duplicate = wire();
    expect(duplicate.game.inventory.length).toBeGreaterThan(1);
    duplicate.game.inventory[1].inventoryId = duplicate.game.inventory[0].inventoryId;
    expect(() => deserializeGame(JSON.stringify(duplicate))).toThrow(/inventory id/i);
  });

  it("rejects locally plausible cost, progress, id, position, and counter forgery by replay", () => {
    const inventoryCost = wire();
    inventoryCost.game.inventory[0].productionCost += 777;
    expect(() => deserializeGame(JSON.stringify(inventoryCost))).toThrow(/replay mismatch.*productionCost/i);

    const minted = wire();
    const clone = structuredClone(minted.game.inventory[0]);
    clone.inventoryId = minted.game.nextInventoryId;
    minted.game.nextInventoryId += 1;
    minted.game.inventory.push(clone);
    expect(() => deserializeGame(JSON.stringify(minted))).toThrow(/replay mismatch.*inventory/i);

    const progress = wire();
    expect(progress.game.factoryState.units.length).toBeGreaterThan(0);
    progress.game.factoryState.units[0].proc += 1;
    expect(() => deserializeGame(JSON.stringify(progress))).toThrow(/replay mismatch.*proc/i);

    const position = wire();
    const unit = position.game.factoryState.units[0];
    unit.drug.pos[0].x = (unit.drug.pos[0].x + 1) % position.game.genOptions.width;
    expect(() => deserializeGame(JSON.stringify(position))).toThrow(/replay mismatch.*drug.*pos/i);

    const tick = wire();
    tick.game.factoryState.tick += 1;
    expect(() => deserializeGame(JSON.stringify(tick))).toThrow(/replay mismatch.*tick/i);

    const counters = wire();
    counters.game.factoryState.nextUnitId += 100;
    counters.game.factoryState.producedTotal += 100;
    expect(() => deserializeGame(JSON.stringify(counters))).toThrow(/replay mismatch.*nextUnitId|producedTotal/i);
  });

  it("rejects negative sale counts, costs, progress, and invalid factory mass", () => {
    const sold = wire();
    sold.game.economy.sold = [{ disease: 0, count: -1 }];
    expect(() => deserializeGame(JSON.stringify(sold))).toThrow(/sold count/i);

    const unordered = wire();
    unordered.game.economy.sold = [
      { disease: 1, count: 1 },
      { disease: 0, count: 1 },
    ];
    expect(() => deserializeGame(JSON.stringify(unordered))).toThrow(/order/i);

    const inventoryCost = wire();
    inventoryCost.game.inventory[0].productionCost = -1;
    expect(() => deserializeGame(JSON.stringify(inventoryCost))).toThrow(/production cost/i);

    const progress = wire();
    expect(progress.game.factoryState.units.length).toBeGreaterThan(0);
    progress.game.factoryState.units[0].proc = -1;
    expect(() => deserializeGame(JSON.stringify(progress))).toThrow(/progress|proc/i);

    const mass = wire();
    mass.game.factoryState.nextUnitId = -1;
    expect(() => deserializeGame(JSON.stringify(mass))).toThrow(/nextUnitId|next unit id|mass/i);
  });

  it("rejects undrained product events so load cannot credit a product twice", () => {
    const parsed = wire();
    const product = parsed.game.inventory[0];
    parsed.game.factoryState.producedEvents = [{
      id: product.id,
      drug: product.drug,
      productionCost: product.productionCost,
    }];
    expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/drained|product event/i);
  });

  it("rejects forged or out-of-range splitter routing cursors", () => {
    let game = createGameState(OPTIONS, 0, 0);
    game = applyGameIntent(game, {
      kind: "saveRecipe",
      recipe: generate(OPTIONS).diseases[0]!.reference,
    });
    game = applyGameIntent(game, { kind: "setFactory", factory: splitterFactory(game.factory!) });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 2 });
    const outOfRange = wire(game);
    outOfRange.game.factoryState.splitterCursors[0] = 2;
    expect(() => deserializeGame(JSON.stringify(outOfRange))).toThrow(/splitter.*cursor/i);

    const forged = wire(game);
    forged.game.factoryState.splitterCursors[0] = 0;
    expect(() => deserializeGame(JSON.stringify(forged))).toThrow(/replay mismatch.*splitterCursors/i);
  });

  it("rejects invalid source periods and duplicate machine ids", () => {
    const source = wire();
    const sourceTile = source.game.factory.tiles.find((tile: any) => tile.kind === "source");
    sourceTile.period = 0;
    expect(() => deserializeGame(JSON.stringify(source))).toThrow(/period/i);

    const duplicate = wire();
    expect(duplicate.game.factory.machines.length).toBeGreaterThan(1);
    duplicate.game.factory.machines[1].id = duplicate.game.factory.machines[0].id;
    expect(() => deserializeGame(JSON.stringify(duplicate))).toThrow(/duplicate.*id/i);
  });

  it("serializeGame also refuses an invalid in-memory state", () => {
    const game = baseGame();
    const invalid = { ...game, factoryWaste: -1 };
    expect(() => serializeGame(invalid)).toThrow(SaveError);

    const runtime = game.factoryState!;
    const unused = runtime.capacity - 1;
    expect(unused).toBeGreaterThanOrEqual(runtime.unitCount);
    runtime.unitX[unused] = 1;
    expect(() => serializeGame(game)).toThrow(/unused.*slot|canonical/i);
  });
});

describe("multi-save slots and rewind", () => {
  it("round-trips isolated slot snapshots deterministically", () => {
    const states = [baseGame(), createGameState({ ...OPTIONS, seed: 15 }, 5, 1)];
    const blob = serializeSlots(states);
    expect(serializeSlots(states)).toBe(blob);
    expect(deserializeSlots(blob)).toEqual(states);
  });

  it("rejects malformed and incompatible slot blobs", () => {
    expect(() => deserializeSlots("[oops")).toThrow(SaveError);
    expect(() => deserializeSlots(JSON.stringify({ version: SAVE_VERSION + 1, slots: [] }))).toThrow(
      /incompatible version/,
    );
  });

  it("pushSnapshot cold-clones a mutable runtime", () => {
    const game = baseGame();
    const history = pushSnapshot([], game);
    expect(history).toEqual([game]);
    expect(history[0]).not.toBe(game);
    expect(history[0]?.factoryState).not.toBe(game.factoryState);
  });

  it("rewinds to a cold-cloned prior state and truncates history", () => {
    const a = baseGame();
    const b = createGameState({ ...OPTIONS, seed: 15 }, 5, 1);
    const c = createGameState({ ...OPTIONS, seed: 16 }, 6, 2);
    const result = rewind([a, b, c], 1);
    expect(result.state).toEqual(b);
    expect(result.state).not.toBe(b);
    expect(result.history).toEqual([a, b]);
    expect(deserializeGame(serializeGame(result.state))).toEqual(b);
  });

  it("uses one step by default and rejects rewinding past the start", () => {
    const a = baseGame();
    const b = createGameState({ ...OPTIONS, seed: 15 }, 5, 1);
    expect(rewind([a, b]).state).toEqual(a);
    expect(() => rewind([a], 5)).toThrow(SaveError);
  });
});
