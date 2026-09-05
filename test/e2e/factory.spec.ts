import { openMenu } from "./menu";
import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState, DEFAULT_STARTING_CASH } from "../../src/sim/game";
import { quoteProductionBuild } from "../../src/sim/construction";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { SAVE_VERSION, deserializeGame, deserializeGameAuthority, serializeGame } from "../../src/sim/save";
import { worldCells } from "../../src/sim/factory-geom";
import { hexDistance, hexIndex, type HexCoord } from "../../src/sim/hex";
import { hexBoardBounds, hexToPixel } from "../../src/render/hexProjection";
import { defaultGenOptions } from "../../src/ui/Game";
import { machineName } from "../../src/ui/machineLabels";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  type FactoryLayout,
  type FactoryTile,
  type PlacedMachine,
} from "../../src/sim/phase0_interfaces";

test.setTimeout(60_000);

const checkpointKey = `hexapharma.save.v${SAVE_VERSION}.checkpoint.0`;

function referenceLayout(seed = 14): FactoryLayout {
  const options = defaultGenOptions(seed);
  return compileEntitledPrototype(
    generate(options).diseases[0]!.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
}

function pilotSave(): string {
  let game = createGameState(defaultGenOptions(14), 10_000, 100);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout: referenceLayout() });
  return serializeGame(game);
}

function productionSave(): string {
  let game = createGameState(defaultGenOptions(14), 10_000, 100);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout: referenceLayout() });
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout: referenceLayout() });
  return serializeGame(game);
}

function zeroCashProductionSave(): string {
  const options = defaultGenOptions(14);
  const layout = referenceLayout();
  const priced = createGameState(options, 1_000_000, 100);
  const cost = quoteProductionBuild(priced.production.layout, layout);
  let game = createGameState(options, cost, 100);
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  if (game.economy.cash !== 0) throw new Error("zero-cash Production fixture did not spend its build budget");
  return serializeGame(game);
}

const clipboardPayloads = [
  { cell: { q: 8, r: 6 }, destination: { q: 8, r: 8 }, tile: { kind: "source" as const, dir: 2 as const, period: 7 } },
  { cell: { q: 10, r: 6 }, destination: { q: 10, r: 8 }, tile: { kind: "splitter" as const, inDir: 3 as const, outDirs: [0, 1, 2] as const } },
  { cell: { q: 12, r: 6 }, destination: { q: 12, r: 8 }, tile: { kind: "merger" as const, inDirs: [0, 2, 3] as const, outDir: 1 as const } },
];

function clipboardPayloadSave(): string {
  let game = createGameState(defaultGenOptions(14), 10_000, 100);
  const tiles: FactoryTile[] = Array.from(
    { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
    () => ({ kind: "empty" as const }),
  );
  for (const payload of clipboardPayloads) {
    tiles[hexIndex(BASE_GAME_FACTORY_WIDTH, payload.cell.q, payload.cell.r)] = payload.tile;
  }
  const layout: FactoryLayout = {
    width: BASE_GAME_FACTORY_WIDTH,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles,
    machines: [],
  };
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  return serializeGame(game);
}

function machineGallerySave(): string {
  const options = defaultGenOptions(14);
  const level = generate(options);
  let game = createGameState(options, 1_000_000, 100_000);
  game = applyGameIntent(game, { kind: "unlockPatent", id: "bench-2" });
  for (const [disease, id] of [
    [0, "skew-unlock"],
    [1, "dilute-unlock"],
    [2, "settle-unlock"],
  ] as const) {
    const layout = compileEntitledPrototype(
      level.diseases[disease]!.reference,
      game.production.layout.width,
      game.production.layout.height,
    ).layout;
    game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 400 });
    const productIds = game.inventory
      .filter((product) => product.outcome.cured.includes(disease))
      .slice(0, 3)
      .map((product) => product.inventoryId);
    if (productIds.length !== 3) throw new Error(`machine gallery could not complete Disease ${disease + 1}`);
    game = applyGameIntent(game, { kind: "sellProducts", productIds, disease });
    game = applyGameIntent(game, { kind: "unlockPatent", id });
  }
  const anchors = [
    { q: 1, r: 1 },
    { q: 5, r: 1 },
    { q: 11, r: 1 },
    { q: 15, r: 1 },
    { q: 1, r: 6 },
    { q: 7, r: 6 },
    { q: 13, r: 6 },
  ];
  const machines: PlacedMachine[] = DEFAULT_CATALOG.map((entry, index) => ({
    id: index,
    def: {
      typeId: entry.typeId,
      path: entry.path,
      cost: entry.cost,
      speed: entry.speed,
    },
    anchor: anchors[index]!,
    footRot: 0,
    shape: DEFAULT_SHAPES[entry.typeId]!,
  }));
  const width = BASE_GAME_FACTORY_WIDTH + 2;
  const layout: FactoryLayout = {
    width,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles: Array.from({ length: width * BASE_GAME_FACTORY_HEIGHT }, () => ({ kind: "empty" as const })),
    machines,
  };
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  return serializeGame(game);
}

