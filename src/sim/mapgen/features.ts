import { CellKind, type Machine } from "../phase0_interfaces";
import { HEX_DQ, HEX_DR, hexDistance } from "../hex";
import {
  START_DISK_RADIUS,
  hash3,
  passTraversable,
  reachableFromStart,
  walkableConnected,
  type AtlasScratch,
  type TerrainInfo,
} from "./terrain";

// v2 effect regions and failure (black) cells, placed after the relief (docs/design.md §1.4).

export const MIN_EASY_REGION = 3;
export const HARD_REGION_SIZES = [9, 12] as const;
export const HARD_REGION_STARS = [2, 3] as const;
export const VOID_DISTANCE = 4;
const MAX_VOID_FILLS = 64;

export type RegionKind = "easy" | "hard" | "fill";
export type BlackKind = "star" | "trap" | "single" | "strip";

export interface AtlasRegion {
  readonly map: number;
  readonly disease: number;
  readonly kind: RegionKind;
  readonly cells: readonly number[];
  /** Tier-2 (★) core cells, a subset of `cells`. */
  readonly stars: readonly number[];
}

export interface BlackGroup {
  readonly kind: BlackKind;
  readonly cells: number[];
}

export interface FeatureMap extends AtlasScratch {
  readonly cureId: Int16Array;
  readonly cureTier: Uint8Array;
  readonly sideEffectId: Int32Array;
  readonly protectedCells: Uint8Array;
}

interface Placement {
  readonly map: FeatureMap;
  readonly seed: number;
  /** Cells no Cure may use: one-step endpoints of the catalog from the start. */
  readonly noCure: Uint8Array;
  /** Cells reference programs stop on before their last machine (keeps prefixes non-curing). */
  readonly refPrefix: Uint8Array;
}

const startDistances = new WeakMap<Uint8Array, Int32Array>();

function startDistance(map: FeatureMap, index: number): number {
  let table = startDistances.get(map.cell);
  if (table === undefined) {
    table = new Int32Array(map.cell.length);
    for (let cell = 0; cell < table.length; cell++) {
      const q = cell % map.width;
      table[cell] = hexDistance(map.start.q, map.start.r, q, (cell - q) / map.width);
    }
    startDistances.set(map.cell, table);
  }
  return table[index]!;
}

function forEachNeighbor(map: FeatureMap, index: number, visit: (next: number, dir: number) => void): void {
  const q = index % map.width;
  const r = (index - q) / map.width;
  for (let dir = 0; dir < 6; dir++) {
    const nq = q + HEX_DQ[dir]!;
    const nr = r + HEX_DR[dir]!;
    if (nq < 0 || nr < 0 || nq >= map.width || nr >= map.height) continue;
    visit(nr * map.width + nq, dir);
  }
}

/** Plain ground an effect region may take for `disease`, keeping a gap to other diseases. */
function regionCell(placement: Placement, index: number, disease: number): boolean {
  const { map } = placement;
  if (
    map.inside[index] === 0 ||
    map.cell[index] !== CellKind.Empty ||
    map.pass[index] === 1 ||
    map.protectedCells[index] === 1 ||
    placement.noCure[index] === 1 ||
    placement.refPrefix[index] === 1 ||
    startDistance(map, index) <= START_DISK_RADIUS + 1
  ) return false;
  let foreign = false;
  forEachNeighbor(map, index, (next) => {
    if (map.cell[next] === CellKind.Cure && map.cureId[next] !== disease) foreign = true;
  });
  return !foreign;
}

/** Grow up to `size` cells from `seed`, always taking the frontier cell with the lowest hash. */
function grow(placement: Placement, seed: number, size: number, disease: number, salt: number): number[] {
  if (!regionCell(placement, seed, disease)) {
    // An ineligible seed (e.g. a reference stop) hands over to its lowest-hash eligible neighbour,
    // so a void around it still fills with a connected region.
    let best = -1;
    forEachNeighbor(placement.map, seed, (next) => {
      if (!regionCell(placement, next, disease)) return;
      if (best < 0 || hash3(placement.seed, next, salt, 0x6f) < hash3(placement.seed, best, salt, 0x6f)) best = next;
    });
    return best < 0 ? [] : growFrom(placement, best, size, disease, salt);
  }
  return growFrom(placement, seed, size, disease, salt);
}

