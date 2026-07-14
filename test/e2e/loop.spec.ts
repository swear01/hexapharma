import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeGame } from "../../src/sim/save";
import { defaultGenOptions } from "../../src/ui/Game";
import { BASE_GAME_FACTORY_HEIGHT, BASE_GAME_FACTORY_WIDTH } from "../../src/sim/phase0_interfaces";

test.setTimeout(60_000);

function preparedFacilitiesSave(seed = 14): string {
  const options = defaultGenOptions(seed);
  const program = generate(options).diseases[0]!.reference;
  const layout = compileEntitledPrototype(
    program,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  let game = createGameState(options, 10_000, 100);
  game = applyGameIntent(game, { kind: "setResearchProgram", program });
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  return serializeGame(game);
}

async function loadPrepared(page: import("@playwright/test").Page, seed = 14): Promise<void> {
  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), preparedFacilitiesSave(seed));
  await page.reload();
  await page.getByTestId("load").click();
}

test("full loop: paid Research → independent Pilot → timed Production → Market → Technology", async ({
  page,
}) => {
  await loadPrepared(page);
  const cashBeforeResearch = Number(await page.getByTestId("cash").textContent());
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("cash")).not.toHaveText(String(cashBeforeResearch));
  await expect(page.getByTestId("research-atlas-outcome")).toBeVisible({ timeout: 15_000 });

  await page.getByTestId("view-pilot").click();
  await expect(page.getByRole("heading", { name: "Pilot Plant" })).toBeVisible();
  await page.getByTestId("pilot-command").click();
  await expect(page.getByRole("heading", { name: "Production" })).toBeVisible();
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-produced")).not.toHaveText("0", { timeout: 10_000 });
  await page.getByTestId("factory-pause").click();
  await page.getByTestId("view-market").click();
  const sell = page.getByRole("button", { name: /ship one/i }).first();
  await expect(sell).toBeEnabled();
  const cashBeforeSale = Number(await page.getByTestId("cash").textContent());
  await sell.click();
  await expect.poll(async () => Number(await page.getByTestId("cash").textContent()))
    .toBeGreaterThan(cashBeforeSale);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("technology-drawer")).toBeVisible();
  await expect(page.getByTestId("research")).not.toHaveText("100");
});

test("Blueprint Library persists Pilot layouts independently of save-slot loading", async ({ page }) => {
  await loadPrepared(page);
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("factory-canvas").locator("canvas"))
    .toBeVisible();
  await page.getByTestId("view-blueprints").click();
  await page.getByTestId("blueprint-name").fill("Starter plant");
  await page.getByTestId("blueprint-save-pilot").click();
  await expect(page.getByTestId("blueprint-status")).toContainText(/Saved|portable blueprint/i);
  const card = page.locator(".blueprint-card").filter({ hasText: "Starter plant" });
  await expect(card).toContainText("Pilot Plant");
  const download = page.waitForEvent("download");
  await card.getByRole("button", { name: "Download" }).click();
  await download;
  await page.getByTestId("blueprint-json").fill("{not valid json");
  await page.getByTestId("blueprint-import").click();
  await expect(page.getByTestId("blueprint-status")).toContainText(/invalid JSON|Could not import/i);

  await page.evaluate((save) => {
    localStorage.removeItem("hexapharma.save.checkpoint.0");
    localStorage.setItem("hexapharma.save.slot.0", save);
  }, preparedFacilitiesSave(15));
  await page.getByTestId("load").click();
  await expect(page.getByTestId("seed")).toHaveText("15");
  await expect(page.getByText("Starter plant", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByTestId("view-blueprints").click();
  await expect(page.getByText("Starter plant", { exact: true })).toBeVisible();
});
