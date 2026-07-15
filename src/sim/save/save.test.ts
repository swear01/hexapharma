import { describe, expect, it } from "vitest";
import type { FactoryLayout, GameState, GenOptions, Template } from "../phase0_interfaces";
import {
  DEFAULT_CATALOG,
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  MAX_BULK_SALE_PRODUCTS,
  MAX_FACTORY_CELLS,
  MAX_TEMPLATE_STEPS,
} from "../phase0_interfaces";
import { MAX_INTENT_TRACE, applyGameIntent, createGameState } from "../game";
import { generate } from "../mapgen";
import { compileEntitledPrototype } from "../recipe";
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
  nMaps: 1,
  width: 32,
  height: 32,
  catalog: DEFAULT_CATALOG,
  diseaseCount: 1,
  difficulty: { min: 4, max: 12 },
};

function researchFixture(options = OPTIONS): { layout: FactoryLayout; program: Template } {
  const program = generate(options).diseases[0]!.reference;
  return {
    layout: compileEntitledPrototype(
      program,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout,
    program,
  };
}

function completeResearch(game: GameState, program = researchFixture(game.genOptions).program): GameState {
  let next = applyGameIntent(game, { kind: "setResearchProgram", program });
  next = applyGameIntent(next, { kind: "beginResearchShot" });
  while (next.research.shot !== null) {
    next = applyGameIntent(next, { kind: "advanceResearchShot" });
  }
  return next;
}

function reachProduction(game = createGameState(OPTIONS, 10_000, 100)): GameState {
  const { layout } = researchFixture(game.genOptions);
  let next = completeResearch(game);
  next = applyGameIntent(next, { kind: "setPilotLayout", layout });
  return applyGameIntent(next, { kind: "buildProductionLayout", layout });
}

function baseGame(): GameState {
  return applyGameIntent(reachProduction(), { kind: "productionTicks", ticks: 80 });
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

function expensiveRawTrace(): unknown[] {
  const machine = DEFAULT_CATALOG[0]!;
  return [
    {
      kind: "setResearchProgram",
      program: {
        steps: new Array(MAX_TEMPLATE_STEPS).fill({
          typeId: machine.typeId,
          path: machine.path,
        }),
      },
    },
    ...new Array(MAX_INTENT_TRACE - 1).fill({ kind: "advanceResearchShot" }),
  ];
}

describe("serializeGame / deserializeGame", () => {
  it("uses only the breaking v7 three-facility schema", () => {
    expect(SAVE_VERSION).toBe(7);
    const serialized = serializeGame(baseGame());
    const parsed = JSON.parse(serialized) as { version: number; game: Record<string, any> };

    expect(parsed.version).toBe(7);
    expect(parsed.game).toHaveProperty("research");
    expect(parsed.game).toHaveProperty("pilot");
    expect(parsed.game).toHaveProperty("production");
    expect(parsed.game).not.toHaveProperty("recipe");
    expect(parsed.game).not.toHaveProperty("factory");
    expect(parsed.game).not.toHaveProperty("factoryState");
    expect(parsed.game).not.toHaveProperty("factoryWaste");
    expect(parsed.game.research).toEqual(expect.objectContaining({
      program: expect.objectContaining({ steps: expect.any(Array) }),
      shot: null,
    }));
    expect(parsed.game.research).not.toHaveProperty("layout");
    expect(parsed.game.pilot).toEqual(expect.objectContaining({ layout: expect.any(Object) }));
    expect(parsed.game.pilot).not.toHaveProperty("contract");
    expect(parsed.game.production).toEqual(expect.objectContaining({
      layout: expect.any(Object),
      runtime: expect.any(Object),
      waste: expect.any(Number),
    }));
    expect(parsed.game.production).not.toHaveProperty("contract");
    expect(parsed.game.research.program.steps[0]).toEqual({
      typeId: expect.any(String),
      path: expect.any(Array),
    });
    expect(serialized).not.toMatch(/"(?:saveRecipe|runLab|setFactory|factoryTicks|resetFactory)"/);
    expect(serialized).not.toMatch(/"(?:contract|transform|orientation|orientable)"\s*:/);
  });

  it("round-trips a live Production runtime through a cold snapshot", () => {
    const game = baseGame();
    const loaded = deserializeGame(serializeGame(game));
    expect(loaded).toEqual(game);
    expect(loaded.production.runtime).not.toBe(game.production.runtime);
  });

  it("round-trips Research editing, active-shot, completed, Pilot, and negative-cash states", () => {
    const empty = createGameState(OPTIONS, 0, 0);
    const { layout, program } = researchFixture();
    const editing = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setResearchProgram",
      program,
    });
    const active = applyGameIntent(editing, { kind: "beginResearchShot" });
    const completed = completeResearch(createGameState(OPTIONS, 10_000, 0), program);
    const pilot = applyGameIntent(completed, { kind: "setPilotLayout", layout });
    const negative = createGameState(OPTIONS, -250, 0);

    for (const game of [empty, editing, active, completed, pilot, negative]) {
      expect(deserializeGame(serializeGame(game))).toEqual(game);
    }
  });

  it("round-trips abort, direct Pilot editing, and Production reset intents", () => {
    const { layout, program } = researchFixture();
    let aborted = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setResearchProgram",
      program,
    });
    aborted = applyGameIntent(aborted, { kind: "beginResearchShot" });
    aborted = applyGameIntent(aborted, { kind: "abortResearchShot" });

    const pilot = applyGameIntent(createGameState(OPTIONS, 0, 0), {
      kind: "setPilotLayout",
      layout: emptyFactory(layout),
    });

    let reset = applyGameIntent(reachProduction(), {
      kind: "buildProductionLayout",
      layout: emptyFactory(layout),
    });
    reset = applyGameIntent(reset, { kind: "productionTicks", ticks: 5 });
    reset = applyGameIntent(reset, { kind: "resetProduction" });

    for (const game of [aborted, pilot, reset]) {
      expect(deserializeGame(serializeGame(game))).toEqual(game);
    }
  });

  it("round-trips a live Production runtime with cumulative waste", () => {
    let game = reachProduction();
    game = applyGameIntent(game, {
      kind: "buildProductionLayout",
      layout: emptyFactory(game.production.layout),
    });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 5 });
    expect(game.production.waste).toBeGreaterThan(0);
    expect(deserializeGame(serializeGame(game))).toEqual(game);
  });

  it("round-trips behavior-affecting Production splitter cursors", () => {
    let game = reachProduction();
    game = applyGameIntent(game, {
      kind: "buildProductionLayout",
      layout: splitterFactory(game.production.layout),
    });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 2 });
    expect(game.production.runtime.splitterCursors).toEqual(new Int32Array([1]));
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

  it("round-trips Research editing/shot and contract-free Pilot/Production through compact authority", () => {
    const { layout, program } = researchFixture();
    const editing = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setResearchProgram",
      program,
    });
    const active = applyGameIntent(editing, { kind: "beginResearchShot" });
    const pilot = applyGameIntent(editing, { kind: "setPilotLayout", layout });
    const production = applyGameIntent(pilot, { kind: "buildProductionLayout", layout });

    for (const game of [editing, active, pilot, production]) {
      const loaded = deserializeGameAuthority(serializeGameAuthority(game));
      expect(loaded).toEqual(game);
      expect("contract" in loaded.pilot).toBe(false);
      expect("contract" in loaded.production).toBe(false);
    }
  });

  it("preflights weighted raw three-facility authority work before semantic replay", () => {
    const authority = JSON.parse(
      serializeGameAuthority(createGameState(OPTIONS, 10_000, 0)),
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
    authority.authority.intentTrace = expensiveRawTrace();
    const raw = JSON.stringify(authority);

    expect(inspectGameAuthority(raw).replayWork).toBeGreaterThan(10_000_000);
    expect(() => deserializeGameAuthority(raw)).toThrow(/Research|canonical|replay/i);
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
      production: game.production,
      pilot: game.pilot,
      research: game.research,
      patents: game.patents,
      economy: game.economy,
      genOptions: game.genOptions,
    };
    expect(serializeGame(reordered)).toBe(serializeGame(game));
    expect(JSON.parse(serializeGame(game)).version).toBe(SAVE_VERSION);
  });
});