function growFrom(placement: Placement, seed: number, size: number, disease: number, salt: number): number[] {
  const taken: number[] = [];
  const seen = new Set<number>();
  const frontier = [seed];
  seen.add(seed);
  while (frontier.length > 0 && taken.length < size) {
    let best = 0;
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (let index = 0; index < frontier.length; index++) {
      const cell = frontier[index]!;
      const score = hash3(placement.seed, cell, salt, 0x6e) * 4096 + (cell % 4096);
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
    const cell = frontier[best]!;
    frontier.splice(best, 1);
    if (!regionCell(placement, cell, disease)) continue;
    taken.push(cell);
    forEachNeighbor(placement.map, cell, (next) => {
      if (seen.has(next)) return;
      seen.add(next);
      frontier.push(next);
    });
  }
  return taken;
}

function commitRegion(map: FeatureMap, cells: readonly number[], stars: number, disease: number): void {
  for (let index = 0; index < cells.length; index++) {
    const cell = cells[index]!;
    map.cell[cell] = CellKind.Cure;
    map.cureId[cell] = disease;
    map.cureTier[cell] = index < stars ? 2 : 1;
  }
}

function walkDistances(map: FeatureMap): Int32Array {
  const area = map.width * map.height;
  const dist = new Int32Array(area).fill(-1);
  const queue = new Int32Array(area);
  const start = map.start.r * map.width + map.start.q;
  let head = 0;
  let tail = 0;
  dist[start] = 0;
  queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++]!;
    forEachNeighbor(map, current, (next) => {
      if (dist[next] !== -1 || map.cell[next] === CellKind.Wall || map.cell[next] === CellKind.Abyss) return;
      dist[next] = dist[current]! + 1;
      queue[tail++] = next;
    });
  }
  return dist;
}

/** Eligible region cells within hex distance 2 (of 19): keeps hard regions off thin strips. */
function openness(placement: Placement, index: number): number {
  const { map } = placement;
  const cq = index % map.width;
  const cr = (index - cq) / map.width;
  let count = 0;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dq = -2; dq <= 2; dq++) {
      const q = cq + dq;
      const r = cr + dr;
      if (Math.abs(dq + dr) > 2 || q < 0 || r < 0 || q >= map.width || r >= map.height) continue;
      if (regionCell(placement, r * map.width + q, -1)) count++;
    }
  }
  return count;
}

/**
 * One hard region per disease on this map: inside a basin first, otherwise on the farthest walk
 * from the start (behind long passes). 9–12 cells with a 2–3 cell ★ core.
 */
export function placeHardRegions(
  map: FeatureMap,
  mapIndex: number,
  info: TerrainInfo,
  diseases: readonly number[],
  seed: number,
  noCure: Uint8Array,
): AtlasRegion[] {
  if (!info.skeleton) return [];
  const placement: Placement = { map, seed, noCure, refPrefix: new Uint8Array(map.cell.length) };
  const walk = walkDistances(map);
  const ringOuter = Math.ceil(info.ring / 1024) + 2;
  const candidates: number[] = [];
  for (const basin of info.basins) {
    // Nearest basin floor cell to the basin centre (by hex distance, then index).
    let best = -1;
    let bestDistance = Number.MAX_SAFE_INTEGER;
    const cq = basin.center % map.width;
    const cr = (basin.center - cq) / map.width;
    for (let index = 0; index < map.cell.length; index++) {
      if (walk[index]! < 0 || !regionCell(placement, index, -1)) continue;
      const q = index % map.width;
      const d = hexDistance(cq, cr, q, (index - q) / map.width);
      if (d < bestDistance) {
        bestDistance = d;
        best = index;
      }
    }
    if (best >= 0 && bestDistance * 1024 <= basin.rho) candidates.push(best);
  }
  const remote: number[] = [];
  for (let index = 0; index < map.cell.length; index++) {
    if (walk[index]! < 0 || startDistance(map, index) < ringOuter) continue;
    if (regionCell(placement, index, -1) && openness(placement, index) >= 12) remote.push(index);
  }
  const remoteKey = new Map(remote.map((cell) => [cell, hash3(seed, cell, 0, 0x4d)]));
  remote.sort((left, right) => walk[right]! - walk[left]! || remoteKey.get(left)! - remoteKey.get(right)! || left - right);
  candidates.push(...remote);
  const regions: AtlasRegion[] = [];
  const seeds: number[] = [];
  for (const disease of diseases) {
    const word = hash3(seed, disease, mapIndex, 0x4a);
    const size = HARD_REGION_SIZES[0] + (word % (HARD_REGION_SIZES[1] - HARD_REGION_SIZES[0] + 1));
    const stars = HARD_REGION_STARS[0] + ((word >>> 8) % (HARD_REGION_STARS[1] - HARD_REGION_STARS[0] + 1));
    for (const candidate of candidates) {
      const cq = candidate % map.width;
      const cr = (candidate - cq) / map.width;
      if (seeds.some((other) => {
        const oq = other % map.width;
        return hexDistance(cq, cr, oq, (other - oq) / map.width) < 8;
      })) continue;
      if (!regionCell(placement, candidate, disease)) continue;
      const cells = grow(placement, candidate, size, disease, 0x100 + disease);
      if (cells.length < size) continue;
      commitRegion(map, cells, stars, disease);
      seeds.push(candidate);
      regions.push({ map: mapIndex, disease, kind: "hard", cells, stars: cells.slice(0, stars) });
      break;
    }
  }
  return regions;
}

