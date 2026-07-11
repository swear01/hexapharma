import type {
  Dir,
  Vec2,
  Rotation,
  DrugState,
  DiseaseId,
  SideEffectId,
  MultiMap,
  Outcome,
  FactoryTile,
  FactoryLayout,
  PlacedMachine,
  FactoryMachineDef,
  Machine,
  MachineShape,
  CompileTemplateFn,
  FactoryOutcomeFn,
} from "../phase0_interfaces";
import {
  CellKind,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  MAX_FACTORY_REPLAY_TICKS,
  MAX_TEMPLATE_STEPS,
} from "../phase0_interfaces";
import { worldCells, worldInPorts, worldOutPorts } from "../factory-geom";
import {
  initFactory,
  requireFactoryAnalysisBudget,
  snapshotProducedEvents,
  stepFactory,
} from "../factory-sim";

// ════════════════════════════════ recipe ════════════════════════════════
//
// compileTemplate realizes a Template as a REAL-shaped, belt-routed production
// line: source → m0 → m1 → … → m_{k-1} → sink. Each machine keeps its canonical
// footprint (DEFAULT_SHAPES[typeId]) and is normalized so its FIRST input port
// faces WEST, then the machines are packed left→right on a roomy canvas (with
// generous vertical margin for belt bends). Belts are then carved by a deterministic
// BFS over free cells, connecting source→m0.in, each m_i.out→m_{i+1}.in, and
// m_last.out→sink.
//
// The effect-determining drug orientation lives in each machine's `def.orientation`
// and is INDEPENDENT of `footRot` (packing only) — so the shaped packing + belt
// routing preserve the cure exactly (INV-7). factoryOutcome runs the layout via
// the fixed-capacity runtime until a unit reaches the sink, then reads its final DrugState into
// a cure/side-effect/failure Outcome.

const E: Dir = 0;
const S: Dir = 1;
const W: Dir = 2;
const N: Dir = 3;

// Deterministic neighbour scan order for the BFS router (y-down grid).
const DIR_DX: readonly number[] = [1, 0, -1, 0]; // E S W N
const DIR_DY: readonly number[] = [0, 1, 0, -1];
const SCAN: readonly Dir[] = [E, S, W, N];

function catalogEntry(typeId: string) {
  for (const entry of DEFAULT_CATALOG) {
    if (entry.typeId === typeId) return entry;
  }
  throw new Error(`compileTemplate: unknown machine type "${typeId}"`);
}

function shapeOf(typeId: string): MachineShape {
  const shape = DEFAULT_SHAPES[typeId];
  if (shape === undefined) throw new Error(`compileTemplate: unknown machine shape "${typeId}"`);
  return shape;
}

function defOf(step: Machine): FactoryMachineDef {
  const entry = catalogEntry(step.typeId);
  const transform = step.transform.kind === "translate"
    ? {
        kind: "translate" as const,
        delta: { x: step.transform.delta.x, y: step.transform.delta.y },
        relation: step.transform.relation,
      }
    : step.transform.kind === "scale"
      ? { kind: "scale" as const, num: step.transform.num, den: step.transform.den }
      : { kind: "swap" as const, a: step.transform.a, b: step.transform.b };
  return {
    typeId: step.typeId,
    transform,
    orientation: { rot: step.orientation.rot, flip: step.orientation.flip },
    cost: entry.cost,
    speed: entry.speed,
  };
}

/**
 * Choose the footRot (0..3) that points the shape's FIRST input port WEST so the
 * machine reads input from the belt approaching from the west. Falls back to 0.
 */
function normalizeFootRot(def: FactoryMachineDef, shape: MachineShape): Rotation {
  for (let r = 0 as Rotation; r < 4; r = (r + 1) as Rotation) {
    const probe: PlacedMachine = { id: 0, def, anchor: { x: 0, y: 0 }, footRot: r, shape };
    const inp = worldInPorts(probe)[0];
    if (inp !== undefined && inp.side === W) return r;
  }
  return 0 as Rotation;
}

