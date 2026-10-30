import { installSaveFixture } from "./checkpoint";
import { openMenu } from "./menu";
import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState, DEFAULT_STARTING_CASH } from "../../src/sim/game";
import { quoteProductionBuild } from "../../src/sim/construction";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype, withSourceBase } from "../../src/sim/recipe";
import { SAVE_VERSION, deserializeGame, deserializeSnapshot, serializeGame } from "../../src/sim/save";
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
  let game = createGameState(defaultGenOptions(14), 10_000);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout: referenceLayout() });
  return serializeGame(game);
}

function productionSave(): string {
  let game = createGameState(defaultGenOptions(14), 10_000);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout: referenceLayout() });
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout: referenceLayout() });
  return serializeGame(game);
}

function zeroCashProductionSave(): string {
  const options = defaultGenOptions(14);
  const layout = referenceLayout();
  const priced = createGameState(options, 1_000_000);
  const cost = quoteProductionBuild(priced.production.layout, layout);
  let game = createGameState(options, cost);
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  if (game.economy.cash !== 0) throw new Error("zero-cash Production fixture did not spend its build budget");
  return serializeGame(game);
}

const clipboardPayloads = [
  { cell: { q: 8, r: 6 }, destination: { q: 8, r: 8 }, tile: { kind: "source" as const, dir: 2 as const, period: 7, base: 0 } },
  { cell: { q: 10, r: 6 }, destination: { q: 10, r: 8 }, tile: { kind: "splitter" as const, inDir: 3 as const, outDirs: [0, 1, 2] as const } },
  { cell: { q: 12, r: 6 }, destination: { q: 12, r: 8 }, tile: { kind: "merger" as const, inDirs: [0, 2, 3] as const, outDir: 1 as const } },
];

