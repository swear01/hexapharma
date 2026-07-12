import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Dir,
  FactoryLayout,
  Machine,
  PlacedMachine,
  Rotation,
  Template,
} from "../sim/phase0_interfaces";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
} from "../sim/phase0_interfaces";
import {
  compileEntitledPrototype,
  compilePrototype,
  type PrototypePlacement,
} from "../sim/recipe";
import { worldCells } from "../sim/factory-geom";
import { MachineIcon } from "./MachineIcon";

const ARROW: Readonly<Record<Dir, string>> = { 0: "→", 1: "↓", 2: "←", 3: "↑" };

export interface PilotPrototype {
  readonly placements: readonly PrototypePlacement[];
  readonly layout: FactoryLayout;
}

export function buildInitialPrototype(
  template: Template,
  width = BASE_GAME_FACTORY_WIDTH,
  height = BASE_GAME_FACTORY_HEIGHT,
): PilotPrototype {
  return compileEntitledPrototype(template, width, height);
}

export interface PilotBuildResult {
  readonly prototype: PilotPrototype | null;
  readonly error: string | null;
}

export function tryBuildInitialPrototype(
  template: Template,
  width = BASE_GAME_FACTORY_WIDTH,
  height = BASE_GAME_FACTORY_HEIGHT,
): PilotBuildResult {
  try {
    return { prototype: buildInitialPrototype(template, width, height), error: null };
  } catch (error) {
    return {
      prototype: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function machineAt(layout: FactoryLayout, x: number, y: number): PlacedMachine | undefined {
  for (const machine of layout.machines) {
    if (worldCells(machine).some((cell) => cell.x === x && cell.y === y)) return machine;
  }
  return undefined;
}

function machineFromPlaced(placed: PlacedMachine): Machine {
  return {
    typeId: placed.def.typeId,
    transform: placed.def.transform,
    orientation: placed.def.orientation,
  };
}

interface PilotBenchProps {
  readonly template: Template;
  readonly width: number;
  readonly height: number;
  readonly onLayoutChange: (layout: FactoryLayout | null) => void;
}

export function PilotBench({ template, width, height, onLayoutChange }: PilotBenchProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(
    () => tryBuildInitialPrototype(template, width, height),
    [height, template, width],
  );
  const [prototype, setPrototype] = useState<PilotPrototype | null>(initial.prototype);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState("Select a machine, then choose a grid cell to move it.");

  useEffect(() => {
    setPrototype(initial.prototype);
    setSelected(null);
    setMessage(initial.error ?? "Prototype rebuilt from the current effect sequence.");
    onLayoutChange(initial.prototype?.layout ?? null);
    const scroll = scrollRef.current;
    if (scroll !== null) {
      scroll.scrollTop = Math.max(0, Math.floor(height / 2) * 40 - scroll.clientHeight / 2 + 20);
      scroll.scrollLeft = 0;
    }
  }, [initial, onLayoutChange]);

  function commit(nextPlacements: readonly PrototypePlacement[], success: string): void {
    if (prototype === null) return;
    try {
      const layout = compilePrototype(
        template,
        prototype.layout.width,
        prototype.layout.height,
        nextPlacements,
      );
      const next = { placements: nextPlacements, layout };
      setPrototype(next);
      onLayoutChange(layout);
      setMessage(success);
    } catch (error) {
      onLayoutChange(null);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function placeAt(x: number, y: number): void {
    if (prototype === null) return;
    const occupied = machineAt(prototype.layout, x, y);
    if (occupied !== undefined) {
      setSelected(occupied.id);
      setMessage(`Machine ${occupied.id + 1} selected. Choose its new anchor cell.`);
      return;
    }
    if (selected === null) return;
    const next = prototype.placements.map((placement, index): PrototypePlacement =>
      index === selected ? { ...placement, anchor: { x, y } } : placement,
    );
    commit(next, `Machine ${selected + 1} moved; belts rerouted on the pilot bench.`);
  }

  function rotateSelected(): void {
    if (selected === null || prototype === null) return;
    const next = prototype.placements.map((placement, index): PrototypePlacement =>
      index === selected
        ? { ...placement, footRot: ((placement.footRot + 1) & 3) as Rotation }
        : placement,
    );
    commit(next, `Machine ${selected + 1} footprint rotated; chemical effect stayed locked.`);
  }

  function autoArrange(): void {
    if (initial.prototype === null) return;
    setPrototype(initial.prototype);
    setSelected(null);
    onLayoutChange(initial.prototype.layout);
    setMessage("Prototype auto-arranged into a valid source-to-analyzer line.");
  }

  return (
    <section className="pilot-bench" aria-label="Pilot Bench" data-testid="pilot-bench">
      <header className="pilot-bench-header">
        <div>
          <strong>Pilot Bench</strong>
          <span>{width}×{height} · exact Factory footprint</span>
        </div>
        <div className="pilot-bench-actions">
          <button type="button" onClick={rotateSelected} disabled={selected === null} data-testid="pilot-rotate">↻ Rotate footprint</button>
          <button type="button" onClick={autoArrange} disabled={initial.prototype === null}>Auto arrange</button>
        </div>
      </header>
      {prototype === null ? (
        <div className="pilot-build-error" role="alert">The current recipe does not fit this Pilot Bench.</div>
      ) : <div className="pilot-scroll" ref={scrollRef}>
        <div
          className="pilot-grid"
          style={{ gridTemplateColumns: `repeat(${prototype.layout.width}, 40px)` }}
        >
          {prototype.layout.tiles.map((tile, index) => {
            const x = index % prototype.layout.width;
            const y = Math.floor(index / prototype.layout.width);
            const machine = machineAt(prototype.layout, x, y);
            const isAnchor = machine?.anchor.x === x && machine.anchor.y === y;
            const machineSelected = machine?.id === selected;
            const tileLabel = tile.kind === "source"
              ? "◆"
              : tile.kind === "sink"
                ? "◎"
                : tile.kind === "belt"
                  ? ARROW[tile.dir]
                  : tile.kind === "splitter"
                    ? "Y"
                    : tile.kind === "merger"
                      ? "⋈"
                      : "";
            return (
              <button
                key={index}
                type="button"
                className={`pilot-cell pilot-${tile.kind}${x % 5 === 4 ? " is-major-column" : ""}${machine === undefined ? "" : " has-machine"}${machineSelected ? " is-selected" : ""}`}
                aria-label={machine === undefined
                  ? `Pilot cell ${x},${y} ${tile.kind}`
                  : `Machine ${machine.id + 1} ${machine.def.typeId} at ${x},${y}`}
                onClick={() => placeAt(x, y)}
                data-x={x}
                data-y={y}
              >
                {isAnchor && machine !== undefined
                  ? <MachineIcon {...machineFromPlaced(machine)} size={22} />
                  : machine === undefined ? tileLabel : ""}
              </button>
            );
          })}
        </div>
      </div>}
      <output className="pilot-message" role="status">{message}</output>
    </section>
  );
}
