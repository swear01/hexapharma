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
  Template,
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

export interface PrototypePlacement {
  readonly anchor: Vec2;
  readonly footRot: Rotation;
}

export interface CompiledPrototype {
  readonly placements: readonly PrototypePlacement[];
  readonly layout: FactoryLayout;
}

function emptyFactoryTiles(width: number, height: number): FactoryTile[] {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 3 || height < 3) {
    throw new Error("compilePrototype: bench dimensions must be safe integers >= 3");
  }
  const tiles: FactoryTile[] = [];
  for (let cell = 0; cell < width * height; cell++) tiles.push({ kind: "empty" });
  return tiles;
}

function inside(width: number, height: number, point: Vec2): boolean {
  return point.x >= 0 && point.y >= 0 && point.x < width && point.y < height;
}

/**
 * Route a real pilot-bench prototype through player-owned machine anchors. The returned
 * layout is already a valid FactoryLayout and is transferred byte-for-byte to Factory;
 * no later packing pass is required.
 */
export function compilePrototype(
  template: Template,
  width: number,
  height: number,
  placements: readonly PrototypePlacement[],
): FactoryLayout {
  if (placements.length !== template.steps.length) {
    throw new Error("compilePrototype: every recipe step needs exactly one physical placement");
  }
  const tiles = emptyFactoryTiles(width, height);
  const blocked = new Uint8Array(width * height);
  const source: Vec2 = { x: 0, y: Math.floor(height / 2) };
  const sink: Vec2 = { x: width - 1, y: Math.floor(height / 2) };
  tiles[at(width, source.x, source.y)] = { kind: "source", dir: E, period: 1 };
  tiles[at(width, sink.x, sink.y)] = { kind: "sink" };
  blocked[at(width, source.x, source.y)] = 1;
  blocked[at(width, sink.x, sink.y)] = 1;

  const placed: Placed[] = [];
  for (let index = 0; index < template.steps.length; index++) {
    const step = template.steps[index]!;
    const placement = placements[index]!;
    const shape = shapeOf(step.typeId);
    const machine: PlacedMachine = {
      id: index,
      def: defOf(step),
      anchor: { x: placement.anchor.x, y: placement.anchor.y },
      footRot: placement.footRot,
      shape,
    };
    const cells = worldCells(machine);
    for (const cell of cells) {
      if (!inside(width, height, cell)) {
        throw new Error(`compilePrototype: machine ${index} extends outside the pilot bench`);
      }
      const cellIndex = at(width, cell.x, cell.y);
      if (blocked[cellIndex]) {
        throw new Error(`compilePrototype: machine ${index} overlaps another occupied cell`);
      }
      blocked[cellIndex] = 1;
    }
    const input = worldInPorts(machine)[0];
    const output = worldOutPorts(machine)[0];
    if (input === undefined || output === undefined) {
      throw new Error(`compilePrototype: machine ${index} needs an input and output port`);
    }
    const inApproach = {
      x: input.x + (DIR_DX[input.side] ?? 0),
      y: input.y + (DIR_DY[input.side] ?? 0),
    };
    const outExit = {
      x: output.x + (DIR_DX[output.side] ?? 0),
      y: output.y + (DIR_DY[output.side] ?? 0),
    };
    if (!inside(width, height, inApproach) || !inside(width, height, outExit)) {
      throw new Error(`compilePrototype: machine ${index} port faces outside the pilot bench`);
    }
    placed.push({
      machine,
      inPortCell: { x: input.x, y: input.y },
      inPortSide: input.side,
      inApproach,
      inMoveDir: ((input.side + 2) & 3) as Dir,
      outExit,
      outSide: output.side,
    });
  }

  function layBelt(x: number, y: number, dir: Dir): void {
    tiles[at(width, x, y)] = { kind: "belt", dir };
    blocked[at(width, x, y)] = 1;
  }
  let routeFinalDir: Dir = E;
  function routeAndLay(from: Vec2, to: Vec2): void {
    if (!inside(width, height, from) || !inside(width, height, to)) {
      throw new Error("compilePrototype: a route endpoint lies outside the pilot bench");
    }
    const fromIndex = at(width, from.x, from.y);
    const toIndex = at(width, to.x, to.y);
    const toIsSink = to.x === sink.x && to.y === sink.y;
    if (blocked[fromIndex]) {
      throw new Error(`compilePrototype: route start ${from.x},${from.y} is occupied`);
    }
    if (blocked[toIndex] && !toIsSink) {
      throw new Error(`compilePrototype: route end ${to.x},${to.y} is occupied`);
    }
    const wasToBlocked = blocked[toIndex] ?? 0;
    if (toIsSink) blocked[toIndex] = 0;
    const path = bfsPath(width, height, blocked, from, to);
    blocked[toIndex] = wasToBlocked;
    if (path === null) {
      throw new Error(
        `compilePrototype: no belt route ${from.x},${from.y} -> ${to.x},${to.y}`,
      );
    }
    for (let pathIndex = 0; pathIndex < path.length; pathIndex++) {
      const cell = path[pathIndex]!;
      if ((cell.x === source.x && cell.y === source.y) ||
          (cell.x === sink.x && cell.y === sink.y)) continue;
      const next = path[pathIndex + 1];
      layBelt(cell.x, cell.y, next === undefined ? routeFinalDir : dirBetween(cell, next));
    }
  }
  const same = (a: Vec2, b: Vec2): boolean => a.x === b.x && a.y === b.y;
  const opposite = (dir: Dir): Dir => ((dir + 2) & 3) as Dir;
  const sourceExit = { x: source.x + 1, y: source.y };
  if (placed.length === 0) {
    routeAndLay(sourceExit, sink);
  } else {
    const first = placed[0]!;
    if (!(same(sourceExit, first.inPortCell) && first.inPortSide === W)) {
      routeFinalDir = first.inMoveDir;
      routeAndLay(sourceExit, first.inApproach);
    }
    for (let index = 0; index + 1 < placed.length; index++) {
      const current = placed[index]!;
      const next = placed[index + 1]!;
      if (same(current.outExit, next.inPortCell) && opposite(current.outSide) === next.inPortSide) {
        continue;
      }
      routeFinalDir = next.inMoveDir;
      routeAndLay(current.outExit, next.inApproach);
    }
    const last = placed[placed.length - 1]!;
    if (!same(last.outExit, sink)) routeAndLay(last.outExit, sink);
  }
  const layout = { width, height, tiles, machines: placed.map((entry) => entry.machine) };
  const derived = derivePrototypeTemplate(layout);
  if (JSON.stringify(derived) !== JSON.stringify(template)) {
    throw new Error("compilePrototype: routed topology changed the submitted machine sequence");
  }
  return layout;
}