export interface BlackPlacement {
  readonly groups: BlackGroup[];
  readonly fills: AtlasRegion[];
}

/**
 * Failure (Abyss) cells around ★ cores and past narrow exits, void-filling tier-1 regions, then
 * sneaky singles and strips. A black cell never lands on a pass, pass pocket, effect, start
 * area or reference trail, and every placement keeps all walkable cells connected.
 */
export function placeBlackAndFill(
  map: FeatureMap,
  mapIndex: number,
  info: TerrainInfo,
  hard: readonly AtlasRegion[],
  diseases: readonly number[],
  seed: number,
  noCure: Uint8Array,
  refPrefix: Uint8Array,
  refTrail: Uint8Array,
  machines: readonly Machine[],
): BlackPlacement {
  const groups: BlackGroup[] = [];
  const fills: AtlasRegion[] = [];
  if (!info.skeleton || diseases.length === 0) return { groups, fills };
  const placement: Placement = { map, seed, noCure, refPrefix };
  const tryBlack = (index: number, minStart: number): boolean => {
    if (
      index < 0 ||
      map.inside[index] === 0 ||
      map.cell[index] !== CellKind.Empty ||
      map.pass[index] === 1 ||
      refTrail[index] === 1 ||
      map.protectedCells[index] === 1 ||
      startDistance(map, index) <= minStart
    ) return false;
    map.cell[index] = CellKind.Abyss;
    if (ringContiguous(map, index) || walkableConnected(map)) return true;
    map.cell[index] = CellKind.Empty;
    return false;
  };
  const step = (index: number, dir: number, count: number): number => {
    let q = index % map.width;
    let r = (index - q) / map.width;
    const d = ((dir % 6) + 6) % 6;
    q += HEX_DQ[d]! * count;
    r += HEX_DR[d]! * count;
    if (q < 0 || r < 0 || q >= map.width || r >= map.height) return -1;
    return r * map.width + q;
  };

  for (const region of hard) {
    // Plain cells around the region, nearest to the ★ core first (up to two steps out).
    const inRegion = new Set(region.cells);
    const ring = new Set<number>();
    for (const cell of region.cells) {
      forEachNeighbor(map, cell, (next) => {
        if (inRegion.has(next) || map.cell[next] !== CellKind.Empty) return;
        ring.add(next);
        forEachNeighbor(map, next, (outer) => {
          if (!inRegion.has(outer) && map.cell[outer] === CellKind.Empty) ring.add(outer);
        });
      });
    }
    const starDistance = (index: number): number => {
      const q = index % map.width;
      const r = (index - q) / map.width;
      let best = Number.MAX_SAFE_INTEGER;
      for (const star of region.stars) {
        const sq = star % map.width;
        best = Math.min(best, hexDistance(q, r, sq, (star - sq) / map.width));
      }
      return best;
    };
    const ordered = [...ring].sort((left, right) =>
      starDistance(left) - starDistance(right) ||
      hash3(seed, left, region.disease, 0x5b) - hash3(seed, right, region.disease, 0x5b) ||
      left - right);
    const want = 3 + (hash3(seed, region.disease, mapIndex, 0x5c) % 2);
    const cells: number[] = [];
    for (const cell of ordered) {
      if (cells.length >= want) break;
      if (tryBlack(cell, 3)) cells.push(cell);
    }
    groups.push({ kind: "star", cells });
  }

  for (const pass of info.passes) {
    if (pass.narrow.length < 2) continue;
    const end = pass.narrow[pass.narrow.length - 1]!;
    const prev = pass.narrow[pass.narrow.length - 2]!;
    let dir = -1;
    forEachNeighbor(map, prev, (next, d) => {
      if (next === end) dir = d;
    });
    if (dir < 0) continue;
    const firstSide = hash3(seed, end, 0, 0x5d) % 2 === 0 ? 1 : -1;
    let placed = -1;
    for (const distance of [2, 3, 1, 4]) {
      for (const side of [firstSide, -firstSide]) {
        const ahead = step(end, dir, distance);
        const cell = ahead < 0 ? -1 : step(ahead, dir + side, 1);
        if (placed < 0 && tryBlack(cell, 3)) placed = cell;
      }
    }
    if (placed >= 0) groups.push({ kind: "trap", cells: [placed] });
  }

  // Void filling: tier-1 regions where plain ground is ≥ VOID_DISTANCE from every feature.
  const tried = new Uint8Array(map.cell.length);
  const area = map.cell.length;
  const dist = new Int32Array(area);
  const queue = new Int32Array(area);
  let stale = true;
  for (let guard = 0; guard < MAX_VOID_FILLS; guard++) {
    let head = 0;
    let tail = 0;
    if (stale) dist.fill(-1);
    for (let index = 0; stale && index < area; index++) {
      if (
        map.inside[index] === 0 ||
        map.cell[index] !== CellKind.Empty ||
        map.pass[index] === 1
      ) {
        dist[index] = 0;
        queue[tail++] = index;
      }
    }
    stale = false;
    while (head < tail) {
      const current = queue[head++]!;
      const q = current % map.width;
      const r = (current - q) / map.width;
      for (let dir = 0; dir < 6; dir++) {
        const nq = q + HEX_DQ[dir]!;
        const nr = r + HEX_DR[dir]!;
        if (nq < 0 || nr < 0 || nq >= map.width || nr >= map.height) continue;
        const next = nr * map.width + nq;
        if (dist[next] !== -1) continue;
        dist[next] = dist[current]! + 1;
        queue[tail++] = next;
      }
    }
    let best = -1;
    for (let index = 0; index < area; index++) {
      if (tried[index] === 1 || dist[index]! < VOID_DISTANCE || startDistance(map, index) <= START_DISK_RADIUS) continue;
      if (
        best < 0 ||
        dist[index]! > dist[best]! ||
        (dist[index] === dist[best] && hash3(seed, index, guard, 0x5e) < hash3(seed, best, guard, 0x5e))
      ) best = index;
    }
    if (best < 0) break;
    tried[best] = 1;
    const word = hash3(seed, best, fills.length, 0x5f);
    const disease = diseases[(fills.length + word) % diseases.length]!;
    const cells = grow(placement, best, MIN_EASY_REGION + (word >>> 4) % 3, disease, 0x200 + fills.length);
    if (cells.length < MIN_EASY_REGION) continue;
    commitRegion(map, cells, 0, disease);
    fills.push({ map: mapIndex, disease, kind: "fill", cells, stars: [] });
    stale = true;
  }

  // Sneaky singles on open ground, then 2–3 strips of ~5 cells in different sectors.
  const open: number[] = [];
  for (let index = 0; index < area; index++) {
    if (map.cell[index] === CellKind.Empty && map.inside[index] === 1 && startDistance(map, index) > 4) open.push(index);
  }
  const openKey = new Map(open.map((cell) => [cell, hash3(seed, cell, 0, 0x60)]));
  open.sort((left, right) => openKey.get(left)! - openKey.get(right)! || left - right);
  const singles = 8 + (hash3(seed, mapIndex, 0, 0x61) % 5);
  const singleCells: number[] = [];
  for (const cell of open) {
    if (singleCells.length >= singles) break;
    if (tryBlack(cell, 4)) singleCells.push(cell);
  }
  groups.push({ kind: "single", cells: singleCells });
  const strips = 2 + (hash3(seed, mapIndex, 0, 0x62) % 2);
  const usedSectors = new Set<number>();
  let made = 0;
  for (let index = 40; index < open.length && made < strips; index++) {
    const origin = open[index]!;
    if (map.cell[origin] !== CellKind.Empty || startDistance(map, origin) < 8) continue;
    const sector = sectorOf(map, origin);
    if (usedSectors.has(sector)) continue;
    let dir = hash3(seed, origin, 0, 0x63) % 6;
    let cursor = origin;
    const cells: number[] = [];
    for (let length = 0; length < 5 && cursor >= 0; length++) {
      if (tryBlack(cursor, 4)) cells.push(cursor);
      if (hash3(seed, cursor, length, 0x64) % 4 === 0) dir += 1;
      cursor = step(cursor, dir, 1);
    }
    if (cells.length >= 4) {
      made++;
      usedSectors.add(sector);
      groups.push({ kind: "strip", cells });
    } else {
      for (const cell of cells) map.cell[cell] = CellKind.Empty;
    }
  }
  // A pass must stay traversable with failure ground around its ends: if not, clear the black
  // cells in its end pockets (the corridor itself never takes any).
  for (const pass of info.passes) {
    if (!pass.verified || passTraversable(map, pass, machines)) continue;
    const ends = [pass.path[0]!, pass.path[pass.path.length - 1]!];
    for (const group of groups) {
      for (let index = group.cells.length - 1; index >= 0; index--) {
        const cell = group.cells[index]!;
        const q = cell % map.width;
        const r = (cell - q) / map.width;
        if (!ends.some((end) => {
          const eq = end % map.width;
          return hexDistance(q, r, eq, (end - eq) / map.width) <= 2;
        })) continue;
        map.cell[cell] = CellKind.Empty;
        group.cells.splice(index, 1);
      }
    }
  }
  return { groups, fills };
}

