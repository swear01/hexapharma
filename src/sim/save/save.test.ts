import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FactoryLayout, GameState, GenOptions, Template } from "../phase0_interfaces";
import {
  DEFAULT_CATALOG,
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  MAX_FACTORY_CELLS,
  MAX_TEMPLATE_STEPS,
} from "../phase0_interfaces";
import { applyGameIntent, createGameState, validateGameState } from "../game";
import { generate } from "../mapgen";
import * as factorySim from "../factory-sim";
import { compileEntitledPrototype } from "../recipe";
import {
  SAVE_VERSION,
  SAVE_CONTENT_BUILD,
  MAX_SLOT_STATES,
  MAX_SAVE_CHARACTERS,
  SaveError,
  deserializeGame,
  deserializeSnapshot,
  deserializeSlots,
  pushSnapshot,
  rewind,
  serializeGame,
  serializeSnapshot,
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
  let next = applyGameIntent(game, { kind: "beginResearchShot" });
  for (const machine of program.steps) {
    next = applyGameIntent(next, { kind: "advanceResearchShot", machine });
    if (next.research.shot === null) break;
  }
  return next;
}

function activeResearch(game: GameState, program = researchFixture(game.genOptions).program): GameState {
  const started = applyGameIntent(game, { kind: "beginResearchShot" });
  return applyGameIntent(started, { kind: "advanceResearchShot", machine: program.steps[0]! });
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
  tiles[1] = { kind: "splitter", inDir: 3, outDirs: [0, 1] };
  tiles[2] = { kind: "sink" };
  tiles[base.width + 1] = { kind: "sink" };
  return { width: base.width, height: base.height, tiles, machines: [] };
}

function wire(game = baseGame()): { version: number; game: Record<string, any> } {
  return JSON.parse(serializeGame(game)) as { version: number; game: Record<string, any> };
}

