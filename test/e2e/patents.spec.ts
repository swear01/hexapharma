import { openMenu } from "./menu";
import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeSnapshot } from "../../src/sim/save";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
} from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";

async function confirmLoad(page: import("@playwright/test").Page): Promise<void> {
  await openMenu(page);
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

function productionCheckpoint(): string {
  const options = defaultGenOptions(14);
  const disease = generate(options).diseases[0]!;
  const layout = compileEntitledPrototype(
    disease.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  let game = createGameState(options, 9_999);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
  return JSON.stringify({ version: 2, head: serializeSnapshot(game), history: [] });
}

function revealedOf(text: string | null): number {
  if (text === null) throw new Error("Research Atlas has no revealed count");
  return Number(text);
}

test("reveal aid is a free switch that expands the next Research trial sensor", async ({ page }) => {
  await page.goto("/?cash=9999");
  const revealed = page.getByTestId("lab-map-frame");
  const before = revealedOf(await revealed.getAttribute("data-revealed"));
  await page.getByTestId("view-technology").click();
  const scanner = page.getByTestId("patent-switch-reveal-aid");
  await expect(scanner).toHaveAttribute("aria-checked", "false");
  await scanner.click();
  await expect(scanner).toHaveAttribute("aria-checked", "true");
  await expect(scanner).toHaveText("On");
  await expect(page.getByTestId("cash")).toHaveText("9999");
  await page.getByTestId("view-research").click();
  expect(revealedOf(await revealed.getAttribute("data-revealed"))).toBe(before);
  await page.getByTestId(`research-machine-${DEFAULT_CATALOG[0]!.typeId}`).click();
  await page.getByTestId("research-command").click();
  await expect.poll(async () => revealedOf(await revealed.getAttribute("data-revealed"))).toBeGreaterThan(before);
});

test("a machine switch starts on and removes then restores the same path in Research and Production Plan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("research-machine-crane")).toBeVisible();
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-switch-crane-unlock")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("patent-switch-crane-unlock").click();
  await expect(page.getByTestId("patent-switch-crane-unlock")).toHaveAttribute("aria-checked", "false");
  await page.getByTestId("view-research").click();
  await expect(page.getByTestId("research-machine-crane")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await page.getByTestId("patent-switch-crane-unlock").click();
  await page.getByTestId("view-research").click();
  await expect(page.getByTestId("research-machine-crane")).toBeVisible();
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("brush-machine-crane")).not.toHaveAttribute("aria-disabled", "true");
});

test("factory expansion confirms before resetting built Production", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.v16.checkpoint.0", checkpoint);
  }, productionCheckpoint());
  await page.reload();
  await confirmLoad(page);
  await page.getByTestId("view-technology").click();

  await page.getByTestId("patent-switch-bench-2").click();
  await expect(page.getByTestId("patent-confirm")).toContainText(/runtime and waste will reset/i);
  await expect(page.getByTestId("patent-confirm-switch")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("patent-confirm").getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("patent-confirm")).toHaveCount(0);
  await expect(page.getByTestId("patent-switch-bench-2")).toBeFocused();
  await expect(page.getByTestId("patent-switch-bench-2")).toHaveAttribute("aria-checked", "false");

  await page.getByTestId("patent-switch-bench-2").click();
  await page.getByTestId("patent-confirm-switch").click();
  await expect(page.getByTestId("patent-switch-bench-2")).toHaveAttribute("aria-checked", "true");
});

test("Technology lists every node as a free switch with only its effect", async ({ page }) => {
  await page.goto("/?cash=0");
  await page.getByTestId("view-technology").click();

  await expect(page.getByTestId("patents-effects")).toHaveText("Splitter and Merger on4 machines on");
  await expect(page.getByTestId("patents-table")).not.toContainText(/\$|knowledge|requires|contract|\blocked\b/i);
  await expect(page.getByTestId("patent-switch-loop-unlock")).toBeEnabled();
  await expect(page.getByTestId("patent-row-bench-2")).toContainText("Add 2 factory columns");
  await expect(page.getByTestId("patent-row-floor-depth")).toContainText("Add 2 factory rows");
});
