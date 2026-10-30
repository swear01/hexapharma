/**
 * Box selection, erase, move and paste for the Factory editor (pure, UI-side).
 *
 * A selection is the list of cells covered by whole items: every footprint cell of a selected
 * machine and every selected built tile. The clipboard is the same `factory-layout` payload a
 * Blueprint captures, cut down to the selected items.
 */
import { blueprintFromFactoryLayout, materializeFactoryLayout } from "../blueprint/format";
import { worldCells } from "../sim/factory-geom";
import { hexInBounds, hexIndex, rotateHexCoord } from "../sim/hex";
import type { Dir, FactoryLayout, FactoryTile, HexCoord, PlacedMachine, Rotation } from "../sim/phase0_interfaces";

export interface PlacedTile {
  readonly q: number;
  readonly r: number;
  readonly tile: FactoryTile;
}

export interface FactoryFragment {
  readonly tiles: readonly PlacedTile[];
  readonly machines: readonly PlacedMachine[];
}

export interface FactoryClipboard {
  /** The copied items, as a Blueprint `factory-layout` on the source floor. */
  readonly layout: FactoryLayout;
  /** The cell the held paste hangs from the cursor by (and rotates about). */
  readonly pivot: HexCoord;
}

/**
 * Floor cells whose centres lie in the screen-aligned box spanned by the centres of `a` and `b`,
 * widened by half a hex so a click covers exactly its cell. Works in half-hex-width units
 * (x = 2q + r), so it is exact integer math.
 */
export function boxCells(width: number, height: number, a: HexCoord, b: HexCoord): HexCoord[] {
  const minX = Math.min(2 * a.q + a.r, 2 * b.q + b.r) - 1;
  const maxX = Math.max(2 * a.q + a.r, 2 * b.q + b.r) + 1;
  const cells: HexCoord[] = [];
  for (let r = Math.max(0, Math.min(a.r, b.r)); r <= Math.min(height - 1, Math.max(a.r, b.r)); r++) {
    for (let q = Math.max(0, Math.ceil((minX - r) / 2)); q <= Math.min(width - 1, Math.floor((maxX - r) / 2)); q++) {
      cells.push({ q, r });
    }
  }
  return cells;
}

/** Whether an in-bounds `cell` is set in a per-cell mask of `layout`. */
function marked(layout: FactoryLayout, mask: Uint8Array, cell: HexCoord): boolean {
  return hexInBounds(layout.width, layout.height, cell.q, cell.r) && mask[hexIndex(layout.width, cell.q, cell.r)] === 1;
}

/** Every cell of the items `cells` touch: a machine counts whole, an empty cell not at all. */
export function itemCells(layout: FactoryLayout, cells: readonly HexCoord[]): HexCoord[] {
  const touched = new Uint8Array(layout.tiles.length);
  const isTouched = (cell: HexCoord) => marked(layout, touched, cell);
  for (const cell of cells) {
    if (hexInBounds(layout.width, layout.height, cell.q, cell.r)) touched[hexIndex(layout.width, cell.q, cell.r)] = 1;
  }
  const picked = new Uint8Array(layout.tiles.length);
  for (const machine of layout.machines) {
    const footprint = worldCells(machine);
    if (!footprint.some(isTouched)) continue;
    for (const cell of footprint) {
      if (hexInBounds(layout.width, layout.height, cell.q, cell.r)) picked[hexIndex(layout.width, cell.q, cell.r)] = 1;
    }
  }
  for (let index = 0; index < layout.tiles.length; index++) {
    if (touched[index] === 1 && layout.tiles[index]?.kind !== "empty") picked[index] = 1;
  }
  const result: HexCoord[] = [];
  for (let index = 0; index < picked.length; index++) {
    if (picked[index] === 1) result.push({ q: index % layout.width, r: Math.floor(index / layout.width) });
  }
  return result;
}

/** The selected items as a layout of the same floor; nothing else is built on it. */
export function selectionLayout(layout: FactoryLayout, cells: readonly HexCoord[]): FactoryLayout {
  const picked = new Uint8Array(layout.tiles.length);
  for (const cell of itemCells(layout, cells)) picked[hexIndex(layout.width, cell.q, cell.r)] = 1;
  return {
    width: layout.width,
    height: layout.height,
    tiles: layout.tiles.map((tile, index) => picked[index] === 1 ? tile : { kind: "empty" }),
    machines: layout.machines.filter((machine) => worldCells(machine).some((cell) => marked(layout, picked, cell))),
  };
}

/** Copy the selected items through the Blueprint capture; null when nothing is selected. */
export function copySelection(layout: FactoryLayout, cells: readonly HexCoord[]): FactoryClipboard | null {
  const covered = itemCells(layout, cells);
  if (covered.length === 0) return null;
  const captured = materializeFactoryLayout(blueprintFromFactoryLayout("Selection", selectionLayout(layout, covered)));
  return { layout: captured, pivot: centreCell(covered) };
}

/** The cell nearest the mean of non-empty `cells`. */
function centreCell(cells: readonly HexCoord[]): HexCoord {
  let q = 0;
  let r = 0;
  for (const cell of cells) {
    q += cell.q;
    r += cell.r;
  }
  return { q: Math.round(q / cells.length), r: Math.round(r / cells.length) };
}

/** Remove every item `cells` touch; the same layout when there is nothing to remove. */
export function eraseItems(layout: FactoryLayout, cells: readonly HexCoord[]): FactoryLayout {
  const covered = itemCells(layout, cells);
  if (covered.length === 0) return layout;
  const picked = new Uint8Array(layout.tiles.length);
  for (const cell of covered) picked[hexIndex(layout.width, cell.q, cell.r)] = 1;
  return {
    ...layout,
    tiles: layout.tiles.map((tile, index) => picked[index] === 1 ? { kind: "empty" } : tile),
    machines: layout.machines.filter((machine) => !worldCells(machine).some((cell) => marked(layout, picked, cell))),
  };
}

