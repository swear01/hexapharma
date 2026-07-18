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

async function confirmLoad(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

function productionCheckpoint(): string {
  const options = defaultGenOptions(14);
  const layout = compileEntitledPrototype(
    generate(options).diseases[0]!.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  let game = createGameState(options, 9_999, 9_999);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 1 });
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
  let endpoint: { readonly x: number; readonly y: number } | undefined;
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
  await page.mouse.click(
    box.x + box.width / 2 + (endpoint.x + 0.5 - cameraX) * 40 * zoom * box.width / 832,
    box.y + box.height / 2 + (endpoint.y + 0.5 - cameraY) * 40 * zoom * box.height / 512,
  );
}

test("reveal aid spends both resources and expands the next Dispense sensor", async ({ page }) => {
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
  await expect(page.getByTestId("research-command")).toBeEnabled();
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await expect.poll(async () => revealedOf(await revealed.textContent())).toBeGreaterThan(before);
});

test("machine patents add the same fixed path to Research and Pilot palettes", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("research-machine-skew")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-unlock-skew-unlock")).toBeEnabled();
  await page.getByTestId("patent-unlock-skew-unlock").click();
  await expect(page.getByTestId("patent-unlock-skew-unlock")).toHaveText("Owned");
  await page.getByTestId("view-research").click();
  await expect(page.getByTestId("research-machine-skew")).toBeVisible();
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("brush-machine-skew")).toBeEnabled();
});

test("factory and machine prerequisites unlock without introducing map layers", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
  await expect(page.getByTestId("map-count")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-unlock-dilute-unlock")).toBeDisabled();
  await page.getByTestId("patent-unlock-bench-2").click();
  await expect(page.getByTestId("patent-unlock-dilute-unlock")).toBeEnabled();
  await page.getByTestId("patent-unlock-dilute-unlock").click();
  await expect(page.getByTestId("patent-unlock-dilute-unlock")).toHaveText("Owned");
  await expect(page.getByTestId("cash")).toHaveText(String(9999 - 120 - 180));
  await expect(page.getByTestId("research")).toHaveText(String(9999 - 2 - 3));
  await expect(page.getByTestId("patents-table")).not.toContainText(/unlock map|layer [b-d]/i);
  await page.getByTestId("view-research").click();
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
});

test("factory expansion confirms before resetting built Production", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.checkpoint.0", checkpoint);
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