function clipboardPayloadSave(): string {
  let game = createGameState(defaultGenOptions(14), 10_000);
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
  let game = createGameState(options, 1_000_000);
  game = applyGameIntent(game, { kind: "setPatent", id: "bench-2", enabled: true });
  game = applyGameIntent(game, { kind: "setPatent", id: "reveal-aid", enabled: true });
  game = applyGameIntent(game, { kind: "setPatent", id: "oil-base", enabled: true });
  game = applyGameIntent(game, { kind: "setPatent", id: "ethanol-base", enabled: true });
  for (const disease of [0, 1, 2]) {
    const layout = withSourceBase(compileEntitledPrototype(
      level.diseases[disease]!.reference,
      game.production.layout.width,
      game.production.layout.height,
    ).layout, level.diseases[disease]!.map);
    game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
    game = applyGameIntent(game, { kind: "productionTicks", ticks: 400 });
    const productIds = game.inventory
      .filter((product) => product.outcome.cured.includes(disease))
      .slice(0, 3)
      .map((product) => product.inventoryId);
    if (productIds.length !== 3) throw new Error(`machine gallery could not complete Disease ${disease + 1}`);
    game = applyGameIntent(game, { kind: "sellProducts", productIds, disease });
  }
  const anchors = [
    { q: 1, r: 1 },
    { q: 5, r: 1 },
    { q: 11, r: 1 },
    { q: 15, r: 1 },
    { q: 1, r: 6 },
    { q: 7, r: 6 },
    { q: 13, r: 6 },
    { q: 20, r: 6 },
  ];
  const machines: PlacedMachine[] = DEFAULT_CATALOG.map((entry, index) => ({
    id: index,
    def: {
      typeId: entry.typeId,
      path: entry.path,
      turn: entry.turn,
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

async function loadSaveFixture(
  page: import("@playwright/test").Page,
  blob: string,
): Promise<void> {
  await page.goto("/");
  await installSaveFixture(page, blob);
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

async function loadProduction(page: import("@playwright/test").Page): Promise<void> {
  await loadSaveFixture(page, productionSave());
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
    width: element.clientWidth,
    height: element.clientHeight,
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
  await expect(page).toHaveTitle("HexaPharma");
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

test("Production runs continuous time, produces sink outcomes, and scales its speed", async ({ page }) => {
  await loadProduction(page);
  await expect(page.getByTestId("production-facility-workspace")).toBeVisible();
  await expect(page.getByTestId("production-facility-workspace").locator("canvas")).toBeVisible();
  const tick = page.getByTestId("factory-tick");
  await expect(tick).toHaveText("0");
  await page.getByTestId("factory-step").click();
  await expect(tick).toHaveText("1");
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-run-state")).toHaveText("Running");
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await expect(page.getByTestId("factory-pause")).toHaveCount(0);
  await expect(page.getByTestId("factory-run-state")).toHaveText("Paused");

  // 10× advances ten 1× batches (80 ticks) per interval.
  const paused = Number(await tick.textContent());
  await page.getByTestId("factory-speed-10").click();
  await expect(page.getByTestId("factory-speed-10")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("factory-speed-1")).toHaveAttribute("aria-pressed", "false");
  await page.getByTestId("factory-play").click();
  await expect.poll(async () => Number(await tick.textContent())).toBeGreaterThan(paused);
  await page.getByTestId("factory-pause").click();
  expect((Number(await tick.textContent()) - paused) % 80).toBe(0);
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
  await expect(pause).toHaveCount(0);
  await expect(page.getByTestId("factory-tick")).toHaveText("1");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("factory-tick")).toHaveText("2");
  await expect(pause).toHaveCount(0);
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
  await expect(frame).not.toHaveAttribute("data-ghost");
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
  await loadSaveFixture(page, zeroCashProductionSave());
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
  await loadSaveFixture(page, layout);
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
  await installSaveFixture(page, serialized);
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
  const saved = deserializeSnapshot((JSON.parse(raw) as { readonly head: string }).head);
  const rotated = saved.pilot.layout?.machines.find((candidate) => candidate.id === machine.id);
  expect(rotated?.footRot).toBe(1);
});

test("Factory copy and paste preserve source, splitter, and merger payloads", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const source = deserializeGame(serialized).pilot.layout;
  if (source === null) throw new Error("clipboard fixture has no Pilot layout");
  await loadSaveFixture(page, serialized);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");

  for (const payload of clipboardPayloads) {
    const from = await factoryCellPoint(frame, source, payload.cell);
    const to = await factoryCellPoint(frame, source, payload.destination);
    await page.mouse.move(from.x, from.y);
    await page.keyboard.press(payload.tile.kind === "source" ? "Control+c" : "Control+x");
    await page.keyboard.press("Control+v");
    await page.mouse.click(to.x, to.y);
  }
  await openMenu(page);
  await page.getByTestId("save").click();

  const raw = await page.evaluate((key) => localStorage.getItem(key), checkpointKey);
  if (raw === null) throw new Error("clipboard checkpoint was not saved");
  const saved = deserializeSnapshot((JSON.parse(raw) as { readonly head: string }).head);
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

async function savedPilotLayout(page: import("@playwright/test").Page): Promise<FactoryLayout> {
  await openMenu(page);
  await page.getByTestId("save").click();
  await page.getByTestId("view-menu").click();
  const raw = await page.evaluate((key) => localStorage.getItem(key), checkpointKey);
  if (raw === null) throw new Error("Pilot checkpoint was not saved");
  const layout = deserializeSnapshot((JSON.parse(raw) as { readonly head: string }).head).pilot.layout;
  if (layout === null) throw new Error("saved Pilot layout is missing");
  return layout;
}

function savedTile(layout: FactoryLayout, cell: HexCoord): FactoryTile | undefined {
  return layout.tiles[hexIndex(layout.width, cell.q, cell.r)];
}

test("X box-erases everything in the dragged box and previews what goes", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const source = deserializeGame(serialized).pilot.layout!;
  await loadSaveFixture(page, serialized);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  const [sourceTile, splitter, merger] = clipboardPayloads;

  await page.keyboard.press("x");
  await expect(workspace.getByTestId("brush-erase")).toHaveAttribute("aria-pressed", "true");
  const from = await factoryCellPoint(frame, source, { q: sourceTile!.cell.q - 1, r: sourceTile!.cell.r });
  const to = await factoryCellPoint(frame, source, splitter!.cell);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await expect(frame.getByTestId("factory-marquee")).toBeVisible();
  await expect(frame.locator(".factory-ghost.is-erase")).toHaveCount(2);
  await page.mouse.up();
  await expect(frame.getByTestId("factory-marquee")).toHaveCount(0);

  const saved = await savedPilotLayout(page);
  expect(savedTile(saved, sourceTile!.cell)).toEqual({ kind: "empty" });
  expect(savedTile(saved, splitter!.cell)).toEqual({ kind: "empty" });
  expect(savedTile(saved, merger!.cell)).toEqual(merger!.tile);
});

test("a box selection moves by dragging and Delete removes it", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const source = deserializeGame(serialized).pilot.layout!;
  await loadSaveFixture(page, serialized);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  const [sourceTile, splitter, merger] = clipboardPayloads;
  const point = (cell: HexCoord) => factoryCellPoint(frame, source, cell);

  await page.keyboard.press("v");
  await expect(workspace.getByTestId("brush-select")).toHaveAttribute("aria-pressed", "true");
  const a = await point(sourceTile!.cell);
  await page.mouse.click(a.x, a.y);
  await expect(frame.getByTestId("factory-selected")).toHaveCount(1);
  const b = await point(splitter!.cell);
  await page.keyboard.down("Shift");
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up("Shift");
  await expect(frame.getByTestId("factory-selected")).toHaveCount(2);

  const down = { q: sourceTile!.cell.q, r: sourceTile!.cell.r + 1 };
  const target = await point(down);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 6 });
  await expect(frame).toHaveAttribute("data-ghost", "valid");
  await page.mouse.up();
  let saved = await savedPilotLayout(page);
  expect(savedTile(saved, sourceTile!.cell)).toEqual({ kind: "empty" });
  expect(savedTile(saved, down)).toEqual(sourceTile!.tile);
  expect(savedTile(saved, { q: splitter!.cell.q, r: splitter!.cell.r + 1 })).toEqual(splitter!.tile);

  // R turns the selection in place about its centre cell, and the selection follows.
  await page.keyboard.press("r");
  saved = await savedPilotLayout(page);
  const centre = { q: (sourceTile!.cell.q + splitter!.cell.q) / 2, r: down.r };
  expect(savedTile(saved, down)).toEqual({ kind: "empty" });
  expect(savedTile(saved, { q: centre.q, r: centre.r - 1 })).toEqual({ ...sourceTile!.tile, dir: 3 });
  expect(savedTile(saved, { q: centre.q, r: centre.r + 1 })).toEqual({ kind: "splitter", inDir: 4, outDirs: [1, 2, 3] });

  await page.keyboard.press("Delete");
  await expect(frame.getByTestId("factory-selected")).toHaveCount(0);
  saved = await savedPilotLayout(page);
  expect(saved.tiles.filter((tile) => tile.kind !== "empty")).toEqual([merger!.tile]);
});

test("Ctrl+C copies, Ctrl+V holds a paste that Shift+R turns back and a click places", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const source = deserializeGame(serialized).pilot.layout!;
  await loadSaveFixture(page, serialized);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  const [sourceTile] = clipboardPayloads;

  await page.keyboard.press("1");
  await page.keyboard.press("Shift+R");
  await expect(workspace.getByTestId("brush-direction")).toHaveAccessibleName("Direction NE");
  await page.keyboard.press("r");
  await expect(workspace.getByTestId("brush-direction")).toHaveAccessibleName("Direction E");

  const from = await factoryCellPoint(frame, source, sourceTile!.cell);
  await page.mouse.move(from.x, from.y);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("Paste");
  await page.keyboard.press("Shift+R");
  await expect(workspace.getByTestId("brush-direction")).toHaveAccessibleName("Paste 300°");
  const destination = { q: sourceTile!.cell.q, r: sourceTile!.cell.r + 3 };
  const to = await factoryCellPoint(frame, source, destination);
  await page.mouse.move(to.x, to.y);
  await expect(frame).toHaveAttribute("data-ghost", "valid");
  await page.mouse.click(to.x, to.y);
  await page.keyboard.press("Escape");
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("belt");

  const saved = await savedPilotLayout(page);
  expect(savedTile(saved, destination)).toEqual({ kind: "source", dir: 1, period: 7, base: 0 });
  expect(savedTile(saved, sourceTile!.cell)).toEqual(sourceTile!.tile);
});

test("a copy in Plan pastes into Production at the build quote", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const source = deserializeGame(serialized).pilot.layout!;
  await loadSaveFixture(page, serialized);
  await page.getByTestId("view-pilot").click();
  const pilotFrame = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  const [sourceTile] = clipboardPayloads;
  const from = await factoryCellPoint(pilotFrame, source, sourceTile!.cell);
  await page.mouse.move(from.x, from.y);
  await page.keyboard.press("Control+c");

  await page.getByTestId("view-production").click();
  const workspace = page.getByTestId("production-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  const cash = Number(await page.getByTestId("cash").textContent());
  await page.keyboard.press("Control+v");
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("Paste");
  const to = await factoryCellPoint(frame, source, sourceTile!.cell);
  await page.mouse.move(to.x, to.y);
  await expect(frame).toHaveAttribute("data-ghost", "valid");
  const cost = Number((await page.getByTestId("factory-ghost-cost").textContent())!.slice(1));
  expect(cost).toBeGreaterThan(0);
  await page.mouse.click(to.x, to.y);
  await expect(page.getByTestId("cash")).toHaveText(String(cash - cost));

  await openMenu(page);
  await page.getByTestId("save").click();
  const raw = await page.evaluate((key) => localStorage.getItem(key), checkpointKey);
  const production = deserializeSnapshot((JSON.parse(raw!) as { readonly head: string }).head).production.layout;
  expect(savedTile(production, sourceTile!.cell)).toEqual(sourceTile!.tile);

  // Loading another game state clears the clipboard, so nothing stays in hand.
  await page.getByTestId("view-menu").click();
  await page.keyboard.press("Control+v");
  const again = await factoryCellPoint(frame, source, { q: sourceTile!.cell.q, r: sourceTile!.cell.r + 2 });
  await page.mouse.click(again.x, again.y);
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("Paste");
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("alertdialog", { name: "Load saved game?" }).getByRole("button", { name: "Load saved game" }).click();
  await page.getByTestId("view-production").click();
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("belt");
  await expect(workspace.getByTestId("factory-paste")).toHaveCount(0);
});

test("a held paste over an installed machine shows a refused ghost", async ({ page }) => {
  const serialized = machineGallerySave();
  const gallery = deserializeGame(serialized).pilot.layout!;
  await loadSaveFixture(page, serialized);
  await page.getByTestId("view-pilot").click();
  const frame = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  const point = await factoryCellPoint(frame, gallery, worldCells(gallery.machines[0]!)[0]!);
  await page.mouse.move(point.x, point.y);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.mouse.move(point.x + 2, point.y);
  await expect(frame).toHaveAttribute("data-ghost", "invalid");
  await page.mouse.click(point.x + 2, point.y);
  await page.mouse.click(point.x + 2, point.y, { button: "right" });
  expect((await savedPilotLayout(page)).machines).toHaveLength(gallery.machines.length);
});

test("WASD pans the Factory camera and Shift+drag no longer does", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const frame = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  await expect(frame.locator("canvas")).toBeVisible();
  const transform = frame.locator(".factory-canvas-transform");
  const offset = async () => {
    const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/u.exec(await transform.evaluate((node) => (node as HTMLElement).style.transform));
    if (match === null) throw new Error("Factory camera transform is unreadable");
    return { x: Number(match[1]), y: Number(match[2]) };
  };
  const start = await offset();
  await page.keyboard.down("d");
  await expect.poll(async () => (await offset()).x).toBeLessThan(start.x - 20);
  await page.keyboard.up("d");
  const afterD = await offset();
  await page.keyboard.down("s");
  await expect.poll(async () => (await offset()).y).toBeLessThan(afterD.y - 20);
  await page.keyboard.up("s");

  const settled = await offset();
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Factory frame has no bounds");
  await page.keyboard.down("Shift");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  expect(await offset()).toEqual(settled);
});

test("focused Factory tool controls still allow R, number, and Q world hotkeys", async ({ page }) => {
  const serialized = clipboardPayloadSave();
  const layout = deserializeGame(serialized).pilot.layout;
  if (layout === null) throw new Error("hotkey fixture has no Pilot layout");
  await loadSaveFixture(page, serialized);
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");

  await workspace.getByTestId("brush-belt").click();
  await page.keyboard.press("Digit2");
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("splitter");

  const source = clipboardPayloads[0]!;
  const point = await factoryCellPoint(frame, layout, source.cell);
  await page.mouse.move(point.x, point.y);
  await expect(workspace.getByTestId("factory-hover-kind")).toHaveText("source");
  await workspace.getByTestId("brush-merger").click();
  await page.keyboard.press("q");
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("source");
  await expect(workspace.getByTestId("brush-direction")).toHaveAccessibleName("Direction SW");
});

test("Pilot builds without a Research contract and Production is an exact copy", async ({ page }) => {
  await loadSaveFixture(page, pilotSave());
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(0);
  await expect.poll(async () => Number(await page.getByTestId("lab-map-frame").getAttribute("data-plan-line")))
    .toBeGreaterThan(1);
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
  const saved = deserializeSnapshot(envelope.head);
  expect(saved.research.lastTrial).toBeNull();
  expect(saved.production.layout).toEqual(saved.pilot.layout);
});

test("Splitter and Merger start on and lock when Split / Merge is switched off", async ({ page }) => {
  await loadSaveFixture(page, pilotSave());
  await expect(page.getByTestId("lab-map-frame")).toBeVisible();
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  await expect(workspace.getByTestId("brush-splitter")).not.toHaveAttribute("aria-disabled", "true");
  await page.getByTestId("view-technology").click();
  await page.getByTestId("patent-switch-split-merge").click();
  await expect(page.getByTestId("patent-switch-split-merge")).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await expect(workspace.getByTestId("brush-splitter")).toHaveAttribute("aria-disabled", "true");
  await expect(workspace.getByTestId("brush-merger")).toHaveAttribute("aria-disabled", "true");
  await workspace.getByTestId("brush-belt").click();
  await workspace.getByTestId("factory-canvas").hover();
  await page.keyboard.press("Digit2");
  await expect(workspace.getByTestId("brush-selected")).toHaveAccessibleName("belt");
  await expect(workspace.getByRole("status").filter({ hasText: "Split / Merge" })).toBeVisible();
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
  await pilot.getByTestId("brush-machine-hook").click();
  const iconPath = page.getByTestId("research-machine-hook").locator("[data-icon-shape='path']");
  const before = await iconPath.getAttribute("points");
  await page.keyboard.press("r");
  await expect(pilot.getByTestId("brush-direction")).toHaveAccessibleName("Footprint 60°");
  await expect(iconPath).toHaveAttribute("points", before ?? "");
});

test("compact Pilot controls remain reachable above the construction hotbar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadSaveFixture(page, pilotSave());
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
  // Details either fits or scrolls inside its own panel.
  expect(await inspector.evaluate((element) => element.scrollHeight <= element.clientHeight || getComputedStyle(element).overflowY === "auto")).toBe(true);
  await inspector.getByRole("button", { name: "Close factory details" }).click();
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("inspector-more"))
    .toBeHidden();
  await expectPilotMachineAboveToolbelt(page);

  await page.setViewportSize({ width: 651, height: 844 });
  expect(await toolbelt.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await expect(inspector).toBeHidden();
  await page.getByTestId("pilot-facility-workspace").getByTestId("factory-diagnostics").click();
  await expect(inspector).toBeVisible();
  // Details either fits or scrolls inside its own panel.
  expect(await inspector.evaluate((element) => element.scrollHeight <= element.clientHeight || getComputedStyle(element).overflowY === "auto")).toBe(true);
  await inspector.getByRole("button", { name: "Close factory details" }).click();
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("toolbelt-more"))
    .toBeVisible();
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("inspector-more"))
    .toBeHidden();
});

