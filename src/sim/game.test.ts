import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FactoryLayout, GameIntent, GenOptions, Template } from "./phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
} from "./phase0_interfaces";
import {
  MAX_FACTORY_CELLS,
  MAX_GAME_MAP_DIMENSION,
  MAX_GAME_INVENTORY_PRODUCTS,
  MAX_TEMPLATE_STEPS,
} from "./phase0_interfaces";
import { initialState, applyTemplate } from "./drug-graph";
import { snapshotFactory } from "./factory-sim";
import { generate } from "./mapgen";
import * as mapgenModule from "./mapgen";
import {
  MAX_INTENT_TRACE,
  MAX_REPLAY_TICKS,
  applyGameIntent,
  availableCatalog,
  createGameState,
  hashGame,
  replayGame,
} from "./game";
import { deserializeGame, serializeGame } from "./save";
import { compileEntitledPrototype } from "./recipe";

const opts = {
  seed: 14,
  nMaps: 2,
  width: 32,
  height: 32,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 2,
  difficulty: { min: 4, max: 12 },
} as const;

function recipe(): Template {
  return generate(opts).diseases[0]!.reference;
}

function saveIntent(savedRecipe: Template): Extract<GameIntent, { readonly kind: "saveRecipe" }> {
  return {
    kind: "saveRecipe",
    recipe: savedRecipe,
    factory: compileEntitledPrototype(
      savedRecipe,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout,
  };
}

const emptyFactory: FactoryLayout = {
  width: 2,
  height: 1,
  tiles: [
    { kind: "source", dir: 0, period: 1 },
    { kind: "sink" },
  ],
  machines: [],
};

function directSinkFactory(layout: FactoryLayout, period = 1): FactoryLayout {
  const tiles: FactoryLayout["tiles"][number][] = Array.from(
    { length: layout.width * layout.height },
    () => ({ kind: "empty" }),
  );
  tiles[0] = { kind: "source", dir: 0, period };
  tiles[1] = { kind: "sink" };
  return { width: layout.width, height: layout.height, tiles, machines: [] };
}

describe("whole-game deterministic state", () => {
  it("credits inventory from the actual sink product, never from the saved recipe", () => {
    const level = generate(opts);
    const savedRecipe = recipe();
    const savedOutcome = applyTemplate(level.mm, initialState(level.mm), savedRecipe);
    expect(savedOutcome.pos).not.toEqual(level.start.pos);

    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(savedRecipe));

    game = applyGameIntent(game, {
      kind: "setFactory",
      factory: directSinkFactory(game.factory!),
    });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 2 });

    expect(game.inventory).toEqual([]);
  });

  it("stores actual production cost and removes a physical product after one sale", () => {
    const savedRecipe = recipe();
    const expectedCost = savedRecipe.steps.reduce((total, step) => {
      return total + (DEFAULT_CATALOG.find((entry) => entry.typeId === step.typeId)?.cost ?? 0);
    }, 0);

    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(savedRecipe));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 200 });
    expect(game.inventory.length).toBeGreaterThan(0);
    expect(game.inventory[0]?.productionCost).toBe(expectedCost);
    const inventoryBeforeSale = game.inventory.length;
    const soldProduct = game.inventory[0]!;
    const disease = soldProduct.outcome.cured[0];
    expect(disease).toBeDefined();
    const diseaseSpec = generate(opts).diseases.find((candidate) => candidate.id === disease)!;
    const cashBefore = game.economy.cash;

    game = applyGameIntent(game, {
      kind: "sellProduct",
      productId: soldProduct.inventoryId,
      disease: disease!,
    });
    expect(game.inventory).toHaveLength(inventoryBeforeSale - 1);
    expect(game.economy.research).toBe(1);
    expect(game.economy.cash).toBe(
      cashBefore + diseaseSpec.basePrice - soldProduct.productionCost
        - soldProduct.outcome.sideEffects.length * 25,
    );
  });

  it("sells more than the trace-entry cap atomically with one replayable bulk intent", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: MAX_INTENT_TRACE * 2 + 512 });
    const disease = game.inventory[0]!.outcome.cured[0]!;
    const productIds = game.inventory
      .filter((product) => product.outcome.cured.includes(disease))
      .map((product) => product.inventoryId);
    expect(productIds.length).toBeGreaterThan(MAX_INTENT_TRACE);

    game = applyGameIntent(game, { kind: "sellProducts", productIds, disease });

    expect(game.inventory.some((product) => productIds.includes(product.inventoryId))).toBe(false);
    expect(game.intentTrace).toHaveLength(3);
    expect(game.intentTrace.at(-1)).toMatchObject({ kind: "sellProducts", disease });
    expect(deserializeGame(serializeGame(game))).toEqual(game);
  });

  it("normalizes consecutive same-disease single sales into one bulk trace entry", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 100 });
    const first = game.inventory[0]!;
    const disease = first.outcome.cured[0]!;
    const second = game.inventory[1]!;
    game = applyGameIntent(game, { kind: "sellProduct", productId: first.inventoryId, disease });
    game = applyGameIntent(game, { kind: "sellProduct", productId: second.inventoryId, disease });
    expect(game.intentTrace.at(-1)).toEqual({
      kind: "sellProducts",
      productIds: [first.inventoryId, second.inventoryId],
      disease,
    });
    expect(deserializeGame(serializeGame(game))).toEqual(game);
  });

  it("does not regenerate an unchanged level on every factory tick intent", () => {
    const generateSpy = vi.spyOn(mapgenModule, "generate");
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    const callsBeforeTick = generateSpy.mock.calls.length;
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 1 });
    expect(game.factoryState?.tick).toBe(1);
    expect(generateSpy.mock.calls.length).toBe(callsBeforeTick);
    generateSpy.mockRestore();
  });

  it("rejects locked recipes instead of relying on the disabled UI palette", () => {
    const skew = DEFAULT_CATALOG.find((entry) => entry.typeId === "skew")!;
    const lockedRecipe: Template = {
      steps: [{ typeId: skew.typeId, transform: skew.transform, orientation: { rot: 0, flip: false } }],
    };
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, saveIntent(lockedRecipe))).toThrow(/locked/i);
  });

  it("rejects saving an uncured recipe instead of relying on the Lab button", () => {
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, saveIntent({ steps: [] }))).toThrow(/cure/i);
  });

  it("transfers the submitted Pilot layout to Factory without repacking it", () => {
    const game = createGameState(opts, 200, 0);
    const intent = saveIntent(recipe());
    const saved = applyGameIntent(game, intent);
    expect(saved.factory).toEqual(intent.factory);
    expect(saved.factory?.machines.map((machine) => machine.anchor)).toEqual(
      intent.factory.machines.map((machine) => machine.anchor),
    );
  });

  it("rejects a valid Pilot topology on a floor outside the patent entitlement", () => {
    const game = createGameState(opts, 200, 0);
    const savedRecipe = recipe();
    const oversized = compileEntitledPrototype(
      savedRecipe,
      BASE_GAME_FACTORY_WIDTH + 1,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    expect(() => applyGameIntent(game, {
      kind: "saveRecipe",
      recipe: savedRecipe,
      factory: oversized,
    })).toThrow(/entitled.*24x12/i);
  });

  it("rejects Game maps too large for the bounded UI authority before generation", () => {
    expect(() => createGameState({
      ...opts,
      width: MAX_GAME_MAP_DIMENSION + 1,
      height: MAX_GAME_MAP_DIMENSION + 1,
    }, 200, 0)).toThrow(/game.*map|dimensions/i);
  });

  it("keeps factory dimensions authoritative to the recipe and expansion patents", () => {
    let game = createGameState(opts, 10_000, 100);
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: emptyFactory })).toThrow(
      /base dimensions|saved recipe/i,
    );
    const baseFactory: FactoryLayout = {
      width: BASE_GAME_FACTORY_WIDTH,
      height: BASE_GAME_FACTORY_HEIGHT,
      tiles: Array.from(
        { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
        () => ({ kind: "empty" }),
      ),
      machines: [],
    };
    expect(applyGameIntent(game, { kind: "setFactory", factory: baseFactory }).factory).toEqual(
      baseFactory,
    );

    let patentFirst = createGameState(opts, 10_000, 100);
    patentFirst = applyGameIntent(patentFirst, { kind: "unlockPatent", id: "bench-2" });
    const expandedBase: FactoryLayout = {
      width: BASE_GAME_FACTORY_WIDTH + 2,
      height: BASE_GAME_FACTORY_HEIGHT,
      tiles: Array.from(
        { length: (BASE_GAME_FACTORY_WIDTH + 2) * BASE_GAME_FACTORY_HEIGHT },
        () => ({ kind: "empty" }),
      ),
      machines: [],
    };
    expect(
      applyGameIntent(patentFirst, { kind: "setFactory", factory: expandedBase }).factory,
    ).toEqual(expandedBase);

    game = applyGameIntent(game, saveIntent(recipe()));
    const base = game.factory!;
    const unauthorizedResize: FactoryLayout = {
      width: base.width + 1,
      height: base.height,
      tiles: new Array((base.width + 1) * base.height).fill({ kind: "empty" }),
      machines: [],
    };
    expect(() => applyGameIntent(game, {
      kind: "setFactory",
      factory: unauthorizedResize,
    })).toThrow(/dimensions|expansion patent/i);

    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    expect(game.factory?.width).toBe(base.width + 2);
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: base })).toThrow(
      /dimensions|expansion patent/i,
    );
  });

  it("rejects factory definitions that tamper with catalog speed or cost", () => {
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const tampered: FactoryLayout = {
      width: 3,
      height: 1,
      tiles: [{ kind: "source", dir: 0, period: 1 }, { kind: "empty" }, { kind: "sink" }],
      machines: [{
        id: 0,
        def: {
          typeId: push.typeId,
          transform: push.transform,
          orientation: { rot: 0, flip: false },
          cost: 0,
          speed: 1,
        },
        anchor: { x: 1, y: 0 },
        footRot: 0,
        shape: { cells: [{ x: 0, y: 0 }], inPorts: [], outPorts: [] },
      }],
    };
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: tampered })).toThrow(/catalog/i);
  });

  it("rejects non-positive source periods before the factory sim", () => {
    const invalid: FactoryLayout = {
      ...emptyFactory,
      tiles: [{ kind: "source", dir: 0, period: 0 }, { kind: "sink" }],
    };
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: invalid })).toThrow(/period/i);
    const overflow: FactoryLayout = {
      ...emptyFactory,
      tiles: [{ kind: "source", dir: 0, period: 0x80000000 }, { kind: "sink" }],
    };
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: overflow })).toThrow(/period/i);
  });

  it("accepts only non-negative safe-integer factory tick batches", () => {
    const game = createGameState(opts, 200, 0);
    expect(applyGameIntent(game, { kind: "factoryTicks", ticks: 0 })).toBe(game);
    for (const ticks of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => applyGameIntent(game, { kind: "factoryTicks", ticks })).toThrow(/ticks|integer/i);
    }
  });

  it("rejects positive factory ticks when no authoritative layout exists", () => {
    const game = createGameState(opts, 200, 0);
    const beforeHash = hashGame(game);
    const beforeTrace = game.intentTrace;

    expect(applyGameIntent(game, { kind: "factoryTicks", ticks: 0 })).toBe(game);
    expect(() => applyGameIntent(game, { kind: "factoryTicks", ticks: 1 })).toThrow(
      /no.*factory|factory.*layout/i,
    );
    expect(hashGame(game)).toBe(beforeHash);
    expect(game.intentTrace).toBe(beforeTrace);
  });

  it("records a normalized, bounded authoritative intent trace", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    const factory = directSinkFactory(game.factory!);
    game = applyGameIntent(game, { kind: "setFactory", factory });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 1 });
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 2 });
    expect(game.intentTrace).toEqual([
      saveIntent(recipe()),
      { kind: "setFactory", factory },
      { kind: "factoryTicks", ticks: 3 },
    ]);
    expect(game.replayTicks).toBe(3);
    expect(deserializeGame(serializeGame(game))).toEqual(game);
    expect(() => applyGameIntent(game, {
      kind: "factoryTicks",
      ticks: MAX_REPLAY_TICKS,
    })).toThrow(/cumulative.*ticks/i);
  });

  it("normalizes consecutive layout edits and omits semantic no-op exploration", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    const first = directSinkFactory(game.factory!);
    const second = directSinkFactory(game.factory!, 2);
    game = applyGameIntent(game, { kind: "setFactory", factory: first });
    game = applyGameIntent(game, { kind: "setFactory", factory: second });
    expect(game.intentTrace).toHaveLength(2);
    expect(game.intentTrace[1]).toEqual({ kind: "setFactory", factory: second });
    const before = game;
    game = applyGameIntent(game, { kind: "runLab", template: { steps: [] } });
    expect(game).toBe(before);
  });

  it("omits semantic no-op recipe saves and factory resets from the authoritative trace", () => {
    let game = createGameState(opts, 200, 0);
    const savedRecipe = recipe();
    game = applyGameIntent(game, saveIntent(savedRecipe));
    const pristine = game;

    expect(applyGameIntent(pristine, saveIntent(savedRecipe))).toBe(pristine);
    expect(applyGameIntent(pristine, { kind: "resetFactory" })).toBe(pristine);

    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 1 });
    const reset = applyGameIntent(game, { kind: "resetFactory" });
    expect(reset).not.toBe(game);
    expect(reset.intentTrace.at(-1)).toEqual({ kind: "resetFactory" });
    expect(applyGameIntent(reset, { kind: "resetFactory" })).toBe(reset);
  });

  it("rejects invalid bulk-sale members atomically without mutating inventory or economy", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 100 });
    const first = game.inventory[0]!;
    const disease = first.outcome.cured[0]!;
    const otherDisease = generate(opts).diseases.find((candidate) => candidate.id !== disease)!.id;
    const before = game;
    const beforeHash = hashGame(game);

    for (const intent of [
      { kind: "sellProducts", productIds: [first.inventoryId, first.inventoryId], disease },
      { kind: "sellProducts", productIds: [first.inventoryId, game.nextInventoryId], disease },
      { kind: "sellProducts", productIds: [first.inventoryId], disease: otherDisease },
    ] as const) {
      expect(() => applyGameIntent(game, intent)).toThrow(/duplicated|unavailable|not a cure/i);
      expect(game).toBe(before);
      expect(hashGame(game)).toBe(beforeHash);
    }
  });

  it("rejects invalid single-product sales instead of silently accepting a no-op", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 100 });
    const first = game.inventory[0]!;
    const disease = first.outcome.cured[0]!;
    const otherDisease = generate(opts).diseases.find((candidate) => candidate.id !== disease)!.id;

    for (const intent of [
      { kind: "sellProduct", productId: first.inventoryId, disease: Number.MAX_SAFE_INTEGER },
      { kind: "sellProduct", productId: game.nextInventoryId, disease },
      { kind: "sellProduct", productId: first.inventoryId, disease: otherDisease },
    ] as const) {
      const before = game;
      const beforeHash = hashGame(game);
      expect(() => applyGameIntent(game, intent)).toThrow(/unknown disease|unavailable|not a cure/i);
      expect(game).toBe(before);
      expect(hashGame(game)).toBe(beforeHash);
    }

    game = applyGameIntent(game, {
      kind: "sellProduct",
      productId: first.inventoryId,
      disease,
    });
    const sold = game;
    const soldHash = hashGame(game);
    expect(() => applyGameIntent(game, {
      kind: "sellProduct",
      productId: first.inventoryId,
      disease,
    })).toThrow(/unavailable/i);
    expect(game).toBe(sold);
    expect(hashGame(game)).toBe(soldHash);
  });

  it("owns and freezes cache-key inputs instead of aliasing caller mutations", () => {
    const mutableOptions: GenOptions = {
      ...opts,
      catalog: opts.catalog.map((entry) => ({ ...entry })),
      difficulty: { ...opts.difficulty },
    };
    let game = createGameState(mutableOptions, -0, 0);
    (mutableOptions as unknown as { seed: number }).seed = 99;
    (mutableOptions.catalog[0] as unknown as { speed: number }).speed = 99;
    expect(game.genOptions.seed).toBe(14);
    expect(game.genOptions.catalog[0]?.speed).toBe(2);
    expect(Object.is(game.economy.cash, -0)).toBe(false);

    game = applyGameIntent(game, saveIntent(recipe()));
    const mutableLayout = directSinkFactory(game.factory!);
    game = applyGameIntent(game, { kind: "setFactory", factory: mutableLayout });
    (mutableLayout.tiles as FactoryLayout["tiles"] & { 0: { kind: "source"; dir: 0; period: number } })[0].period = 2;
    expect(game.factory?.tiles[0]).toEqual({ kind: "source", dir: 0, period: 1 });
    expect(() => {
      (game.factory!.tiles as unknown as { period: number }[])[0]!.period = 3;
    }).toThrow();
    expect(deserializeGame(serializeGame(game))).toEqual(game);
  });

  it("canonicalizes intent objects and rejects oversized templates/layouts before allocation", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, {
      kind: "setFactory",
      factory: directSinkFactory(game.factory!),
      ignored: "not authoritative",
    } as GameIntent & { ignored: string });
    expect(game.intentTrace[0]).not.toHaveProperty("ignored");

    const tooLong = { steps: new Array(MAX_TEMPLATE_STEPS + 1).fill(recipe().steps[0]) };
    expect(() => applyGameIntent(game, { kind: "runLab", template: tooLong })).toThrow(/steps|256/i);

    const oversized = {
      width: MAX_FACTORY_CELLS,
      height: 2,
      tiles: new Array(MAX_FACTORY_CELLS * 2),
      machines: [],
    } as unknown as FactoryLayout;
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: oversized })).toThrow(
      /bounded|65536|dimensions/i,
    );
  });

  it("rejects duplicate, overlapping, out-of-bounds, and tile-covering machines", () => {
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const placed = (id: number, x: number) => ({
      id,
      def: {
        typeId: push.typeId,
        transform: push.transform,
        orientation: { rot: 0 as const, flip: false },
        cost: push.cost,
        speed: push.speed,
      },
      anchor: { x, y: 0 },
      footRot: 0 as const,
      shape: DEFAULT_SHAPES.push!,
    });
    const tiles: FactoryLayout["tiles"][number][] = Array.from(
      { length: 8 * 3 },
      () => ({ kind: "empty" }),
    );
    tiles[0] = { kind: "source", dir: 0, period: 1 };
    tiles[7] = { kind: "sink" };
    const base: FactoryLayout = {
      width: 8,
      height: 3,
      tiles,
      machines: [],
    };
    const game = createGameState(opts, 200, 0);

    expect(() => applyGameIntent(game, {
      kind: "setFactory",
      factory: { ...base, machines: [placed(0, 1), placed(0, 4)] },
    })).toThrow(/duplicate.*id/i);
    expect(() => applyGameIntent(game, {
      kind: "setFactory",
      factory: { ...base, machines: [placed(0, 1), placed(1, 1)] },
    })).toThrow(/overlap/i);
    expect(() => applyGameIntent(game, {
      kind: "setFactory",
      factory: { ...base, machines: [placed(0, 8)] },
    })).toThrow(/bounds/i);
    expect(() => applyGameIntent(game, {
      kind: "setFactory",
      factory: { ...base, machines: [placed(0, 0)] },
    })).toThrow(/empty|tile/i);
  });

  it("rejects invalid tile directions and machine placement rotations at the intent boundary", () => {
    const game = createGameState(opts, 200, 0);
    const invalidDir = {
      ...emptyFactory,
      tiles: [{ kind: "source", dir: 9, period: 1 }, { kind: "sink" }],
    } as unknown as FactoryLayout;
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: invalidDir })).toThrow(
      /direction/i,
    );

    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const invalidRotation = {
      width: 3,
      height: 1,
      tiles: [{ kind: "source", dir: 0, period: 1 }, { kind: "empty" }, { kind: "sink" }],
      machines: [{
        id: 0,
        def: {
          typeId: push.typeId,
          transform: push.transform,
          orientation: { rot: 0, flip: false },
          cost: push.cost,
          speed: push.speed,
        },
        anchor: { x: 1, y: 0 },
        footRot: 4,
        shape: DEFAULT_SHAPES.push!,
      }],
    } as unknown as FactoryLayout;
    expect(() => applyGameIntent(game, { kind: "setFactory", factory: invalidRotation })).toThrow(
      /placement/i,
    );
  });

  it("drains every product in a multi-tick batch exactly once", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 200 });
    expect(game.factoryState?.producedTotal).toBeGreaterThan(1);
    expect(game.inventory).toHaveLength(game.factoryState!.producedTotal);
    expect(game.factoryState?.producedEvents.count).toBe(0);
    expect(game.factoryWaste).toBe(0);
  });

  it("clones the persistent inventory at most once per factory tick batch", () => {
    const source = readFileSync(new URL("./game.ts", import.meta.url), "utf8");
    const drain = source.slice(
      source.indexOf("function drainProducts"),
      source.indexOf("function sellPhysicalProducts"),
    );
    expect(drain.match(/current\.inventory = \[\.\.\.current\.sourceInventory\]/g)).toHaveLength(1);
    expect(drain).not.toMatch(/current\.inventory = \[\.\.\.current\.inventory/);
  });

  it("rejects materialized inventory beyond the practical authority bound", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 100 });
    const product = game.inventory[0]!;
    const oversized = {
      ...game,
      inventory: new Array(MAX_GAME_INVENTORY_PRODUCTS + 1).fill(product),
    };
    expect(() => serializeGame(oversized)).toThrow(/inventory exceeds/i);
  });

  it("does not mutate the input runtime while advancing factory ticks", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    const runtime = game.factoryState!;
    const before = snapshotFactory(runtime);

    const next = applyGameIntent(game, { kind: "factoryTicks", ticks: 100 });

    expect(next.factoryState).not.toBe(runtime);
    expect(snapshotFactory(runtime)).toEqual(before);
  });

  it("rejects an externally stepped runtime with undrained product events", () => {
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(recipe()));
    game = applyGameIntent(game, {
      kind: "setFactory",
      factory: directSinkFactory(game.factory!),
    });
    (game.factoryState!.producedEvents as { count: number }).count = 1;
    expect(game.factoryState?.producedEvents.count).toBeGreaterThan(0);
    expect(() => applyGameIntent(game, { kind: "factoryTicks", ticks: 1 })).toThrow(/drained/i);
  });

  it("keeps locked machine types out of the production palettes", () => {
    const game = createGameState(opts, 200, 0);
    const ids = availableCatalog(game.patents).map((entry) => entry.typeId);
    expect(ids).not.toContain("skew");
    expect(ids).not.toContain("dilute");
    expect(ids).toContain("push");
    expect(Object.isFrozen(DEFAULT_CATALOG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_CATALOG[0]?.transform)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SHAPES.push?.cells)).toBe(true);
  });

  it("rejects an unknown patent intent instead of silently ignoring it", () => {
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, { kind: "unlockPatent", id: "unknown" })).toThrow(/unknown/i);
  });

  it("preserves physical inventory when saving another recipe on the same level", () => {
    const savedRecipe = recipe();
    let game = createGameState(opts, 200, 0);
    game = applyGameIntent(game, saveIntent(savedRecipe));
    game = applyGameIntent(game, { kind: "factoryTicks", ticks: 200 });
    expect(game.inventory.length).toBeGreaterThan(0);
    const inventory = game.inventory;

    game = applyGameIntent(game, saveIntent(savedRecipe));
    expect(game.inventory).toEqual(inventory);
  });

  it("applies machine unlock, factory expansion, and 2→3→4 map patents", () => {
    let game = createGameState(opts, 10_000, 100);
    game = applyGameIntent(game, saveIntent(recipe()));
    const baseWidth = game.factory!.width;
    game = applyGameIntent(game, { kind: "unlockPatent", id: "skew-unlock" });
    expect(availableCatalog(game.patents).map((entry) => entry.typeId)).toContain("skew");

    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    expect(game.factory?.width).toBe(baseWidth + 2);
    game = applyGameIntent(game, { kind: "unlockPatent", id: "new-map" });
    expect(game.genOptions.nMaps).toBe(3);
    game = applyGameIntent(game, { kind: "unlockPatent", id: "new-map-4" });
    expect(game.genOptions.nMaps).toBe(4);
  });

  it("keeps reveal-aid active when a map patent creates the next level", () => {
    let game = createGameState(opts, 10_000, 100);
    game = applyGameIntent(game, { kind: "unlockPatent", id: "reveal-aid" });
    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    game = applyGameIntent(game, { kind: "unlockPatent", id: "new-map" });
    expect(game.genOptions.nMaps).toBe(3);
    expect(game.fog.reduce((total, map) => total + map.reduce((sum, cell) => sum + cell, 0), 0)).toBeGreaterThan(0);
  });

  it("replays the same intent trace to the same whole-game hash", () => {
    const initial = createGameState(opts, 200, 0);
    const savedRecipe = recipe();
    const withRecipe = applyGameIntent(initial, saveIntent(savedRecipe));
    const factory = directSinkFactory(withRecipe.factory!);
    const intents = [
      saveIntent(savedRecipe),
      { kind: "setFactory", factory },
    ] as const;
    const a = replayGame(initial, intents);
    const b = replayGame(initial, intents);
    expect(hashGame(a)).toBe(hashGame(b));
    expect(a).toEqual(b);
  });

  it("keeps the whole-game hash wire-compatible without materializing one giant JSON string", () => {
    const empty = createGameState(opts, 200, 0);
    expect(hashGame(empty)).toBe(373_381_604);
    let produced = applyGameIntent(empty, saveIntent(recipe()));
    produced = applyGameIntent(produced, { kind: "factoryTicks", ticks: 100 });
    expect(hashGame(produced)).toBe(701_995_677);

    const source = readFileSync(new URL("./game.ts", import.meta.url), "utf8");
    const hashBody = source.slice(source.indexOf("export function hashGame"));
    expect(hashBody).not.toMatch(/TextEncoder\(\)\.encode\(canonical\(/);
  });

  it("replays and saves a vertical intent trace including production, sale, patent, and fog", () => {
    const initial = createGameState(opts, 10_000, 100);
    const savedRecipe = recipe();
    const produced = replayGame(initial, [
      { kind: "runLab", template: savedRecipe },
      saveIntent(savedRecipe),
      { kind: "factoryTicks", ticks: 200 },
    ]);
    const product = produced.inventory[0];
    const disease = product?.outcome.cured[0];
    expect(product).toBeDefined();
    expect(disease).toBeDefined();
    const tail = [
      { kind: "sellProduct", productId: product!.inventoryId, disease: disease! },
      { kind: "unlockPatent", id: "reveal-aid" },
      { kind: "unlockPatent", id: "bench-2" },
      { kind: "unlockPatent", id: "new-map" },
    ] as const;
    const a = replayGame(produced, tail);
    const b = replayGame(produced, tail);
    expect(a).toEqual(b);
    expect(hashGame(a)).toBe(hashGame(b));
    expect(deserializeGame(serializeGame(a))).toEqual(a);
    expect(a.genOptions.nMaps).toBe(3);
    expect(a.economy.sold).toEqual([]);
  });
});
