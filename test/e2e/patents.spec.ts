import { openMenu } from "./menu";
import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeGameAuthority } from "../../src/sim/save";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
  DEFAULT_CATALOG,
} from "../../src/sim/phase0_interfaces";
import { defaultGenOptions, researchPlanningTrails } from "../../src/ui/Game";
import { focusLabCamera } from "../../src/render/labCamera";
import type { HexCoord } from "../../src/sim/hex";

async function confirmLoad(page: import("@playwright/test").Page): Promise<void> {
  await openMenu(page);
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

function productionCheckpoint(completeFirstContract = false): string {
  const options = defaultGenOptions(14);
  const disease = generate(options).diseases[0]!;
  const layout = compileEntitledPrototype(
    disease.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  let game = createGameState(options, 9_999, 9_999);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: completeFirstContract ? 400 : 1 });
  if (completeFirstContract) {
    game = applyGameIntent(game, {
      kind: "sellProducts",
      productIds: game.inventory
        .filter((product) => product.outcome.cured.includes(disease.id))
        .slice(0, 3)
        .map((product) => product.inventoryId),
      disease: disease.id,
    });
  }
  return JSON.stringify({ version: 2, head: serializeGameAuthority(game), history: [] });
}

function revealedOf(text: string | null): number {
  const match = /revealed\s+(\d+)\s*\/\s*\d+/.exec(text ?? "");
  if (match === null) throw new Error(`could not parse revealed-count from "${text}"`);
  return Number(match[1]);
}

async function clickFirstCandidateEndpoint(page: import("@playwright/test").Page): Promise<void> {
  const options = defaultGenOptions(14);
  const level = generate(options);
  const game = createGameState(options, 9_999, 9_999);
  const trail = researchPlanningTrails(level.mm, game.fog, level.start, {
    steps: [DEFAULT_CATALOG[0]!],
  })[0] ?? [];
  let endpoint: HexCoord | undefined;
  for (let index = trail.length - 1; index >= 0; index--) {
    const point = trail[index];
    if (point !== null && point !== undefined) {
      endpoint = point;
      break;
    }
  }
  if (endpoint === undefined) throw new Error("default Research machine has no preview endpoint");

  const frame = page.getByTestId("lab-map-frame");
  const canvas = page.getByTestId("lab-canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Research canvas has no bounds");
  const cameraX = Number(await frame.getAttribute("data-camera-x"));
  const cameraY = Number(await frame.getAttribute("data-camera-y"));
  const zoom = Number(await frame.getAttribute("data-camera-zoom"));
  const endpointCenter = focusLabCamera(endpoint);
  await page.mouse.click(
    box.x + box.width / 2 + (endpointCenter.x - cameraX) * zoom * box.width / 832,
    box.y + box.height / 2 + (endpointCenter.y - cameraY) * zoom * box.height / 512,
  );
}

test("reveal aid spends both resources and expands the next tested cartridge sensor", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  const revealed = page.getByTestId("revealed-count");
  const before = revealedOf(await revealed.textContent());
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-unlock-reveal-aid")).toBeEnabled();
  await page.getByTestId("patent-unlock-reveal-aid").click();
  await expect(page.getByTestId("patent-unlock-reveal-aid")).toHaveText("Owned");
  await expect(page.getByTestId("patent-unlock-reveal-aid")).toBeDisabled();
  await expect(page.getByTestId("cash")).toHaveText("9919");
  await expect(page.getByTestId("research")).toHaveText("9998");
  await page.getByTestId("view-research").click();
  expect(revealedOf(await revealed.textContent())).toBe(before);
  await clickFirstCandidateEndpoint(page);
  await expect.poll(async () => revealedOf(await revealed.textContent())).toBeGreaterThan(before);
});

test("machine patents add the same fixed path to Research and Production Plan palettes", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("research-machine-skew")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-row-skew-unlock"))
    .toContainText("Ship 3 more for Disease 1 contract (0/3)");
  await expect(page.getByTestId("patent-unlock-skew-unlock")).toBeDisabled();

  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.v10.checkpoint.0", checkpoint);
  }, productionCheckpoint(true));
  await page.reload();
  await confirmLoad(page);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-row-skew-unlock"))
    .not.toContainText("Disease 1 contract");
  await expect(page.getByTestId("patent-unlock-skew-unlock")).toBeEnabled();
  await page.getByTestId("patent-unlock-skew-unlock").click();
  await expect(page.getByTestId("patent-unlock-skew-unlock")).toHaveText("Owned");
  await page.getByTestId("view-research").click();
  await expect(page.getByTestId("research-machine-skew")).toBeVisible();
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("brush-machine-skew")).toBeEnabled();
});

test("factory prerequisites do not bypass contract gates or introduce map layers", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
  await expect(page.getByTestId("map-count")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-unlock-dilute-unlock")).toBeDisabled();
  await page.getByTestId("patent-unlock-bench-2").click();
  await expect(page.getByTestId("patent-row-dilute-unlock"))
    .toContainText("Ship 3 more for Disease 2 contract (0/3)");
  await expect(page.getByTestId("patent-unlock-dilute-unlock")).toBeDisabled();
  await expect(page.getByTestId("cash")).toHaveText(String(9999 - 120));
  await expect(page.getByTestId("research")).toHaveText(String(9999 - 2));
  await expect(page.getByTestId("patents-table")).not.toContainText(/unlock map|layer [b-d]/i);
  await page.getByTestId("view-research").click();
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
});

test("factory expansion confirms before resetting built Production", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.v10.checkpoint.0", checkpoint);
  }, productionCheckpoint());
  await page.reload();
  await confirmLoad(page);
  await page.getByTestId("view-technology").click();

  await page.getByTestId("patent-unlock-bench-2").click();
  await expect(page.getByTestId("patent-confirm")).toContainText(/runtime and waste will reset/i);
  await expect(page.getByTestId("patent-confirm-unlock")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("patent-confirm").getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("patent-confirm")).toHaveCount(0);
  await expect(page.getByTestId("patent-unlock-bench-2")).toBeEnabled();
  await expect(page.getByTestId("patent-unlock-bench-2")).toBeFocused();

  await page.getByTestId("patent-unlock-bench-2").click();
  await page.getByTestId("patent-confirm-unlock").click();
  await expect(page.getByTestId("patent-unlock-bench-2")).toHaveText("Owned");
});

test("Technology cards present one concise status and hide empty summaries", async ({ page }) => {
  await page.goto("/?cash=0&research=0");
  await page.getByTestId("view-technology").click();

  await expect(page.getByTestId("patents-effects")).toHaveCount(0);
  await expect(page.getByTestId("patents-table")).not.toContainText(/\+0w|\+0h|requires:\s*none|\blocked\b/i);
  await expect(page.locator("[data-testid^='patent-state-']")).toHaveCount(0);
  await expect(page.getByTestId("patent-unlock-reveal-aid")).toBeDisabled();
  await expect(page.getByTestId("patent-row-bench-2")).toContainText("Add 2 factory columns");
  await expect(page.getByTestId("patent-row-floor-depth")).toContainText("Add 2 factory rows");
  await expect(page.getByTestId("patent-row-dilute-unlock")).toContainText("Requires: Wider factory floor");
});
