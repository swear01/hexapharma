import type {
  Dir,
  DrugState,
  Machine,
  FactoryTile,
  FactoryLayout,
  Unit,
  InitFactoryFn,
  StepFactoryFn,
  AnalyzeThroughputFn,
  MachineTypeId,
} from "../phase0_interfaces";
import { applyStep, initialState } from "../drug-graph";

// ════════════════════════════════ conventions ════════════════════════════════
//
// Grid:        tiles[y * width + x]; one Unit per tile (capacity 1).
// Directions:  Dir 0=E 1=S 2=W 3=N on a y-down grid.
//                E=(+1,0)  S=(0,+1)  W=(-1,0)  N=(0,-1).
//
// Tick resolution order (each tick produces a brand-new FactoryState):
//   1. PROCESS  — every unit on a machine tile with proc < speed gets proc+1.
//                 When proc reaches speed the transform is applied EXACTLY ONCE
//                 (at the completing tick), updating that unit's drug. A finished
//                 unit (proc === speed) is then eligible to leave via outDir.
//                 A machine holding any unit cannot accept another.
//   2. MOVE     — fixpoint relocation of movable units. A unit's travel direction
//                 is its tile's belt.dir / machine.outDir / source.dir. A machine
//                 unit only travels once finished (proc === speed); a belt unit
//                 always travels. The target is the neighbour in that direction.
//                 A move is legal iff the target is in-bounds, is a
//                 belt | machine-input(matching inDir) | sink, and is empty this
//                 tick. We iterate ascending unit id repeatedly until a full pass
//                 moves nothing — this lets a train of units advance one cell in a
//                 single tick. Contention for one target is won by the lower unit
//                 id (it moves first; the target is then occupied for the rest of
//                 the tick). Entering a machine tile resets proc=0. Entering a sink
//                 removes the unit and appends its drug to `produced` (deterministic
//                 arrival order = ascending id within the fixpoint).
//   3. EMIT     — for each source tile (scanned by ascending tile index), when
//                 tick % period === 0 and its output neighbour (the tile in
//                 source.dir) is in-bounds, accepts from that side, and is empty,
//                 spawn a unit onto that OUTPUT tile with id = nextUnitId++,
//                 drug = initialState(mm), proc = 0. Convention: a source occupies
//                 no tile of its own; the fresh unit is born on the neighbour tile.
//                 If the output is a machine, the unit begins processing (proc=0).
//                 A source whose output is blocked at an emit tick is "pending".
//   4. DEADLOCK — if a tick performs no proc increment, no movement, no emission,
//                 and no production, yet units exist OR a source is pending,
//                 set deadlocked=true. (The sim never spins forever: the fixpoint
//                 is bounded by unit count, and a stalled tick is flagged.)
//
// Note: the contract's stepFactory(layout, mm, s) does not receive the level's
// `start` DrugState, so sources emit `initialState(mm)` — the canonical start
// (each map's start cell, failed=false), identical to what initFactory is given.
//
// Determinism: every iteration order is by ascending unit id / ascending tile
// index. No Math.random, no wall-clock; "time" is the tick counter. Integers only.

const DIR_DX: readonly number[] = [1, 0, -1, 0];
const DIR_DY: readonly number[] = [0, 1, 0, -1];

/** The side a unit enters through when it moves in direction `d`. */
function opposite(d: Dir): Dir {
  return ((d + 2) & 3) as Dir;
}

function inBounds(layout: FactoryLayout, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < layout.width && y < layout.height;
}

function tileAt(layout: FactoryLayout, x: number, y: number): FactoryTile | undefined {
  if (!inBounds(layout, x, y)) return undefined;
  return layout.tiles[y * layout.width + x];
}

/** A mutable working copy of a unit during a tick. */
interface WorkUnit {
  id: number;
  x: number;
  y: number;
  drug: DrugState;
  proc: number;
}

/** Travel direction of the tile a unit sits on, or null if it cannot move. */
function travelDir(tile: FactoryTile, u: WorkUnit): Dir | null {
  switch (tile.kind) {
    case "belt":
      return tile.dir;
    case "machine":
      return u.proc >= tile.def.speed ? tile.outDir : null;
    case "source":
      return tile.dir;
    case "sink":
    case "empty":
      return null;
  }
}