async function loadLegacySave(
  page: import("@playwright/test").Page,
  blob: string,
): Promise<void> {
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), blob);
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

async function loadProduction(page: import("@playwright/test").Page): Promise<void> {
  await loadLegacySave(page, productionSave());
  await page.getByTestId("view-production").click();
}

async function factoryCellPoint(
  frame: import("@playwright/test").Locator,
  layout: FactoryLayout,
  cell: HexCoord,
): Promise<{ readonly x: number; readonly y: number }> {
  const canvas = frame.locator("canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Factory canvas has no bounds");
  const intrinsic = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  const bounds = hexBoardBounds(layout.width, layout.height, 21);
  const projected = hexToPixel(cell.q, cell.r, 21);
  return {
    x: box.x + (12 - bounds.minX + projected.x) * box.width / intrinsic.width,
    y: box.y + (12 - bounds.minY + projected.y) * box.height / intrinsic.height,
  };
}

function nearestEmptyCell(layout: FactoryLayout, origin: HexCoord): HexCoord {
  const occupied = new Set(layout.machines.flatMap((machine) =>
    worldCells(machine).map((cell) => `${cell.q},${cell.r}`)));
  let found: { readonly q: number; readonly r: number; readonly distance: number } | null = null;
  for (let r = 0; r < layout.height; r++) {
    for (let q = 0; q < layout.width; q++) {
      if (layout.tiles[hexIndex(layout.width, q, r)]?.kind !== "empty" || occupied.has(`${q},${r}`)) continue;
      const distance = hexDistance(origin.q, origin.r, q, r);
      if (found === null || distance < found.distance) found = { q, r, distance };
    }
  }
  if (found === null) throw new Error("Factory fixture has no empty cell");
  return { q: found.q, r: found.r };
}

async function expectPilotMachineAboveToolbelt(page: import("@playwright/test").Page): Promise<void> {
  const pilotCanvas = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  const canvasBox = await pilotCanvas.locator("canvas").boundingBox();
  const frameBox = await pilotCanvas.boundingBox();
  const toolbeltBox = await page.locator(".facility-pilot .toolbelt").boundingBox();
  const layout = referenceLayout();
  const machine = layout.machines[0]!;
  const cells = worldCells(machine);
  if (canvasBox === null || frameBox === null || toolbeltBox === null) {
    throw new Error("compact Pilot canvas chrome has no bounds");
  }
  const centers = await Promise.all(cells.map((cell) => factoryCellPoint(pilotCanvas, layout, cell)));
  const machineCenterY = (
    Math.min(...centers.map((center) => center.y)) +
    Math.max(...centers.map((center) => center.y))
  ) / 2;
  expect(machineCenterY).toBeGreaterThan(frameBox.y);
  expect(machineCenterY).toBeLessThan(toolbeltBox.y);
}

