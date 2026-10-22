import type { EffectMap, Machine } from "../phase0_interfaces";
import { CellKind } from "../phase0_interfaces";
import { HEX_DQ, HEX_DR, hexDistance } from "../hex";
import { PATH_OUT_STRIDE, turnHeading, walkValidatedPathInto } from "../drug-graph";

// v2 Atlas relief (docs/design.md §1.2). Integer/fixed-point only: integer hashing, polynomial
// fades and kernels, an integer square root and a literal angle table. No transcendental Math.

/** Elevation fixed point: 1024 = 1.0 (stored as Int16 in EffectMap.elevation). */
export const ELEVATION_ONE = 1024;
export const MOUNTAIN_LEVEL = 614;
export const WATER_LEVEL = -461;
/** Atlases below this radius are flat test boards without the v2 skeleton. */
export const MIN_SKELETON_RADIUS = 8;
export const START_DISK_RADIUS = 2;
export const MAX_PASS_ATTEMPTS = 8;
export const MAX_PASS_STEPS = 10;
/** Narrow-core window as path fractions in 1/100: ring and arc passes, basin entries. */
const RANGE_NARROW = [33, 68] as const;
const BASIN_NARROW = [30, 72] as const;
const PASS_SADDLE = 307;
const RIM_HEIGHT = 1434;
const RIM_SECOND = 240;

// Positions: x = (2q + r)·222, y = r·384 relative to the centre, so a neighbour step is ≈ 444
// units (√3 prototype units of 256).
const CELL = 444;

// cos/sin(i·7.5°)·1024, generated offline (code-as-data, no runtime trig).
const COS48 = [1024, 1015, 989, 946, 887, 812, 724, 623, 512, 392, 265, 134, 0, -134, -265, -392, -512, -623, -724, -812, -887, -946, -989, -1015, -1024, -1015, -989, -946, -887, -812, -724, -623, -512, -392, -265, -134, 0, 134, 265, 392, 512, 623, 724, 812, 887, 946, 989, 1015] as const;
const SIN48 = [0, 134, 265, 392, 512, 623, 724, 812, 887, 946, 989, 1015, 1024, 1015, 989, 946, 887, 812, 724, 623, 512, 392, 265, 134, 0, -134, -265, -392, -512, -623, -724, -812, -887, -946, -989, -1015, -1024, -1015, -989, -946, -887, -812, -724, -623, -512, -392, -265, -134] as const;
const GRAD8 = [[1024, 0], [724, 724], [0, 1024], [-724, 724], [-1024, 0], [-724, -724], [0, -1024], [724, -724]] as const;

export type PassKind = "ring" | "arc" | "basin";

export interface PassInfo {
  readonly kind: PassKind;
  /** Routed centre line, inner/approach end first. */
  readonly path: readonly number[];
  /** The 1-cell core: a contiguous slice of `path`. */
  readonly narrow: readonly number[];
  /** Every forced-walkable corridor cell (path plus widened ends). */
  readonly cells: readonly number[];
  /** Passed the bounded local machine BFS with the initial catalog. */
  readonly verified: boolean;
}

export interface Basin {
  readonly center: number;
  /** Rim radius in neighbour steps ×1024. */
  readonly rho: number;
}

export interface AtlasScratch {
  readonly width: number;
  readonly height: number;
  readonly start: { readonly q: number; readonly r: number };
  readonly cell: Uint8Array;
  readonly elevation: Int16Array;
  readonly pass: Uint8Array;
  readonly inside: Uint8Array;
}

export interface TerrainInfo {
  readonly radius: number;
  readonly skeleton: boolean;
  /** Inner ring centre-line radius in neighbour steps ×1024 (0 without skeleton). */
  readonly ring: number;
  readonly passes: readonly PassInfo[];
  readonly basins: readonly Basin[];
}

export function mix32(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  result ^= result >>> 16;
  return result >>> 0;
}

export function hash3(seed: number, a: number, b: number, salt: number): number {
  return mix32(seed ^ Math.imul(a, 0x9e3779b1) ^ Math.imul(b ^ 0x5bd1e995, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35));
}

export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

export function atlasRadius(width: number, height: number): number {
  return Math.floor((Math.min(width, height) - 1) / 2);
}

