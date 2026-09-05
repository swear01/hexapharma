import type { EffectMap, HexCoord } from "../sim/phase0_interfaces";
import { CellKind } from "../sim/phase0_interfaces";
import { hexInBounds, hexIndex } from "../sim/hex";
import { SHARED_SCHEMATIC_STYLE } from "./schematicStyle";

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
  readonly destination: HexCoord | null;
  readonly direction: HexCoord | null;
}

export type LabTerrainVisual = CellTerrainVisual | PortalTerrainVisual;

const EMPTY_TERRAIN_VISUAL: CellTerrainVisual = {
  kind: "empty",
  motif: "substrate",
  baseColor: SHARED_SCHEMATIC_STYLE.deck,
  rimColor: 0x41515a,
  opaque: true,
  sideEffectOverlay: false,
};

const CURE_PALETTE = [
  { baseColor: 0x2b4032, rimColor: SHARED_SCHEMATIC_STYLE.cure },
  { baseColor: 0x2e4036, rimColor: 0x9dd3b1 },
  { baseColor: 0x283b34, rimColor: 0x86bcac },
  { baseColor: 0x304438, rimColor: 0xa1c6ac },
  { baseColor: 0x293e32, rimColor: 0x8fc9aa },
  { baseColor: 0x2c423a, rimColor: 0x97cfbb },
  { baseColor: 0x304238, rimColor: 0xa6d3b3 },
  { baseColor: 0x2b3c30, rimColor: 0x9bc8a7 },
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
  const destination: HexCoord = {
    q: destinationIndex % map.width,
    r: Math.floor(destinationIndex / map.width),
  };
  let direction: HexCoord | null = null;
  const fromQ = entryIndex % map.width;
  const fromR = Math.floor(entryIndex / map.width);
  if (pairKnown && (destination.q !== fromQ || destination.r !== fromR)) {
    direction = { q: destination.q - fromQ, r: destination.r - fromR };
  }
  return {
    kind: "portal",
    motif: "paired-directional",
    role,
    baseColor: 0x102331,
    rimColor: SHARED_SCHEMATIC_STYLE.flow,
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

export function labTerrainVisual(map: EffectMap, q: number, r: number): LabTerrainVisual {
  if (!hexInBounds(map.width, map.height, q, r)) {
    throw new Error("Lab terrain coordinate is outside the effect map");
  }
  const index = hexIndex(map.width, q, r);

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
        baseColor: 0x3a4248,
        rimColor: 0x727f88,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Abyss:
      return {
        kind: "abyss",
        motif: "void-rim",
        baseColor: 0x0e1115,
        rimColor: 0x617785,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Swamp:
      return {
        kind: "swamp",
        motif: "viscous-drag",
        baseColor: 0x303f3d,
        rimColor: 0x819a92,
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