/**
 * Whether `target` accepts a unit arriving by moving in direction `moveDir`.
 * Belts and sinks accept from any side; a machine accepts only on its inDir side.
 */
function accepts(target: FactoryTile, moveDir: Dir): boolean {
  switch (target.kind) {
    case "belt":
    case "sink":
      return true;
    case "machine":
      return opposite(moveDir) === target.inDir;
    case "source":
    case "empty":
      return false;
  }
}

export const initFactory: InitFactoryFn = (_layout, _mm, _start) => ({
  tick: 0,
  units: [],
  nextUnitId: 0,
  produced: [],
  deadlocked: false,
});

export const stepFactory: StepFactoryFn = (layout, mm, s) => {
  if (s.deadlocked) {
    // A deadlocked sim makes no further progress; we still advance the counter.
    return { ...s, tick: s.tick + 1 };
  }

  const width = layout.width;

  const units: WorkUnit[] = s.units.map((u) => ({
    id: u.id,
    x: u.pos.x,
    y: u.pos.y,
    drug: u.drug,
    proc: u.proc,
  }));
  units.sort((a, b) => a.id - b.id);

  const produced: DrugState[] = s.produced.slice();
  let nextUnitId = s.nextUnitId;

  let didProcess = false;
  let didMove = false;
  let didEmit = false;
  let didProduce = false;

  // Occupancy of the grid by working-unit array index (-1 = empty).
  const occ = new Int32Array(width * layout.height).fill(-1);
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined) continue;
    occ[u.y * width + u.x] = i;
  }

  // ── 1. PROCESS ──
  for (const u of units) {
    const tile = tileAt(layout, u.x, u.y);
    if (tile === undefined || tile.kind !== "machine") continue;
    if (u.proc < tile.def.speed) {
      u.proc += 1;
      didProcess = true;
      if (u.proc === tile.def.speed) {
        const m: Machine = {
          typeId: tile.def.typeId,
          transform: tile.def.transform,
          orientation: tile.def.orientation,
        };
        u.drug = applyStep(mm, u.drug, m);
      }
    }
  }

  // ── 2. MOVE (fixpoint) ──
  // Each unit advances at most ONE cell per tick (`movedTick`); the fixpoint only
  // lets a unit ahead vacate first so the one behind can claim the freed cell in
  // the same tick (train advance). This bound also guarantees termination — even
  // on a belt ring with a free slot, no unit can circulate within a single tick.
  const removed = new Array<boolean>(units.length).fill(false);
  const movedTick = new Array<boolean>(units.length).fill(false);
  let movedThisPass = true;
  while (movedThisPass) {
    movedThisPass = false;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || removed[i] || movedTick[i]) continue;
      const tile = tileAt(layout, u.x, u.y);
      if (tile === undefined) continue;
      const d = travelDir(tile, u);
      if (d === null) continue;

      const nx = u.x + (DIR_DX[d] ?? 0);
      const ny = u.y + (DIR_DY[d] ?? 0);
      const target = tileAt(layout, nx, ny);
      if (target === undefined || !accepts(target, d)) continue;

      const tIdx = ny * width + nx;
      if (occ[tIdx] !== -1) continue; // target occupied this tick

      // Perform the move.
      occ[u.y * width + u.x] = -1;
      u.x = nx;
      u.y = ny;
      movedTick[i] = true;
      didMove = true;
      movedThisPass = true;

      if (target.kind === "sink") {
        produced.push(u.drug);
        removed[i] = true;
        didProduce = true;
        // A sink retains no occupancy.
      } else {
        occ[tIdx] = i;
        if (target.kind === "machine") {
          u.proc = 0; // fresh entry into a machine
        }
      }
    }
  }

  // ── 3. EMIT ──
  let pendingSource = false;
  for (let ty = 0; ty < layout.height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const tile = layout.tiles[ty * width + tx];
      if (tile === undefined || tile.kind !== "source") continue;
      if (tile.period <= 0) continue; // ill-formed period never emits
      if (s.tick % tile.period !== 0) continue;

      const d = tile.dir;
      const ox = tx + (DIR_DX[d] ?? 0);
      const oy = ty + (DIR_DY[d] ?? 0);
      const out = tileAt(layout, ox, oy);
      if (out === undefined || !accepts(out, d)) continue;

      const oIdx = oy * width + ox;
      if (occ[oIdx] !== -1) {
        pendingSource = true; // wanted to emit but the output is blocked
        continue;
      }

      const nu: WorkUnit = {
        id: nextUnitId,
        x: ox,
        y: oy,
        drug: initialState(mm),
        proc: 0,
      };
      nextUnitId += 1;
      units.push(nu);
      occ[oIdx] = units.length - 1;
      removed.push(false);
      didEmit = true;
    }
  }

  // ── 4. FINALIZE + DEADLOCK ──
  const out: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    if (removed[i]) continue;
    const u = units[i];
    if (u === undefined) continue;
    out.push({ id: u.id, pos: { x: u.x, y: u.y }, drug: u.drug, proc: u.proc });
  }
  out.sort((a, b) => a.id - b.id);

  const changed = didProcess || didMove || didEmit || didProduce;
  const hasWork = out.length > 0 || pendingSource;
  const deadlocked = !changed && hasWork;

  return {
    tick: s.tick + 1,
    units: out,
    nextUnitId,
    produced,
    deadlocked,
  };
};

