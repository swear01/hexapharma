import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeGame } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
} from "../../src/sim/phase0_interfaces";

test.setTimeout(60_000);

function researchSave(): string {
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
  return serializeGame(game);
}

test("loading a finished Research shot preserves fog and transfer authority", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), researchSave());
  await page.reload();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("research-command")).toHaveText("Send to Pilot Plant");
  await page.getByTestId("research-command").click();
  await expect(page.getByRole("heading", { name: "Pilot Plant" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("Research planning cannot reveal fog before a shot is dispensed", async ({ page }) => {
  await page.goto("/");
  const revealed = page.getByTestId("revealed-count");
  const before = await revealed.textContent();
  await page.getByTestId("research-show-floor").click();
  const canvas = page.getByTestId("research-facility-workspace").getByTestId("factory-canvas").locator("canvas");
  await expect(canvas).toBeVisible();
  await page.getByTestId("brush-belt").click();
  await canvas.click({ position: { x: 12 + 10 * 42 + 21, y: 12 + 5 * 42 + 21 } });
  await page.getByTestId("research-show-atlas").click();
  await expect(revealed).toHaveText(before ?? "");
});

test("a corrupt old-build save is reported instead of silently migrated", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("hexapharma.save.slot.0", JSON.stringify({ version: 4, game: {} }));
  });
  await page.reload();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("save-msg")).toContainText(/version|save|could not|invalid/i);
});
