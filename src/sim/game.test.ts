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

const FACTORY_CATALOG = availableCatalog({ unlocked: [] }).filter(
  (entry) => DEFAULT_SHAPES[entry.typeId] !== undefined,
);

const opts: GenOptions = {
  seed: 14,
  nMaps: 1,
  width: 32,
  height: 32,
  catalog: FACTORY_CATALOG,
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

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

function buildTemplate(
  initial: ReturnType<typeof createGameState>,
  template = recipe(),
  runResearch = false,
): ReturnType<typeof createGameState> {
  let game = initial;
  if (runResearch) {
    game = applyGameIntent(game, { kind: "setResearchProgram", program: template });
    game = applyGameIntent(game, { kind: "beginResearchShot" });
    for (let guard = 0; game.research.shot !== null && guard < 300; guard++) {
      game = applyGameIntent(game, { kind: "advanceResearchShot" });
    }
    if (game.research.shot !== null) throw new Error("test Research shot did not finish");
  }
  const layout = entitledLayout(template);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  return applyGameIntent(game, { kind: "buildProductionLayout", layout });
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
  it("starts with an editable empty Production floor without a Pilot gate", () => {
    const game = createGameState(opts, 200, 0);

    expect(game.production.layout).toEqual(baseLayout());
    expect(game.production.runtime).not.toBeNull();
    expect(game.production.runtime.tick).toBe(0);
    expect(applyGameIntent(game, { kind: "productionTicks", ticks: 1 }).production.runtime.tick).toBe(1);
  });

  it("builds directly in Production and charges the exact construction quote", () => {
    const initial = createGameState(opts, 200, 0);
    const proposed = directSinkFactory(baseLayout());
    const built = applyGameIntent(initial, { kind: "buildProductionLayout", layout: proposed });

    expect(built.production.layout).toEqual(proposed);
    expect(built.production.layout).not.toBe(proposed);
    expect(built.economy.cash).toBe(182);
    expect(built.pilot).toBe(initial.pilot);
    expect(built.production.runtime.tick).toBe(0);
  });

  it("rejects unaffordable Production construction atomically", () => {
    const initial = createGameState(opts, 17, 0);
    const beforeHash = hashGame(initial);

    expect(() => applyGameIntent(initial, {
      kind: "buildProductionLayout",
      layout: directSinkFactory(baseLayout()),
    })).toThrow(/requires 18 cash/i);
    expect(hashGame(initial)).toBe(beforeHash);
  });

  it("keeps every paid Production build in the replay trace", () => {
    let game = createGameState(opts, 200, 0);
    const east = { ...baseLayout(), tiles: [...baseLayout().tiles] };
    east.tiles[0] = { kind: "belt", dir: 0 };
    const south = { ...baseLayout(), tiles: [...baseLayout().tiles] };
    south.tiles[0] = { kind: "belt", dir: 1 };

    game = applyGameIntent(game, { kind: "buildProductionLayout", layout: east });
    game = applyGameIntent(game, { kind: "buildProductionLayout", layout: south });

    expect(game.economy.cash).toBe(196);
    expect(game.intentTrace.slice(-2).map((intent) => intent.kind)).toEqual([
      "buildProductionLayout",
      "buildProductionLayout",
    ]);
  });

  it("credits inventory from physical Production output, not merely a Research result", () => {
    const level = generate(opts);
    const template = recipe();
    expect(applyTemplate(level.mm, initialState(level.mm), template).pos).not.toEqual(level.start.pos);

    let game = buildTemplate(createGameState(opts, 1_000, 0), template);
    game = applyGameIntent(game, {
      kind: "buildProductionLayout",
      layout: directSinkFactory(game.production.layout),
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
    let game = buildTemplate(createGameState(opts, 500, 0), template);
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

  it("normalizes adjacent Production ticks but retains paid layout edits", () => {
    let game = buildTemplate(createGameState(opts, 500, 0));
    const first = directSinkFactory(game.production.layout);
    const second = directSinkFactory(game.production.layout, 2);
    game = applyGameIntent(game, { kind: "buildProductionLayout", layout: first });
    game = applyGameIntent(game, { kind: "buildProductionLayout", layout: second });
    expect(game.intentTrace.slice(-2).map((intent) => intent.kind)).toEqual([
      "buildProductionLayout",
      "buildProductionLayout",
    ]);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 2 });
    expect(game.intentTrace.at(-1)).toEqual({ kind: "productionTicks", ticks: 3 });
    expect(game.replayTicks).toBe(3);
  });

  it("normalizes consecutive same-disease sales into one replayable bulk intent", () => {
    let game = buildTemplate(createGameState(opts, 500, 0));
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
    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const fastOptions: GenOptions = {
      ...opts,
      nMaps: 1,
      catalog: [push],
      diseaseCount: 1,
      difficulty: { min: 1, max: 1 },
    };
    const fastRecipe = generate(fastOptions).diseases[0]!.reference;
    let game = buildTemplate(createGameState(fastOptions, 500, 0), fastRecipe);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: MAX_INTENT_TRACE * 4 + 512 });
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
    let game = buildTemplate(createGameState(opts, 500, 0));
    const callsBeforeTick = generateSpy.mock.calls.length;
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
    expect(game.production.runtime?.tick).toBe(1);
    expect(generateSpy.mock.calls.length).toBe(callsBeforeTick);
    generateSpy.mockRestore();
  });

  it("uses a Pilot plan as an optional paid Production build without aliasing it", () => {
    const layout = entitledLayout(recipe());
    let game = createGameState(opts, 500, 0);
    expect(game.research.program.steps).toEqual([]);
    game = applyGameIntent(game, { kind: "setPilotLayout", layout });
    const pilot = game.pilot.layout!;
    game = applyGameIntent(game, { kind: "buildProductionLayout", layout: pilot });

    expect(game.production.layout).toEqual(pilot);
    expect(game.production.layout).not.toBe(pilot);
    expect(game.production.runtime.tick).toBe(0);
    expect(game.economy.cash).toBeLessThan(500);
    expect("contract" in game.pilot).toBe(false);
    expect("contract" in game.production).toBe(false);
  });

  it("keeps free Pilot edits independent from the live Production floor", () => {
    const layout = baseLayout();
    let game = createGameState(opts, 500, 0);
    const production = game.production;
    game = applyGameIntent(game, { kind: "setPilotLayout", layout });

    expect(game.economy.cash).toBe(500);
    expect(game.production).toBe(production);
    expect(game.pilot.layout).toEqual(layout);
  });

  it("rejects locked fixed paths and non-entitled physical floors at every boundary", () => {
    const skew = DEFAULT_CATALOG.find((entry) => entry.typeId === "skew")!;
    const lockedProgram = {
      steps: [{ typeId: skew.typeId, path: skew.path }],
    };
    const locked = entitledLayout(lockedProgram);
    const game = createGameState(opts, 500, 0);
    expect(() => applyGameIntent(game, {
      kind: "setResearchProgram",
      program: lockedProgram,
    })).toThrow(/locked/i);
    expect(() => applyGameIntent(game, { kind: "setPilotLayout", layout: locked })).toThrow(/locked/i);
    const built = buildTemplate(game);
    expect(() => applyGameIntent(built, {
      kind: "buildProductionLayout",
      layout: locked,
    })).toThrow(/locked/i);

    const oversized = compileEntitledPrototype(
      recipe(),
      BASE_GAME_FACTORY_WIDTH + 1,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    for (const intent of [
      { kind: "setPilotLayout", layout: oversized },
      { kind: "buildProductionLayout", layout: oversized },
    ] as const) {
      expect(() => applyGameIntent(game, intent)).toThrow(/entitled.*24x12/i);
    }
  });

  it("expands Pilot and Production while preserving the non-spatial ResearchProgram", () => {
    let game = buildTemplate(createGameState(opts, 10_000, 100), recipe(), true);
    const width = game.production.layout.width;
    const research = game.research;
    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    expect(game.research).toEqual(research);
    expect("layout" in game.research).toBe(false);
    expect(game.pilot.layout?.width).toBe(width + 2);
    expect(game.production.layout.width).toBe(width + 2);
    expect(game.production.runtime.tick).toBe(0);
    expect(() => applyGameIntent(game, {
      kind: "setPilotLayout",
      layout: entitledLayout(recipe()),
    })).toThrow(/entitled.*26x12/i);
  });

  it("expands facilities without interrupting or rewriting an active Research shot", () => {
    const program = recipe();
    let game = createGameState(opts, 10_000, 100);
    game = applyGameIntent(game, { kind: "setResearchProgram", program });
    game = applyGameIntent(game, { kind: "beginResearchShot" });
    const research = game.research;
    expect(research.shot).not.toBeNull();

    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });

    expect(game.research).toBe(research);
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
    expect(applyGameIntent(empty, { kind: "productionTicks", ticks: 1 }).production.runtime.tick).toBe(1);
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
          path: push.path,
          cost: 0,
          speed: push.speed,
        },
        anchor: { x: 2, y: 2 },
        footRot: 0,
        shape: DEFAULT_SHAPES.push!,
      }],
    };
    const game = createGameState(opts, 200, 0);
    expect(() => applyGameIntent(game, { kind: "buildProductionLayout", layout })).toThrow(/catalog/i);
    const badPeriod = { ...baseLayout(), tiles: [...baseLayout().tiles] };
    (badPeriod.tiles as FactoryLayout["tiles"][number][])[0] = {
      kind: "source",
      dir: 0,
      period: 0,
    };
    expect(() => applyGameIntent(game, {
      kind: "buildProductionLayout",
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
      kind: "buildProductionLayout",
      layout: oversized,
    })).toThrow(/bounded|dimensions/i);

    const push = DEFAULT_CATALOG.find((entry) => entry.typeId === "push")!;
    const placed = (id: number) => ({
      id,
      def: {
        typeId: push.typeId,
        path: push.path,
        cost: push.cost,
        speed: push.speed,
      },
      anchor: { x: 2, y: 2 },
      footRot: 0 as const,
      shape: DEFAULT_SHAPES.push!,
    });
    expect(() => applyGameIntent(game, {
      kind: "buildProductionLayout",
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
    const game = buildTemplate(createGameState(opts, 500, 0));
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
    let game = buildTemplate(createGameState(opts, 500, 0));
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

  it("preserves accumulated waste across layout edits and runtime reset", () => {
    let game = createGameState(opts, 500, 0);
    game = applyGameIntent(game, {
      kind: "buildProductionLayout",
      layout: directSinkFactory(game.production.layout),
    });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 2 });
    expect(game.production.waste).toBeGreaterThan(0);
    const waste = game.production.waste;

    game = applyGameIntent(game, { kind: "buildProductionLayout", layout: baseLayout() });
    expect(game.production.waste).toBe(waste);
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
    game = applyGameIntent(game, { kind: "resetProduction" });
    expect(game.production.waste).toBe(waste);
  });

  it("rejects invalid sales atomically", () => {
    let game = buildTemplate(createGameState(opts, 500, 0));
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 200 });
    const first = game.inventory[0]!;
    const disease = first.outcome.cured[0]!;
    const otherDisease = disease + 1;
    const before = game;
    const beforeHash = hashGame(game);
    for (const intent of [
      { kind: "sellProducts", productIds: [first.inventoryId, first.inventoryId], disease },
      { kind: "sellProducts", productIds: [game.nextInventoryId], disease },
      { kind: "sellProducts", productIds: [first.inventoryId], disease: otherDisease },
    ] as const) {
      expect(() => applyGameIntent(game, intent)).toThrow(/duplicated|unavailable|not a cure|unknown disease/i);
      expect(game).toBe(before);
      expect(hashGame(game)).toBe(beforeHash);
    }
  });

  it("enforces inventory and replay bounds", () => {
    let game = buildTemplate(createGameState(opts, 500, 0));
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

  it("applies machine unlock and both factory expansion patents without changing Atlas authority", () => {
    let game = buildTemplate(createGameState(opts, 10_000, 100));
    game = applyGameIntent(game, { kind: "unlockPatent", id: "skew-unlock" });
    expect(availableCatalog(game.patents).map((entry) => entry.typeId)).toContain("skew");
    game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
    expect(game.production.layout?.width).toBe(BASE_GAME_FACTORY_WIDTH + 2);
    const program = game.research.program;
    game = applyGameIntent(game, { kind: "unlockPatent", id: "floor-depth" });
    expect(game.production.layout?.height).toBe(BASE_GAME_FACTORY_HEIGHT + 2);
    expect(game.pilot.layout?.height).toBe(BASE_GAME_FACTORY_HEIGHT + 2);
    expect(game.genOptions.nMaps).toBe(1);
    expect(game.research.program).toEqual(program);
  });

  it("replays and serializes the three-facility trace deterministically", () => {
    const initial = createGameState(opts, 500, 0);
    const produced = buildTemplate(initial, recipe(), true);
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
    const produced = buildTemplate(createGameState(opts, 500, 0));
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