function fade(t: number): number {
  const t2 = Math.floor((t * t) / 1024);
  const t3 = Math.floor((t2 * t) / 1024);
  return Math.floor((t3 * (6 * t2 - 15 * t + 10_240)) / 1024);
}

/** 2-D gradient noise at fixed-point position (x, y) with lattice size `size`; ≈ −1024..1024. */
function gradientNoise(x: number, y: number, size: number, seed: number, salt: number): number {
  const gx = Math.floor(x / size);
  const gy = Math.floor(y / size);
  const fx = Math.floor(((x - gx * size) * 1024) / size);
  const fy = Math.floor(((y - gy * size) * 1024) / size);
  const g00 = GRAD8[hash3(seed, gx, gy, salt) & 7]!;
  const g10 = GRAD8[hash3(seed, gx + 1, gy, salt) & 7]!;
  const g01 = GRAD8[hash3(seed, gx, gy + 1, salt) & 7]!;
  const g11 = GRAD8[hash3(seed, gx + 1, gy + 1, salt) & 7]!;
  const d00 = Math.floor((g00[0] * fx + g00[1] * fy) / 1024);
  const d10 = Math.floor((g10[0] * (fx - 1024) + g10[1] * fy) / 1024);
  const d01 = Math.floor((g01[0] * fx + g01[1] * (fy - 1024)) / 1024);
  const d11 = Math.floor((g11[0] * (fx - 1024) + g11[1] * (fy - 1024)) / 1024);
  const u = fade(fx);
  const v = fade(fy);
  const a = d00 + Math.floor(((d10 - d00) * u) / 1024);
  const b = d01 + Math.floor(((d11 - d01) * u) / 1024);
  return Math.floor(((a + Math.floor(((b - a) * v) / 1024)) * 1448) / 1024);
}

/** Smooth compact bump ≈ exp(−(d/w)²): (1 − d²/4w²)³, 0..1024. */
function bump(d2: number, w: number): number {
  const t = Math.floor((d2 * 1024) / (4 * w * w));
  if (t >= 1024) return 0;
  const u = 1024 - t;
  return Math.floor((Math.floor((u * u) / 1024) * u) / 1024);
}

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Squared distance from p to segment ab, all integers. */
function segmentDistance2(px: number, py: number, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  let t = 0;
  if (length2 > 0) {
    t = Math.floor((((px - a.x) * dx + (py - a.y) * dy) * 1024) / length2);
    if (t < 0) t = 0;
    else if (t > 1024) t = 1024;
  }
  const ex = px - a.x - Math.floor((dx * t) / 1024);
  const ey = py - a.y - Math.floor((dy * t) / 1024);
  return ex * ex + ey * ey;
}

function polylineDistance2(px: number, py: number, points: readonly Point[]): number {
  let best = Number.MAX_SAFE_INTEGER;
  for (let index = 1; index < points.length; index++) {
    const d2 = segmentDistance2(px, py, points[index - 1]!, points[index]!);
    if (d2 < best) best = d2;
  }
  return best;
}

/** Polar point around (cx, cy) at `rho` neighbour steps ×1024 and angle index 0..47. */
function polar(cx: number, cy: number, rho: number, angle: number): Point {
  const a = ((angle % 48) + 48) % 48;
  return {
    x: cx + Math.floor((rho * CELL * COS48[a]!) / (1024 * 1024)),
    y: cy + Math.floor((rho * CELL * SIN48[a]!) / (1024 * 1024)),
  };
}

function arcPoints(rho: number, from: number, to: number): Point[] {
  const points: Point[] = [];
  for (let angle = from; angle <= to; angle++) points.push(polar(0, 0, rho, angle));
  return points;
}

interface Grid {
  readonly width: number;
  readonly height: number;
  readonly cq: number;
  readonly cr: number;
  readonly radius: number;
}

function pointOf(grid: Grid, index: number): Point {
  const dq = (index % grid.width) - grid.cq;
  const dr = Math.floor(index / grid.width) - grid.cr;
  return { x: (2 * dq + dr) * 222, y: dr * 384 };
}

/** Nearest cell to a centre-relative position (cube rounding), or -1 outside the grid. */
function cellAt(grid: Grid, p: Point): number {
  const rf = p.y / 384;
  const qf = (p.x / 222 - rf) / 2;
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  const s = Math.round(sf);
  const qe = Math.abs(q - qf);
  const re = Math.abs(r - rf);
  const se = Math.abs(s - sf);
  if (qe > re && qe > se) q = -r - s;
  else if (re > se) r = -q - s;
  const aq = q + grid.cq;
  const ar = r + grid.cr;
  if (aq < 0 || ar < 0 || aq >= grid.width || ar >= grid.height) return -1;
  return ar * grid.width + aq;
}