describe("deserializeGame schema validation", () => {
  it.each([6, 2])(
    "explicitly rejects legacy v%s full saves, authority, and slots without migration",
    (legacyVersion) => {
      const game = baseGame();
      const full = JSON.parse(serializeGame(game));
      full.version = legacyVersion;
      expect(() => deserializeGame(JSON.stringify(full))).toThrow(
        new RegExp(
          `legacy.*version ${legacyVersion}|` +
            `incompatible version ${legacyVersion}.*expected 7`,
          "i",
        ),
      );

      const authority = JSON.parse(serializeGameAuthority(game));
      authority.version = legacyVersion;
      expect(() => deserializeGameAuthority(JSON.stringify(authority))).toThrow(
        new RegExp(
          `legacy.*version ${legacyVersion}|` +
            `incompatible version ${legacyVersion}.*expected 7`,
          "i",
        ),
      );

      const slots = JSON.parse(serializeSlots([game]));
      slots.version = legacyVersion;
      expect(() => deserializeSlots(JSON.stringify(slots))).toThrow(
        new RegExp(
          `legacy.*version ${legacyVersion}|` +
            `incompatible version ${legacyVersion}.*expected 7`,
          "i",
        ),
      );
    },
  );

  it.each([
    "setResearchLayout",
    "sendResearchToPilot",
    "sendPilotToProduction",
    "setProductionLayout",
    "saveRecipe",
    "runLab",
    "setFactory",
    "factoryTicks",
    "resetFactory",
  ])(
    "rejects removed %s intents instead of falling back",
    (kind) => {
      const parsed = wire(createGameState(OPTIONS, 0, 0));
      parsed.game.intentTrace = [{ kind }];
      expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/unknown GameIntent kind/i);
    },
  );

  it("preflights aggregate trace/work budgets for full-slot histories", () => {
    const maximumOptions: GenOptions = {
      ...OPTIONS,
      width: 32,
      height: 32,
    };
    const full = JSON.parse(serializeGame(createGameState(maximumOptions, 0, 0))) as {
      game: Record<string, unknown>;
    };
    full.game.intentTrace = expensiveRawTrace();
    const raw = JSON.stringify({ version: SAVE_VERSION, slots: new Array(8).fill(full.game) });

    expect(() => deserializeSlots(raw)).toThrow(/aggregate.*(?:trace|replay work)|history.*work/i);
  });

  it("preflights one full save's raw trace before semantic replay", () => {
    const maximumOptions: GenOptions = {
      ...OPTIONS,
      width: 32,
      height: 32,
    };
    const full = JSON.parse(serializeGame(createGameState(maximumOptions, 0, 0))) as {
      game: Record<string, unknown>;
    };
    full.game.intentTrace = expensiveRawTrace();

    expect(() => deserializeGame(JSON.stringify(full))).toThrow(/input trace|replay|layout/i);
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

    const missingFacility = wire();
    delete missingFacility.game.research;
    expect(() => deserializeGame(JSON.stringify(missingFacility))).toThrow(/research/);
  });

  it("fails fast on oversized traces, Research programs, layouts, and slot arrays", () => {
    const trace = wire();
    trace.game.intentTrace = new Array(MAX_INTENT_TRACE + 1).fill({ kind: "resetProduction" });
    expect(() => deserializeGame(JSON.stringify(trace))).toThrow(/intentTrace.*exceeds/i);

    const program = wire();
    program.game.research.program.steps = new Array(MAX_TEMPLATE_STEPS + 1).fill(
      program.game.research.program.steps[0],
    );
    expect(() => deserializeGame(JSON.stringify(program))).toThrow(/steps.*exceeds/i);

    const layout = wire();
    layout.game.production.layout = {
      width: MAX_FACTORY_CELLS,
      height: 2,
      tiles: [],
      machines: [],
    };
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

  it("requires a non-null Production layout and runtime", () => {
    const layout = wire();
    layout.game.production.layout = null;
    expect(() => deserializeGame(JSON.stringify(layout))).toThrow(/production\.layout.*object/i);

    const runtime = wire();
    runtime.game.production.runtime = null;
    expect(() => deserializeGame(JSON.stringify(runtime))).toThrow(/production\.runtime.*object/i);
  });

  it("rejects unknown tiles and tile-count mismatches in both factory facilities", () => {
    for (const facility of ["pilot", "production"] as const) {
      const unknown = wire();
      unknown.game[facility].layout = {
        width: 1,
        height: 1,
        tiles: [{ kind: "wormhole" }],
        machines: [],
      };
      expect(() => deserializeGame(JSON.stringify(unknown))).toThrow(/unknown FactoryTile kind/);

      const mismatch = wire();
      mismatch.game[facility].layout = {
        width: 4,
        height: 4,
        tiles: [{ kind: "empty" }],
        machines: [],
      };
      expect(() => deserializeGame(JSON.stringify(mismatch))).toThrow(/layout\.tiles/);
    }
  });

  it("rejects v5 facility fields and cross-domain payloads instead of ignoring them", () => {
    const researchLayout = wire();
    researchLayout.game.research.layout = researchLayout.game.pilot.layout;
    expect(() => deserializeGame(JSON.stringify(researchLayout))).toThrow(/unknown field.*research\.layout/i);

    const pilotContract = wire();
    pilotContract.game.pilot.contract = pilotContract.game.research.program;
    expect(() => deserializeGame(JSON.stringify(pilotContract))).toThrow(/unknown field.*pilot\.contract/i);

    const productionContract = wire();
    productionContract.game.production.contract = productionContract.game.research.program;
    expect(() => deserializeGame(JSON.stringify(productionContract))).toThrow(
      /unknown field.*production\.contract/i,
    );
  });

  it("strictly rejects unknown full, compact, intent, and machine fields", () => {
    const full = wire();
    full.game.legacy = true;
    expect(() => deserializeGame(JSON.stringify(full))).toThrow(/unknown field game\.legacy/i);

    const compact = JSON.parse(serializeGameAuthority(baseGame()));
    compact.authority.legacy = true;
    expect(() => deserializeGameAuthority(JSON.stringify(compact))).toThrow(
      /unknown field authority\.legacy/i,
    );

    const intent = wire();
    intent.game.intentTrace[0].layout = {};
    expect(() => deserializeGame(JSON.stringify(intent))).toThrow(/unknown field.*layout/i);

    const machine = wire();
    machine.game.pilot.layout.machines[0].def.orientation = { rot: 0, flip: false };
    expect(() => deserializeGame(JSON.stringify(machine))).toThrow(/unknown field.*orientation/i);
  });
});

describe("deserializeGame semantic authority", () => {
  it("rejects tampered catalog, Research paths, obsolete strokes, and factory authority", () => {
    for (const facility of ["pilot", "production"] as const) {
      for (const [field, value] of [["cost", -999], ["speed", 0]] as const) {
        const parsed = wire();
        parsed.game[facility].layout.machines[0].def[field] = value;
        expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/catalog|cost|speed/i);
      }

      const path = wire();
      path.game[facility].layout.machines[0].def.path[0] = { x: -1, y: 0 };
      expect(() => deserializeGame(JSON.stringify(path))).toThrow(/path|catalog|replay mismatch/i);

      const stroke = wire();
      stroke.game[facility].layout.machines[0].def.stroke = 0;
      expect(() => deserializeGame(JSON.stringify(stroke))).toThrow(/unknown field.*stroke/i);
    }

    const researchPath = wire();
    researchPath.game.research.program.steps[0].path[0] = { x: -1, y: 0 };
    expect(() => deserializeGame(JSON.stringify(researchPath))).toThrow(/path|catalog|replay mismatch/i);

    const researchStroke = wire();
    researchStroke.game.research.program.steps[0].stroke = 0;
    expect(() => deserializeGame(JSON.stringify(researchStroke))).toThrow(/unknown field.*stroke/i);

    const catalog = wire();
    catalog.game.genOptions.catalog[0].cost = -1;
    expect(() => deserializeGame(JSON.stringify(catalog))).toThrow(/catalog|cost/i);
  });

  it("rejects forged Research shot progress, cost, drug, and outcome by replay", () => {
    const { program } = researchFixture();
    const editing = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setResearchProgram",
      program,
    });
    const active = applyGameIntent(editing, { kind: "beginResearchShot" });

    const step = wire(active);
    step.game.research.shot.step += 1;
    expect(() => deserializeGame(JSON.stringify(step))).toThrow(/Research shot|replay mismatch/i);

    const cost = wire(active);
    cost.game.research.shot.cost += 1;
    expect(() => deserializeGame(JSON.stringify(cost))).toThrow(/Research shot cost|replay mismatch/i);

    const drug = wire(active);
    drug.game.research.shot.drug.pos[0].x += 1;
    expect(() => deserializeGame(JSON.stringify(drug))).toThrow(/Research shot drug|replay mismatch/i);

    const outcome = wire(completeResearch(createGameState(OPTIONS, 10_000, 0), program));
    outcome.game.research.lastOutcome.cured = [];
    expect(() => deserializeGame(JSON.stringify(outcome))).toThrow(/Research outcome|replay mismatch/i);
  });

  it("rejects unknown, duplicate, and prerequisite-skipping patents", () => {
    for (const unlocked of [["bogus"], ["bench-2", "bench-2"], ["floor-depth"]]) {
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

  it("rejects locally plausible Production cost, progress, position, and counter forgery by replay", () => {
    const inventoryCost = wire();
    inventoryCost.game.inventory[0].productionCost += 777;
    expect(() => deserializeGame(JSON.stringify(inventoryCost))).toThrow(
      /replay mismatch.*productionCost/i,
    );

    const minted = wire();
    const clone = structuredClone(minted.game.inventory[0]);
    clone.inventoryId = minted.game.nextInventoryId;
    minted.game.nextInventoryId += 1;
    minted.game.inventory.push(clone);
    expect(() => deserializeGame(JSON.stringify(minted))).toThrow(/replay mismatch.*inventory/i);

    const progress = wire();
    expect(progress.game.production.runtime.units.length).toBeGreaterThan(0);
    progress.game.production.runtime.units[0].proc += 1;
    expect(() => deserializeGame(JSON.stringify(progress))).toThrow(/replay mismatch.*proc/i);

    const position = wire();
    const unit = position.game.production.runtime.units[0];
    unit.drug.pos[0].x = (unit.drug.pos[0].x + 1) % position.game.genOptions.width;
    expect(() => deserializeGame(JSON.stringify(position))).toThrow(/replay mismatch.*drug.*pos/i);

    const tick = wire();
    tick.game.production.runtime.tick += 1;
    expect(() => deserializeGame(JSON.stringify(tick))).toThrow(/replay mismatch.*tick/i);

    const counters = wire();
    counters.game.production.runtime.nextUnitId += 100;
    counters.game.production.runtime.producedTotal += 100;
    expect(() => deserializeGame(JSON.stringify(counters))).toThrow(
      /replay mismatch.*nextUnitId|producedTotal/i,
    );
  });

  it("rejects negative sale counts, costs, progress, and invalid Production mass", () => {
    const sold = wire();
    sold.game.economy.sold = [{ disease: 0, count: -1 }];
    expect(() => deserializeGame(JSON.stringify(sold))).toThrow(/sold count/i);

    const unordered = wire();
    unordered.game.economy.sold = [
      { disease: 1, count: 1 },
      { disease: 0, count: 1 },
    ];
    expect(() => deserializeGame(JSON.stringify(unordered))).toThrow(/order|generated diseases/i);

    const inventoryCost = wire();
    inventoryCost.game.inventory[0].productionCost = -1;
    expect(() => deserializeGame(JSON.stringify(inventoryCost))).toThrow(/production cost/i);

    const progress = wire();
    expect(progress.game.production.runtime.units.length).toBeGreaterThan(0);
    progress.game.production.runtime.units[0].proc = -1;
    expect(() => deserializeGame(JSON.stringify(progress))).toThrow(/progress|proc/i);

    const mass = wire();
    mass.game.production.runtime.nextUnitId = -1;
    expect(() => deserializeGame(JSON.stringify(mass))).toThrow(/nextUnitId|next unit id|mass/i);
  });

  it("rejects undrained Production events so load cannot credit a product twice", () => {
    const parsed = wire();
    const product = parsed.game.inventory[0];
    parsed.game.production.runtime.producedEvents = [{
      id: product.id,
      drug: product.drug,
      productionCost: product.productionCost,
    }];
    expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/drained|product event/i);
  });

  it("rejects forged or out-of-range Production splitter cursors", () => {
    let game = reachProduction();
    game = applyGameIntent(game, {
      kind: "buildProductionLayout",
      layout: splitterFactory(game.production.layout),
    });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 2 });
    const outOfRange = wire(game);
    outOfRange.game.production.runtime.splitterCursors[0] = 2;
    expect(() => deserializeGame(JSON.stringify(outOfRange))).toThrow(/splitter.*cursor/i);

    const forged = wire(game);
    forged.game.production.runtime.splitterCursors[0] = 0;
    expect(() => deserializeGame(JSON.stringify(forged))).toThrow(/replay mismatch.*splitterCursors/i);
  });

  it("rejects invalid source periods and duplicate machine ids", () => {
    const source = wire();
    const sourceTile = source.game.production.layout.tiles.find(
      (tile: any) => tile.kind === "source",
    );
    sourceTile.period = 0;
    expect(() => deserializeGame(JSON.stringify(source))).toThrow(/source|period/i);

    const duplicate = wire();
    expect(duplicate.game.pilot.layout.machines.length).toBeGreaterThan(1);
    duplicate.game.pilot.layout.machines[1].id =
      duplicate.game.pilot.layout.machines[0].id;
    expect(() => deserializeGame(JSON.stringify(duplicate))).toThrow(/duplicate.*id/i);
  });

  it("serializeGame also refuses invalid in-memory three-facility state", () => {
    const game = baseGame();
    const invalid = { ...game, production: { ...game.production, waste: -1 } };
    expect(() => serializeGame(invalid)).toThrow(SaveError);

    const runtime = game.production.runtime;
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

  it("round-trips active Research, independent Pilot, and live Production slot states", () => {
    const { layout, program } = researchFixture();
    const editing = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setResearchProgram",
      program,
    });
    const active = applyGameIntent(editing, { kind: "beginResearchShot" });
    const pilot = applyGameIntent(editing, { kind: "setPilotLayout", layout });
    const production = applyGameIntent(pilot, { kind: "buildProductionLayout", layout });
    const states = [active, pilot, production];

    expect(deserializeSlots(serializeSlots(states))).toEqual(states);
  });

  it("rejects malformed and incompatible slot blobs", () => {
    expect(() => deserializeSlots("[oops")).toThrow(SaveError);
    expect(() => deserializeSlots(JSON.stringify({ version: SAVE_VERSION + 1, slots: [] }))).toThrow(
      /incompatible version/,
    );
  });

  it("pushSnapshot cold-clones a mutable Production runtime", () => {
    const game = baseGame();
    const history = pushSnapshot([], game);
    expect(history).toEqual([game]);
    expect(history[0]).not.toBe(game);
    expect(history[0]?.production.runtime).not.toBe(game.production.runtime);
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

  it("rewinds exactly to an active Research shot without inventing factory contracts", () => {
    const { layout, program } = researchFixture();
    const editing = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setResearchProgram",
      program,
    });
    const active = applyGameIntent(editing, { kind: "beginResearchShot" });
    const pilot = applyGameIntent(editing, { kind: "setPilotLayout", layout });
    const production = applyGameIntent(pilot, { kind: "buildProductionLayout", layout });

    const recalled = rewind([active, pilot, production], 2).state;
    expect(recalled).toEqual(active);
    expect(recalled.research.shot).not.toBeNull();
    expect("contract" in recalled.pilot).toBe(false);
    expect("contract" in recalled.production).toBe(false);
  });

  it("uses one step by default and rejects rewinding past the start", () => {
    const a = baseGame();
    const b = createGameState({ ...OPTIONS, seed: 15 }, 5, 1);
    expect(rewind([a, b]).state).toEqual(a);
    expect(() => rewind([a], 5)).toThrow(SaveError);
  });
});
