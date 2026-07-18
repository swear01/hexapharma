import { expect, test } from "@playwright/test";
import { quoteProductionBuild } from "../../src/sim/construction";
import {
  applyGameIntent,
  createGameState,
} from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeGame } from "../../src/sim/save";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
} from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";

function preparedMarketSave(priorSales: number): string {
  const options = defaultGenOptions(14);
  const level = generate(options);
  const disease = level.diseases[0]!;
  const layout = compileEntitledPrototype(
    disease.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  const empty = createGameState(options, 10_000, 0);
  const buildCost = quoteProductionBuild(empty.production.layout, layout);
  let game = createGameState(options, buildCost + 1_000, 0);
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 200 });
  for (let index = 0; index < priorSales; index++) {
    const product = game.inventory[0]!;
    game = applyGameIntent(game, {
      kind: "sellProducts",
      productIds: [product.inventoryId],
      disease: disease.id,
    });
  }
  return serializeGame(game);
}

async function loadMarket(
  page: import("@playwright/test").Page,
  priorSales: number,
): Promise<void> {
  await page.goto("/");
  await page.evaluate((save) => {
    localStorage.setItem("hexapharma.save.slot.0", save);
  }, preparedMarketSave(priorSales));
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByRole("alertdialog", { name: "Load saved game?" })
    .getByRole("button", { name: "Load saved game" })
    .click();
  await page.getByTestId("view-market").click();
}

test("Market explains Ship best economics and reports Knowledge from a sale", async ({ page }) => {
  await loadMarket(page, 0);
  const row = page.getByTestId("shop-row-0");

  await expect(row.getByText("Next gross", { exact: true })).toBeVisible();
  await expect(row.getByText("Best production cost", { exact: true })).toBeVisible();
  await expect(row.getByText("Best effect penalty", { exact: true })).toBeVisible();
  await expect(row.getByText("Best net", { exact: true })).toBeVisible();
  await expect(row.getByTestId("shop-next-0")).toHaveText("96");
  await expect(row.getByTestId("shop-production-cost-0")).toHaveText("26");
  await expect(row.getByTestId("shop-side-effect-penalty-0")).toHaveText("$25 × 0 = $0");
  await expect(row.getByTestId("shop-net-0")).toHaveText("70");
  await expect(row.getByText("Tainted stock", { exact: true })).toBeVisible();

  await row.getByTestId("shop-sell-0").click();
  await expect(page.getByTestId("market-sale-feedback")).toHaveText(
    "Shipped 1 · +1 Knowledge",
  );
  await expect(page.getByTestId("research")).toHaveText("1");
});

test("Market gives a visible reason when no stock can ship profitably", async ({ page }) => {
  await loadMarket(page, 12);
  const row = page.getByTestId("shop-row-0");

  await expect(row.getByTestId("shop-next-0")).toHaveText("24");
  await expect(row.getByTestId("shop-production-cost-0")).toHaveText("26");
  await expect(row.getByTestId("shop-net-0")).toHaveText("-2");
  await expect(row.getByTestId("shop-disabled-reason-0")).toHaveText(
    "No profitable stock at next price.",
  );
  await expect(row.getByTestId("shop-sell-0")).toBeDisabled();
  await expect(row.getByTestId("shop-sell-all-0")).toBeDisabled();

  const emptyRow = page.getByTestId("shop-row-1");
  await expect(emptyRow.getByTestId("shop-disabled-reason-1")).toHaveText(
    "No curative stock.",
  );
});

test("Factory machine tooltip distinguishes speed from per-unit processing cost", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();

  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("brush-machine-push"))
    .toHaveAttribute("title", "Hook pump · 2 ticks/unit · Processing $2/unit");
});