function hexFromCentre(grid: Grid, index: number): number {
  return hexDistance(grid.cq, grid.cr, index % grid.width, Math.floor(index / grid.width));
}

/** Cheapest route between two cells over a deterministic noisy cost field (binary heap). */
function noisyRoute(grid: Grid, inside: Uint8Array, from: number, to: number, seed: number, salt: number): number[] {
  const area = grid.width * grid.height;
  const dist = new Int32Array(area).fill(0x7fffffff);
  const prev = new Int32Array(area).fill(-1);
  const heap: number[] = [];
  const push = (key: number): void => {
    heap.push(key);
    let index = heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heap[parent]! <= heap[index]!) break;
      [heap[parent], heap[index]] = [heap[index]!, heap[parent]!];
      index = parent;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < heap.length && heap[left]! < heap[smallest]!) smallest = left;
        if (right < heap.length && heap[right]! < heap[smallest]!) smallest = right;
        if (smallest === index) break;
        [heap[smallest], heap[index]] = [heap[index]!, heap[smallest]!];
        index = smallest;
      }
    }
    return top;
  };
  dist[from] = 0;
  push(from);
  while (heap.length > 0) {
    const key = pop();
    const current = key % area;
    const d = (key - current) / area;
    if (d > dist[current]!) continue;
    if (current === to) break;
    const q = current % grid.width;
    const r = (current - q) / grid.width;
    for (let dir = 0; dir < 6; dir++) {
      const nq = q + HEX_DQ[dir]!;
      const nr = r + HEX_DR[dir]!;
      if (nq < 0 || nr < 0 || nq >= grid.width || nr >= grid.height) continue;
      const next = nr * grid.width + nq;
      if (inside[next] === 0) continue;
      const nd = d + 16 + (hash3(seed, nq, nr, salt) % 80);
      if (nd >= dist[next]!) continue;
      dist[next] = nd;
      prev[next] = current;
      push(nd * area + next);
    }
  }
  if (dist[to] === 0x7fffffff) return [];
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev[path[path.length - 1]!]!);
  return path.reverse();
}

function floodFrom(atlas: AtlasScratch, blocked: (kind: number) => boolean): Uint8Array {
  const area = atlas.width * atlas.height;
  const seen = new Uint8Array(area);
  const queue = new Int32Array(area);
  const start = atlas.start.r * atlas.width + atlas.start.q;
  let head = 0;
  let tail = 0;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++]!;
    const q = current % atlas.width;
    const r = (current - q) / atlas.width;
    for (let dir = 0; dir < 6; dir++) {
      const nq = q + HEX_DQ[dir]!;
      const nr = r + HEX_DR[dir]!;
      if (nq < 0 || nr < 0 || nq >= atlas.width || nr >= atlas.height) continue;
      const next = nr * atlas.width + nq;
      if (seen[next] === 1 || blocked(atlas.cell[next]!)) continue;
      seen[next] = 1;
      queue[tail++] = next;
    }
  }
  return seen;
}

/** Cells reachable from the start without crossing Wall (or Abyss when `abyssBlocks`). */
export function reachableFromStart(atlas: AtlasScratch, abyssBlocks = true): Uint8Array {
  return floodFrom(atlas, (kind) => kind === CellKind.Wall || (abyssBlocks && kind === CellKind.Abyss));
}

/** True when every non-Wall, non-Abyss cell is reachable from the start. */
export function walkableConnected(atlas: AtlasScratch): boolean {
  const seen = reachableFromStart(atlas);
  for (let index = 0; index < atlas.cell.length; index++) {
    const kind = atlas.cell[index]!;
    if (kind !== CellKind.Wall && kind !== CellKind.Abyss && seen[index] === 0) return false;
  }
  return true;
}

function neighbors(width: number, height: number, index: number, out: number[]): number[] {
  out.length = 0;
  const q = index % width;
  const r = (index - q) / width;
  for (let dir = 0; dir < 6; dir++) {
    const nq = q + HEX_DQ[dir]!;
    const nr = r + HEX_DR[dir]!;
    if (nq < 0 || nr < 0 || nq >= width || nr >= height) continue;
    out.push(nr * width + nq);
  }
  return out;
}

