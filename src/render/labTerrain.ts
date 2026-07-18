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
  baseColor: 0xdce4dc,
  rimColor: 0xa4b6b2,
  opaque: true,
  sideEffectOverlay: false,
};

const CURE_PALETTE = [
  { baseColor: 0x1d7c5b, rimColor: 0x75f0b8 },
  { baseColor: 0x245b8f, rimColor: 0x83cfff },
  { baseColor: 0x8a5a22, rimColor: 0xffd27d },
  { baseColor: 0x7d3f70, rimColor: 0xf2a7dd },
  { baseColor: 0x3f7480, rimColor: 0x9ce8ed },
  { baseColor: 0x6e6f2d, rimColor: 0xdde779 },
  { baseColor: 0x75452c, rimColor: 0xf2a477 },
  { baseColor: 0x514f8c, rimColor: 0xbab5ff },
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
    baseColor: 0x17235e,
    rimColor: 0x67e8f9,
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
        baseColor: 0x1b2528,
        rimColor: 0xf4d58d,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Abyss:
      return {
        kind: "abyss",
        motif: "void-rim",
        baseColor: 0x020406,
        rimColor: 0x8eb8cc,
        opaque: true,
        sideEffectOverlay: false,
      };
    case CellKind.Swamp:
      return {
        kind: "swamp",
        motif: "viscous-drag",
        baseColor: 0x315f37,
        rimColor: 0xb5d56a,
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
        baseColor: 0x6d3f83,
        rimColor: 0xd6a6ed,
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