test("compact Pilot keeps its camera after a local edit acknowledgement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadSaveFixture(page, pilotSave());
  await page.getByTestId("view-pilot").click();
  const workspace = page.getByTestId("pilot-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  const transform = workspace.locator(".factory-canvas-transform");
  await page.waitForTimeout(250);
  const before = await transform.getAttribute("style");
  const layout = referenceLayout();
  const target = await factoryCellPoint(frame, layout, nearestEmptyCell(layout, layout.machines[0]!.anchor));
  await page.mouse.click(target.x, target.y);
  await expect(workspace.getByTestId("factory-undo")).toBeEnabled();
  await page.waitForTimeout(250);
  expect(await transform.getAttribute("style")).toBe(before);
});

test("opening a built line on a phone starts legible at its Source", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadSaveFixture(page, productionSave());
  await page.getByTestId("view-production").click();
  const workspace = page.getByTestId("production-facility-workspace");
  const frame = workspace.getByTestId("factory-canvas");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(250);
  const frameBox = await frame.boundingBox();
  if (frameBox === null) throw new Error("Production frame has no bounds");
  const layout = referenceLayout();
  for (let index = 0; index < layout.tiles.length; index++) {
    const kind = layout.tiles[index]!.kind;
    if (kind !== "source") continue;
    const point = await factoryCellPoint(frame, layout, { q: index % layout.width, r: Math.floor(index / layout.width) });
    expect(point.x).toBeGreaterThan(frameBox.x);
    expect(point.x).toBeLessThan(frameBox.x + frameBox.width);
    expect(point.y).toBeGreaterThan(frameBox.y);
    expect(point.y).toBeLessThan(frameBox.y + frameBox.height);
  }
});

test("every unlocked machine family has its own path icon and factory silhouette", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await loadSaveFixture(page, machineGallerySave());
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
