import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  type FactoryLayout,
  type FactoryTile,
} from "../sim/phase0_interfaces";
import {
  copyFactoryTile,
  directGestureMachineAt,
  factoryErasePreviewCells,
  factoryHotkeyTargetConsumesKey,
  factoryResetPlaybackAfterClose,
  facilityMayAnalyzeOutcome,
  facilityOutcomeMap,
  formatFacilityOutcome,
  initialFacilityLayout,
  machineTooltip,
  paintBeltRoute,
  placeFactoryTile,
  previewProductionBuildCost,
  requestFactoryLayoutChange,
  transformPlacedMachine,
} from "./Factory";

describe("facility workspace initialization", () => {
  it("starts a facility as an empty entitled floor without auto-packing a recipe", () => {
    const layout = initialFacilityLayout(null, 24, 12);

    expect(layout.width).toBe(24);
    expect(layout.height).toBe(12);
    expect(layout.machines).toEqual([]);
    expect(layout.tiles).toHaveLength(24 * 12);
    expect(layout.tiles.every((tile) => tile.kind === "empty")).toBe(true);
  });

  it("states machine speed and per-unit processing cost in its tooltip", () => {
    expect(machineTooltip(DEFAULT_CATALOG[0]!)).toBe(
      "Hook pump · 2 ticks/unit · Processing $2/unit",
    );
  });
});

describe("Production placement cost preview", () => {
  it("shows no price in Pilot and the exact paid delta in Production", () => {
    const current = initialFacilityLayout(null, 4, 4);
    const proposed = {
      ...current,
      tiles: current.tiles.map((tile, index) => index === 0 ? { kind: "belt" as const, dir: 0 as const } : tile),
    };

    expect(previewProductionBuildCost("pilot", current, proposed)).toBeNull();
    expect(previewProductionBuildCost("production", current, proposed)).toBe(2);
    expect(previewProductionBuildCost("production", proposed, proposed)).toBeNull();
  });

  it("quotes the whole one-bend belt gesture instead of only its endpoint", () => {
    const current = initialFacilityLayout(null, 6, 6);
    const proposed = paintBeltRoute(current, [
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 },
      { x: 3, y: 2 }, { x: 3, y: 3 },
    ], 0);

    expect(previewProductionBuildCost("production", current, proposed)).toBe(10);
    expect(proposed.tiles[1 * proposed.width + 1]).toEqual({ kind: "belt", dir: 0 });
    expect(proposed.tiles[1 * proposed.width + 3]).toEqual({ kind: "belt", dir: 1 });
    expect(proposed.tiles[3 * proposed.width + 3]).toEqual({ kind: "belt", dir: 1 });
  });
});

describe("direct machine manipulation", () => {
  const placedLayout = (): FactoryLayout => {
    const base = initialFacilityLayout(null, 12, 10);
    const entry = DEFAULT_CATALOG[0]!;
    return {
      ...base,
      machines: [{
        id: 7,
        def: { typeId: entry.typeId, path: entry.path, cost: entry.cost, speed: entry.speed },
        anchor: { x: 2, y: 2 },
        footRot: 0,
        shape: DEFAULT_SHAPES[entry.typeId]!,
      }],
    };
  };

  it("moves a placed machine directly while preserving its identity", () => {
    const layout = placedLayout();
    const moved = transformPlacedMachine(layout, 7, { x: 6, y: 4 }, 0);

    expect(moved).not.toBe(layout);
    expect(moved.machines[0]).toMatchObject({ id: 7, anchor: { x: 6, y: 4 }, footRot: 0 });
  });

  it("rotates a placed machine and rejects occupied destinations atomically", () => {
    const layout = placedLayout();
    const rotated = transformPlacedMachine(layout, 7, { x: 2, y: 2 }, 1);
    expect(rotated.machines[0]).toMatchObject({ id: 7, anchor: { x: 2, y: 2 }, footRot: 1 });

    const blocked = {
      ...layout,
      tiles: layout.tiles.map((tile, index) => index === 5 * layout.width + 6
        ? { kind: "sink" as const }
        : tile),
    };
    expect(transformPlacedMachine(blocked, 7, { x: 6, y: 5 }, 0)).toBe(blocked);
  });

  it("lets touch Erase bypass direct-move capture while other tools select the machine", () => {
    const layout = placedLayout();

    expect(directGestureMachineAt(layout, 2, 2, false)?.id).toBe(7);
    expect(directGestureMachineAt(layout, 2, 2, true)).toBeUndefined();
  });

  it("skips machine cells when a belt gesture crosses their footprint", () => {
    const layout = placedLayout();
    const painted = paintBeltRoute(layout, [
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
    ], 0);

    expect(painted.machines).toEqual(layout.machines);
    expect(painted.tiles[2 * painted.width]).toEqual({ kind: "belt", dir: 0 });
    expect(painted.tiles[2 * painted.width + 1]).toEqual({ kind: "belt", dir: 0 });
    expect(painted.tiles[2 * painted.width + 2]).toEqual({ kind: "empty" });
    expect(painted.tiles[2 * painted.width + 3]).toEqual({ kind: "empty" });
    expect(painted.tiles[2 * painted.width + 4]).toEqual({ kind: "belt", dir: 0 });
  });

  it("previews the whole machine footprint before Erase removes it", () => {
    expect(factoryErasePreviewCells(placedLayout(), 2, 2)).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
    ]);
  });
});