// ════════════════════════════════ throughput ════════════════════════════════
//
// Static steady-state analysis for single-path lines + simple parallel splits.
// Assumptions:
//   - Each machine stage processes one unit per `speed` ticks ⇒ rate 1/speed.
//   - Each source emits one unit per `period` ticks ⇒ rate 1/period.
//   - Machines of the SAME typeId are treated as parallel copies of one stage:
//     their rates add (k copies of speed s ⇒ k/s). This is the simple-parallel
//     model; it is exact for a balanced split feeding k identical machines.
//   - The whole line's steady-state rate is the MIN over the source stage and
//     every machine stage (the bottleneck). `bottleneck` is the limiting machine
//     typeId, or null if the source (or absence of machines) limits.
//   - Rational result is reduced to lowest terms.

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x === 0 ? 1 : x;
}

interface Rate {
  num: number;
  den: number;
}

function reduce(r: Rate): Rate {
  const g = gcd(r.num, r.den);
  return { num: r.num / g, den: r.den / g };
}

/** a < b for positive rationals (num/den). */
function lessThan(a: Rate, b: Rate): boolean {
  return a.num * b.den < b.num * a.den;
}

export const analyzeThroughput: AnalyzeThroughputFn = (layout) => {
  // Source stage: combine all sources (parallel) by adding 1/period.
  let srcRate: Rate | null = null;
  // Machine stages keyed by typeId: combine copies by adding 1/speed.
  const stageNum = new Map<MachineTypeId, number>();
  const stageDen = new Map<MachineTypeId, number>();

  for (const tile of layout.tiles) {
    if (tile === undefined) continue;
    if (tile.kind === "source" && tile.period > 0) {
      const add: Rate = { num: 1, den: tile.period };
      srcRate =
        srcRate === null
          ? add
          : { num: srcRate.num * add.den + add.num * srcRate.den, den: srcRate.den * add.den };
    } else if (tile.kind === "machine" && tile.def.speed > 0) {
      const id = tile.def.typeId;
      const pNum = stageNum.get(id) ?? 0;
      const pDen = stageDen.get(id) ?? 1;
      // pNum/pDen + 1/speed
      const num = pNum * tile.def.speed + pDen;
      const den = pDen * tile.def.speed;
      const g = gcd(num, den);
      stageNum.set(id, num / g);
      stageDen.set(id, den / g);
    }
  }

  // Start from the source rate (or unbounded if no source).
  let best: Rate = srcRate ?? { num: 1, den: 1 };
  let bottleneck: MachineTypeId | null = null;
  if (srcRate === null) {
    // No source ⇒ no steady output.
    best = { num: 0, den: 1 };
  }

  // Iterate machine stages in deterministic (sorted typeId) order.
  const ids = [...stageNum.keys()].sort();
  for (const id of ids) {
    const num = stageNum.get(id) ?? 0;
    const den = stageDen.get(id) ?? 1;
    const r: Rate = { num, den };
    if (lessThan(r, best)) {
      best = r;
      bottleneck = id;
    }
  }

  const red = reduce(best);
  return { rateNum: red.num, rateDen: red.den, bottleneck };
};
