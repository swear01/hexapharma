import type { EffectMap, Machine, Vec2 } from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { validateEffectMap, validateMachinePath } from "./validation";

export interface PathWalkResult {
  readonly pos: Vec2;
  readonly failed: boolean;
  readonly entered: readonly Vec2[];
}

function inBounds(map: EffectMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

function walkPathCore(
  map: EffectMap,
  fromX: number,
  fromY: number,
  machine: Machine,
  entered: Vec2[] | null,
  out: Int32Array,
  outOffset: number,
): void {
  let x = fromX;
  let y = fromY;
  let energy = machine.path.length;
  let failed = 0;

  for (let stepIndex = 0; stepIndex < machine.path.length; stepIndex++) {
    const delta = machine.path[stepIndex];
    if (delta === undefined) throw new Error("drug graph: validated path is missing a delta");

    const nextX = x + delta.x;
    const nextY = y + delta.y;
    if (!inBounds(map, nextX, nextY)) continue;

    const cellIndex = nextY * map.width + nextX;
    const kind = map.cell[cellIndex];
    if (kind === CellKind.Wall) continue;

    const cost = kind === CellKind.Swamp ? 2 : 1;
    if (energy < cost) break;
    energy -= cost;

    x = nextX;
    y = nextY;
    if (entered !== null) entered.push({ x, y });

    if (kind === CellKind.Abyss) {
      failed = 1;
      break;
    }

    if (kind === CellKind.Portal) {
      const destination = map.portalTo[cellIndex];
      if (destination === undefined) {
        throw new Error("drug graph: validated portal has no destination");
      }
      x = destination % map.width;
      y = Math.floor(destination / map.width);
      if (entered !== null) entered.push({ x, y });
    }
  }

  out[outOffset] = x;
  out[outOffset + 1] = y;
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
  fromX: number,
  fromY: number,
  machine: Machine,
  out: Int32Array,
  outOffset: number,
): void {
  validateOutputRange(out, outOffset);
  walkPathCore(map, fromX, fromY, machine, null, out, outOffset);
}

export function walkPathInto(
  map: EffectMap,
  fromX: number,
  fromY: number,
  machine: Machine,
  out: Int32Array,
  outOffset: number,
): void {
  validateEffectMap(map);
  validateMachinePath(machine);
  walkValidatedPathInto(map, fromX, fromY, machine, out, outOffset);
}

export function walkPath(map: EffectMap, from: Vec2, machine: Machine): PathWalkResult {
  validateEffectMap(map);
  validateMachinePath(machine);
  const entered: Vec2[] = [];
  const out = new Int32Array(3);
  walkPathCore(map, from.x, from.y, machine, entered, out, 0);
  return {
    pos: { x: out[0]!, y: out[1]! },
    failed: out[2] === 1,
    entered,
  };
}