test("the shell exposes exactly three facility pages and drawer utilities", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("HexaPharma — Research · Plan · Production");
  await expect(page.getByTestId("view-research")).toBeVisible();
  await expect(page.getByTestId("view-pilot")).toBeVisible();
  await expect(page.getByTestId("view-production")).toBeVisible();
  await expect(page.getByTestId("view-market")).toBeVisible();
  await expect(page.getByTestId("view-technology")).toBeVisible();
  await expect(page.getByText("Pilot Bench", { exact: true })).toHaveCount(0);

  await page.getByTestId("view-market").click();
  await expect(page.getByTestId("market-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("market-drawer")).toHaveCount(0);
});

test("Production runs continuous time, produces sink outcomes, and resets", async ({ page }) => {
  await loadProduction(page);
  await expect(page.getByTestId("production-facility-workspace")).toBeVisible();
  await expect(page.getByTestId("production-facility-workspace").locator("canvas")).toBeVisible();
  const tick = page.getByTestId("factory-tick");
  await expect(tick).toHaveText("0");
  await page.getByTestId("factory-step").click();
  await expect(tick).toHaveText("1");
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await page.getByTestId("factory-reset").click();
  await page.getByRole("alertdialog", { name: "Reset Production?" })
    .getByRole("button", { name: "Reset runtime" }).click();
  await expect(tick).toHaveText("0");
});

test("focused Factory controls consume Space without toggling Production playback", async ({ page }) => {
  await loadProduction(page);
  const play = page.getByTestId("factory-play");
  const pause = page.getByTestId("factory-pause");

  await expect(play).toHaveAttribute("aria-label", "Play Production");
  await expect(page.getByTestId("factory-step")).toHaveAttribute("title", "Step one tick (.)");
  await page.getByTestId("factory-step").focus();
  await page.keyboard.press("Space");

  await expect(play).toBeEnabled();
  await expect(pause).toBeDisabled();
  await expect(page.getByTestId("factory-tick")).toHaveText("1");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("factory-tick")).toHaveText("2");
  await expect(pause).toBeDisabled();
});

test("Production Reset is disabled initially and requires explicit confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadProduction(page);
  const reset = page.getByTestId("factory-reset");
  const tick = page.getByTestId("factory-tick");
  await expect(reset).toBeDisabled();
  await page.getByTestId("factory-step").click();
  await expect(tick).toHaveText("1");
  await expect(reset).toBeEnabled();

  await reset.click();
  const dialog = page.getByRole("alertdialog", { name: "Reset Production?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reset runtime" })).toBeFocused();
  await page.keyboard.press(".");
  await page.keyboard.press("r");
  await page.keyboard.press("F2");
  await page.keyboard.press("m");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("view-production")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("market-drawer")).toHaveCount(0);
  await expect(tick).toHaveText("1");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(dialog).toContainText("Runtime and in-flight units will be cleared.");
  await expect(dialog).toContainText("Inventory and waste will stay.");
  await expect(tick).toHaveText("1");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(reset).toBeFocused();
  await expect(tick).toHaveText("1");

  await reset.click();
  await page.getByRole("alertdialog", { name: "Reset Production?" })
    .getByRole("button", { name: "Reset runtime" }).click();
  await expect(tick).toHaveText("0");
  await expect(reset).toBeDisabled();
});

test("opening Reset freezes live Production and Cancel resumes it", async ({ page }) => {
  await loadProduction(page);
  const tick = page.getByTestId("factory-tick");
  await page.getByTestId("factory-play").click();
  await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(0);

  await page.getByTestId("factory-reset").click();
  const dialog = page.getByRole("alertdialog", { name: "Reset Production?" });
  await expect(dialog).toBeVisible();
  const frozenTick = Number(await tick.textContent());
  await page.waitForTimeout(250);
  await expect(tick).toHaveText(String(frozenTick));

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("factory-pause")).toBeEnabled();
  await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(frozenTick);
});