function machineStep(placed: PlacedMachine): Machine {
  return {
    typeId: placed.def.typeId,
    transform: placed.def.transform.kind === "translate"
      ? {
          kind: "translate",
          delta: { x: placed.def.transform.delta.x, y: placed.def.transform.delta.y },
          relation: placed.def.transform.relation,
        }
      : placed.def.transform.kind === "scale"
        ? { kind: "scale", num: placed.def.transform.num, den: placed.def.transform.den }
        : { kind: "swap", a: placed.def.transform.a, b: placed.def.transform.b },
    orientation: {
      rot: placed.def.orientation.rot,
      flip: placed.def.orientation.flip,
    },
  };
}

/**
 * Derive the effect recipe from one physical, acyclic source-to-sink prototype.
 * Pilot benches intentionally reject branches, mergers, loops, disconnected machines,
 * and ambiguous ports; those industrial concerns belong to Factory after transfer.
 */
export function derivePrototypeTemplate(layout: FactoryLayout): Template {
  let source: { readonly x: number; readonly y: number; readonly dir: Dir } | null = null;
  let sinks = 0;
  for (let index = 0; index < layout.tiles.length; index++) {
    const tile = layout.tiles[index];
    if (tile?.kind === "splitter" || tile?.kind === "merger") {
      throw new Error("pilot prototype: splitters and mergers are Factory-only");
    }
    if (tile?.kind === "source") {
      if (source !== null) throw new Error("pilot prototype: exactly one source is required");
      source = { x: index % layout.width, y: Math.floor(index / layout.width), dir: tile.dir };
    }
    if (tile?.kind === "sink") sinks++;
  }
  if (source === null || sinks !== 1) {
    throw new Error("pilot prototype: exactly one source and one analyzer sink are required");
  }

  const area = layout.width * layout.height;
  const inputOwner = new Int32Array(area * 4);
  const outputX = new Int32Array(layout.machines.length);
  const outputY = new Int32Array(layout.machines.length);
  const outputSide = new Int8Array(layout.machines.length);
  for (let slot = 0; slot < layout.machines.length; slot++) {
    const machine = layout.machines[slot]!;
    for (const port of worldInPorts(machine)) {
      if (port.x < 0 || port.y < 0 || port.x >= layout.width || port.y >= layout.height) {
        throw new Error("pilot prototype: machine input lies outside the bench");
      }
      const moveDir = ((port.side + 2) & 3) as Dir;
      const key = (at(layout.width, port.x, port.y) * 4) + moveDir;
      inputOwner[key] = inputOwner[key] === 0 ? slot + 1 : -1;
    }
    const outputs = worldOutPorts(machine);
    if (outputs.length !== 1) throw new Error("pilot prototype: each machine needs one output port");
    outputX[slot] = outputs[0]!.x;
    outputY[slot] = outputs[0]!.y;
    outputSide[slot] = outputs[0]!.side;
  }

  const steps: Machine[] = [];
  const usedMachines = new Uint8Array(layout.machines.length);
  const visited = new Uint8Array(area * 4);
  const visitedBelts = new Uint8Array(area);
  let usedMachineCount = 0;
  let x = source.x + (DIR_DX[source.dir] ?? 0);
  let y = source.y + (DIR_DY[source.dir] ?? 0);
  let moveDir = source.dir;
  const maxHops = layout.width * layout.height + layout.machines.length + 1;
  for (let hop = 0; hop < maxHops; hop++) {
    if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) {
      throw new Error("pilot prototype: route leaves the bench before reaching the analyzer");
    }
    const stateKey = (at(layout.width, x, y) * 4) + moveDir;
    if (visited[stateKey] === 1) throw new Error("pilot prototype: route contains a cycle");
    visited[stateKey] = 1;

    const owner = inputOwner[stateKey] ?? 0;
    if (owner < 0) throw new Error("pilot prototype: route has an ambiguous machine input");
    if (owner > 0) {
      const slot = owner - 1;
      const machine = layout.machines[slot]!;
      if (usedMachines[slot] === 1) throw new Error("pilot prototype: route revisits a machine");
      usedMachines[slot] = 1;
      usedMachineCount++;
      steps.push(machineStep(machine));
      moveDir = (outputSide[slot] ?? 0) as Dir;
      x = (outputX[slot] ?? 0) + (DIR_DX[moveDir] ?? 0);
      y = (outputY[slot] ?? 0) + (DIR_DY[moveDir] ?? 0);
      continue;
    }

    const cellIndex = at(layout.width, x, y);
    const tile = layout.tiles[cellIndex];
    if (tile?.kind === "sink") {
      if (usedMachineCount !== layout.machines.length) {
        throw new Error("pilot prototype: every placed machine must belong to the source-to-sink route");
      }
      for (let tileIndex = 0; tileIndex < layout.tiles.length; tileIndex++) {
        if (layout.tiles[tileIndex]?.kind === "belt" && visitedBelts[tileIndex] !== 1) {
          throw new Error("pilot prototype: every belt must belong to the source-to-sink route");
        }
      }
      return { steps };
    }
    if (tile?.kind !== "belt") {
      throw new Error("pilot prototype: route is broken before reaching the analyzer");
    }
    visitedBelts[cellIndex] = 1;
    moveDir = tile.dir;
    x += DIR_DX[moveDir] ?? 0;
    y += DIR_DY[moveDir] ?? 0;
  }
  throw new Error("pilot prototype: route exceeds the acyclic traversal bound");
}