function corridorOf(width: number, height: number, path: readonly number[], a: number, b: number): number[] {
  const cells: number[] = [];
  const seen = new Set<number>();
  const add = (index: number): void => {
    if (seen.has(index)) return;
    seen.add(index);
    cells.push(index);
  };
  for (let i = 0; i < path.length; i++) {
    const index = path[i]!;
    add(index);
    if (i >= a && i <= b) continue;
    const q = index % width;
    const r = (index - q) / width;
    for (let dir = 0; dir < 6; dir += i % 2 === 1 ? 2 : 3) {
      const nq = q + HEX_DQ[dir]!;
      const nr = r + HEX_DR[dir]!;
      if (nq < 0 || nr < 0 || nq >= width || nr >= height) continue;
      add(nr * width + nq);
    }
  }
  return cells;
}

const POCKET_RADIUS = 2;

/**
 * Bounded local machine BFS (generation-time only, never exposed): from the pass's first cell
 * with any heading, can the initial machines reach the far-end pocket within MAX_PASS_STEPS, when
 * only the corridor and 2-cell end pockets are walkable? Uses the real drug-graph traversal.
 */
export function passTraversable(
  atlas: AtlasScratch,
  pass: Pick<PassInfo, "path" | "cells">,
  machines: readonly Machine[],
): boolean {
  const { width, height } = atlas;
  const area = width * height;
  const first = pass.path[0]!;
  const last = pass.path[pass.path.length - 1]!;
  const fq = first % width;
  const fr = (first - fq) / width;
  const lq = last % width;
  const lr = (last - lq) / width;
  const cell = new Uint8Array(area).fill(CellKind.Wall);
  for (let index = 0; index < area; index++) {
    const q = index % width;
    const r = (index - q) / width;
    if (hexDistance(q, r, fq, fr) <= POCKET_RADIUS || hexDistance(q, r, lq, lr) <= POCKET_RADIUS) {
      const kind = atlas.cell[index]!;
      cell[index] = kind === CellKind.Abyss || kind === CellKind.Wall ? kind : kind === CellKind.Swamp ? CellKind.Swamp : CellKind.Empty;
    }
  }
  for (const index of pass.cells) {
    const kind = atlas.cell[index]!;
    cell[index] = kind === CellKind.Swamp ? CellKind.Swamp : kind === CellKind.Abyss ? CellKind.Abyss : CellKind.Empty;
  }
  const map: EffectMap = {
    width,
    height,
    origin: atlas.start,
    start: atlas.start,
    cell,
    cureId: new Int16Array(area).fill(-1),
    cureTier: new Uint8Array(area),
    sideEffectId: new Int32Array(area).fill(-1),
    portalTo: new Int32Array(area).fill(-1),
    elevation: new Int16Array(area),
    fog: new Uint8Array(area),
  };
  // State = cell · 42 + offset slot (0 = centre, 1..6 = unit direction) · 6 + heading.
  const seen = new Uint8Array(area * 42);
  let frontier: number[] = [];
  for (let heading = 0; heading < 6; heading++) {
    const state = first * 42 + heading;
    seen[state] = 1;
    frontier.push(state);
  }
  const out = new Int32Array(PATH_OUT_STRIDE);
  for (let depth = 0; depth < MAX_PASS_STEPS && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const state of frontier) {
      const heading = state % 6;
      const slot = Math.floor(state / 6) % 7;
      const index = Math.floor(state / 42);
      const q = index % width;
      const r = (index - q) / width;
      const oq = slot === 0 ? 0 : HEX_DQ[slot - 1]!;
      const or = slot === 0 ? 0 : HEX_DR[slot - 1]!;
      for (const machine of machines) {
        walkValidatedPathInto(map, q, r, oq, or, heading, machine, out, 0);
        if (out[4] === 1) continue;
        const nq = out[0]!;
        const nr = out[1]!;
        if (hexDistance(nq, nr, lq, lr) <= POCKET_RADIUS) return true;
        let nslot = 0;
        for (let dir = 0; dir < 6; dir++) {
          if (HEX_DQ[dir] === out[2] && HEX_DR[dir] === out[3]) nslot = dir + 1;
        }
        const nstate = (nr * width + nq) * 42 + nslot * 6 + turnHeading(heading, machine.turn);
        if (seen[nstate] === 1) continue;
        seen[nstate] = 1;
        next.push(nstate);
      }
    }
    frontier = next;
  }
  return false;
}