describe("Factory clipboard tile payload", () => {
  const payloads: readonly FactoryTile[] = [
    { kind: "source", dir: 2, period: 7 },
    { kind: "splitter", inDir: 3, outDirs: [0, 1, 2] },
    { kind: "merger", inDirs: [0, 2, 3], outDir: 1 },
  ];

  it.each(payloads)("copies and pastes the exact $kind payload", (payload) => {
    const empty = initialFacilityLayout(null, 4, 4);
    const source = {
      ...empty,
      tiles: empty.tiles.map((tile, index) => index === 0 ? payload : tile),
    };

    const copied = copyFactoryTile(source, 0, 0);
    expect(copied).toEqual(payload);
    expect(copied).not.toBe(payload);
    const pasted = placeFactoryTile(source, 2, 2, copied!);
    expect(pasted.tiles[2 * pasted.width + 2]).toEqual(payload);
  });

  it("rejects non-erase tile placement on a machine footprint", () => {
    const base = initialFacilityLayout(null, 6, 6);
    const entry = DEFAULT_CATALOG[0]!;
    const layout: FactoryLayout = {
      ...base,
      machines: [{
        id: 3,
        def: { typeId: entry.typeId, path: entry.path, cost: entry.cost, speed: entry.speed },
        anchor: { x: 2, y: 2 },
        footRot: 0,
        shape: DEFAULT_SHAPES[entry.typeId]!,
      }],
    };

    expect(placeFactoryTile(layout, 2, 2, { kind: "belt", dir: 0 })).toBe(layout);
  });
});

describe("Factory layout commit acceptance", () => {
  it("does not request or accept no-op edits", () => {
    const layout = initialFacilityLayout(null, 4, 4);
    let requests = 0;

    expect(requestFactoryLayoutChange(layout, layout, () => {
      requests += 1;
      return true;
    })).toBe(false);
    expect(requests).toBe(0);
  });

  it("reports only an accepted authoritative edit as committed", () => {
    const current = initialFacilityLayout(null, 4, 4);
    const proposed = {
      ...current,
      tiles: current.tiles.map((tile, index) => index === 0
        ? { kind: "belt" as const, dir: 0 as const }
        : tile),
    };

    expect(requestFactoryLayoutChange(current, proposed, () => false)).toBe(false);
    expect(requestFactoryLayoutChange(current, proposed, () => true)).toBe(true);
  });

  it("resumes prior playback after cancel or rejection, but not after an accepted reset", () => {
    expect(factoryResetPlaybackAfterClose(true, "cancel", false)).toBe(true);
    expect(factoryResetPlaybackAfterClose(true, "rejected", false)).toBe(true);
    expect(factoryResetPlaybackAfterClose(true, "accepted", false)).toBe(false);
    expect(factoryResetPlaybackAfterClose(true, "cancel", true)).toBe(false);
    expect(factoryResetPlaybackAfterClose(false, "rejected", false)).toBe(false);
  });
});

describe("Factory hotkey focus routing", () => {
  it("reserves every key for text entry but only native activation keys for controls", () => {
    expect(factoryHotkeyTargetConsumesKey("text", "r")).toBe(true);
    expect(factoryHotkeyTargetConsumesKey("control", "Enter")).toBe(true);
    expect(factoryHotkeyTargetConsumesKey("control", " ")).toBe(true);
    expect(factoryHotkeyTargetConsumesKey("control", "r")).toBe(false);
    expect(factoryHotkeyTargetConsumesKey("control", "q")).toBe(false);
    expect(factoryHotkeyTargetConsumesKey("control", "2")).toBe(false);
    expect(factoryHotkeyTargetConsumesKey("world", " ")).toBe(false);
  });
});

describe("facility sample visibility", () => {
  it("uses only the fog-masked planning map for Pilot outcome analysis", () => {
    const authoritative = { maps: [] };
    const planning = { maps: [] };

    expect(facilityOutcomeMap("pilot", planning)).toBe(planning);
    expect(facilityOutcomeMap("pilot", planning)).not.toBe(authoritative);
    expect(facilityOutcomeMap("production", planning)).toBeNull();
  });

  it("evaluates zero-time Pilot samples but leaves Production to its live metrics", () => {
    expect(facilityMayAnalyzeOutcome("pilot", 1)).toBe(true);
    expect(facilityMayAnalyzeOutcome("pilot", 0)).toBe(false);
    expect(facilityMayAnalyzeOutcome("production", 1)).toBe(false);
  });

  it("reports useful Pilot effects without raw ids or provisional coordinates", () => {
    expect(formatFacilityOutcome({
      failed: false,
      final: [{ x: 2, y: -1 }],
      cured: [7],
      sideEffects: [200, 201],
    })).toBe("Cure Disease 8 · 2 side effects");

    expect(formatFacilityOutcome({
      failed: false,
      final: [{ x: 4, y: 3 }],
      cured: [],
      sideEffects: [202],
    })).toBe("No cure · 1 side effect");
  });
});
