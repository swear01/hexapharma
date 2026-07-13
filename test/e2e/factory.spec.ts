import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeGame } from "../../src/sim/save";
import { worldCells } from "../../src/sim/factory-geom";
import { defaultGenOptions } from "../../src/ui/Game";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
  DEFAULT_SHAPES,
  IDENTITY,
  type FactoryLayout,
  type PlacedMachine,
} from "../../src/sim/phase0_interfaces";

test.setTimeout(60_000);

function productionSave(): string {
  const options = defaultGenOptions(14);
  const template = generate(options).diseases[0]!.reference;
  const layout = compileEntitledPrototype(
    template,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  let game = createGameState(options, 10_000, 100);
  game = applyGameIntent(game, { kind: "setResearchLayout", layout });
  game = applyGameIntent(game, { kind: "beginResearchShot" });
  while (game.research.shot !== null) {
    game = applyGameIntent(game, { kind: "advanceResearchShot" });
  }
  game = applyGameIntent(game, { kind: "sendResearchToPilot" });
  game = applyGameIntent(game, { kind: "sendPilotToProduction" });
  return serializeGame(game);
}

function plannedResearchSave(): string {
  const options = defaultGenOptions(14);
  const template = generate(options).diseases[0]!.reference;
  const layout = compileEntitledPrototype(
    template,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  let game = createGameState(options, 10_000, 100);
  game = applyGameIntent(game, { kind: "setResearchLayout", layout });
  return serializeGame(game);
}

function machineGallerySave(): string {
  let game = createGameState(defaultGenOptions(14), 1_000_000, 100_000);
  for (const id of ["bench-2", "skew-unlock", "dilute-unlock", "new-map"]) {
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
      transform: entry.transform,
      orientation: IDENTITY,
      cost: entry.cost,
      speed: entry.speed,
    },
    anchor: anchors[index]!,
    footRot: 0,
    shape: DEFAULT_SHAPES[entry.typeId]!,
  }));
  const width = BASE_GAME_FACTORY_WIDTH + 2;
  const height = BASE_GAME_FACTORY_HEIGHT;
  const layout: FactoryLayout = {
    width,
    height,
    tiles: Array.from({ length: width * height }, () => ({ kind: "empty" as const })),
    machines,
  };
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  return serializeGame(game);
}

async function loadProduction(page: import("@playwright/test").Page): Promise<void> {
  const blob = productionSave();
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), blob);
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByTestId("view-production").click();
}

async function expectPilotMachineAboveToolbelt(page: import("@playwright/test").Page): Promise<void> {
  const pilotCanvas = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  const canvasBox = await pilotCanvas.locator("canvas").boundingBox();
  const frameBox = await pilotCanvas.boundingBox();
  const toolbeltBox = await page.locator(".facility-pilot .toolbelt").boundingBox();
  const machine = compileEntitledPrototype(
    generate(defaultGenOptions(14)).diseases[0]!.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout.machines[0]!;
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

test("Research separates the large effect atlas from its physical route floor", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), plannedResearchSave());
  await page.reload();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("research-atlas")).toBeVisible();
  await expect(page.getByTestId("lab-map-frame")).toBeVisible();
  await page.getByTestId("research-show-floor").click();
  await expect(page.getByTestId("research-workspace")).toBeVisible();
  await expect(page.getByTestId("factory-canvas").locator("canvas")).toBeVisible();
  await expect(page.getByText(/No clock · layout edits are free/)).toBeVisible();
  await expect(page.getByTestId("research-sample-state")).toHaveText("Hidden until Dispense");
  await expect(page.getByTestId("research-facility-workspace").getByTestId("facility-sample-outcome")).toHaveCount(0);
  await expect(page.getByTestId("research-command")).toBeEnabled();
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-atlas")).toBeVisible();
  await expect(page.getByTestId("research-command")).toBeDisabled();
});

test("Production runs continuous time, produces units, and resets", async ({ page }) => {
  await loadProduction(page);
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await expect(page.getByTestId("production-facility-workspace").locator("canvas")).toBeVisible();
  await page.locator(".message-layer").evaluate((element) => {
    (element as HTMLElement).style.visibility = "hidden";
  });
  await expect(page).toHaveScreenshot("production-floor-current.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
    timeout: 15_000,
  });
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

test("Pilot Plant has free spatial editing and an exact Production transfer command", async ({ page }) => {
  const blob = productionSave();
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), blob);
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByTestId("view-pilot").click();
  await expect(page.getByRole("heading", { name: "Pilot Plant" })).toBeVisible();
  await expect(page.getByTestId("factory-play")).toHaveCount(0);
  await expect(page.getByTestId("pilot-command")).toBeEnabled();
  await page.getByTestId("pilot-command").click();
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
});

test("compact Pilot controls remain a single readable construction bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const blob = productionSave();
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), blob);
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByTestId("view-pilot").click();

  const bar = await page.locator(".facility-pilot .transport-bar").boundingBox();
  const stage = await page.getByTestId("game-stage").boundingBox();
  if (bar === null || stage === null) throw new Error("compact Pilot construction bar has no bounds");
  expect(bar.height).toBeLessThanOrEqual(56);
  expect(bar.x).toBeGreaterThanOrEqual(stage.x);
  expect(bar.x + bar.width).toBeLessThanOrEqual(stage.x + stage.width);
  await expect(page.locator(".facility-pilot .facility-clock-state")).toBeHidden();
  await expect(page.getByTestId("pilot-command")).toHaveText("Commission");
  await expectPilotMachineAboveToolbelt(page);
  await page.locator(".message-layer").evaluate((element) => {
    (element as HTMLElement).style.visibility = "hidden";
  });
  await expect(page.getByTestId("game-stage")).toHaveScreenshot("compact-pilot-controls.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
    timeout: 15_000,
  });
});

test("compact Pilot refocuses a same-size Research transfer after its empty floor was visited", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), plannedResearchSave());
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("pilot-facility-workspace").locator("canvas")).toBeVisible();

  await page.getByTestId("view-research").click();
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-command")).toHaveText("Send to Pilot Plant", { timeout: 20_000 });
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("pilot-facility-workspace")).toBeVisible();
  await expectPilotMachineAboveToolbelt(page);
});

test("compact Pilot keeps the player's scroll position after a local edit acknowledgement", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), productionSave());
  await page.reload();
  await page.getByTestId("load").click();
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
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("factory-undo")).toBeEnabled();
  await page.waitForTimeout(250);
  expect(await frame.evaluate((element) => element.scrollTop)).toBe(0);
});

test("every machine family has a distinct readable factory silhouette", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), machineGallerySave());
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByTestId("view-pilot").click();
  const canvas = page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas");
  await expect(canvas.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.locator(".message-layer").evaluate((element) => {
    (element as HTMLElement).style.visibility = "hidden";
  });
  await expect(canvas).toHaveScreenshot("machine-family-gallery.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.01,
    timeout: 15_000,
  });
});
