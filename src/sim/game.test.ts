import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FactoryLayout, GameIntent, GenOptions, Template } from "./phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  MAX_FACTORY_CELLS,
  MAX_GAME_INVENTORY_PRODUCTS,
  MAX_GAME_MAP_DIMENSION,
} from "./phase0_interfaces";
import { applyTemplate, initialState } from "./drug-graph";
import { snapshotFactory } from "./factory-sim";
import {
  MAX_INTENT_TRACE,
  MAX_REPLAY_TICKS,
  applyGameIntent,
  availableCatalog,
  createGameState,
  hashGame,
  replayGame,
} from "./game";
import { generate } from "./mapgen";
import * as mapgenModule from "./mapgen";
import { compileEntitledPrototype } from "./recipe";
import { deserializeGame, serializeGame } from "./save";

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

function entitledLayout(template: Template): FactoryLayout {
  return compileEntitledPrototype(
    template,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
}

function dispatchResearchToProduction(
  initial: ReturnType<typeof createGameState>,
  template = recipe(),
): ReturnType<typeof createGameState> {
  let game = applyGameIntent(initial, {
    kind: "setResearchLayout",
    layout: entitledLayout(template),
  });
  game = applyGameIntent(game, { kind: "beginResearchShot" });
  for (let guard = 0; game.research.shot !== null && guard < 300; guard++) {
    game = applyGameIntent(game, { kind: "advanceResearchShot" });
  }
  if (game.research.shot !== null) throw new Error("test Research shot did not finish");
  game = applyGameIntent(game, { kind: "sendResearchToPilot" });
  return applyGameIntent(game, { kind: "sendPilotToProduction" });
}

function baseLayout(): FactoryLayout {
  return {
    width: BASE_GAME_FACTORY_WIDTH,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles: Array.from(
      { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
      () => ({ kind: "empty" as const }),
    ),
    machines: [],
  };
}

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
  it("credits inventory from physical Production output, not merely its Research contract", () => {
    const level = generate(opts);
    const template = recipe();
    expect(applyTemplate(level.mm, initialState(level.mm), template).pos).not.toEqual(level.start.pos);

    let game = dispatchResearchToProduction(createGameState(opts, 200, 0), template);
    game = applyGameIntent(game, {
      kind: "setProductionLayout",
      layout: directSinkFactory(game.production.layout!),
    });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 2 });

    expect(game.inventory).toEqual([]);
    expect(game.production.waste).toBeGreaterThan(0);
  });

  it("stores actual production cost and removes a physical product after sale", () => {
    const template = recipe();
    const expectedCost = template.steps.reduce((total, step) => {
      return total + (DEFAULT_CATALOG.find((entry) => entry.typeId === step.typeId)?.cost ?? 0);
    }, 0);
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0), template);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 200 });
    const product = game.inventory[0]!;
    expect(product.productionCost).toBe(expectedCost);
    const disease = product.outcome.cured[0]!;
    const diseaseSpec = generate(opts).diseases.find((candidate) => candidate.id === disease)!;
    const cashBefore = game.economy.cash;

    game = applyGameIntent(game, {
      kind: "sellProduct",
      productId: product.inventoryId,
      disease,
    });

    expect(game.inventory.some((candidate) => candidate.inventoryId === product.inventoryId)).toBe(false);
    expect(game.economy.research).toBe(1);
    expect(game.economy.cash).toBe(
      cashBefore + diseaseSpec.basePrice - product.productionCost
        - product.outcome.sideEffects.length * 25,
    );
  });

  it("normalizes adjacent Production ticks and same-facility layout edits", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    const first = directSinkFactory(game.production.layout!);
    const second = directSinkFactory(game.production.layout!, 2);
    game = applyGameIntent(game, { kind: "setProductionLayout", layout: first });
    game = applyGameIntent(game, { kind: "setProductionLayout", layout: second });
    expect(game.intentTrace.at(-1)).toEqual({ kind: "setProductionLayout", layout: second });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 2 });
    expect(game.intentTrace.at(-1)).toEqual({ kind: "productionTicks", ticks: 3 });
    expect(game.replayTicks).toBe(3);
  });

  it("normalizes consecutive same-disease sales into one replayable bulk intent", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 200 });
    const first = game.inventory[0]!;
    const second = game.inventory[1]!;
    const disease = first.outcome.cured[0]!;
    game = applyGameIntent(game, { kind: "sellProduct", productId: first.inventoryId, disease });
    game = applyGameIntent(game, { kind: "sellProduct", productId: second.inventoryId, disease });
    expect(game.intentTrace.at(-1)).toEqual({
      kind: "sellProducts",
      productIds: [first.inventoryId, second.inventoryId],
      disease,
    });
  });

  it("sells more than the trace-entry cap atomically in one bulk intent", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    game = applyGameIntent(game, { kind: "productionTicks", ticks: MAX_INTENT_TRACE * 2 + 512 });
    const disease = game.inventory[0]!.outcome.cured[0]!;
    const productIds = game.inventory
      .filter((product) => product.outcome.cured.includes(disease))
      .map((product) => product.inventoryId);
    expect(productIds.length).toBeGreaterThan(MAX_INTENT_TRACE);
    game = applyGameIntent(game, { kind: "sellProducts", productIds, disease });
    expect(game.inventory.some((product) => productIds.includes(product.inventoryId))).toBe(false);
    expect(game.intentTrace.at(-1)).toMatchObject({ kind: "sellProducts", disease });
  });

  it("does not regenerate an unchanged level on each Production tick", () => {
    const generateSpy = vi.spyOn(mapgenModule, "generate");
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    const callsBeforeTick = generateSpy.mock.calls.length;
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
    expect(game.production.runtime?.tick).toBe(1);
    expect(generateSpy.mock.calls.length).toBe(callsBeforeTick);
    generateSpy.mockRestore();
  });

  it("rejects locked machines and non-entitled floors at every facility boundary", () => {
    const skew = DEFAULT_CATALOG.find((entry) => entry.typeId === "skew")!;
    const locked = entitledLayout({
      steps: [{
        typeId: skew.typeId,
        transform: skew.transform,
        orientation: { rot: 0, flip: false },
      }],
    });
    const game = createGameState(opts, 500, 0);
    expect(() => applyGameIntent(game, { kind: "setResearchLayout", layout: locked })).toThrow(/locked/i);

    const oversized = compileEntitledPrototype(
      recipe(),
      BASE_GAME_FACTORY_WIDTH + 1,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    for (const intent of [
      { kind: "setResearchLayout", layout: oversized },
      { kind: "setPilotLayout", layout: oversized },
      { kind: "setProductionLayout", layout: oversized },
    ] as const) {
      expect(() => applyGameIntent(game, intent)).toThrow(/entitled.*24x12/i);
    }
  });

  it("keeps all facility floors aligned with expansion patents", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 10_000, 100));
    const width = game.production.layout!.width;
    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    expect(game.research.layout?.width).toBe(width + 2);
    expect(game.pilot.layout?.width).toBe(width + 2);
    expect(game.production.layout?.width).toBe(width + 2);
    expect(game.production.runtime).toBeNull();
    expect(() => applyGameIntent(game, {
      kind: "setPilotLayout",
      layout: entitledLayout(recipe()),
    })).toThrow(/entitled.*26x12/i);
  });

  it("accepts only bounded maps and non-negative safe Production tick batches", () => {
    expect(() => createGameState({
      ...opts,
      width: MAX_GAME_MAP_DIMENSION + 1,
      height: MAX_GAME_MAP_DIMENSION + 1,
    }, 200, 0)).toThrow(/game.*map|dimensions/i);

    const empty = createGameState(opts, 200, 0);
    expect(applyGameIntent(empty, { kind: "productionTicks", ticks: 0 })).toBe(empty);
    for (const ticks of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => applyGameIntent(empty, { kind: "productionTicks", ticks })).toThrow(/ticks|integer/i);
    }
    expect(() => applyGameIntent(empty, { kind: "productionTicks", ticks: 1 })).toThrow(
      /Production.*layout/i,
    );
  });

  it("rejects tampered machine definitions and invalid source periods", () => {
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const tampered = baseLayout();
    const tiles = [...tampered.tiles];
    tiles[0] = { kind: "source", dir: 0, period: 1 };
    const layout: FactoryLayout = {
      ...tampered,
      tiles,
      machines: [{
        id: 0,
        def: {
          typeId: push.typeId,
          transform: push.transform,
          orientation: { rot: 0, flip: false },
          cost: 0,
          speed: push.speed,
        },
        anchor: { x: 2, y: 2 },
        footRot: 0,
        shape: DEFAULT_SHAPES.push!,
      }],
    };
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, { kind: "setProductionLayout", layout })).toThrow(/catalog/i);
    const badPeriod = { ...baseLayout(), tiles: [...baseLayout().tiles] };
    (badPeriod.tiles as FactoryLayout["tiles"][number][])[0] = {
      kind: "source",
      dir: 0,
      period: 0,
    };
    expect(() => applyGameIntent(game, {
      kind: "setProductionLayout",
      layout: badPeriod,
    })).toThrow(/period/i);
  });

  it("rejects oversized and overlapping facility authority inputs before simulation", () => {
    const oversized = {
      width: MAX_FACTORY_CELLS,
      height: 2,
      tiles: new Array(MAX_FACTORY_CELLS * 2),
      machines: [],
    } as unknown as FactoryLayout;
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, {
      kind: "setProductionLayout",
      layout: oversized,
    })).toThrow(/bounded|dimensions/i);

    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const placed = (id: number) => ({
      id,
      def: {
        typeId: push.typeId,
        transform: push.transform,
        orientation: { rot: 0 as const, flip: false },
        cost: push.cost,
        speed: push.speed,
      },
      anchor: { x: 2, y: 2 },
      footRot: 0 as const,
      shape: DEFAULT_SHAPES.push!,
    });
    expect(() => applyGameIntent(game, {
      kind: "setProductionLayout",
      layout: { ...baseLayout(), machines: [placed(0), placed(1)] },
    })).toThrow(/overlap/i);
  });

  it("owns and freezes facility layouts instead of aliasing caller mutations", () => {
    const mutableOptions: GenOptions = {
      ...opts,
      catalog: opts.catalog.map((entry) => ({ ...entry })),
      difficulty: { ...opts.difficulty },
    };
    let game = createGameState(mutableOptions, -0, 0);
    (mutableOptions as unknown as { seed: number }).seed = 99;
    expect(game.genOptions.seed).toBe(14);
    expect(Object.is(game.economy.cash, -0)).toBe(false);

    const mutableLayout = directSinkFactory(baseLayout());
    game = applyGameIntent(game, { kind: "setPilotLayout", layout: mutableLayout });
    (mutableLayout.tiles as FactoryLayout["tiles"] & {
      0: { kind: "source"; dir: 0; period: number };
    })[0].period = 2;
    expect(game.pilot.layout?.tiles[0]).toEqual({ kind: "source", dir: 0, period: 1 });
    expect(() => {
      (game.pilot.layout!.tiles as unknown as { period: number }[])[0]!.period = 3;
    }).toThrow();
  });

  it("drains every product once and does not mutate the input runtime", () => {
    const game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    const runtime = game.production.runtime!;
    const before = snapshotFactory(runtime);
    const next = applyGameIntent(game, { kind: "productionTicks", ticks: 200 });
    expect(next.production.runtime).not.toBe(runtime);
    expect(snapshotFactory(runtime)).toEqual(before);
    expect(next.production.runtime?.producedTotal).toBeGreaterThan(1);
    expect(next.inventory).toHaveLength(next.production.runtime!.producedTotal);
    expect(next.production.runtime?.producedEvents.count).toBe(0);
    expect(next.production.waste).toBe(0);
  });

  it("resets Production without affecting Research or Pilot", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    const research = game.research;
    const pilot = game.pilot;
    expect(applyGameIntent(game, { kind: "resetProduction" })).toBe(game);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 10 });
    game = applyGameIntent(game, { kind: "resetProduction" });
    expect(game.production.runtime?.tick).toBe(0);
    expect(game.research).toEqual(research);
    expect(game.pilot).toEqual(pilot);
    expect(applyGameIntent(game, { kind: "resetProduction" })).toBe(game);
  });

  it("rejects invalid sales atomically", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 200 });
    const first = game.inventory[0]!;
    const disease = first.outcome.cured[0]!;
    const otherDisease = generate(opts).diseases.find((candidate) => candidate.id !== disease)!.id;
    const before = game;
    const beforeHash = hashGame(game);
    for (const intent of [
      { kind: "sellProducts", productIds: [first.inventoryId, first.inventoryId], disease },
      { kind: "sellProducts", productIds: [game.nextInventoryId], disease },
      { kind: "sellProducts", productIds: [first.inventoryId], disease: otherDisease },
    ] as const) {
      expect(() => applyGameIntent(game, intent)).toThrow(/duplicated|unavailable|not a cure/i);
      expect(game).toBe(before);
      expect(hashGame(game)).toBe(beforeHash);
    }
  });

  it("enforces inventory and replay bounds", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 500, 0));
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 200 });
    const oversized = {
      ...game,
      inventory: new Array(MAX_GAME_INVENTORY_PRODUCTS + 1).fill(game.inventory[0]),
    };
    expect(() => serializeGame(oversized)).toThrow(/inventory exceeds/i);
    expect(() => applyGameIntent(game, {
      kind: "productionTicks",
      ticks: MAX_REPLAY_TICKS,
    })).toThrow(/cumulative.*ticks/i);
  });

  it("keeps locked machines out of all facility palettes", () => {
    const ids = availableCatalog(createGameState(opts, 200, 0).patents).map((entry) => entry.typeId);
    expect(ids).not.toContain("skew");
    expect(ids).not.toContain("dilute");
    expect(ids).toContain("push");
    expect(Object.isFrozen(DEFAULT_CATALOG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SHAPES.push?.cells)).toBe(true);
  });

  it("applies machine unlock, facility expansion, and map patents", () => {
    let game = dispatchResearchToProduction(createGameState(opts, 10_000, 100));
    game = applyGameIntent(game, { kind: "unlockPatent", id: "skew-unlock" });
    expect(availableCatalog(game.patents).map((entry) => entry.typeId)).toContain("skew");
    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    expect(game.production.layout?.width).toBe(BASE_GAME_FACTORY_WIDTH + 2);
    game = applyGameIntent(game, { kind: "unlockPatent", id: "new-map" });
    expect(game.genOptions.nMaps).toBe(3);
    expect(game.research.layout).toBeNull();
    expect(game.pilot.layout).toBeNull();
    expect(game.production.layout).toBeNull();
    game = applyGameIntent(game, { kind: "unlockPatent", id: "new-map-4" });
    expect(game.genOptions.nMaps).toBe(4);
  });

  it("replays and serializes the three-facility trace deterministically", () => {
    const initial = createGameState(opts, 500, 0);
    const produced = dispatchResearchToProduction(initial);
    const intents = produced.intentTrace;
    const a = replayGame(initial, intents);
    const b = replayGame(initial, intents);
    expect(a).toEqual(b);
    expect(hashGame(a)).toBe(hashGame(b));
    expect(deserializeGame(serializeGame(a))).toEqual(a);
  });

  it("streams the whole-game hash without materializing one giant canonical JSON string", () => {
    const empty = createGameState(opts, 200, 0);
    expect(hashGame(empty)).toBe(hashGame(createGameState(opts, 200, 0)));
    const produced = dispatchResearchToProduction(createGameState(opts, 500, 0));
    expect(hashGame(produced)).not.toBe(hashGame(empty));
    const source = readFileSync(new URL("./game.ts", import.meta.url), "utf8");
    const hashBody = source.slice(source.indexOf("export function hashGame"));
    expect(hashBody).not.toMatch(/TextEncoder\(\)\.encode\(canonical\(/);
  });

  it("clones the persistent inventory at most once per Production batch", () => {
    const source = readFileSync(new URL("./game.ts", import.meta.url), "utf8");
    const drain = source.slice(
      source.indexOf("function drainProducts"),
      source.indexOf("function sellPhysicalProducts"),
    );
    expect(drain.match(/current\.inventory = \[\.\.\.current\.sourceInventory\]/g)).toHaveLength(1);
    expect(drain).not.toMatch(/current\.inventory = \[\.\.\.current\.inventory/);
  });

  it("rejects unknown patent intents", () => {
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, { kind: "unlockPatent", id: "unknown" })).toThrow(/unknown/i);
  });

  it("canonicalizes intent objects to authoritative fields", () => {
    const layout = directSinkFactory(baseLayout());
    const game = applyGameIntent(createGameState(opts, 200, 0), {
      kind: "setPilotLayout",
      layout,
      ignored: "not authoritative",
    } as GameIntent & { ignored: string });
    expect(game.intentTrace[0]).not.toHaveProperty("ignored");
  });
});
