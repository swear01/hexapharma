import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { serializeGame } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";

test.setTimeout(60_000);

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
  await page.getByTestId("load").click();
  await expect(page.getByTestId("research-program-count")).not.toHaveText("0 placed");
  await expect(page.getByTestId("research-atlas-outcome")).toBeVisible();
  await expect(page.getByTestId("research-command")).toHaveText("Dispense");
  await expect(page.getByRole("button", { name: /send.*pilot|transfer/i })).toHaveCount(0);
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("pilot-command")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("Research planning cannot reveal fog or spend cash before Dispense", async ({ page }) => {
  await page.goto("/");
  const revealed = page.getByTestId("revealed-count");
  const cash = page.getByTestId("cash");
  const fogBefore = await revealed.textContent();
  const cashBefore = await cash.textContent();
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("research-program-count")).toHaveText("2 placed");
  await expect(revealed).toHaveText(fogBefore ?? "");
  await expect(cash).toHaveText(cashBefore ?? "");
});

test("aborting a dispensed shot does not refund its paid cost", async ({ page }) => {
  await page.goto("/?cash=200");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  for (let step = 0; step < 4; step++) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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