test("hovering an installed machine previews direct manipulation and a no-op keeps Production playing", async ({ page }) => {
  const layout = referenceLayout();
  const machine = layout.machines[0]!;
  await loadProduction(page);
  const workspace = page.getByTestId("production-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  const point = await factoryCellPoint(frame, layout, machine.anchor);

  await page.mouse.move(point.x, point.y);
  await expect(frame.locator(".factory-ghost")).toHaveCount(machine.shape.cells.length);
  await expect(frame.locator(".factory-ghost.is-invalid")).toHaveCount(0);
  await expect(workspace.getByTestId("factory-ghost-cost")).toHaveCount(0);

  await workspace.getByTestId("factory-play").click();
  await expect(workspace.getByTestId("factory-pause")).toBeEnabled();
  await page.mouse.click(point.x, point.y);
  await expect(workspace.getByTestId("factory-pause")).toBeEnabled();
});

test("a rejected Production edit keeps playback running atomically", async ({ page }) => {
  const layout = referenceLayout();
  const origin = layout.machines[0]!.anchor;
  const empty = nearestEmptyCell(layout, origin);
  await loadLegacySave(page, zeroCashProductionSave());
  await page.getByTestId("view-production").click();
  const workspace = page.getByTestId("production-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  const point = await factoryCellPoint(frame, layout, empty);

  await workspace.getByTestId("factory-play").click();
  await expect(workspace.getByTestId("factory-pause")).toBeEnabled();
  await page.mouse.move(point.x, point.y);
  await expect(workspace.getByTestId("factory-ghost-cost")).toHaveText("$2");
  const tickBefore = Number(await workspace.getByTestId("factory-tick").textContent());
  await page.mouse.click(point.x, point.y);

  await expect(workspace.getByTestId("factory-pause")).toBeEnabled();
  await expect(workspace.getByTestId("factory-undo")).toBeDisabled();
  await expect.poll(async () => Number(await workspace.getByTestId("factory-tick").textContent()))
    .toBeGreaterThan(tickBefore);
});

test("touch Erase deletes an installed machine instead of capturing a no-op move", async ({ page }) => {
  const layout = machineGallerySave();
  await loadLegacySave(page, layout);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  const gallery = deserializeGame(layout).pilot.layout;
  if (gallery === null) throw new Error("machine gallery fixture has no Pilot layout");
  const machine = gallery.machines.reduce((closest, candidate) => {
    const distance = hexDistance(candidate.anchor.q, candidate.anchor.r, gallery.width / 2, gallery.height / 2);
    const closestDistance = hexDistance(closest.anchor.q, closest.anchor.r, gallery.width / 2, gallery.height / 2);
    return distance < closestDistance ? candidate : closest;
  });
  const point = await factoryCellPoint(frame, gallery, machine.anchor);
  await workspace.getByTestId("brush-erase").click();
  await page.mouse.move(point.x, point.y);
  await expect(workspace.getByTestId("factory-hover-kind"))
    .toHaveText(machineName(machine.def.typeId));
  await expect(frame.locator(".factory-ghost.is-erase")).toHaveCount(machine.shape.cells.length);
  await frame.evaluate((element) => {
    Object.defineProperty(element, "setPointerCapture", { value: () => undefined });
  });
  const touch = {
    pointerId: 71,
    pointerType: "touch",
    button: 0,
    clientX: point.x,
    clientY: point.y,
  };
  await frame.dispatchEvent("pointerdown", touch);
  await frame.dispatchEvent("pointerup", touch);

  await expect(workspace.getByTestId("factory-hover-kind")).toHaveText("empty");
});

test("touch paints a Belt drag and rotates the tapped installed machine", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  const emptyLayout: FactoryLayout = {
    width: BASE_GAME_FACTORY_WIDTH,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles: Array.from(
      { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
      () => ({ kind: "empty" as const }),
    ),
    machines: [],
  };
  const from = await factoryCellPoint(frame, emptyLayout, { q: 3, r: 8 });
  const to = await factoryCellPoint(frame, emptyLayout, { q: 7, r: 8 });
  await frame.evaluate((element) => {
    Object.defineProperty(element, "setPointerCapture", { value: () => undefined });
  });
  await workspace.getByTestId("brush-belt").click();
  await frame.dispatchEvent("pointerdown", {
    pointerId: 81,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: from.x,
    clientY: from.y,
  });
  await frame.dispatchEvent("pointermove", {
    pointerId: 81,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  await frame.dispatchEvent("pointerup", {
    pointerId: 81,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  await expect(workspace.getByTestId("factory-undo")).toBeEnabled();

  const transform = frame.locator(".factory-canvas-transform");
  const cameraBefore = await transform.getAttribute("style");
  await frame.dispatchEvent("pointerdown", {
    pointerId: 83,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: from.x,
    clientY: from.y,
  });
  await frame.dispatchEvent("pointerdown", {
    pointerId: 84,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    clientX: to.x,
    clientY: to.y,
  });
  await frame.dispatchEvent("pointermove", {
    pointerId: 84,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    clientX: to.x - 60,
    clientY: to.y - 30,
  });
  await frame.dispatchEvent("pointerup", {
    pointerId: 84,
    pointerType: "touch",
    isPrimary: false,
    button: 0,
    clientX: to.x - 60,
    clientY: to.y - 30,
  });
  await frame.dispatchEvent("pointerup", {
    pointerId: 83,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: from.x,
    clientY: from.y,
  });
  await expect.poll(() => transform.getAttribute("style")).not.toBe(cameraBefore);

  const serialized = machineGallerySave();
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), serialized);
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("alertdialog", { name: "Load saved game?" })
    .getByRole("button", { name: "Load saved game" })
    .click();
  await page.getByTestId("view-pilot").click();
  const gallery = deserializeGame(serialized).pilot.layout;
  if (gallery === null) throw new Error("machine gallery fixture has no Pilot layout");
  const machine = gallery.machines[0]!;
  const galleryFrame = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  const point = await factoryCellPoint(galleryFrame, gallery, machine.anchor);
  await galleryFrame.evaluate((element) => {
    Object.defineProperty(element, "setPointerCapture", { value: () => undefined });
  });
  const tap = {
    pointerId: 82,
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    clientX: point.x,
    clientY: point.y,
  };
  await galleryFrame.dispatchEvent("pointerdown", tap);
  await galleryFrame.dispatchEvent("pointerup", tap);
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("factory-hover-kind"))
    .toHaveText(machineName(machine.def.typeId));
  await page.getByTestId("pilot-facility-workspace").getByTestId("brush-rotate").click();
  await openMenu(page);
  await page.getByTestId("save").click();
  const raw = await page.evaluate((key) => localStorage.getItem(key), checkpointKey);
  if (raw === null) throw new Error("rotated Pilot checkpoint was not saved");
  const saved = deserializeGameAuthority((JSON.parse(raw) as { readonly head: string }).head);
  const rotated = saved.pilot.layout?.machines.find((candidate) => candidate.id === machine.id);
  expect(rotated?.footRot).toBe(1);
});

test("Factory copy and paste preserve source, splitter, and merger payloads", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const source = deserializeGame(serialized).pilot.layout;
  if (source === null) throw new Error("clipboard fixture has no Pilot layout");
  await loadLegacySave(page, serialized);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");

  await workspace.getByTestId("factory-diagnostics").click();
  for (const payload of clipboardPayloads) {
    const from = await factoryCellPoint(frame, source, payload.cell);
    const to = await factoryCellPoint(frame, source, payload.destination);
    await page.mouse.move(from.x, from.y);
    await workspace.getByTestId(payload.tile.kind === "source" ? "factory-copy" : "factory-cut").click();
    await page.mouse.move(to.x, to.y);
    await workspace.getByTestId("factory-paste").click();
  }
  await openMenu(page);
  await page.getByTestId("save").click();

  const raw = await page.evaluate((key) => localStorage.getItem(key), checkpointKey);
  if (raw === null) throw new Error("clipboard checkpoint was not saved");
  const saved = deserializeGameAuthority((JSON.parse(raw) as { readonly head: string }).head);
  if (saved.pilot.layout === null) throw new Error("saved Pilot layout is missing");
  for (const payload of clipboardPayloads) {
    expect(saved.pilot.layout.tiles[hexIndex(saved.pilot.layout.width, payload.destination.q, payload.destination.r)])
      .toEqual(payload.tile);
    if (payload.tile.kind !== "source") {
      expect(saved.pilot.layout.tiles[hexIndex(saved.pilot.layout.width, payload.cell.q, payload.cell.r)])
        .toEqual({ kind: "empty" });
    }
  }
});

test("focused Factory tool controls still allow R, number, and Q world hotkeys", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const layout = deserializeGame(serialized).pilot.layout;
  if (layout === null) throw new Error("hotkey fixture has no Pilot layout");
  await loadLegacySave(page, serialized);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");

  await workspace.getByTestId("brush-belt").click();
  await page.keyboard.press("Digit2");
  await expect(workspace.getByTestId("brush-selected")).toHaveText("splitter");

  const source = clipboardPayloads[0]!;
  const point = await factoryCellPoint(frame, layout, source.cell);
  await page.mouse.move(point.x, point.y);
  await expect(workspace.getByTestId("factory-hover-kind")).toHaveText("source");
  await workspace.getByTestId("brush-merger").click();
  await page.keyboard.press("q");
  await expect(workspace.getByTestId("brush-selected")).toHaveText("source");
  await expect(workspace.getByTestId("brush-direction")).toHaveText("Direction ↙ SW");
});

test("Pilot builds without a Research contract and Production is an exact copy", async ({ page }) => {
  await loadLegacySave(page, pilotSave());
  await expect(page.getByTestId("research-program-count")).toHaveText("0 tested");
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("pilot-facility-workspace")).toBeVisible();
  await expect(page.getByTestId("factory-play")).toHaveCount(0);
  await expect(page.getByTestId("pilot-command")).toBeEnabled();
  await page.getByTestId("pilot-command").click();
  await expect(page.getByTestId("production-facility-workspace")).toBeVisible();
  await openMenu(page);
  await page.getByTestId("save").click();

  const raw = await page.evaluate((key) => localStorage.getItem(key), checkpointKey);
  if (raw === null) throw new Error("built Production checkpoint was not saved");
  const envelope = JSON.parse(raw) as { readonly head: string };
  const saved = deserializeGameAuthority(envelope.head);
  expect(saved.research.program.steps).toHaveLength(0);
  expect(saved.production.layout).toEqual(saved.pilot.layout);
});

