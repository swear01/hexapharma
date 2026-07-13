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

function validatedResearchSave(seed = 14): string {
  const options = defaultGenOptions(seed);
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

test("full loop: validated Research → free Pilot → timed Production → Market → Technology", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), validatedResearchSave());
  await page.reload();
  await page.getByTestId("load").click();
  await expect(page.getByTestId("research-command")).toHaveText("Send to Pilot Plant");
  await page.getByTestId("research-command").click();
  await expect(page.getByRole("heading", { name: "Pilot Plant" })).toBeVisible();
  await page.getByTestId("pilot-command").click();
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await page.getByTestId("view-market").click();
  const sell = page.getByRole("button", { name: /ship one/i }).first();
  await expect(sell).toBeEnabled();
  const cashBefore = Number(await page.getByTestId("cash").textContent());
  await sell.click();
  await expect.poll(async () => Number(await page.getByTestId("cash").textContent())).not.toBe(cashBefore);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("technology-drawer")).toBeVisible();
  await expect(page.getByTestId("research")).not.toHaveText("100");
});

test("Blueprint Library persists independently of save-slot loading", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  const canvas = pilot.getByTestId("factory-canvas").locator("canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Pilot canvas has no bounds");
  await page.mouse.click(box.x + 12 + 42 * 3 + 21, box.y + 12 + 42 * 3 + 21);
  await page.getByTestId("view-blueprints").click();
  await page.getByTestId("blueprint-name").fill("Starter route");
  await page.getByTestId("blueprint-save-pilot").click();
  await expect(page.getByTestId("blueprint-status")).toContainText(/Saved|portable blueprint/i);
  const card = page.locator(".blueprint-card").filter({ hasText: "Starter route" });
  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: "Download" }).click();
  await download;
  await page.getByTestId("blueprint-json").fill("{not valid json");
  await page.getByTestId("blueprint-import").click();
  await expect(page.getByTestId("blueprint-status")).toContainText(/invalid JSON|Could not import/i);
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), validatedResearchSave(15));
  await page.getByTestId("load").click();
  await expect(page.getByTestId("seed")).toHaveText("15");
  await expect(page.getByText("Starter route", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByTestId("view-blueprints").click();
  await expect(page.getByText("Starter route", { exact: true })).toBeVisible();
});
