import type { EffectMap, Vec2 } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";

export type LabTerrainMotif =
  | "substrate"
  | "solid-masonry"
  | "void-rim"
  | "viscous-drag"
  | "paired-directional"
  | "side-effect-colony"
  | "cure-receptor";

export interface CellTerrainVisual {
  readonly kind: "empty" | "wall" | "abyss" | "swamp" | "sideEffect" | "cure";
  readonly motif: Exclude<LabTerrainMotif, "paired-directional">;
  readonly baseColor: number;
  readonly rimColor: number;
  readonly opaque: true;
  readonly sideEffectOverlay: boolean;
}

export interface PortalTerrainVisual {
  readonly kind: "portal";
  readonly motif: "paired-directional";
  readonly role: "entry" | "exit";
  readonly baseColor: number;
  readonly rimColor: number;
  readonly opaque: true;
  readonly pairMarker: string | null;
  readonly destination: Vec2 | null;
  readonly direction: Vec2 | null;
}

export type LabTerrainVisual = CellTerrainVisual | PortalTerrainVisual;

const EMPTY_TERRAIN_VISUAL: CellTerrainVisual = {
  kind: "empty",
  motif: "substrate",
  baseColor: 0x18242b,
  rimColor: 0x41515a,
  opaque: true,
  sideEffectOverlay: false,
};

const CURE_PALETTE = [
  { baseColor: 0x314326, rimColor: 0xb8e06c },
  { baseColor: 0x354a2a, rimColor: 0xc5e983 },
  { baseColor: 0x3d4928, rimColor: 0xd0e86f },
  { baseColor: 0x2d482e, rimColor: 0xa8dc78 },
  { baseColor: 0x3e4525, rimColor: 0xd7df68 },
  { baseColor: 0x294532, rimColor: 0x9ee28a },
  { baseColor: 0x394829, rimColor: 0xc0e275 },
  { baseColor: 0x33462c, rimColor: 0xafe07f },
] as const;

function cureColors(id: number): (typeof CURE_PALETTE)[number] {
  return CURE_PALETTE[(id >= 0 ? id : 0) % CURE_PALETTE.length] ?? CURE_PALETTE[0];
}

const portalExitLookupCache = new WeakMap<Int32Array, Int32Array>();

function revealed(map: EffectMap, index: number): boolean {
  return map.fog[index] === 1;
}

function portalVisual(
  map: EffectMap,
  index: number,
  entryIndex: number,
  destinationIndex: number,
): PortalTerrainVisual {
  if (destinationIndex < 0 || destinationIndex >= map.width * map.height) {
    throw new Error(`Lab portal ${entryIndex} has an invalid same-layer destination`);
  }
  const role = index === entryIndex ? "entry" : "exit";
  const pairKnown = revealed(map, entryIndex) && revealed(map, destinationIndex);
  const destination: Vec2 = {
    x: destinationIndex % map.width,
    y: Math.floor(destinationIndex / map.width),
  };
  let direction: Vec2 | null = null;
  const fromX = entryIndex % map.width;
  const fromY = Math.floor(entryIndex / map.width);
  if (pairKnown && (destination.x !== fromX || destination.y !== fromY)) {
    direction = { x: Math.sign(destination.x - fromX), y: Math.sign(destination.y - fromY) };
  }
  return {
    kind: "portal",
    motif: "paired-directional",
    role,
    baseColor: 0x102331,
    rimColor: 0x48d7e5,
    opaque: true,
    pairMarker: pairKnown ? `P${entryIndex}-${destinationIndex}` : null,
    destination: pairKnown ? destination : null,
    direction,
  };
}

export function portalExitLookup(map: EffectMap): Int32Array {
  const cached = portalExitLookupCache.get(map.portalTo);
  if (cached !== undefined) return cached;
  const lookup = new Int32Array(map.portalTo.length).fill(-1);
  for (let index = 0; index < map.portalTo.length; index++) {
    const exitIndex = map.portalTo[index] ?? -1;
    if (exitIndex < 0 || exitIndex >= lookup.length) continue;
    if (lookup[exitIndex] !== -1) throw new Error(`Lab portal exit ${exitIndex} has multiple entries`);
    lookup[exitIndex] = index;
  }
  portalExitLookupCache.set(map.portalTo, lookup);
  return lookup;
}

function portalEntryForExit(map: EffectMap, exitIndex: number): number | null {
  const entry = portalExitLookup(map)[exitIndex] ?? -1;
  return entry < 0 ? null : entry;
}

export function labTerrainVisual(map: EffectMap, x: number, y: number): LabTerrainVisual {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
    throw new Error("Lab terrain coordinate is outside the effect map");
  }
  const index = y * map.width + x;

  const exitEntry = portalEntryForExit(map, index);
  if (exitEntry !== null) {
    return revealed(map, index)
      ? portalVisual(map, index, exitEntry, index)
      : EMPTY_TERRAIN_VISUAL;
  }

  if (!revealed(map, index) && map.cell[index] !== CellKind.Wall) {
    return EMPTY_TERRAIN_VISUAL;
  }

  switch (map.cell[index]) {
    case CellKind.Wall:
      return {
        kind: "wall",
        motif: "solid-masonry",
        baseColor: 0x242e34,
        rimColor: 0xe7e1d2,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Abyss:
      return {
        kind: "abyss",
        motif: "void-rim",
        baseColor: 0x03070d,
        rimColor: 0x617785,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Swamp:
      return {
        kind: "swamp",
        motif: "viscous-drag",
        baseColor: 0x39352a,
        rimColor: 0xa49367,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Portal: {
      const destination = map.portalTo[index];
      if (destination === undefined) throw new Error(`Lab portal ${index} has no destination`);
      return portalVisual(map, index, index, destination);
    }
    case CellKind.SideEffect:
      return {
        kind: "sideEffect",
        motif: "side-effect-colony",
        baseColor: 0x51223f,
        rimColor: 0xde5fb1,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Cure: {
      const colors = cureColors(map.cureId[index] ?? -1);
      return {
        kind: "cure",
        motif: "cure-receptor",
        baseColor: colors.baseColor,
        rimColor: colors.rimColor,
        opaque: true,
        sideEffectOverlay: (map.sideEffectId[index] ?? -1) >= 0,
      };
    }
    default:
      return EMPTY_TERRAIN_VISUAL;
  }
}
