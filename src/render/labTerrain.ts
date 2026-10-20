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
  rimColor: SHARED_SCHEMATIC_STYLE.rule,
  opaque: true,
  sideEffectOverlay: false,
};

/** Cure green screens: each disease gets its own tint and print ink so adjacent regions separate. */
const CURE_PALETTE = [
  { baseColor: 0xd8ecd9, rimColor: SHARED_SCHEMATIC_STYLE.cure },
  { baseColor: 0xd2e8d8, rimColor: 0x23784a },
  { baseColor: 0xdcebcf, rimColor: 0x4a7f2a },
  { baseColor: 0xcfe6df, rimColor: 0x1f6f5c },
  { baseColor: 0xe0eed6, rimColor: 0x3d8a35 },
  { baseColor: 0xd5eadf, rimColor: 0x2c6e43 },
  { baseColor: 0xdaead2, rimColor: 0x52823a },
  { baseColor: 0xd1e5d6, rimColor: 0x2a6338 },
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
    baseColor: SHARED_SCHEMATIC_STYLE.deck,
    rimColor: SHARED_SCHEMATIC_STYLE.structure,
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
        baseColor: SHARED_SCHEMATIC_STYLE.structure,
        rimColor: SHARED_SCHEMATIC_STYLE.structure,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Abyss:
      return {
        kind: "abyss",
        motif: "void-rim",
        baseColor: 0x1c3a58,
        rimColor: SHARED_SCHEMATIC_STYLE.structure,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Swamp:
      return {
        kind: "swamp",
        motif: "viscous-drag",
        baseColor: 0xe3eff6,
        rimColor: SHARED_SCHEMATIC_STYLE.flow,
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
        baseColor: 0xf8e7d1,
        rimColor: SHARED_SCHEMATIC_STYLE.sideEffect,
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