/**
 * Cheap sufficient test that blocking `index` keeps the walkable set connected: its walkable
 * neighbours form one contiguous arc of the six-cell ring (consecutive directions are adjacent),
 * so they stay linked around it. Otherwise the caller falls back to a full flood.
 */
function ringContiguous(map: FeatureMap, index: number): boolean {
  const q = index % map.width;
  const r = (index - q) / map.width;
  let open = 0;
  let mask = 0;
  for (let dir = 0; dir < 6; dir++) {
    const nq = q + HEX_DQ[dir]!;
    const nr = r + HEX_DR[dir]!;
    if (nq < 0 || nr < 0 || nq >= map.width || nr >= map.height) continue;
    const kind = map.cell[nr * map.width + nq];
    if (kind === CellKind.Wall || kind === CellKind.Abyss) continue;
    mask |= 1 << dir;
    open++;
  }
  if (open === 0) return false;
  let starts = 0;
  for (let dir = 0; dir < 6; dir++) {
    if ((mask >> dir) & 1 && !((mask >> ((dir + 5) % 6)) & 1)) starts++;
  }
  return open === 6 || starts === 1;
}

/** Which of six 60° wedges around the start holds `index` (hex-direction sectors). */
function sectorOf(map: FeatureMap, index: number): number {
  const dq = (index % map.width) - map.start.q;
  const dr = Math.floor(index / map.width) - map.start.r;
  let best = 0;
  let bestScore = Number.MIN_SAFE_INTEGER;
  for (let dir = 0; dir < 6; dir++) {
    const score = dq * HEX_DQ[dir]! + dr * HEX_DR[dir]! + (-dq - dr) * (-HEX_DQ[dir]! - HEX_DR[dir]!);
    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }
  return best;
}

