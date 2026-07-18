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
  if (!Number.isSafeInteger(area)) {
    throw new Error("drug graph: effect map area must be a safe integer");
  }
  if (!(map.cell instanceof Uint8Array) || map.cell.length !== area) {
    throw new Error("drug graph: cell length must equal width*height");
  }
  if (!(map.cureId instanceof Int16Array) || map.cureId.length !== area) {
    throw new Error("drug graph: cureId length must equal width*height and use Int16Array");
  }
  if (!(map.sideEffectId instanceof Int32Array) || map.sideEffectId.length !== area) {
    throw new Error("drug graph: sideEffectId length must equal width*height and use Int32Array");
  }
  if (!(map.portalTo instanceof Int32Array) || map.portalTo.length !== area) {
    throw new Error("drug graph: portalTo length must equal width*height and use Int32Array");
  }
  if (!(map.fog instanceof Uint8Array) || map.fog.length !== area) {
    throw new Error("drug graph: fog length must equal width*height and use Uint8Array");
  }
  for (const [label, point] of [["origin", map.origin], ["start", map.start]] as const) {
    if (
      point === null ||
      typeof point !== "object" ||
      !Number.isSafeInteger(point.x) ||
      !Number.isSafeInteger(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x >= map.width ||
      point.y >= map.height
    ) {
      throw new Error(`drug graph: effect map ${label} must be an in-bounds integer coordinate`);
    }
  }

  const entryForDestination = new Int32Array(area).fill(-1);
  for (let index = 0; index < area; index++) {
    const kind = map.cell[index];
    if (kind === undefined || kind < CellKind.Empty || kind > CellKind.Cure) {
      throw new Error(`drug graph: cell ${index} has an unknown CellKind`);
    }
    const cureId = map.cureId[index];
    if (cureId === undefined || cureId < -1) {
      throw new Error(`drug graph: cureId at cell ${index} must be -1 or non-negative`);
    }
    if (kind === CellKind.Cure && cureId < 0) {
      throw new Error(`drug graph: Cure cell ${index} requires a non-negative cureId`);
    }
    if (kind !== CellKind.Cure && cureId !== -1) {
      throw new Error(`drug graph: non-Cure cell ${index} must have cureId -1`);
    }
    const sideEffectId = map.sideEffectId[index];
    if (sideEffectId === undefined || sideEffectId < -1) {
      throw new Error(`drug graph: sideEffectId at cell ${index} must be -1 or non-negative`);
    }
    if (kind === CellKind.SideEffect && sideEffectId < 0) {
      throw new Error(`drug graph: SideEffect cell ${index} requires a non-negative sideEffectId`);
    }
    if (
      kind !== CellKind.Cure &&
      kind !== CellKind.SideEffect &&
      sideEffectId !== -1
    ) {
      throw new Error(
        `drug graph: sideEffectId at cell ${index} is only valid on Cure or SideEffect cells`,
      );
    }
    const fog = map.fog[index];
    if (fog !== 0 && fog !== 1) {
      throw new Error(`drug graph: fog at cell ${index} must be 0 or 1`);
    }
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