function straightPrototypePlacements(
  machines: readonly PlacedMachine[],
  width: number,
  height: number,
): readonly PrototypePlacement[] | null {
  const occupied = new Uint8Array(width * height);
  const placements: PrototypePlacement[] = [];
  let nextInput: Vec2 = { x: 1, y: Math.floor(height / 2) };
  for (const packed of machines) {
    const probe = { ...packed, anchor: { x: 0, y: 0 }, footRot: 0 as Rotation };
    const input = worldInPorts(probe)[0];
    const output = worldOutPorts(probe)[0];
    if (input === undefined || output === undefined || input.side !== W || output.side !== E) {
      return null;
    }
    const anchor = { x: nextInput.x - input.x, y: nextInput.y - input.y };
    const placed = { ...probe, anchor };
    for (const cell of worldCells(placed)) {
      if (
        cell.x < 1 || cell.y < 0 || cell.x >= width - 1 || cell.y >= height ||
        occupied[at(width, cell.x, cell.y)] === 1
      ) {
        return null;
      }
      occupied[at(width, cell.x, cell.y)] = 1;
    }
    placements.push({ anchor, footRot: 0 });
    nextInput = { x: anchor.x + output.x + 1, y: anchor.y + output.y };
  }
  return nextInput.x < width ? placements : null;
}