/**
 * Contaminate part of each hard region's fringe (never a ★) and one cell of each void fill.
 * Returns the next free side-effect id.
 */
export function contaminateRegions(
  map: FeatureMap,
  regions: readonly AtlasRegion[],
  seed: number,
  nextId: number,
): number {
  let next = nextId;
  for (const region of regions) {
    if (region.kind === "easy") continue;
    const inRegion = new Set(region.cells);
    const stars = new Set(region.stars);
    const fringe = region.cells.filter((cell, index) => {
      if (stars.has(cell) || (region.kind === "fill" && index === 0)) return false;
      let edge = false;
      forEachNeighbor(map, cell, (neighbor) => {
        if (!inRegion.has(neighbor)) edge = true;
      });
      return edge;
    });
    fringe.sort((left, right) => hash3(seed, left, 0, 0x65) - hash3(seed, right, 0, 0x65) || left - right);
    const wanted = region.kind === "hard" ? Math.max(1, Math.floor(fringe.length / 3)) : 1;
    const count = Math.min(wanted, fringe.length);
    for (let index = 0; index < count; index++) map.sideEffectId[fringe[index]!] = next++;
  }
  return next;
}

/** Walkable cells unreachable from the start (should always be zero after generation). */
export function unreachableCount(map: AtlasScratch): number {
  const seen = reachableFromStart(map);
  let count = 0;
  for (let index = 0; index < map.cell.length; index++) {
    const kind = map.cell[index]!;
    if (kind !== CellKind.Wall && kind !== CellKind.Abyss && seen[index] === 0) count++;
  }
  return count;
}