function turn(dir: Dir, rot: Rotation): Dir {
  return ((dir + rot) % 6) as Dir;
}

function rotateTile(tile: FactoryTile, rot: Rotation): FactoryTile {
  switch (tile.kind) {
    case "empty":
    case "sink":
      return { kind: tile.kind };
    case "belt":
      return { kind: "belt", dir: turn(tile.dir, rot) };
    case "splitter":
      return { kind: "splitter", inDir: turn(tile.inDir, rot), outDirs: tile.outDirs.map((dir) => turn(dir, rot)) };
    case "merger":
      return { kind: "merger", inDirs: tile.inDirs.map((dir) => turn(dir, rot)), outDir: turn(tile.outDir, rot) };
    case "source":
      return { kind: "source", dir: turn(tile.dir, rot), period: tile.period, base: tile.base };
  }
}

/** The items of `layout` turned `rot` sixth-turns clockwise about `pivot`, then moved so `pivot` lands on `at`. */
export function transformFragment(layout: FactoryLayout, pivot: HexCoord, at: HexCoord, rot: Rotation): FactoryFragment {
  const place = (cell: HexCoord): HexCoord => {
    const turned = rotateHexCoord({ q: cell.q - pivot.q, r: cell.r - pivot.r }, rot);
    return { q: at.q + turned.q, r: at.r + turned.r };
  };
  const tiles: PlacedTile[] = [];
  for (let index = 0; index < layout.tiles.length; index++) {
    const tile = layout.tiles[index]!;
    if (tile.kind === "empty") continue;
    tiles.push({ ...place({ q: index % layout.width, r: Math.floor(index / layout.width) }), tile: rotateTile(tile, rot) });
  }
  const machines = layout.machines.map((machine) => ({
    ...machine,
    anchor: place(machine.anchor),
    footRot: ((machine.footRot + rot) % 6) as Rotation,
  }));
  return { tiles, machines };
}

/** Cells a fragment covers. */
export function fragmentCells(fragment: FactoryFragment): HexCoord[] {
  return [...fragment.machines.flatMap((machine) => worldCells(machine)), ...fragment.tiles.map(({ q, r }) => ({ q, r }))];
}

/**
 * Build a fragment by the hand-placement rules: machines need empty in-bounds floor, tiles may
 * replace tiles but never sit on a machine. Null when any item is refused; the same layout when
 * nothing would change. `freshIds` numbers pasted machines after the layout's own.
 */
export function placeFragment(layout: FactoryLayout, fragment: FactoryFragment, freshIds: boolean): FactoryLayout | null {
  const underMachine = new Uint8Array(layout.tiles.length);
  let nextId = 0;
  for (const machine of layout.machines) {
    nextId = Math.max(nextId, machine.id + 1);
    for (const cell of worldCells(machine)) underMachine[hexIndex(layout.width, cell.q, cell.r)] = 1;
  }
  const machines = layout.machines.slice();
  for (const machine of fragment.machines) {
    for (const cell of worldCells(machine)) {
      if (!hexInBounds(layout.width, layout.height, cell.q, cell.r)) return null;
      const index = hexIndex(layout.width, cell.q, cell.r);
      if (underMachine[index] === 1 || layout.tiles[index]?.kind !== "empty") return null;
      underMachine[index] = 1;
    }
    machines.push(freshIds ? { ...machine, id: nextId++ } : machine);
  }
  const tiles = layout.tiles.slice();
  let changed = fragment.machines.length > 0;
  for (const { q, r, tile } of fragment.tiles) {
    if (!hexInBounds(layout.width, layout.height, q, r)) return null;
    const index = hexIndex(layout.width, q, r);
    if (underMachine[index] === 1) return null;
    if (JSON.stringify(tiles[index]) === JSON.stringify(tile)) continue;
    tiles[index] = tile;
    changed = true;
  }
  return changed ? { ...layout, tiles, machines } : layout;
}

/**
 * Move the selected items so the `from` cell lands on `to`, turned `rot`. The moved `fragment`
 * always comes back (it previews a refused move too); `layout` is null and `cells` empty when refused.
 */
export function moveSelection(
  layout: FactoryLayout,
  cells: readonly HexCoord[],
  from: HexCoord,
  to: HexCoord,
  rot: Rotation,
): { readonly fragment: FactoryFragment; readonly layout: FactoryLayout | null; readonly cells: HexCoord[] } {
  const fragment = transformFragment(selectionLayout(layout, cells), from, to, rot);
  if (from.q === to.q && from.r === to.r && rot === 0) return { fragment, layout, cells: itemCells(layout, cells) };
  const placed = placeFragment(eraseItems(layout, cells), fragment, false);
  // A turn that maps the items onto themselves (a lone Sink) must not commit a no-op undo step.
  // A pure shift never does, so a plain drag preview skips serializing the floor.
  const unchanged = placed !== null && rot !== 0 && JSON.stringify(placed) === JSON.stringify(layout);
  const moved = unchanged ? layout : placed;
  return { fragment, layout: moved, cells: moved === null ? [] : itemCells(moved, fragmentCells(fragment)) };
}

/** Turn the selected items `rot` sixth-turns clockwise in place, about the selection's centre cell. */
export function rotateSelection(layout: FactoryLayout, cells: readonly HexCoord[], rot: Rotation): ReturnType<typeof moveSelection> {
  const covered = itemCells(layout, cells);
  if (covered.length === 0) return { fragment: { tiles: [], machines: [] }, layout: null, cells: [] };
  const pivot = centreCell(covered);
  return moveSelection(layout, covered, pivot, pivot, rot);
}
