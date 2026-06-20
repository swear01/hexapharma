/**
 * HexaPharma — shared factory geometry (pure, deterministic).
 *
 * Single source of truth for resolving a PlacedMachine's LOCAL shape into WORLD
 * coordinates. The sim (src/sim/factory-sim) and the renderer (src/render) both
 * import these so the placement math is never duplicated.
 *
 * Convention (y-down square grid, Dir 0=E 1=S 2=W 3=N): a footprint is rotated
 * `footRot` quarter-turns CW about the anchor — each turn maps (x,y)->(-y,x) — then
 * translated by `anchor`. A port's facing side rotates with it: worldSide =
 * (localSide + footRot) & 3. Integers only; no randomness, no wall-clock.
 */
import type { Dir, Vec2, Rotation, PlacedMachine } from "./phase0_interfaces";

/** A port resolved into world coordinates. */
export interface WorldPort {
  readonly x: number;
  readonly y: number;
  readonly side: Dir;
}

/** Rotate a LOCAL vector `rot` quarter-turns CW (y-down): (x,y)->(-y,x). */
export function rotateVec(v: Vec2, rot: Rotation): Vec2 {
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

/** Resolve one LOCAL cell into world coordinates for a placed machine. */
export function worldCell(m: PlacedMachine, c: Vec2): Vec2 {
  const r = rotateVec(c, m.footRot);
  return { x: r.x + m.anchor.x, y: r.y + m.anchor.y };
}

/** Resolve one LOCAL port into a world port for a placed machine. */
export function worldPort(m: PlacedMachine, cell: Vec2, side: Dir): WorldPort {
  const c = worldCell(m, cell);
  return { x: c.x, y: c.y, side: ((side + m.footRot) & 3) as Dir };
}

/** Every footprint cell of a placed machine, in world coordinates. */
export function worldCells(m: PlacedMachine): Vec2[] {
  return m.shape.cells.map((c) => worldCell(m, c));
}

/** Every input port of a placed machine, in world coordinates. */
export function worldInPorts(m: PlacedMachine): WorldPort[] {
  return m.shape.inPorts.map((p) => worldPort(m, p.cell, p.side));
}

/** Every output port of a placed machine, in world coordinates. */
export function worldOutPorts(m: PlacedMachine): WorldPort[] {
  return m.shape.outPorts.map((p) => worldPort(m, p.cell, p.side));
}