describe("serializeGame / deserializeGame", () => {
  it("uses only the breaking v11 true-hex schema", () => {
    expect(SAVE_VERSION).toBe(11);
    const serialized = serializeGame(baseGame());
    const parsed = JSON.parse(serialized) as { version: number; game: Record<string, any> };

    expect(parsed.version).toBe(11);
    expect(parsed.game).toHaveProperty("research");
    expect(parsed.game).toHaveProperty("pilot");
    expect(parsed.game).toHaveProperty("production");
    expect(parsed.game).not.toHaveProperty("recipe");
    expect(parsed.game).not.toHaveProperty("factory");
    expect(parsed.game).not.toHaveProperty("factoryState");
    expect(parsed.game).not.toHaveProperty("factoryWaste");
    expect(parsed.game.research).toEqual(expect.objectContaining({
      program: expect.objectContaining({ steps: expect.any(Array) }),
      discoveredFormulas: expect.arrayContaining([
        expect.objectContaining({
          disease: expect.any(Number),
          program: expect.objectContaining({ steps: expect.any(Array) }),
          researchCost: expect.any(Number),
          outcome: expect.any(Object),
        }),
      ]),
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

  it("round-trips Research start, active-step, completed, Pilot, and negative-cash states", () => {
    const empty = createGameState(OPTIONS, 0, 0);
    const { layout, program } = researchFixture();
    const started = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "beginResearchShot",
    });
    const active = activeResearch(createGameState(OPTIONS, 10_000, 0), program);
    const completed = completeResearch(createGameState(OPTIONS, 10_000, 0), program);
    const pilot = applyGameIntent(completed, { kind: "setPilotLayout", layout });
    const negative = createGameState(OPTIONS, -250, 0);

    for (const game of [empty, started, active, completed, pilot, negative]) {
      expect(deserializeGame(serializeGame(game))).toEqual(game);
    }
  });

  it("round-trips abort, direct Pilot editing, and Production reset intents", () => {
    const { layout } = researchFixture();
    let aborted = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "beginResearchShot",
    });
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

  it("loads edited cash and Knowledge without a revenue trace or checksum", () => {
    const game = baseGame();
    const edited = wire(game);
    edited.game.economy.cash = 123456;
    edited.game.economy.research = 999;
    expect(edited.game).not.toHaveProperty("intentTrace");
    expect(edited.game).not.toHaveProperty("origin");
    expect(edited.game).not.toHaveProperty("stateHash");
    const loaded = deserializeGame(JSON.stringify(edited));
    expect(loaded.economy).toEqual({ ...game.economy, cash: 123456, research: 999 });
    expect(loaded.production).toEqual(game.production);
    expect(deserializeGame(serializeGame(loaded))).toEqual(loaded);
  });

  it("round-trips Research start/step and contract-free Pilot/Production through compact snapshots", () => {
    const { layout, program } = researchFixture();
    const started = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "beginResearchShot",
    });
    const active = activeResearch(createGameState(OPTIONS, 10_000, 0), program);
    const pilot = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setPilotLayout",
      layout,
    });
    const production = applyGameIntent(pilot, { kind: "buildProductionLayout", layout });

    for (const game of [started, active, pilot, production]) {
      const loaded = deserializeSnapshot(serializeSnapshot(game));
      expect(loaded).toEqual(game);
      expect("contract" in loaded.pilot).toBe(false);
      expect("contract" in loaded.production).toBe(false);
    }
  });

  it("rejects incompatible content builds before constructing state", () => {
    const edited = wire();
    const stale = { ...edited, contentBuild: "old-market-9/10", game: null };
    expect(() => deserializeGame(JSON.stringify(stale))).toThrow(/incompatible content build/i);
    expect(() => deserializeSlots(JSON.stringify({
      version: SAVE_VERSION, contentBuild: "old-patent-prices", slots: [null],
    }))).toThrow(/incompatible content build/i);
  });

  it("is stable-key deterministic and carries the current version", () => {
    const game = baseGame();
    const reordered: GameState = {
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
  it("rejects v9 envelopes before interpreting their payloads", () => {
    expect(() => deserializeGame(JSON.stringify({ version: 9, game: null })))
      .toThrow(/incompatible version 9.*expected 11/i);
    expect(() => deserializeSnapshot(JSON.stringify({ version: 9, authority: null })))
      .toThrow(/incompatible version 9.*expected 11/i);
    expect(() => deserializeSlots(JSON.stringify({ version: 9, slots: null })))
      .toThrow(/incompatible version 9.*expected 11/i);
  });

  it.each([10, 9, 8, 7, 6, 2])(
    "explicitly rejects legacy v%s full saves, snapshots, and slots without migration",
    (legacyVersion) => {
      const game = baseGame();
      const full = JSON.parse(serializeGame(game));
      full.version = legacyVersion;
      expect(() => deserializeGame(JSON.stringify(full))).toThrow(
        new RegExp(
          `legacy.*version ${legacyVersion}|` +
            `incompatible version ${legacyVersion}.*expected ${SAVE_VERSION}`,
          "i",
        ),
      );

      const authority = JSON.parse(serializeSnapshot(game));
      authority.version = legacyVersion;
      expect(() => deserializeSnapshot(JSON.stringify(authority))).toThrow(
        new RegExp(
          `legacy.*version ${legacyVersion}|` +
            `incompatible version ${legacyVersion}.*expected ${SAVE_VERSION}`,
          "i",
        ),
      );

      const slots = JSON.parse(serializeSlots([game]));
      slots.version = legacyVersion;
      expect(() => deserializeSlots(JSON.stringify(slots))).toThrow(
        new RegExp(
          `legacy.*version ${legacyVersion}|` +
            `incompatible version ${legacyVersion}.*expected ${SAVE_VERSION}`,
          "i",
        ),
      );
    },
  );

  it.each([
    "setResearchProgram",
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
      expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/unknown field game.intentTrace/i);
    },
  );

  it("rejects oversized history before interpreting its snapshots", () => {
    expect(() => deserializeSlots(JSON.stringify({
      version: SAVE_VERSION, contentBuild: SAVE_CONTENT_BUILD,
      slots: new Array(MAX_SLOT_STATES + 1).fill(null),
    }))).toThrow(/state count exceeds/i);
  });

  it("does not execute supplied save traces", () => {
    const edited = wire();
    edited.game.intentTrace = [{ kind: "productionTicks", ticks: Number.MAX_SAFE_INTEGER }];
    expect(() => deserializeGame(JSON.stringify(edited))).toThrow(/unknown field game.intentTrace/i);
  });

  it("rejects malformed JSON, missing version, incompatible version, and missing payload", () => {
    expect(() => deserializeGame("{not json")).toThrow(SaveError);
    expect(() => deserializeGame(JSON.stringify({ game: {} }))).toThrow(/missing version/);
    expect(() => deserializeGame(JSON.stringify({ version: SAVE_VERSION + 1, game: {} }))).toThrow(
      /incompatible version/,
    );
    expect(() => deserializeGame(JSON.stringify({ version: SAVE_VERSION, contentBuild: SAVE_CONTENT_BUILD }))).toThrow(/missing field save.game/);
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

    const missingFormulas = wire();
    delete missingFormulas.game.research.discoveredFormulas;
    expect(() => deserializeGame(JSON.stringify(missingFormulas))).toThrow(/discoveredFormulas/);
  });

  it("fails fast on oversized traces, Research programs, layouts, and slot arrays", () => {
    const trace = wire();
    trace.game.intentTrace = new Array(4097).fill({ kind: "resetProduction" });
    expect(() => deserializeGame(JSON.stringify(trace))).toThrow(/unknown field game.intentTrace/i);

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
      contentBuild: SAVE_CONTENT_BUILD,
      slots: new Array(MAX_SLOT_STATES + 1).fill({}),
    };
    expect(() => deserializeSlots(JSON.stringify(oversizedSlots))).toThrow(/state count.*exceeds/i);


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

    const compact = JSON.parse(serializeSnapshot(baseGame()));
    compact.snapshot.legacy = true;
    expect(() => deserializeSnapshot(JSON.stringify(compact))).toThrow(
      /unknown field game\.legacy/i,
    );

    const intent = wire();
    intent.game.intentTrace = [];
    expect(() => deserializeGame(JSON.stringify(intent))).toThrow(/unknown field.*intentTrace/i);

    const machine = wire();
    machine.game.pilot.layout.machines[0].def.orientation = { rot: 0, flip: false };
    expect(() => deserializeGame(JSON.stringify(machine))).toThrow(/unknown field.*orientation/i);
  });
});