/** Local (anchor-at-0) world geometry of a machine at a given footRot. */
interface LocalGeom {
  readonly cells: readonly Vec2[];
  readonly inPort: { readonly x: number; readonly y: number; readonly side: Dir };
  readonly outPort: { readonly x: number; readonly y: number; readonly side: Dir };
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function localGeom(def: FactoryMachineDef, shape: MachineShape, footRot: Rotation): LocalGeom {
  const probe: PlacedMachine = { id: 0, def, anchor: { x: 0, y: 0 }, footRot, shape };
  const cells = worldCells(probe);
  const inPort = worldInPorts(probe)[0] ?? { x: 0, y: 0, side: W };
  const outPort = worldOutPorts(probe)[0] ?? { x: 0, y: 0, side: E };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { cells, inPort, outPort, minX, minY, maxX, maxY };
}

const at = (w: number, x: number, y: number): number => y * w + x;

/**
 * BFS over free cells from `start` to `goal` (4-connected, fixed scan order E,S,W,N).
 * `blocked[idx]` marks cells the path may NOT enter (machine cells, the source, the
 * sink, already-laid belts). `start` and `goal` are assumed walkable (callers pass
 * approach/exit cells that are free). Returns the cell path inclusive, or null.
 */
function bfsPath(
  width: number,
  height: number,
  blocked: Uint8Array,
  start: Vec2,
  goal: Vec2,
): Vec2[] | null {
  if (start.x === goal.x && start.y === goal.y) return [start];
  const total = width * height;
  const prev = new Int32Array(total).fill(-1);
  const seen = new Uint8Array(total);
  const startIdx = at(width, start.x, start.y);
  const goalIdx = at(width, goal.x, goal.y);
  const queue: number[] = [startIdx];
  seen[startIdx] = 1;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++]!;
    if (cur === goalIdx) break;
    const cx = cur % width;
    const cy = (cur - cx) / width;
    for (const d of SCAN) {
      const nx = cx + (DIR_DX[d] ?? 0);
      const ny = cy + (DIR_DY[d] ?? 0);
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const ni = at(width, nx, ny);
      if (seen[ni]) continue;
      if (ni !== goalIdx && blocked[ni]) continue;
      seen[ni] = 1;
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  if (!seen[goalIdx]) return null;
  const path: Vec2[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    const cx = cur % width;
    path.push({ x: cx, y: (cur - cx) / width });
    if (cur === startIdx) break;
    cur = prev[cur]!;
  }
  path.reverse();
  return path;
}

interface Placed {
  readonly machine: PlacedMachine;
  readonly inPortCell: Vec2; // the world cell of the (first) input port
  readonly inPortSide: Dir; // the world side that port faces (units enter from here)
  readonly inApproach: Vec2; // free cell just outside the input port (belt arrives here)
  readonly inMoveDir: Dir; // direction a unit moves to enter the input port
  readonly outExit: Vec2; // free cell just outside the output port (belt leaves here)
  readonly outSide: Dir; // the world side the output port faces (units leave toward here)
}

export const compileTemplate: CompileTemplateFn = (template) => {
  if (!Array.isArray(template.steps) || template.steps.length > MAX_TEMPLATE_STEPS) {
    throw new Error(`compileTemplate: recipe must not exceed ${MAX_TEMPLATE_STEPS} steps`);
  }
  const k = template.steps.length;

  // ── 1. Normalize each machine's footRot (first input port faces W) + measure it.
  const geoms: { def: FactoryMachineDef; shape: MachineShape; footRot: Rotation; g: LocalGeom }[] =
    [];
  let maxBelow = 0; // cells extending below the spine (input-port) row, across all machines
  let maxAbove = 0; // cells extending above it
  for (let i = 0; i < k; i++) {
    const step = template.steps[i]!;
    const shape = shapeOf(step.typeId);
    const def = defOf(step);
    const footRot = normalizeFootRot(def, shape);
    const g = localGeom(def, shape, footRot);
    // spine row = the input-port row (g.inPort.y). Track vertical reach around it.
    const below = g.maxY - g.inPort.y;
    const above = g.inPort.y - g.minY;
    if (below > maxBelow) maxBelow = below;
    if (above > maxAbove) maxAbove = above;
    geoms.push({ def, shape, footRot, g });
  }

  // ── 2. Size a roomy canvas. The spine row carries the source, the machines' first
  //   input ports and the sink. We give margin BELOW the spine (shear/L outputs face
  //   south) and only as much ABOVE as some footprint actually needs — so an all-single-
  //   row line (the common case) stays on the top rows and packs tightly.
  //   Horizontal: source col + per-machine (footprint width + 1 routing belt) + sink slack.
  const ROUTE_GAP = 1; // free column(s) reserved between consecutive machines for a belt
  let spanX = 1; // source column (m0's input port sits directly east of it — direct feed)
  geoms.forEach(({ g }, i) => {
    spanX += g.maxX - g.minX + 1; // footprint width
    if (i < k - 1) spanX += ROUTE_GAP; // a routing belt between machines
  });
  spanX += 2; // belt before the sink + the sink column
  const width = Math.max(spanX, 3);
  const marginBelow = 1;
  const spineY = maxAbove; // first row that fits every footprint's reach above the port
  const height = spineY + maxBelow + marginBelow + 1;

  const tiles: FactoryTile[] = [];
  for (let cell = 0; cell < width * height; cell++) tiles.push({ kind: "empty" });
  // blocked = cells no belt may be carved through (machines, source, sink, laid belts).
  const blocked = new Uint8Array(width * height);

  // ── 3. Place machines left→right on the spine; record approach/exit cells.
  //   m0's input port is anchored directly EAST of the source so the source feeds it with
  //   no belt; subsequent machines leave one routing column before them.
  const placed: Placed[] = [];
  let cursorX = 1; // m0's leftmost footprint column (col 0 = source)
  for (let i = 0; i < k; i++) {
    const { def, shape, footRot, g } = geoms[i]!;
    // Anchor so the footprint's left edge sits at cursorX and the input port is on spineY.
    const anchor: Vec2 = { x: cursorX - g.minX, y: spineY - g.inPort.y };
    const machine: PlacedMachine = { id: i, def, anchor, footRot, shape };
    for (const wc of worldCells(machine)) blocked[at(width, wc.x, wc.y)] = 1;

    const inp = worldInPorts(machine)[0]!;
    const outp = worldOutPorts(machine)[0]!;
    const inApproach: Vec2 = {
      x: inp.x + (DIR_DX[inp.side] ?? 0),
      y: inp.y + (DIR_DY[inp.side] ?? 0),
    };
    const inMoveDir = ((inp.side + 2) & 3) as Dir; // move opposite the port's facing side
    const outExit: Vec2 = {
      x: outp.x + (DIR_DX[outp.side] ?? 0),
      y: outp.y + (DIR_DY[outp.side] ?? 0),
    };
    placed.push({
      machine,
      inPortCell: { x: inp.x, y: inp.y },
      inPortSide: inp.side,
      inApproach,
      inMoveDir,
      outExit,
      outSide: outp.side,
    });

    cursorX += g.maxX - g.minX + 1 + ROUTE_GAP;
  }

  // Helper to lay a belt at a cell pointing `dir` (and mark it blocked for later paths).
  function layBelt(x: number, y: number, dir: Dir): void {
    tiles[at(width, x, y)] = { kind: "belt", dir };
    blocked[at(width, x, y)] = 1;
  }

  // ── 4. Source + sink placement.
  //   Source sits at the west end of the spine and emits EAST directly into m0's input
  //   port (which is anchored at col 1). The sink sits at the far-right of the spine.
  const source: Vec2 = { x: 0, y: spineY };
  tiles[at(width, source.x, source.y)] = { kind: "source", dir: E, period: 1 };
  blocked[at(width, source.x, source.y)] = 1;
  const sink: Vec2 = { x: width - 1, y: spineY };
  tiles[at(width, sink.x, sink.y)] = { kind: "sink" };
  blocked[at(width, sink.x, sink.y)] = 1;

  // ── 5. Route belts with BFS, in order: source→m0.in, m_i.out→m_{i+1}.in, m_last.out→sink.
  //   We carve a path of free cells then orient each belt toward its successor; the final
  //   path cell is the destination's target (an input approach, or the sink itself).
  //   `from`/`to` are temporarily un-blocked so BFS can use them as endpoints.
  //   `routeFinalDir` is the direction the LAST laid belt must point — used only when the
  //   final path cell is a machine-input approach (it points into the port); for the sink
  //   the sink cell is the path's tail and is skipped, so the cell before it already points
  //   at the sink via dirBetween.
  let routeFinalDir: Dir = E;
  function routeAndLay(from: Vec2, to: Vec2): void {
    const wasFromBlocked = blocked[at(width, from.x, from.y)] ?? 0;
    const wasToBlocked = blocked[at(width, to.x, to.y)] ?? 0;
    blocked[at(width, from.x, from.y)] = 0;
    blocked[at(width, to.x, to.y)] = 0;
    const path = bfsPath(width, height, blocked, from, to);
    blocked[at(width, from.x, from.y)] = wasFromBlocked;
    blocked[at(width, to.x, to.y)] = wasToBlocked;
    if (path === null) {
      throw new Error(
        `compileTemplate: no belt route ${from.x},${from.y} -> ${to.x},${to.y} ` +
          `(width=${width} height=${height})`,
      );
    }
    // Lay a belt on every path cell, each pointing toward the next path cell. The last
    // cell points at the destination — its neighbour is the machine input port or sink,
    // so it must point that way too (computed from the segment's declared `to → target`).
    for (let p = 0; p < path.length; p++) {
      const c = path[p]!;
      // Never overwrite the source or sink tiles.
      if ((c.x === source.x && c.y === source.y) || (c.x === sink.x && c.y === sink.y)) continue;
      const nxt = path[p + 1];
      const dir = nxt !== undefined ? dirBetween(c, nxt) : routeFinalDir;
      layBelt(c.x, c.y, dir);
    }
  }

  const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
  const opp = (d: Dir): Dir => ((d + 2) & 3) as Dir;

  if (k === 0) {
    // No machines: route belts source → sink (source's E-neighbour starts the run).
    routeFinalDir = E;
    routeAndLay(source, sink);
  } else {
    const first = placed[0]!;
    // source → m0: direct feed when the source's E-neighbour IS m0's input port cell
    //   entered from the matching (W) side — no belt needed. Otherwise route belts.
    const directFeed =
      same({ x: source.x + 1, y: source.y }, first.inPortCell) && first.inPortSide === W;
    if (!directFeed) {
      routeFinalDir = first.inMoveDir;
      routeAndLay(source, first.inApproach);
    }
    for (let i = 0; i + 1 < k; i++) {
      const a = placed[i]!;
      const b = placed[i + 1]!;
      // direct port-to-port handoff: a's output port's neighbour IS b's input port cell,
      // entered from the matching side — adjacent machines need no belt between them.
      if (same(a.outExit, b.inPortCell) && opp(a.outSide) === b.inPortSide) continue;
      routeFinalDir = b.inMoveDir;
      routeAndLay(a.outExit, b.inApproach);
    }
    const last = placed[k - 1]!;
    // m_last → sink: direct when the output exit IS the sink cell (sinks accept any side).
    if (!same(last.outExit, sink)) {
      routeAndLay(last.outExit, sink);
    }
  }

  const machines: PlacedMachine[] = placed.map((p) => p.machine);
  return { width, height, tiles, machines };
};

/** The Dir to step from `a` to its 4-adjacent neighbour `b`. */
function dirBetween(a: Vec2, b: Vec2): Dir {
  if (b.x > a.x) return E;
  if (b.x < a.x) return W;
  if (b.y > a.y) return S;
  return N;
}

/** Read a final DrugState against the maps into an Outcome (mirrors drug-graph.evaluate). */
function outcomeOf(mm: MultiMap, drug: DrugState): Outcome {
  const finalPos = drug.pos;
  if (drug.failed) {
    return { failed: true, final: finalPos, cured: [], sideEffects: [] };
  }
  const cured: DiseaseId[] = [];
  const sideEffects: SideEffectId[] = [];
  for (let i = 0; i < mm.maps.length; i++) {
    const map = mm.maps[i];
    const p = finalPos[i];
    if (map === undefined || p === undefined) continue;
    const idx = p.y * map.width + p.x;
    const kind = map.cell[idx];
    if (kind === CellKind.Cure) {
      const id = map.cureId[idx];
      if (id !== undefined && id >= 0) cured.push(id);
    } else if (kind === CellKind.SideEffect) {
      const id = map.sideEffectId[idx];
      if (id !== undefined && id >= 0) sideEffects.push(id);
    }
  }
  return { failed: false, final: finalPos, cured, sideEffects };
}

/** Bounded first-product budget covering every carrier cell plus each machine's latency once. */
function tickCap(layout: FactoryLayout): number {
  let ticks = Math.min(MAX_FACTORY_REPLAY_TICKS, layout.width * layout.height + 16);
  for (const machine of layout.machines) {
    if (ticks > MAX_FACTORY_REPLAY_TICKS - machine.def.speed) {
      return MAX_FACTORY_REPLAY_TICKS;
    }
    ticks += machine.def.speed;
  }
  return ticks;
}

export const factoryOutcome: FactoryOutcomeFn = (layout, mm, start) => {
  const cap = tickCap(layout);
  requireFactoryAnalysisBudget(layout, cap, "factory outcome");
  const runtime = initFactory(layout, mm, start);
  for (let tick = 0; tick < cap; tick++) {
    stepFactory(layout, mm, runtime);
    if (runtime.producedEvents.count === 0) {
      if (runtime.deadlocked) {
        throw new Error("factory outcome: factory deadlocked before producing a product");
      }
      continue;
    }
    const first = snapshotProducedEvents(runtime)[0];
    if (first !== undefined) return outcomeOf(mm, first.drug);
  }
  throw new Error(`factory outcome: first-product replay budget exhausted after ${cap} ticks`);
};