/** Signed angular distance between two 48-step angle indices. */
function angleGap(a: number, b: number): number {
  const d = (((a - b) % 48) + 48) % 48;
  return d > 24 ? 48 - d : d;
}

interface PassPlan {
  readonly kind: PassKind;
  /** Centre-relative waypoints for an angular shift (in 7.5° steps) of the whole pass. */
  readonly at: (shift: number) => readonly Point[];
}

/** Angular shift of attempt k: 0, +1, −1, +2, −2, … steps of `stride`. */
function attemptShift(attempt: number, stride: number): number {
  const magnitude = Math.ceil(attempt / 2) * stride;
  return attempt % 2 === 1 ? magnitude : -magnitude;
}

/**
 * Builds the elevation field, classifies terrain, carves verified winding passes and seals
 * unreachable pockets. Writes atlas.cell / elevation / pass / inside in place.
 */
export function buildTerrain(atlas: AtlasScratch, seed: number, machines: readonly Machine[]): TerrainInfo {
  const { width, height } = atlas;
  const area = width * height;
  const grid: Grid = {
    width,
    height,
    cq: atlas.start.q,
    cr: atlas.start.r,
    radius: atlasRadius(width, height),
  };
  const R = grid.radius;
  if (R < MIN_SKELETON_RADIUS) {
    // Flat test board: a broken swamp ring at radius 2 still makes references depend on terrain.
    atlas.inside.fill(1);
    if (Math.min(width, height) >= 9) {
      const firstGap = hash3(seed, 0, 0, 0x21) % 12;
      const secondGap = (firstGap + 3 + (hash3(seed, 0, 1, 0x21) % 3)) % 12;
      for (let slot = 0; slot < 12; slot++) {
        if (slot === firstGap || slot === secondGap) continue;
        const side = Math.floor(slot / 2);
        const corner = 2 * HEX_DQ[(side + 5) % 6]!;
        const cornerR = 2 * HEX_DR[(side + 5) % 6]!;
        const q = atlas.start.q + corner + (slot % 2) * HEX_DQ[(side + 1) % 6]!;
        const r = atlas.start.r + cornerR + (slot % 2) * HEX_DR[(side + 1) % 6]!;
        const index = r * width + q;
        atlas.cell[index] = CellKind.Swamp;
        atlas.elevation[index] = WATER_LEVEL - 100;
      }
    }
    return { radius: R, skeleton: false, ring: 0, passes: [], basins: [] };
  }
  // Passes route only inside the rim, so the rim stays closed.
  const routable = new Uint8Array(area);
  for (let index = 0; index < area; index++) {
    atlas.inside[index] = hexFromCentre(grid, index) <= R ? 1 : 0;
    routable[index] = hexFromCentre(grid, index) < R ? 1 : 0;
  }
  let salt = 0;
  const rand = (modulo: number): number => hash3(seed, 0x51ed, salt++, 0x2f) % modulo;

  // ── skeleton parameters ──
  const ring = Math.floor((R * 1024 * 3) / 8);
  const outer = Math.floor((R * 1024 * 77) / 100);
  const basinCount = R >= 18 ? 1 + rand(3) : 1;
  const basinAngles: number[] = [];
  const firstBasin = rand(48);
  for (let tries = 0; basinAngles.length < basinCount && tries < 48; tries++) {
    const angle = (firstBasin + tries * 17 + rand(5)) % 48;
    if (basinAngles.every((other) => angleGap(angle, other) >= 14)) basinAngles.push(angle);
  }
  const basinRho = Math.floor((R * 1024 * 18) / 100);
  const basins: { readonly angle: number; readonly c: Point; readonly rho: number }[] = basinAngles.map((angle) => ({
    angle,
    c: polar(0, 0, Math.floor((R * 1024 * (70 + rand(6))) / 100), angle),
    rho: basinRho + rand(Math.max(1, Math.floor(basinRho / 8))),
  }));
  const arcCount = 2 + rand(2);
  const arcs: { readonly from: number; readonly to: number; readonly mid: number }[] = [];
  const firstArc = rand(48);
  for (let tries = 0; arcs.length < arcCount && tries < 48; tries++) {
    const mid = (firstArc + tries * 11) % 48;
    const half = 4 + rand(2);
    if (basinAngles.some((angle) => angleGap(mid, angle) < half + 5)) continue;
    if (arcs.some((arc) => angleGap(mid, arc.mid) < half + 9)) continue;
    arcs.push({ from: mid - half, to: mid + half, mid });
  }
  const spurs: Point[][] = [];
  for (let tries = 0; spurs.length < 1 && tries < 12; tries++) {
    const angle = rand(48);
    if (basinAngles.some((other) => angleGap(angle, other) < 9)) continue;
    if (arcs.some((arc) => angleGap(angle, arc.mid) < 9)) continue;
    const bend = rand(3) - 1;
    spurs.push([
      polar(0, 0, ring + 2 * 1024, angle),
      polar(0, 0, Math.floor((ring + outer) / 2) + 1024, angle + bend),
      polar(0, 0, Math.floor((R * 1024 * 88) / 100), angle - bend),
    ]);
  }
  const ringUnits = Math.floor((ring * CELL) / 1024);
  const ranges: { readonly h: number; readonly w: number; readonly points: readonly Point[] }[] = [
    ...arcs.map((arc) => ({ h: 1434, w: 614, points: arcPoints(outer, arc.from, arc.to) })),
    ...spurs.map((points) => ({ h: 1280, w: 512, points })),
  ];
  const lakes: { readonly c: Point; readonly h: number; readonly w: number }[] = [];
  const lakeCount = 2 + rand(3);
  for (let tries = 0; lakes.length < lakeCount && tries < 64; tries++) {
    const candidate = (hash3(seed, tries, 0x1a4e, 0x3b) % area);
    if (atlas.inside[candidate] === 0) continue;
    const d = hexFromCentre(grid, candidate);
    if (d < 5 || d > R - 3) continue;
    const c = pointOf(grid, candidate);
    const radial = isqrt(c.x * c.x + c.y * c.y);
    if (Math.abs(radial - ringUnits) < 3 * CELL) continue;
    if (basins.some((basin) => isqrt((c.x - basin.c.x) ** 2 + (c.y - basin.c.y) ** 2) < Math.floor((basin.rho * CELL) / 1024) + 2 * CELL)) continue;
    if (lakes.some((lake) => isqrt((c.x - lake.c.x) ** 2 + (c.y - lake.c.y) ** 2) < 6 * CELL)) continue;
    lakes.push({ c, h: 820 + rand(205), w: 614 + rand(307) });
  }
  // Inner knolls and ponds: small seeded relief inside the ring, so every seed's inner ground
  // stops and deflects programs in different places.
  const knolls: { readonly c: Point; readonly h: number; readonly w: number }[] = [];
  const knollCount = R >= 18 ? 1 + rand(2) : rand(2);
  for (let tries = 0; knolls.length < knollCount && tries < 16; tries++) {
    const c = polar(0, 0, (4 + rand(3)) * 1024, rand(48));
    if (knolls.some((other) => isqrt((c.x - other.c.x) ** 2 + (c.y - other.c.y) ** 2) < 4 * CELL)) continue;
    knolls.push({ c, h: (rand(2) === 0 ? 1 : -1) * (950 + rand(150)), w: 560 + rand(200) });
  }

  // ── elevation ──
  const raw = new Int32Array(area);
  for (let index = 0; index < area; index++) {
    if (atlas.inside[index] === 0) {
      raw[index] = RIM_HEIGHT;
      continue;
    }
    const p = pointOf(grid, index);
    let e = Math.floor(
      (gradientNoise(p.x + 50_000, p.y + 50_000, 12 * CELL, seed, 1) * 170 +
        gradientNoise(p.x + 50_000, p.y + 50_000, 5 * CELL, seed, 2) * 80) / 1024,
    );
    e += Math.floor((Math.abs(gradientNoise(p.x + 50_000, p.y + 50_000, 3 * CELL, seed, 3)) * 40) / 1024) - 20;
    // Domain warp bends every skeleton feature by up to ~0.8 cells.
    const wx = p.x + Math.floor((gradientNoise(p.x + 90_000, p.y + 50_000, 7 * CELL, seed, 4) * 355) / 1024);
    const wy = p.y + Math.floor((gradientNoise(p.x + 50_000, p.y + 90_000, 7 * CELL, seed, 5) * 355) / 1024);
    // The inner ring range is a (warped) circle; arcs and spurs are polylines.
    e += Math.floor((1536 * bump((isqrt(wx * wx + wy * wy) - ringUnits) ** 2, 742)) / 1024);
    for (const range of ranges) {
      e += Math.floor((range.h * bump(polylineDistance2(wx, wy, range.points), range.w)) / 1024);
    }
    for (const basin of basins) {
      const rhoUnits = Math.floor((basin.rho * CELL) / 1024);
      const d = isqrt((wx - basin.c.x) ** 2 + (wy - basin.c.y) ** 2);
      e += Math.floor((1740 * bump((d - rhoUnits) ** 2, 538)) / 1024);
      if (d < rhoUnits - 384) e -= 123;
    }
    for (const lake of lakes) {
      e -= Math.floor((lake.h * bump((p.x - lake.c.x) ** 2 + (p.y - lake.c.y) ** 2, lake.w)) / 1024);
    }
    for (const knoll of knolls) {
      e += Math.floor((knoll.h * bump((p.x - knoll.c.x) ** 2 + (p.y - knoll.c.y) ** 2, knoll.w)) / 1024);
    }
    const edge = R - hexFromCentre(grid, index);
    if (edge === 0) e += RIM_HEIGHT;
    else if (edge === 1) e += RIM_SECOND;
    raw[index] = e;
  }
  const startIndex = atlas.start.r * width + atlas.start.q;
  for (let index = 0; index < area; index++) {
    let e = raw[index]!;
    if (atlas.inside[index] === 1 && hexFromCentre(grid, index) <= START_DISK_RADIUS) {
      e = Math.max(WATER_LEVEL + 160, Math.min(MOUNTAIN_LEVEL - 160, e));
    }
    raw[index] = e;
    atlas.cell[index] = atlas.inside[index] === 0 || e >= MOUNTAIN_LEVEL
      ? CellKind.Wall
      : e <= WATER_LEVEL ? CellKind.Swamp : CellKind.Empty;
  }
  atlas.cell[startIndex] = CellKind.Empty;

  // ── passes ──
  const passes: PassInfo[] = [];
  const plans: PassPlan[] = [];
  const ringCount = 2 + rand(2);
  const ringBase = rand(48);
  for (let index = 0; index < ringCount; index++) {
    const base = ringBase + Math.floor((index * 48) / ringCount) + rand(5) - 2;
    const sign = rand(2) === 0 ? 1 : -1;
    const k1 = 2 + rand(2);
    plans.push({
      kind: "ring",
      at: (shift) => {
        const angle = base + shift;
        return [
          polar(0, 0, Math.max(ring - 5 * 1024, (START_DISK_RADIUS + 2) * 1024), angle),
          polar(0, 0, ring - 1024, angle + sign * k1),
          polar(0, 0, ring + 1024, angle - sign),
          polar(0, 0, ring + 5 * 1024, angle + sign),
        ];
      },
    });
  }
  for (const arc of arcs) {
    const base = arc.mid + rand(3) - 1;
    const sign = rand(2) === 0 ? 1 : -1;
    plans.push({
      kind: "arc",
      at: (shift) => {
        const angle = base + shift;
        let far = outer + 3 * 1024;
        while (far > outer && hexFromCentre(grid, Math.max(0, cellAt(grid, polar(0, 0, far, angle)))) > R - 2) far -= 512;
        return [
          polar(0, 0, outer - 4 * 1024, angle),
          polar(0, 0, outer - 1024, angle + sign),
          polar(0, 0, outer + 1024, angle - sign),
          polar(0, 0, far, angle),
        ];
      },
    });
  }
  for (const basin of basins) {
    const base = basin.angle + 24 + rand(9) - 4;
    const sign = rand(2) === 0 ? 1 : -1;
    const k = 3 + rand(3);
    plans.push({
      kind: "basin",
      at: (shift) => {
        const toward = base + shift;
        return [
          polar(basin.c.x, basin.c.y, basin.rho + 4 * 1024, toward),
          polar(basin.c.x, basin.c.y, basin.rho + 1024, toward + sign * k),
          polar(basin.c.x, basin.c.y, basin.rho - 1024, toward - sign * k),
          polar(basin.c.x, basin.c.y, 1024, toward + sign * k),
        ];
      },
    });
  }
  const carve = (cells: readonly number[]): void => {
    for (const index of cells) {
      // The start disk is already plain; it never counts as pass ground.
      if (hexFromCentre(grid, index) <= START_DISK_RADIUS) continue;
      atlas.cell[index] = CellKind.Empty;
      atlas.pass[index] = 1;
      raw[index] = Math.max(WATER_LEVEL + 160, Math.min(PASS_SADDLE, raw[index]!));
    }
  };
  for (let planIndex = 0; planIndex < plans.length; planIndex++) {
    const plan = plans[planIndex]!;
    const narrow = plan.kind === "basin" ? BASIN_NARROW : RANGE_NARROW;
    let fallback: { path: number[]; cells: number[] } | null = null;
    let accepted: PassInfo | null = null;
    for (let attempt = 0; attempt < MAX_PASS_ATTEMPTS && accepted === null; attempt++) {
      const waypoints = plan.at(attemptShift(attempt, plan.kind === "basin" ? 4 : 1));
      const stops: number[] = [];
      for (const point of waypoints) {
        const index = cellAt(grid, point);
        if (index < 0 || atlas.inside[index] === 0 || hexFromCentre(grid, index) > R - 2) break;
        stops.push(index);
      }
      if (stops.length !== waypoints.length) continue;
      const path: number[] = [stops[0]!];
      for (let leg = 1; leg < stops.length && path.length > 0; leg++) {
        const route = noisyRoute(grid, routable, stops[leg - 1]!, stops[leg]!, seed, planIndex * 97 + attempt * 13 + leg);
        if (route.length === 0) path.length = 0;
        else for (let step = 1; step < route.length; step++) path.push(route[step]!);
      }
      if (path.length < 6) continue;
      const a = Math.floor((path.length * narrow[0]) / 100);
      const b = Math.ceil((path.length * narrow[1]) / 100);
      // The approach must touch ground reachable from the start and the far end must open onto
      // non-mountain ground, or the pass would lead nowhere.
      const reach = reachableFromStart(atlas);
      if (!path.slice(0, a + 1).some((index) => reach[index] === 1)) continue;
      if (!path.slice(b + 1).some((index) => atlas.cell[index] !== CellKind.Wall)) continue;
      const cells = corridorOf(width, height, path, a, b).filter((index) => routable[index] === 1);
      fallback ??= {
        path,
        cells: corridorOf(width, height, path, path.length, path.length).filter((index) => routable[index] === 1),
      };
      if (!passTraversable(atlas, { path, cells }, machines)) continue;
      accepted = { kind: plan.kind, path, narrow: path.slice(a, b + 1), cells, verified: true };
    }
    if (accepted === null && fallback !== null) {
      // Bounded attempts exhausted: keep a fully wide route so the region stays connected.
      accepted = {
        kind: plan.kind,
        path: fallback.path,
        narrow: [],
        cells: fallback.cells,
        verified: passTraversable(atlas, fallback, machines),
      };
    }
    if (accepted === null) continue;
    carve(accepted.cells);
    passes.push(accepted);
  }

  // ── cleanup: seal pockets, drop 1-cell lakes ──
  const reach = reachableFromStart(atlas);
  const scratch: number[] = [];
  for (let index = 0; index < area; index++) {
    const kind = atlas.cell[index]!;
    if (kind === CellKind.Wall) continue;
    if (reach[index] === 0) {
      atlas.cell[index] = CellKind.Wall;
      if (raw[index]! < MOUNTAIN_LEVEL) raw[index] = MOUNTAIN_LEVEL;
      continue;
    }
    if (kind === CellKind.Swamp) {
      let wet = false;
      for (const next of neighbors(width, height, index, scratch)) {
        if (atlas.cell[next] === CellKind.Swamp) wet = true;
      }
      if (!wet) {
        atlas.cell[index] = CellKind.Empty;
        if (raw[index]! <= WATER_LEVEL) raw[index] = WATER_LEVEL + 160;
      }
    }
  }
  for (let index = 0; index < area; index++) {
    atlas.elevation[index] = Math.max(-32_000, Math.min(32_000, raw[index]!));
  }
  return {
    radius: R,
    skeleton: true,
    ring,
    passes,
    basins: basins.map((basin) => ({
      center: Math.max(0, cellAt(grid, basin.c)),
      rho: basin.rho,
    })),
  };
}
