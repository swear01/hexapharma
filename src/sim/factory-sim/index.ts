import type {
  Dir,
  Vec2,
  Rotation,
  DrugState,
  Machine,
  Port,
  PlacedMachine,
  FactoryTile,
  FactoryLayout,
  Unit,
  InitFactoryFn,
  StepFactoryFn,
  AnalyzeThroughputFn,
  ThroughputReport,
  MachineTypeId,
} from "../phase0_interfaces";
import { applyStep, initialState } from "../drug-graph";

// ════════════════════════════════ conventions ════════════════════════════════
//
// NEW factory model: multi-cell, multi-port machines + splitter/merger belts +
// REAL parallelism. Machines are NOT tiles — they live in `layout.machines` and
// occupy grid cells via their (footRot-rotated) footprint. Belts/splitters/mergers/
// sinks/sources are tiles; capacity is 1 unit per tile AND 1 unit per machine.
//
// Grid:        tiles[y*width + x]. Directions Dir 0=E 1=S 2=W 3=N on a y-down grid:
//                E=(+1,0)  S=(0,+1)  W=(-1,0)  N=(0,-1).
//
// Machine geometry (computed once per step):
//   A PlacedMachine's WORLD cells/ports = local shape rotated by `footRot` quarter-
//   turns CW about the anchor (each turn maps (x,y)->(-y,x), y-down) then translated
//   by `anchor`. A port's side rotates too: worldSide = (side + footRot) & 3.
//   We build:
//     - cellOwner: cell index -> machineId for every solid machine cell.
//     - per machine: world input ports (cell+side) and world output ports (cell+side).
//   A unit ENTERS a machine ONLY by moving onto an input-port cell from that port's
//   world side; it can NEVER move onto a non-port machine cell. `def.orientation`
//   (the recipe-locked drug effect) is independent of `footRot` (packing only).
//
// Tick resolution order (each tick returns a brand-new FactoryState):
//   1. PROCESS — each unit with machineId !== null and proc < def.speed: proc+1.
//                When proc reaches speed, apply the transform EXACTLY ONCE
//                (drug = applyStep(...)). A machine holds at most ONE unit (cap 1)
//                — that is the per-machine throughput limit.
//   2. MOVE  — fixpoint, ascending unit id, capacity 1 per tile / per machine,
//              lower id wins contention; each unit moves <= 1 hop/tick.
//                * On a belt:     target = neighbor in belt.dir.
//                * On a splitter: outDir = outDirs[id % outDirs.length]; if that
//                  neighbor isn't free/accepting, fall back to the FIRST free outDir;
//                  target = that neighbor. (Deterministic fan-out by unit id.)
//                * On a merger:   acts like a belt outputting outDir (accepts from any
//                  inDir; cap 1 => lower id wins when two arrive — the fan-in).
//                * A finished machine unit (machineId set, proc===speed): pick the
//                  FIRST output port whose neighbor (in the port's world side) accepts
//                  + is free; move there, set machineId=null, proc=0.
//                * A unit whose target cell is a machine INPUT PORT (entered from the
//                  matching world side) and that machine holds no unit: it ENTERS
//                  (machineId set, proc=0, pos=that cell).
//                * A unit reaching a SINK: removed; its drug appended to `produced`
//                  (ascending-id arrival order).
//                "accepts": belt/splitter/merger/sink accept per their declared sides;
//                machine accepts only at an input port on the matching side;
//                empty/source never accept.
//              The fixpoint repeats until a full pass moves nothing — a unit ahead
//              vacating lets the one behind claim the freed cell within one tick
//              (train advance). Each unit still moves at most once per tick, which
//              bounds the loop and prevents single-tick circulation.
//   3. EMIT  — each source (ascending tile index), when tick % period === 0 and its
//              dir-neighbor accepts + is free, spawns { id: nextUnitId++,
//              pos: neighbor, drug: initialState(mm), proc: 0,
//              machineId: (neighbor is a machine input port ? that machine : null) }.
//   4. DEADLOCK — if a tick does no process/move/emit/produce while units exist OR a
//              source is blocked-pending, set deadlocked=true (never loops forever).
//
// stepFactory(layout, mm, s) does not receive the level's `start` DrugState, so
// sources emit `initialState(mm)` (each map's start cell, failed=false).
//
// Determinism: every iteration order is ascending unit id / ascending tile index /
// declared port order. No Math.random, no wall-clock; "time" is the tick counter.
// Integers only.

const DIR_DX: readonly number[] = [1, 0, -1, 0];
const DIR_DY: readonly number[] = [0, 1, 0, -1];

