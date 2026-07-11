/**
 * Headless CLI harness. Once mapgen + drug-graph land:
 *   npm run sim gen 42     # generate a level from a seed, print diseases/difficulty/price
 *   npm run sim run 42     # generate + run each disease's reference solution, print outcomes
 */
import { generate } from "../src/sim/mapgen/index";
import { initialState, evaluate } from "../src/sim/drug-graph/index";
import { DEFAULT_CATALOG, type GenOptions } from "../src/sim/phase0_interfaces";
import { pathToFileURL } from "node:url";

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

export function parseSeed(seedArg: string): number {
  const seed = seedArg.trim() === "" ? Number.NaN : Number(seedArg);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error(`invalid seed: ${seedArg} (expected uint32 integer)`);
  }
  return seed >>> 0;
}

export function parseCliArgs(args: readonly string[]): { readonly cmd: string; readonly seed: number } {
  if (args.length > 2) {
    throw new Error(`unexpected arguments: ${args.slice(2).join(" ")}`);
  }
  const [cmd = "gen", seedArg = "1"] = args;
  return { cmd, seed: parseSeed(seedArg) };
}

export function main(args = process.argv.slice(2)): void {
  try {
    const { cmd, seed } = parseCliArgs(args);
    switch (cmd) {
      case "gen":
        cmdGen(seed);
        break;
      case "run":
        cmdRun(seed);
        break;
      default:
        throw new Error(`unknown command: ${cmd} (expected: gen | run)`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
