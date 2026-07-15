import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { deserializeGameAuthority, serializeGame } from "../../src/sim/save";
import { worldCells } from "../../src/sim/factory-geom";
import { defaultGenOptions } from "../../src/ui/Game";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  type FactoryLayout,
  type PlacedMachine,
} from "../../src/sim/phase0_interfaces";

test.setTimeout(60_000);

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

function machineGallerySave(): string {
  let game = createGameState(defaultGenOptions(14), 1_000_000, 100_000);
  for (const id of ["bench-2", "skew-unlock", "dilute-unlock", "settle-unlock"]) {
    game = applyGameIntent(game, { kind: "unlockPatent", id });
  }
  const anchors = [
    { x: 1, y: 1 },
    { x: 5, y: 1 },
    { x: 11, y: 1 },
    { x: 15, y: 1 },
    { x: 1, y: 6 },
    { x: 7, y: 6 },
    { x: 13, y: 6 },
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
  await page.getByTestId("load").click();
}

async function loadProduction(page: import("@playwright/test").Page): Promise<void> {
  await loadLegacySave(page, productionSave());
  await page.getByTestId("view-production").click();
}

async function expectPilotMachineAboveToolbelt(page: import("@playwright/test").Page): Promise<void> {
  const pilotCanvas = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  const canvasBox = await pilotCanvas.locator("canvas").boundingBox();
  const frameBox = await pilotCanvas.boundingBox();
  const toolbeltBox = await page.locator(".facility-pilot .toolbelt").boundingBox();
  const machine = referenceLayout().machines[0]!;
  const cells = worldCells(machine);
  const minY = Math.min(...cells.map((cell) => cell.y));
  const maxY = Math.max(...cells.map((cell) => cell.y));
  if (canvasBox === null || frameBox === null || toolbeltBox === null) {
    throw new Error("compact Pilot canvas chrome has no bounds");
  }
  const canvasScale = canvasBox.height / (BASE_GAME_FACTORY_HEIGHT * 42 + 24);
  const machineCenterY = canvasBox.y + (12 + ((minY + maxY + 1) * 42) / 2) * canvasScale;
  expect(machineCenterY).toBeGreaterThan(frameBox.y);
  expect(machineCenterY).toBeLessThan(toolbeltBox.y);
}

test("the shell exposes exactly three facility pages and drawer utilities", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("HexaPharma — Research · Pilot · Production");
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
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await expect(page.getByTestId("production-facility-workspace").locator("canvas")).toBeVisible();
  const tick = page.getByTestId("factory-tick");
  await expect(tick).toHaveText("0");
  await page.getByTestId("factory-step").click();
  await expect(tick).toHaveText("1");
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await page.getByTestId("factory-reset").click();
  await expect(tick).toHaveText("0");
});

test("Pilot builds without a Research contract and Production is an exact copy", async ({ page }) => {
  await loadLegacySave(page, pilotSave());
  await expect(page.getByTestId("research-program-count")).toHaveText("0 placed");
  await page.getByTestId("view-pilot").click();
  await expect(page.getByRole("heading", { name: "Pilot Plant" })).toBeVisible();
  await expect(page.getByTestId("factory-play")).toHaveCount(0);
  await expect(page.getByTestId("pilot-command")).toBeEnabled();
  await page.getByTestId("pilot-command").click();
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await page.getByTestId("save").click();

  const raw = await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0"));
  if (raw === null) throw new Error("built Production checkpoint was not saved");
  const envelope = JSON.parse(raw) as { readonly head: string };
  const saved = deserializeGameAuthority(envelope.head);
  expect(saved.research.program.steps).toHaveLength(0);
  expect(saved.production.layout).toEqual(saved.pilot.layout);
});

test("a fresh game opens its empty Production floor without using Pilot", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-production").click();

  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await expect(page.getByTestId("production-facility-workspace").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
});

test("Production previews and charges construction while removal gives no refund", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-production").click();
  const frame = page.getByTestId("production-facility-workspace").getByTestId("factory-canvas");
  const canvas = frame.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Production canvas has no bounds");
  const target = { x: box.x + 12 + 4 * 42 + 21, y: box.y + 12 + 4 * 42 + 21 };
  const end = { x: target.x + 3 * 42, y: target.y + 2 * 42 };

  await page.mouse.move(target.x, target.y);
  await expect(page.getByTestId("factory-ghost-cost")).toHaveText("$2");
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.getByTestId("factory-ghost-cost")).toHaveText("$12");
  await page.mouse.up();
  await expect(page.getByTestId("cash")).toHaveText("188");
  await page.getByTestId("brush-erase").click();
  await page.mouse.click(end.x, end.y);
  await expect(page.getByTestId("cash")).toHaveText("188");
});

test("physical footprint rotation leaves the selected chemical path unchanged", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  await pilot.getByTestId("brush-machine-push").click();
  const iconPath = pilot.getByTestId("brush-machine-push").locator("[data-icon-shape='path']");
  const before = await iconPath.getAttribute("points");
  await page.keyboard.press("r");
  await expect(pilot.getByTestId("brush-direction")).toHaveText("Footprint 90°");
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
  await expect(page.getByTestId("pilot-command")).toHaveText(/^Build \$\d+$/);
  await expectPilotMachineAboveToolbelt(page);
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
  const canvasBox = await frame.locator("canvas").boundingBox();
  if (canvasBox === null) throw new Error("compact Pilot canvas has no bounds");

  await page.mouse.click(canvasBox.x + 33, canvasBox.y + 33);
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
  const points = await pilot.locator("[data-machine-icon] [data-icon-shape='path']")
    .evaluateAll((icons) => icons.map((icon) => icon.getAttribute("points")));
  expect(new Set(points).size).toBe(DEFAULT_CATALOG.length);
  await expect(pilot.getByText("Machines").locator("..")).toContainText(String(DEFAULT_CATALOG.length));
});