test("a fresh game opens its empty Production floor without using Pilot", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-production").click();

  await expect(page.getByTestId("production-facility-workspace")).toBeVisible();
  await expect(page.getByTestId("production-facility-workspace").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
});

test("Production previews and charges construction while removal gives no refund", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-production").click();
  const frame = page.getByTestId("production-facility-workspace").getByTestId("factory-canvas");
  const canvas = frame.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const emptyLayout: FactoryLayout = {
    width: BASE_GAME_FACTORY_WIDTH,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles: Array.from(
      { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
      () => ({ kind: "empty" as const }),
    ),
    machines: [],
  };
  const target = await factoryCellPoint(frame, emptyLayout, { q: 4, r: 4 });
  const end = await factoryCellPoint(frame, emptyLayout, { q: 7, r: 6 });

  await page.mouse.move(target.x, target.y);
  const ghostCost = page.getByTestId("factory-ghost-cost");
  await expect(ghostCost).toHaveText("$2");
  expect(await ghostCost.evaluate((node) => ({
    left: node.style.left,
    top: node.style.top,
  }))).toMatchObject({ left: expect.stringMatching(/px$/u), top: expect.stringMatching(/px$/u) });
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.getByTestId("factory-ghost-cost")).toHaveText("$12");
  await page.mouse.up();
  await expect(page.getByTestId("cash")).toHaveText(String(DEFAULT_STARTING_CASH - 12));
  await page.getByTestId("brush-erase").click();
  await page.mouse.click(end.x, end.y);
  await expect(page.getByTestId("cash")).toHaveText(String(DEFAULT_STARTING_CASH - 12));
});

