import { describe, it, expect } from "vitest";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  type GenOptions,
  type EconomyState,
  type PatentState,
} from "../../src/sim/phase0_interfaces";
import { generate } from "../../src/sim/mapgen/index";
import { solve } from "../../src/sim/solver/index";
import { initialState, evaluate } from "../../src/sim/drug-graph/index";
import {
  compileEntitledPrototype,
  compileTemplate,
  factoryOutcome,
} from "../../src/sim/recipe/index";
import { replayFactory } from "../../src/sim/state";
import { analyzeThroughput } from "../../src/sim/factory-sim/index";
import { sellUnit } from "../../src/sim/economy/index";
import { DEFAULT_PATENTS, canUnlock, unlockPatent } from "../../src/sim/patent/index";
import { serializeGame, deserializeGame } from "../../src/sim/save/index";
import { applyGameIntent, availableCatalog, createGameState } from "../../src/sim/game";

/** Small, fast options for an end-to-end loop. */
function opts(seed: number): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 32,
    height: 32,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 2, max: 8 },
  };
}

describe("integration: map → recipe → factory plus economy/patent/save contracts", () => {
  it("a generated disease can be solved, compiled, produced, and sold", () => {
    const level = generate(opts(7));
    const start = initialState(level.mm);
    const disease = level.diseases[0]!;

    // research: solver finds a sound recipe for the disease (INV-13)
    const sol = solve(level.mm, start, {
      catalog: availableCatalog({ unlocked: [] }),
      maxDepth: disease.difficulty + 4,
      targets: [disease.id],
    });
    expect(sol).not.toBeNull();
    const tmplOutcome = evaluate(level.mm, start, sol!.template);
    expect(tmplOutcome.failed).toBe(false);
    expect(tmplOutcome.cured).toContain(disease.id);

    // recipe → factory line realizes the template (INV-7)
    const layout = compileTemplate(sol!.template);
    const facOutcome = factoryOutcome(layout, level.mm, start);
    expect(facOutcome).toEqual(tmplOutcome);

    // produce: run the line; mass conservation holds; units are produced
    const fs = replayFactory(layout, level.mm, start, 200);
    expect(fs.deadlocked).toBe(false);
    expect(fs.producedTotal).toBeGreaterThan(0);
    expect(fs.nextUnitId).toBe(fs.producedTotal + fs.units.length); // no spawn/vanish

    // throughput is reported
    const tp = analyzeThroughput(layout, level.mm);
    expect(tp.rateDen).toBeGreaterThan(0);
  });

  it("selling diminishes per-disease but rewards diversifying (anti-degeneracy)", () => {
    const level = generate(opts(7));
    const dA = level.diseases[0]!;
    const dB = level.diseases[1]!;
    let econ: EconomyState = { cash: 0, research: 0, sold: [] };

    // spam disease A: each successive unit nets no more than the previous
    const nets: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = sellUnit(econ, dA.id, dA.basePrice, 0, 0);
      econ = r.econ;
      nets.push(r.revenue);
    }
    for (let i = 1; i < nets.length; i++) {
      expect(nets[i]!).toBeLessThanOrEqual(nets[i - 1]!);
    }
    // a fresh disease B's first unit beats A's now-saturated price
    const rB = sellUnit(econ, dB.id, dB.basePrice, 0, 0);
    expect(rB.revenue).toBeGreaterThan(nets[nets.length - 1]!);

    // cash conservation: cash after the A-spam equals the sum of those nets
    // (productionCost/sideEffectPenalty are 0 here, so net === revenue)
    const sumA = nets.reduce((a, b) => a + b, 0);
    expect(econ.cash).toBe(sumA);
    expect(rB.econ.cash).toBe(econ.cash + rB.net);
  });

  it("patents gate on cash + prerequisites; new-map requires bench-2", () => {
    let patents: PatentState = { unlocked: [] };
    // too poor for bench-2 (cost 120)
    expect(canUnlock(DEFAULT_PATENTS, patents, 50, 9999, "bench-2")).toBe(false);
    // new-map locked until bench-2
    expect(canUnlock(DEFAULT_PATENTS, patents, 9999, 9999, "new-map")).toBe(false);

    const u1 = unlockPatent(DEFAULT_PATENTS, patents, 200, 9999, "bench-2");
    patents = u1.patents;
    expect(patents.unlocked).toContain("bench-2");
    expect(u1.cash).toBe(80); // 200 − 120

    // now new-map is unlockable with enough cash
    expect(canUnlock(DEFAULT_PATENTS, patents, 9999, u1.research, "new-map")).toBe(true);
  });

  it("a full GameState round-trips through save", () => {
    const options = opts(7);
    const level = generate(options);
    const template = solve(level.mm, initialState(level.mm), {
      catalog: availableCatalog({ unlocked: [] }),
      maxDepth: 12,
      targets: [0],
    })!.template;
    let g = createGameState(options, 10_000, 100);
    const layout = compileEntitledPrototype(
      template,
      BASE_GAME_FACTORY_WIDTH,
      BASE_GAME_FACTORY_HEIGHT,
    ).layout;
    g = applyGameIntent(g, {
      kind: "setResearchLayout",
      layout,
    });
    g = applyGameIntent(g, { kind: "beginResearchShot" });
    while (g.research.shot !== null) {
      g = applyGameIntent(g, { kind: "advanceResearchShot" });
    }
    g = applyGameIntent(g, { kind: "sendResearchToPilot" });
    g = applyGameIntent(g, { kind: "sendPilotToProduction" });
    g = applyGameIntent(g, { kind: "productionTicks", ticks: 200 });
    const product = g.inventory[0]!;
    g = applyGameIntent(g, {
      kind: "sellProduct",
      productId: product.inventoryId,
      disease: product.outcome.cured[0]!,
    });
    g = applyGameIntent(g, { kind: "unlockPatent", id: "bench-2" });
    g = applyGameIntent(g, { kind: "unlockPatent", id: "skew-unlock" });
    g = applyGameIntent(g, { kind: "unlockPatent", id: "dilute-unlock" });
    expect(deserializeGame(serializeGame(g))).toEqual(g);
  });

  it("generation + factory replay are deterministic (INV-10, INV-15)", () => {
    const a = generate(opts(42));
    const b = generate(opts(42));
    expect(a.diseases).toEqual(b.diseases);
    const start = initialState(a.mm);
    const layout = compileTemplate(a.diseases[0]!.reference);
    const fa = replayFactory(layout, a.mm, start, 120);
    const fb = replayFactory(layout, a.mm, start, 120);
    expect(fa).toEqual(fb);
  });
});
