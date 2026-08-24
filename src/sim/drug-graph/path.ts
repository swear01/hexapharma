import type { EffectMap, HexCoord, Machine } from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { HEX_DQ, HEX_DR } from "../hex";
import { validateEffectMap, validateMachinePath } from "./validation";

export interface PathWalkResult {
  readonly pos: HexCoord;
  readonly failed: boolean;
  readonly entered: readonly HexCoord[];
}

function inBounds(map: EffectMap, q: number, r: number): boolean {
  return q >= 0 && r >= 0 && q < map.width && r < map.height;
}

function walkPathCore(
  map: EffectMap,
  fromQ: number,
  fromR: number,
  machine: Machine,
  entered: HexCoord[] | null,
  out: Int32Array,
  outOffset: number,
): void {
  let q = fromQ;
  let r = fromR;
  let energy = machine.path.length;
  let failed = 0;

  for (let stepIndex = 0; stepIndex < machine.path.length; stepIndex++) {
    const dir = machine.path[stepIndex];
    if (dir === undefined) throw new Error("drug graph: validated path is missing a direction");

    const nextQ = q + HEX_DQ[dir]!;
    const nextR = r + HEX_DR[dir]!;
    if (!inBounds(map, nextQ, nextR)) continue;

    const cellIndex = nextR * map.width + nextQ;
    const kind = map.cell[cellIndex];
    if (kind === CellKind.Wall) continue;

    const cost = kind === CellKind.Swamp ? 2 : 1;
    if (energy < cost) break;
    energy -= cost;

    q = nextQ;
    r = nextR;
    if (entered !== null) entered.push({ q, r });

    if (kind === CellKind.Abyss) {
      failed = 1;
      break;
    }

    if (kind === CellKind.Portal) {
      const destination = map.portalTo[cellIndex];
      if (destination === undefined) {
        throw new Error("drug graph: validated portal has no destination");
      }
      q = destination % map.width;
      r = Math.floor(destination / map.width);
      if (entered !== null) entered.push({ q, r });
    }
  }

  out[outOffset] = q;
  out[outOffset + 1] = r;
  out[outOffset + 2] = failed;
}

function validateOutputRange(out: Int32Array, outOffset: number): void {
  if (!Number.isSafeInteger(outOffset) || outOffset < 0 || outOffset + 2 >= out.length) {
    throw new Error("drug graph: path output range is outside the buffer");
  }
}

/** Caller must validate the EffectMap and Machine once before using this in a hot loop. */
export function walkValidatedPathInto(
  map: EffectMap,
  fromQ: number,
  fromR: number,
  machine: Machine,
  out: Int32Array,
  outOffset: number,
): void {
  validateOutputRange(out, outOffset);
  walkPathCore(map, fromQ, fromR, machine, null, out, outOffset);
}

export function walkPathInto(
  map: EffectMap,
  fromQ: number,
  fromR: number,
  machine: Machine,
  out: Int32Array,
  outOffset: number,
): void {
  validateEffectMap(map);
  validateMachinePath(machine);
  walkValidatedPathInto(map, fromQ, fromR, machine, out, outOffset);
}

export function walkPath(map: EffectMap, from: HexCoord, machine: Machine): PathWalkResult {
  validateEffectMap(map);
  validateMachinePath(machine);
  const entered: HexCoord[] = [];
  const out = new Int32Array(3);
  walkPathCore(map, from.q, from.r, machine, entered, out, 0);
  return {
    pos: { q: out[0]!, r: out[1]! },
    failed: out[2] === 1,
    entered,
  };
}