/** Deterministically straight-pack when possible, then snake-pack the exact entitled floor. */
export function compileEntitledPrototype(
  template: Template,
  width: number,
  height: number,
): CompiledPrototype {
  const packed = compileTemplate(template);
  const straight = straightPrototypePlacements(packed.machines, width, height);
  if (straight !== null) {
    return { placements: straight, layout: compilePrototype(template, width, height, straight) };
  }
  const portRows = [Math.floor(height / 2), 1, height - 2];
  const placements: PrototypePlacement[] = [];
  let rowIndex = 0;
  let cursorX = 1;
  for (let index = 0; index < packed.machines.length; index++) {
    const machine = packed.machines[index]!;
    const probe = { ...machine, anchor: { x: 0, y: 0 }, footRot: 0 as Rotation };
    const localCells = worldCells(probe);
    const localInput = worldInPorts(probe)[0];
    if (localInput === undefined) throw new Error(`compilePrototype: machine ${index} has no input port`);
    const minY = Math.min(...localCells.map((cell) => cell.y));
    const maxX = Math.max(...localCells.map((cell) => cell.x));
    const maxY = Math.max(...localCells.map((cell) => cell.y));
    let anchor = {
      x: cursorX - localInput.x,
      y: (portRows[rowIndex] ?? 0) - localInput.y,
    };
    if (
      anchor.x + maxX > width - 3 ||
      anchor.y + minY < 0 ||
      anchor.y + maxY >= height
    ) {
      rowIndex++;
      cursorX = 2;
      const portRow = portRows[rowIndex];
      if (portRow === undefined) {
        throw new Error("compilePrototype: entitlement cannot fit the machine sequence");
      }
      anchor = { x: cursorX - localInput.x, y: portRow - localInput.y };
    }
    if (
      anchor.x < 1 ||
      anchor.x + maxX > width - 3 ||
      anchor.y + minY < 0 ||
      anchor.y + maxY >= height
    ) {
      throw new Error("compilePrototype: entitlement cannot fit the machine sequence");
    }
    placements.push({ anchor, footRot: 0 });
    cursorX = anchor.x + maxX + 3;
  }
  const layout = compilePrototype(template, width, height, placements);
  const derived = derivePrototypeTemplate(layout);
  if (JSON.stringify(derived) !== JSON.stringify(template)) {
    throw new Error("compilePrototype: auto-arrangement changed the physical machine order");
  }
  return { placements, layout };
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