test("physical footprint rotation leaves the selected chemical path unchanged", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  await pilot.getByTestId("brush-machine-push").click();
  const iconPath = page.getByTestId("research-machine-push").locator("[data-icon-shape='path']");
  const before = await iconPath.getAttribute("points");
  await page.keyboard.press("r");
  await expect(pilot.getByTestId("brush-direction")).toHaveText("Footprint 60°");
  await expect(iconPath).toHaveAttribute("points", before ?? "");
});

test("compact Pilot controls remain reachable above the construction hotbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLegacySave(page, pilotSave());
  await page.getByTestId("view-pilot").click();

  const bar = await page.locator(".facility-pilot .transport-bar").boundingBox();
  const stage = await page.getByTestId("game-stage").boundingBox();
  if (bar === null || stage === null) throw new Error("compact Pilot construction bar has no bounds");
  expect(bar.height).toBeLessThanOrEqual(56);
  expect(bar.x).toBeGreaterThanOrEqual(stage.x);
  expect(bar.x + bar.width).toBeLessThanOrEqual(stage.x + stage.width);
  await expect(page.locator(".facility-pilot .facility-clock-state")).toBeHidden();
  await expect(page.getByTestId("pilot-command")).toHaveText(/^Commission \$\d+$/);
  const toolbelt = page.getByTestId("pilot-facility-workspace").getByTestId("factory-toolbelt");
  expect(await toolbelt.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("toolbelt-more"))
    .toBeVisible();
  const inspector = page.getByTestId("pilot-facility-workspace").getByTestId("factory-inspector");
  await expect(inspector).toBeHidden();
  await page.getByTestId("pilot-facility-workspace").getByTestId("factory-diagnostics").click();
  await expect(inspector).toBeVisible();
  expect(await inspector.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await inspector.getByRole("button", { name: "Close factory details" }).click();
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("inspector-more"))
    .toBeHidden();
  await expectPilotMachineAboveToolbelt(page);

  await page.setViewportSize({ width: 651, height: 844 });
  expect(await toolbelt.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(inspector).toBeHidden();
  await page.getByTestId("pilot-facility-workspace").getByTestId("factory-diagnostics").click();
  await expect(inspector).toBeVisible();
  expect(await inspector.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await inspector.getByRole("button", { name: "Close factory details" }).click();
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("toolbelt-more"))
    .toBeVisible();
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("inspector-more"))
    .toBeHidden();
});