describe("deserializeGame executable-state validation", () => {
  it("shares the map generator disease limit for the discovered formula ledger", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const parser = source.slice(
      source.indexOf("function parseResearchFacility"),
      source.indexOf("function parsePilotFacility"),
    );
    expect(parser).toContain("MAX_GENERATION_DISEASES");
    expect(parser).not.toMatch(/discoveredFormulas\.length > \d/);
  });

  it("rejects tampered catalog, Research paths, obsolete strokes, and factory content", () => {
    for (const facility of ["pilot", "production"] as const) {
      for (const [field, value] of [["cost", -999], ["speed", 0]] as const) {
        const parsed = wire();
        parsed.game[facility].layout.machines[0].def[field] = value;
        expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/catalog|cost|speed/i);
      }

      const path = wire();
      path.game[facility].layout.machines[0].def.path[0] =
        (path.game[facility].layout.machines[0].def.path[0] + 1) % 6;
      expect(() => deserializeGame(JSON.stringify(path))).toThrow(/path|catalog/i);

      const stroke = wire();
      stroke.game[facility].layout.machines[0].def.stroke = 0;
      expect(() => deserializeGame(JSON.stringify(stroke))).toThrow(/unknown field.*stroke/i);
    }

    const researchPath = wire();
    researchPath.game.research.program.steps[0].path[0] =
      (researchPath.game.research.program.steps[0].path[0] + 1) % 6;
    expect(() => deserializeGame(JSON.stringify(researchPath))).toThrow(/path|catalog/i);

    const researchStroke = wire();
    researchStroke.game.research.program.steps[0].stroke = 0;
    expect(() => deserializeGame(JSON.stringify(researchStroke))).toThrow(/unknown field.*stroke/i);

    const catalog = wire();
    catalog.game.genOptions.catalog[0].cost = -1;
    expect(() => deserializeGame(JSON.stringify(catalog))).toThrow(/catalog|cost/i);
  });

  it("rejects inconsistent Research shot progress, cost, drug, and outcome against the active program", () => {
    const { program } = researchFixture();
    const active = activeResearch(createGameState(OPTIONS, 10_000, 0), program);

    const step = wire(active);
    step.game.research.shot.step += 1;
    expect(() => deserializeGame(JSON.stringify(step))).toThrow(/Research shot/i);

    const cost = wire(active);
    cost.game.research.shot.cost += 1;
    expect(() => deserializeGame(JSON.stringify(cost))).toThrow(/Research shot cost/i);

    const drug = wire(active);
    drug.game.research.shot.drug.pos[0].q += 1;
    expect(() => deserializeGame(JSON.stringify(drug))).toThrow(/Research shot drug/i);

    const outcome = wire(completeResearch(createGameState(OPTIONS, 10_000, 0), program));
    outcome.game.research.lastOutcome.cured = [];
    expect(() => deserializeGame(JSON.stringify(outcome))).toThrow(/Research outcome/i);
  });

  it("rejects inconsistent discovered formula disease, cost, and outcome", () => {
    const disease = wire();
    disease.game.research.discoveredFormulas[0].disease += 100;
    expect(() => deserializeGame(JSON.stringify(disease))).toThrow(/formula.*disease/i);

    const cost = wire();
    cost.game.research.discoveredFormulas[0].researchCost += 1;
    expect(() => deserializeGame(JSON.stringify(cost))).toThrow(/formula.*cost/i);

    const outcome = wire();
    outcome.game.research.discoveredFormulas[0].outcome.cured = [];
    expect(() => deserializeGame(JSON.stringify(outcome))).toThrow(/formula.*outcome/i);
  });

  it("rejects unknown, duplicate, and prerequisite-skipping patents", () => {
    for (const unlocked of [["bogus"], ["bench-2", "bench-2"], ["floor-depth"]]) {
      const parsed = wire();
      parsed.game.patents = { unlocked };
      expect(() => deserializeGame(JSON.stringify(parsed))).toThrow(/patent|prerequisite/i);
    }
  });

  it("rejects inconsistent inventory outcomes and duplicate inventory ids", () => {
    const forged = wire();
    forged.game.inventory[0].outcome.cured = [];
    expect(() => deserializeGame(JSON.stringify(forged))).toThrow(/inventory.*outcome/i);

    const duplicate = wire();
    expect(duplicate.game.inventory.length).toBeGreaterThan(1);
    duplicate.game.inventory[1].inventoryId = duplicate.game.inventory[0].inventoryId;
    expect(() => deserializeGame(JSON.stringify(duplicate))).toThrow(/inventory id/i);
  });

  it("accepts player-edited inventory and runtime counters that satisfy executable invariants", () => {
    const edited = wire();
    edited.game.inventory[0].productionCost += 777;
    const clone = structuredClone(edited.game.inventory[0]);
    clone.inventoryId = edited.game.nextInventoryId++;
    edited.game.inventory.push(clone);
    edited.game.production.runtime.tick = 1_000_000;
    edited.game.production.runtime.nextUnitId += 100;
    edited.game.production.runtime.producedTotal += 100;
    const loaded = deserializeGame(JSON.stringify(edited));
    expect(loaded.inventory).toEqual(edited.game.inventory);
    expect(loaded.production.runtime.tick).toBe(1_000_000);
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

  it("accepts edited in-range splitter cursors and rejects out-of-range cursors", () => {
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
    expect(deserializeGame(JSON.stringify(forged)).production.runtime.splitterCursors[0]).toBe(0);
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

describe("snapshot safety", () => {

  it("keeps cloned layout identity coherent with its restored runtime", () => {
    const restore = vi.spyOn(factorySim, "restoreFactory");
    try {
      const game = validateGameState(createGameState(OPTIONS, 1000, 0));
      const map = restore.mock.calls.at(-1)![1];
      factorySim.stepFactory(game.production.layout, map, game.production.runtime);
      expect(game.production.runtime.tick).toBe(1);
    } finally {
      restore.mockRestore();
    }
  });

  it("rejects progress and production costs that would wrap when restored into int32 buffers", () => {
    for (const field of ["proc", "productionCost"]) {
      const edited = wire();
      edited.game.production.runtime.units[0][field] = 0x1_0000_0001;
      expect(() => deserializeGame(JSON.stringify(edited))).toThrow(/int32/i);
    }
  });

  it("preflights compact inventory expansion and rejects unknown group fields", () => {
    const edited = JSON.parse(serializeSnapshot(baseGame()));
    edited.snapshot.inventory[0].ids = new Array(24501).fill([0, 0]);
    expect(() => deserializeSnapshot(JSON.stringify(edited))).toThrow(/physical product limit/i);
    const unknown = JSON.parse(serializeSnapshot(baseGame()));
    unknown.snapshot.inventory[0].extra = true;
    expect(() => deserializeSnapshot(JSON.stringify(unknown))).toThrow(/unknown field/i);
  });

  it("preserves compact inventory order when product kinds alternate", () => {
    const game = baseGame();
    const inventory = game.inventory.map((product, index) => ({ ...product, productionCost: index % 2 }));
    expect(deserializeSnapshot(serializeSnapshot({ ...game, inventory })).inventory).toEqual(inventory);
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
    const active = activeResearch(createGameState(OPTIONS, 10_000, 0), program);
    const pilot = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setPilotLayout",
      layout,
    });
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
    const active = activeResearch(createGameState(OPTIONS, 10_000, 0), program);
    const pilot = applyGameIntent(createGameState(OPTIONS, 10_000, 0), {
      kind: "setPilotLayout",
      layout,
    });
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
