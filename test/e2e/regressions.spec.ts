import { installSaveFixture } from "./checkpoint";
import { openMenu } from "./menu";
import { expect, test, type Page } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { SAVE_VERSION, serializeGame } from "../../src/sim/save";
import { DEFAULT_CATALOG } from "../../src/sim/phase0_interfaces";
import { defaultGenOptions, researchPlanningTrails } from "../../src/ui/Game";
import { focusLabCamera } from "../../src/render/labCamera";
import type { HexCoord } from "../../src/sim/hex";

test.setTimeout(60_000);

async function confirmLoad(page: import("@playwright/test").Page): Promise<void> {
  await openMenu(page);
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

function plannedEndpoint(stepCount: number): HexCoord {
  const options = defaultGenOptions(14);
  const level = generate(options);
  const game = createGameState(options, 200, 0);
  const entry = DEFAULT_CATALOG[0];
  if (entry === undefined) throw new Error("default Research machine is unavailable");
  const trail = researchPlanningTrails(level.mm, game.fog, level.start, {
    steps: Array.from({ length: stepCount }, () => entry),
  })[0] ?? [];
  for (let index = trail.length - 1; index >= 0; index--) {
    const point = trail[index];
    if (point !== null && point !== undefined) return point;
  }
  throw new Error("default Research machine has no preview endpoint");
}

async function clickLastControl(page: Page, stepCount: number): Promise<void> {
  const canvas = page.getByTestId("lab-canvas");
  const frame = page.getByTestId("lab-map-frame");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Research canvas has no bounds");
  const cameraX = Number(await frame.getAttribute("data-camera-x"));
  const cameraY = Number(await frame.getAttribute("data-camera-y"));
  const zoom = Number(await frame.getAttribute("data-camera-zoom"));
  const endpoint = plannedEndpoint(stepCount);
  const endpointCenter = focusLabCamera(endpoint);
  await page.mouse.click(
    box.x + box.width / 2 + (endpointCenter.x - cameraX) * zoom * box.width / 832,
    box.y + box.height / 2 + (endpointCenter.y - cameraY) * zoom * box.height / 512,
  );
}

function completedResearchSave(): string {
  const options = defaultGenOptions(14);
  const program = generate(options).diseases[0]!.reference;
  let game = createGameState(options, 10_000, 100);
  game = applyGameIntent(game, { kind: "runResearchTrial", program });
  return serializeGame(game);
}

test("loading a finished Research trial preserves fog and its outcome without a plan", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await installSaveFixture(page, completedResearchSave());
  await page.reload();
  const revealedBefore = await page.getByTestId("revealed-count").textContent();
  await confirmLoad(page);
  await expect(page.getByTestId("revealed-count")).not.toHaveText(revealedBefore ?? "");
  await expect(page.getByTestId("research-program-count")).toHaveText("0 steps");
  await expect(page.getByTestId("research-atlas-outcome")).toContainText("Cure Disease 1");
  await expect(page.getByTestId("research-command")).toHaveText("Run · $0");
  await expect(page.getByTestId("research-command")).toBeDisabled();
  await expect(page.getByRole("button", { name: /send.*pilot|transfer/i })).toHaveCount(0);
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("pilot-command")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Research planning is free; only Run spends once and reveals", async ({ page }) => {
  await page.goto("/");
  const revealed = page.getByTestId("revealed-count");
  const cash = page.getByTestId("cash");
  const fogBefore = await revealed.textContent();
  const cashBefore = await cash.textContent();
  await expect(page.getByTestId("lab-canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-hook").click();
  await page.getByTestId("research-machine-hook").click();
  await expect(page.getByTestId("research-program-count")).toHaveText("2 steps");
  await expect(revealed).toHaveText(fogBefore ?? "");
  await expect(cash).toHaveText(cashBefore ?? "");
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-program-count")).toHaveText("2 steps");
  await expect(revealed).not.toHaveText(fogBefore ?? "");
  await expect(cash).toHaveText(String(Number(cashBefore) - 6));
});

test("clicking the last control removes it and Clear empties the plan without refunds", async ({ page }) => {
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-canvas")).toBeVisible({ timeout: 15_000 });
  for (let step = 0; step < 4; step++) await page.getByTestId("research-machine-hook").click();
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("cash")).toHaveText("188");
  await clickLastControl(page, 4);
  await expect(page.getByTestId("research-program-count")).toHaveText("3 steps");
  await page.getByTestId("research-clear").click();
  await expect(page.getByTestId("cash")).toHaveText("188");
  await expect(page.getByTestId("research-command")).toBeDisabled();
  await expect(page.getByTestId("research-program-count")).toHaveText("0 steps");
});

test("an obsolete save namespace is ignored and preserved without migration", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("hexapharma.save.slot.0", JSON.stringify({ version: 5, game: {} }));
  });
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText("No save found");
  await expect(page.getByRole("alertdialog", { name: "Load saved game?" })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.slot.0")))
    .toBe(JSON.stringify({ version: 5, game: {} }));
  expect(await page.evaluate((version) => localStorage.getItem(`hexapharma.save.v${version}.checkpoint.0`), SAVE_VERSION))
    .toBeNull();
});