test("compact Pilot keeps scroll position after a local edit acknowledgement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLegacySave(page, pilotSave());
  await page.getByTestId("view-pilot").click();
  const frame = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await frame.evaluate((element) => {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  });
  const emptyLayout: FactoryLayout = {
    width: BASE_GAME_FACTORY_WIDTH,
    height: BASE_GAME_FACTORY_HEIGHT,
    tiles: Array.from(
      { length: BASE_GAME_FACTORY_WIDTH * BASE_GAME_FACTORY_HEIGHT },
      () => ({ kind: "empty" as const }),
    ),
    machines: [],
  };
  const target = await factoryCellPoint(frame, emptyLayout, { q: 0, r: 0 });
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("factory-undo"))
    .toBeEnabled();
  await page.waitForTimeout(250);
  expect(await frame.evaluate((element) => element.scrollTop)).toBe(0);
});

test("every unlocked machine family has its own path icon and factory silhouette", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loadLegacySave(page, machineGallerySave());
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  await expect(pilot.getByTestId("factory-canvas").locator("canvas")).toBeVisible({ timeout: 15_000 });
  const footprints = await pilot.locator("[data-machine-icon] [data-icon-shape='footprint']")
    .evaluateAll((icons) => icons.map((icon) => icon.innerHTML));
  expect(new Set(footprints).size).toBe(DEFAULT_CATALOG.length);
  await pilot.getByTestId("factory-diagnostics").click();
  await expect(pilot.getByText("Machines").locator("..")).toContainText(String(DEFAULT_CATALOG.length));
  await page.getByTestId("view-research").click();
  const paths = await page.locator("[data-testid='research-path-hotbar'] [data-icon-shape='path']")
    .evaluateAll((icons) => icons.map((icon) => icon.getAttribute("points")));
  expect(new Set(paths).size).toBe(DEFAULT_CATALOG.length);
});
