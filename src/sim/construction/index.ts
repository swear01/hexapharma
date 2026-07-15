import type { FactoryLayout, FactoryTile } from "../phase0_interfaces";

function sameDirections(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function sameTile(left: FactoryTile, right: FactoryTile): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "empty":
    case "sink":
      return true;
    case "belt":
      return right.kind === "belt" && left.dir === right.dir;
    case "source":
      return right.kind === "source" && left.dir === right.dir && left.period === right.period;
    case "splitter":
      return right.kind === "splitter" && left.inDir === right.inDir && sameDirections(left.outDirs, right.outDirs);
    case "merger":
      return right.kind === "merger" && left.outDir === right.outDir && sameDirections(left.inDirs, right.inDirs);
  }
}

function tileBuildPrice(tile: FactoryTile): number {
  switch (tile.kind) {
    case "empty":
      return 0;
    case "belt":
      return 2;
    case "splitter":
    case "merger":
      return 8;
    case "source":
      return 12;
    case "sink":
      return 6;
  }
}

function sameInstalledMachine(
  left: FactoryLayout["machines"][number],
  right: FactoryLayout["machines"][number],
): boolean {
  return left.def.typeId === right.def.typeId &&
    left.anchor.x === right.anchor.x &&
    left.anchor.y === right.anchor.y &&
    left.footRot === right.footRot;
}

function addPrice(total: number, price: number): number {
  if (!Number.isSafeInteger(price) || price < 0 || total > Number.MAX_SAFE_INTEGER - price) {
    throw new Error("Production construction quote exceeds safe-integer range");
  }
  return total + price;
}

export function quoteProductionBuild(current: FactoryLayout, proposed: FactoryLayout): number {
  if (
    current.width !== proposed.width ||
    current.height !== proposed.height ||
    current.tiles.length !== proposed.tiles.length
  ) {
    throw new Error("Production construction quote requires matching floor dimensions");
  }
  let total = 0;
  for (let index = 0; index < proposed.tiles.length; index++) {
    const before = current.tiles[index];
    const after = proposed.tiles[index];
    if (before === undefined || after === undefined) {
      throw new Error("Production construction quote found an incomplete floor");
    }
    if (sameTile(before, after)) continue;
    const price = tileBuildPrice(after);
    total = addPrice(total, price);
  }
  for (const machine of proposed.machines) {
    if (current.machines.some((installed) => sameInstalledMachine(installed, machine))) continue;
    total = addPrice(total, machine.def.cost * 10);
  }
  return total;
}
