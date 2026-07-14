import type { EffectMap, Machine, PathStamp } from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";

export function validatePathStamp(path: PathStamp): void {
  if (!Array.isArray(path) || path.length === 0) {
    throw new Error("drug graph: path stamp must be a non-empty array");
  }

  for (let index = 0; index < path.length; index++) {
    const delta = path[index];
    if (
      delta === undefined ||
      !Number.isSafeInteger(delta.x) ||
      !Number.isSafeInteger(delta.y) ||
      Math.abs(delta.x) + Math.abs(delta.y) !== 1
    ) {
      throw new Error(`drug graph: path delta ${index} must be a cardinal unit delta`);
    }
  }
}

export function validateMachinePath(machine: Machine): void {
  validatePathStamp(machine.path);
  if (
    !Number.isSafeInteger(machine.stroke) ||
    machine.stroke < 1 ||
    machine.stroke > machine.path.length
  ) {
    throw new Error("drug graph: stroke must be an integer in [1, path.length]");
  }
}

export function validateEffectMap(map: EffectMap): void {
  if (
    !Number.isSafeInteger(map.width) ||
    !Number.isSafeInteger(map.height) ||
    map.width < 1 ||
    map.height < 1
  ) {
    throw new Error("drug graph: effect map dimensions must be positive safe integers");
  }

  const area = map.width * map.height;
  if (!Number.isSafeInteger(area) || map.cell.length !== area) {
    throw new Error("drug graph: cell length must equal width*height");
  }
  if (!(map.portalTo instanceof Int32Array) || map.portalTo.length !== area) {
    throw new Error("drug graph: portalTo length must equal width*height");
  }

  const entryForDestination = new Int32Array(area).fill(-1);
  for (let index = 0; index < area; index++) {
    const kind = map.cell[index];
    const destination = map.portalTo[index];
    if (kind === CellKind.Portal) {
      if (destination === undefined || destination < 0 || destination >= area) {
        throw new Error(`drug graph: portal destination at index ${index} is outside this map`);
      }
      if (destination === index) {
        throw new Error(`drug graph: portal destination at index ${index} cannot be itself`);
      }
      if (map.cell[destination] === CellKind.Portal) {
        throw new Error(
          `drug graph: portal destination at index ${index} cannot also be a portal entry`,
        );
      }
      if (entryForDestination[destination] !== -1) {
        throw new Error(
          `drug graph: portal destination ${destination} must be unique to one entry`,
        );
      }
      entryForDestination[destination] = index;
    } else if (destination !== -1) {
      throw new Error(`drug graph: non-portal cell ${index} must have portalTo -1`);
    }
  }
}