/** The world side a unit enters through when it moves in direction `d`. */
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

/** Rotate a LOCAL vector `rot` quarter-turns CW (y-down): (x,y)->(-y,x). */
function rotateVec(v: Vec2, rot: Rotation): Vec2 {
  let x = v.x;
  let y = v.y;
  for (let i = 0; i < rot; i++) {
    const nx = -y;
    const ny = x;
    x = nx;
    y = ny;
  }
  return { x, y };
}

/** A port placed in world coords. */
interface WorldPort {
  readonly x: number;
  readonly y: number;
  readonly side: Dir;
}

/** A machine's resolved world geometry. */
interface MachineGeom {
  readonly id: number;
  readonly machine: PlacedMachine;
  readonly inPorts: readonly WorldPort[];
  readonly outPorts: readonly WorldPort[];
}

function worldCell(m: PlacedMachine, c: Vec2): Vec2 {
  const r = rotateVec(c, m.footRot);
  return { x: r.x + m.anchor.x, y: r.y + m.anchor.y };
}

function worldPort(m: PlacedMachine, p: Port): WorldPort {
  const c = worldCell(m, p.cell);
  return { x: c.x, y: c.y, side: ((p.side + m.footRot) & 3) as Dir };
}

/** Precomputed machine layout for a tick: cell ownership + per-machine port geom. */
interface MachineIndex {
  /** world cell index -> machineId (every solid machine cell). */
  readonly cellOwner: Map<number, number>;
  /** machineId -> geometry. */
  readonly geom: Map<number, MachineGeom>;
  /** world cell index -> input port(s) at that cell. */
  readonly inPortAt: Map<number, readonly { readonly machineId: number; readonly side: Dir }[]>;
}

function buildMachineIndex(layout: FactoryLayout): MachineIndex {
  const width = layout.width;
  const cellOwner = new Map<number, number>();
  const geom = new Map<number, MachineGeom>();
  const inPortAt = new Map<number, { machineId: number; side: Dir }[]>();

  for (const m of layout.machines) {
    for (const c of m.shape.cells) {
      const wc = worldCell(m, c);
      cellOwner.set(wc.y * width + wc.x, m.id);
    }
    const inPorts = m.shape.inPorts.map((p) => worldPort(m, p));
    const outPorts = m.shape.outPorts.map((p) => worldPort(m, p));
    geom.set(m.id, { id: m.id, machine: m, inPorts, outPorts });
    for (const wp of inPorts) {
      const idx = wp.y * width + wp.x;
      const list = inPortAt.get(idx) ?? [];
      list.push({ machineId: m.id, side: wp.side });
      inPortAt.set(idx, list);
    }
  }
  return { cellOwner, geom, inPortAt };
}

/** A mutable working copy of a unit during a tick. */
interface WorkUnit {
  id: number;
  x: number;
  y: number;
  drug: DrugState;
  proc: number;
  machineId: number | null;
}

/**
 * Whether the cell (tx,ty) accepts a unit arriving by moving in direction `moveDir`.
 * Returns one of: "tile" (belt/splitter/merger), "sink", { enterMachine }, or null.
 * Machine acceptance requires an input port at the cell whose world side matches the
 * side the unit enters from (= opposite of moveDir).
 */
type Acceptance =
  | { readonly kind: "tile" }
  | { readonly kind: "sink" }
  | { readonly kind: "machine"; readonly machineId: number }
  | null;

