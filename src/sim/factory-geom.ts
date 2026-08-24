/**
 * HexaPharma — shared factory geometry (pure, deterministic).
 *
 * Single source of truth for resolving a PlacedMachine's LOCAL shape into WORLD
 * coordinates. The sim (src/sim/factory-sim) and the renderer (src/render) both
 * import these so the placement math is never duplicated.
 *
 * Convention (axial hex grid, Dir 0=E 1=SE 2=SW 3=W 4=NW 5=NE): a footprint is rotated
 * `footRot` 60° turns clockwise about the anchor, then
 * translated by `anchor`. A port's facing side rotates with it: worldSide =
 * (localSide + footRot) % 6. Integers only; no randomness, no wall-clock.
 */
import type { Dir, Vec2, Rotation, PlacedMachine } from "./phase0_interfaces";
import { rotateHexCoord } from "./hex";

/** A port resolved into world coordinates. */
export interface WorldPort {
  readonly q: number;
  readonly r: number;
  readonly side: Dir;
}

/** Rotate a LOCAL axial vector `rot` 60° turns clockwise. */
export function rotateVec(v: Vec2, rot: Rotation): Vec2 {
  return rotateHexCoord(v, rot);
}

/** Resolve one LOCAL cell into world coordinates for a placed machine. */
export function worldCell(m: PlacedMachine, c: Vec2): Vec2 {
  const r = rotateVec(c, m.footRot);
  return { q: r.q + m.anchor.q, r: r.r + m.anchor.r };
}

/** Resolve one LOCAL port into a world port for a placed machine. */
export function worldPort(m: PlacedMachine, cell: Vec2, side: Dir): WorldPort {
  const c = worldCell(m, cell);
  return { q: c.q, r: c.r, side: ((side + m.footRot) % 6) as Dir };
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
