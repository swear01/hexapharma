import { expect, test, type Page } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { serializeGame } from "../../src/sim/save";
import { DEFAULT_CATALOG } from "../../src/sim/phase0_interfaces";
import { defaultGenOptions, researchPlanningTrails } from "../../src/ui/Game";

test.setTimeout(60_000);

async function confirmLoad(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

function plannedEndpoint(stepCount: number): { readonly x: number; readonly y: number } {
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

async function clickCandidateEndpoint(page: Page, stepCount: number): Promise<void> {
  const canvas = page.getByTestId("lab-canvas");
  const frame = page.getByTestId("lab-map-frame");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Research canvas has no bounds");
  const cameraX = Number(await frame.getAttribute("data-camera-x"));
  const cameraY = Number(await frame.getAttribute("data-camera-y"));
  const endpoint = plannedEndpoint(stepCount);
  await page.mouse.click(
    box.x + box.width / 2 + (endpoint.x + 0.5 - cameraX) * 40 * box.width / 832,
    box.y + box.height / 2 + (endpoint.y + 0.5 - cameraY) * 40 * box.height / 512,
  );
}

function completedResearchSave(): string {
  const options = defaultGenOptions(14);
  const program = generate(options).diseases[0]!.reference;
  let game = createGameState(options, 10_000, 100);
  game = applyGameIntent(game, { kind: "setResearchProgram", program });
  game = applyGameIntent(game, { kind: "beginResearchShot" });
  while (game.research.shot !== null) {
    game = applyGameIntent(game, { kind: "advanceResearchShot" });
  }
  return serializeGame(game);
}

test("loading a finished Research shot preserves fog and its independent outcome", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), completedResearchSave());
  await page.reload();
  await confirmLoad(page);
  await expect(page.getByTestId("research-program-count")).not.toHaveText("0 placed");
  await expect(page.getByTestId("research-atlas-outcome")).toBeVisible();
  await expect(page.getByTestId("research-command")).toHaveText("Dispense");
  await expect(page.getByRole("button", { name: /send.*pilot|transfer/i })).toHaveCount(0);
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("pilot-command")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Research planning cannot reveal fog or spend cash before Dispense", async ({ page }) => {
  await page.goto("/");
  const revealed = page.getByTestId("revealed-count");
  const cash = page.getByTestId("cash");
  const fogBefore = await revealed.textContent();
  const cashBefore = await cash.textContent();
  await expect(page.getByTestId("lab-canvas")).toBeVisible({ timeout: 15_000 });
  await clickCandidateEndpoint(page, 1);
  await clickCandidateEndpoint(page, 2);
  await expect(page.getByTestId("research-program-count")).toHaveText("2 placed");
  await expect(revealed).toHaveText(fogBefore ?? "");
  await expect(cash).toHaveText(cashBefore ?? "");
});

test("aborting a dispensed shot does not refund its paid cost", async ({ page }) => {
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-canvas")).toBeVisible({ timeout: 15_000 });
  for (let step = 0; step < 4; step++) {
    await clickCandidateEndpoint(page, step + 1);
  }
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("cash")).toHaveText("192");
  await page.getByTestId("research-abort").click();
  await expect(page.getByTestId("cash")).toHaveText("192");
  await expect(page.getByTestId("research-command")).toBeEnabled();
});

test("a corrupt old-build save is reported instead of silently migrated", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("hexapharma.save.slot.0", JSON.stringify({ version: 5, game: {} }));
  });
  await page.reload();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText(/version|save|could not|invalid/i);
});
