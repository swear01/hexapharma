import { installSaveFixture } from "./checkpoint";
import { openMenu } from "./menu";
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
  const empty = createGameState(options, 10_000);
  const buildCost = quoteProductionBuild(empty.production.layout, layout);
  let game = createGameState(options, buildCost + 1_000);
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 400 });
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
  await installSaveFixture(page, preparedMarketSave(priorSales));
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("alertdialog", { name: "Load saved game?" })
    .getByRole("button", { name: "Load saved game" })
    .click();
  await page.getByTestId("view-market").click();
}

test("Market shows stock, next-unit net and Ship, with the sum in a tooltip", async ({ page }) => {
  await loadMarket(page, 0);
  const row = page.getByTestId("shop-row-0");

  await expect(row.getByTestId("shop-net-0")).toHaveText("$48");
  await expect(row.locator(".market-net")).toHaveAttribute("title", "$70 price − $22 cost. Each unit shipped lowers the next price.");
  await expect(row.getByTestId("shop-clean-0")).toBeVisible();
  await expect(row.getByTestId("shop-ladder-0")).toHaveCount(0);
  await expect(row).not.toContainText(/contract|sold/i);
  await expect(page.getByTestId("market-drawer")).not.toContainText("Every unit shipped");

  await row.getByTestId("shop-sell-0").click();
  await expect(page.getByTestId("market-sale-feedback")).toHaveText("Shipped 1");
});

test("Market gives a visible reason when no stock can ship profitably", async ({ page }) => {
  await loadMarket(page, 25);
  const row = page.getByTestId("shop-row-0");

  await expect(row.getByTestId("shop-net-0")).toHaveText("−$8");
  await expect(row.getByTestId("shop-disabled-reason-0")).toHaveText(
    "No profitable stock at next price.",
  );
  await expect(row.getByTestId("shop-sell-0")).toBeDisabled();
  await expect(row.getByTestId("shop-sell-all-0")).toBeDisabled();

  const emptyRow = page.getByTestId("shop-row-1");
  await expect(emptyRow.getByTestId("shop-sell-1")).toHaveCount(0);
  await expect(emptyRow.getByTestId("shop-next-1")).toBeVisible();
});

test("Factory machine tooltip distinguishes speed from per-unit processing cost", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();

  await expect(page.getByTestId("pilot-facility-workspace").getByTestId("brush-machine-hook"))
    .toHaveAttribute("title", "Hook pump · 3 ticks/unit · Processing $3/unit");
});
