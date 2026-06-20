/**
 * Headless CLI harness. Once mapgen + drug-graph land:
 *   npm run sim gen 42     # generate a level from a seed, print diseases/difficulty/price
 *   npm run sim run 42     # generate + run each disease's reference solution, print outcomes
 */
import { generate } from "../src/sim/mapgen/index";
import { initialState, evaluate } from "../src/sim/drug-graph/index";
import { DEFAULT_CATALOG, type GenOptions } from "../src/sim/phase0_interfaces";

function optsFor(seed: number): GenOptions {
  return {
    seed,
    nMaps: 2,
    width: 16,
    height: 16,
    catalog: DEFAULT_CATALOG,
    diseaseCount: 2,
    difficulty: { min: 2, max: 12 },
  };
}

function cmdGen(seed: number): void {
  const level = generate(optsFor(seed));
  console.log(
    JSON.stringify(
      {
        seed: level.seed,
        nMaps: level.mm.maps.length,
        size: level.mm.maps.map((m) => `${m.width}x${m.height}`),
        diseases: level.diseases.map((d) => ({
          id: d.id,
          map: d.map,
          node: d.node,
          difficulty: d.difficulty,
          basePrice: d.basePrice,
          refSteps: d.reference.steps.length,
        })),
      },
      null,
      2,
    ),
  );
}

function cmdRun(seed: number): void {
  const level = generate(optsFor(seed));
  const start = initialState(level.mm);
  for (const d of level.diseases) {
    const outcome = evaluate(level.mm, start, d.reference);
    console.log(
      `disease ${d.id} (map ${d.map}): cured=${outcome.cured.includes(d.id)} ` +
        `failed=${outcome.failed} sideEffects=[${outcome.sideEffects.join(",")}] ` +
        `final=${JSON.stringify(outcome.final)}`,
    );
  }
}

function main(): void {
  const [cmd = "gen", seedArg = "1"] = process.argv.slice(2);
  const seed = Number.parseInt(seedArg, 10);
  if (!Number.isFinite(seed)) {
    console.error(`invalid seed: ${seedArg}`);
    process.exitCode = 1;
    return;
  }
  switch (cmd) {
    case "gen":
      cmdGen(seed);
      break;
    case "run":
      cmdRun(seed);
      break;
    default:
      console.error(`unknown command: ${cmd} (expected: gen | run)`);
      process.exitCode = 1;
  }
}

main();