function acceptanceAt(
  layout: FactoryLayout,
  mi: MachineIndex,
  tx: number,
  ty: number,
  moveDir: Dir,
): Acceptance {
  if (!inBounds(layout, tx, ty)) return null;
  const idx = ty * layout.width + tx;
  // A machine cell takes priority: it may be entered only through an input port.
  if (mi.cellOwner.has(idx)) {
    const entrySide = opposite(moveDir);
    const ports = mi.inPortAt.get(idx);
    if (ports !== undefined) {
      for (const p of ports) {
        if (p.side === entrySide) return { kind: "machine", machineId: p.machineId };
      }
    }
    return null; // a non-port (or wrong-side) machine cell never accepts
  }
  const tile = layout.tiles[idx];
  if (tile === undefined) return null;
  switch (tile.kind) {
    case "belt":
    case "splitter":
    case "merger":
      return { kind: "tile" };
    case "sink":
      return { kind: "sink" };
    case "source":
    case "empty":
      return null;
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
    // A deadlocked sim makes no further progress; still advance the counter.
    return { ...s, tick: s.tick + 1 };
  }

  const width = layout.width;
  const mi = buildMachineIndex(layout);

  const units: WorkUnit[] = s.units.map((u) => ({
    id: u.id,
    x: u.pos.x,
    y: u.pos.y,
    drug: u.drug,
    proc: u.proc,
    machineId: u.machineId,
  }));
  units.sort((a, b) => a.id - b.id);

  const produced: DrugState[] = s.produced.slice();
  let nextUnitId = s.nextUnitId;

  let didProcess = false;
  let didMove = false;
  let didEmit = false;
  let didProduce = false;

  // Occupancy of belt-grid cells by working-unit array index (-1 = empty).
  const occ = new Int32Array(width * layout.height).fill(-1);
  // Which machine currently holds a unit (machineId -> working-unit index).
  const machineHeld = new Map<number, number>();
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    if (u === undefined) continue;
    occ[u.y * width + u.x] = i;
    if (u.machineId !== null) machineHeld.set(u.machineId, i);
  }

  // ── 1. PROCESS ──
  for (const u of units) {
    if (u.machineId === null) continue;
    const g = mi.geom.get(u.machineId);
    if (g === undefined) continue;
    const def = g.machine.def;
    if (u.proc < def.speed) {
      u.proc += 1;
      didProcess = true;
      if (u.proc === def.speed) {
        const m: Machine = {
          typeId: def.typeId,
          transform: def.transform,
          orientation: def.orientation,
        };
        u.drug = applyStep(mm, u.drug, m);
      }
    }
  }

  // ── 2. MOVE (fixpoint) ──
  const removed = new Array<boolean>(units.length).fill(false);
  const movedTick = new Array<boolean>(units.length).fill(false);

  /** Free-and-accepting at (tx,ty) for a unit moving in moveDir. Returns acceptance or null. */
  function targetIfFree(tx: number, ty: number, moveDir: Dir): Acceptance {
    const acc = acceptanceAt(layout, mi, tx, ty, moveDir);
    if (acc === null) return null;
    if (acc.kind === "machine") {
      if (machineHeld.has(acc.machineId)) return null; // machine occupied
      return acc;
    }
    if (acc.kind === "sink") return acc; // sinks always have room
    // belt/splitter/merger: cell must be empty
    if (occ[ty * width + tx] !== -1) return null;
    return acc;
  }

  let movedThisPass = true;
  while (movedThisPass) {
    movedThisPass = false;
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u === undefined || removed[i] || movedTick[i]) continue;

      // Determine this unit's candidate move(s).
      let targets: { dir: Dir; nx: number; ny: number; acc: Acceptance }[] = [];

      if (u.machineId !== null) {
        // Inside a machine: only a FINISHED unit may leave, via an output port.
        const g = mi.geom.get(u.machineId);
        if (g === undefined) continue;
        if (u.proc < g.machine.def.speed) continue;
        for (const wp of g.outPorts) {
          const nx = wp.x + (DIR_DX[wp.side] ?? 0);
          const ny = wp.y + (DIR_DY[wp.side] ?? 0);
          const acc = targetIfFree(nx, ny, wp.side);
          if (acc !== null) {
            targets = [{ dir: wp.side, nx, ny, acc }];
            break; // first accepting output port
          }
        }
      } else {
        const tile = tileAt(layout, u.x, u.y);
        if (tile === undefined) continue;
        if (tile.kind === "belt" || tile.kind === "merger") {
          const d = tile.kind === "belt" ? tile.dir : tile.outDir;
          const nx = u.x + (DIR_DX[d] ?? 0);
          const ny = u.y + (DIR_DY[d] ?? 0);
          const acc = targetIfFree(nx, ny, d);
          if (acc !== null) targets = [{ dir: d, nx, ny, acc }];
        } else if (tile.kind === "splitter") {
          const outs = tile.outDirs;
          if (outs.length > 0) {
            const primary = outs[u.id % outs.length] as Dir;
            const order: Dir[] = [primary];
            for (const d of outs) if (d !== primary) order.push(d);
            for (const d of order) {
              const nx = u.x + (DIR_DX[d] ?? 0);
              const ny = u.y + (DIR_DY[d] ?? 0);
              const acc = targetIfFree(nx, ny, d);
              if (acc !== null) {
                targets = [{ dir: d, nx, ny, acc }];
                break;
              }
            }
          }
        }
        // source/sink/empty tiles never carry a movable belt unit.
      }

      if (targets.length === 0) continue;
      const t = targets[0];
      if (t === undefined || t.acc === null) continue;

      // Perform the move.
      occ[u.y * width + u.x] = -1;
      if (u.machineId !== null) machineHeld.delete(u.machineId);

      u.x = t.nx;
      u.y = t.ny;
      movedTick[i] = true;
      didMove = true;
      movedThisPass = true;

      if (t.acc.kind === "sink") {
        produced.push(u.drug);
        removed[i] = true;
        didProduce = true;
        u.machineId = null;
      } else if (t.acc.kind === "machine") {
        u.machineId = t.acc.machineId;
        u.proc = 0;
        machineHeld.set(t.acc.machineId, i);
        // NB: machine-held units do not occupy the belt-grid `occ`.
      } else {
        u.machineId = null;
        occ[t.ny * width + t.nx] = i;
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
      const acc = targetIfFree(ox, oy, d);
      if (acc === null) {
        pendingSource = true; // wanted to emit but the output is blocked
        continue;
      }

      const enterMachine = acc.kind === "machine" ? acc.machineId : null;
      if (acc.kind === "sink") {
        // A source feeding straight into a sink: born + consumed immediately.
        produced.push(initialState(mm));
        nextUnitId += 1;
        didEmit = true;
        didProduce = true;
        continue;
      }

      const nu: WorkUnit = {
        id: nextUnitId,
        x: ox,
        y: oy,
        drug: initialState(mm),
        proc: 0,
        machineId: enterMachine,
      };
      nextUnitId += 1;
      units.push(nu);
      removed.push(false);
      const newIdx = units.length - 1;
      if (enterMachine !== null) {
        machineHeld.set(enterMachine, newIdx);
      } else {
        occ[oy * width + ox] = newIdx;
      }
      didEmit = true;
    }
  }

  // ── 4. FINALIZE + DEADLOCK ──
  const out: Unit[] = [];
  for (let i = 0; i < units.length; i++) {
    if (removed[i]) continue;
    const u = units[i];
    if (u === undefined) continue;
    out.push({
      id: u.id,
      pos: { x: u.x, y: u.y },
      drug: u.drug,
      proc: u.proc,
      machineId: u.machineId,
    });
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
// MEASURED, not heuristic. Run init + step for a bounded window; measure
// produced/tick over a steady TAIL window as a reduced rational. The bottleneck is
// the machine id with the highest sustained busy-fraction (processing or holding a
// unit) over the tail (ties -> lowest id); bottleneckType = its def.typeId. Both are
// null if source-limited / no machines.

const WINDOW = 400;
const TAIL = 200; // measure over the last TAIL ticks (steady state)

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

export const analyzeThroughput: AnalyzeThroughputFn = (layout, mm): ThroughputReport => {
  const start = initialState(mm);
  let s = initFactory(layout, mm, start);

  // Busy-tick counts per machine over the tail window.
  const busy = new Map<number, number>();
  for (const m of layout.machines) busy.set(m.id, 0);

  let tailStartProduced = 0;
  const tailBegin = WINDOW - TAIL;

  for (let t = 0; t < WINDOW; t++) {
    s = stepFactory(layout, mm, s);
    const inTail = t >= tailBegin;
    if (t === tailBegin) tailStartProduced = s.produced.length;
    if (inTail) {
      for (const u of s.units) {
        if (u.machineId !== null) {
          busy.set(u.machineId, (busy.get(u.machineId) ?? 0) + 1);
        }
      }
    }
  }

  const tailTicks = WINDOW - tailBegin;
  const producedInTail = s.produced.length - tailStartProduced;

  // Reduced rational producedInTail / tailTicks.
  let num = producedInTail;
  let den = tailTicks;
  const g = gcd(num, den);
  num = num / g;
  den = den / g;
  if (num === 0) {
    num = 0;
    den = 1;
  }

  // Bottleneck = highest busy fraction; ties -> lowest id.
  let bottleneck: number | null = null;
  let bestBusy = 0;
  const ids = [...busy.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const b = busy.get(id) ?? 0;
    if (b > bestBusy) {
      bestBusy = b;
      bottleneck = id;
    }
  }
  // A machine is the line's bottleneck only if it is SATURATED — busy ~every tail tick
  // (it never idles waiting for input, allowing for the 1-tick handoff gap). If even the
  // busiest machine idles, the source/upstream limits the line ⇒ no machine bottleneck.
  if (bestBusy * 10 < tailTicks * 9) bottleneck = null;

  let bottleneckType: MachineTypeId | null = null;
  if (bottleneck !== null) {
    const m = layout.machines.find((mm2) => mm2.id === bottleneck);
    bottleneckType = m?.def.typeId ?? null;
  }

  return { rateNum: num, rateDen: den, bottleneck, bottleneckType };
};
