import { expect, test } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { serializeGameAuthority } from "../../src/sim/save";
import {
  BASE_GAME_FACTORY_HEIGHT,
  BASE_GAME_FACTORY_WIDTH,
} from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";

function commissionedCheckpoint(): string {
  const options = defaultGenOptions(14);
  const layout = compileEntitledPrototype(
    generate(options).diseases[0]!.reference,
    BASE_GAME_FACTORY_WIDTH,
    BASE_GAME_FACTORY_HEIGHT,
  ).layout;
  let game = createGameState(options, 9_999, 9_999);
  game = applyGameIntent(game, { kind: "setPilotLayout", layout });
  game = applyGameIntent(game, { kind: "sendPilotToProduction" });
  return JSON.stringify({ version: 2, head: serializeGameAuthority(game), history: [] });
}

function revealedOf(text: string | null): number {
  const match = /revealed\s+(\d+)\s*\/\s*\d+/.exec(text ?? "");
  if (match === null) throw new Error(`could not parse revealed-count from "${text}"`);
  return Number(match[1]);
}

test("reveal aid spends both resources and expands the next Dispense sensor", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  const revealed = page.getByTestId("revealed-count");
  const before = revealedOf(await revealed.textContent());
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("available");
  await page.getByTestId("patent-unlock-reveal-aid").click();
  await expect(page.getByTestId("patent-state-reveal-aid")).toHaveText("unlocked");
  await expect(page.getByTestId("cash")).toHaveText("9919");
  await expect(page.getByTestId("research")).toHaveText("9998");
  await page.getByTestId("view-research").click();
  expect(revealedOf(await revealed.textContent())).toBe(before);
  const frame = page.getByTestId("lab-map-frame");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await expect.poll(async () => revealedOf(await revealed.textContent())).toBeGreaterThan(before);
});

test("machine patents add the same fixed path to Research and Pilot palettes", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("research-machine-skew")).toHaveCount(0);
  await page.getByTestId("view-technology").click();
  await expect(page.getByTestId("patent-state-skew-unlock")).toHaveText("available");
  await page.getByTestId("patent-unlock-skew-unlock").click();
  await expect(page.getByTestId("patent-state-skew-unlock")).toHaveText("unlocked");
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
  await expect(page.getByTestId("patent-state-dilute-unlock")).toHaveText("locked");
  await page.getByTestId("patent-unlock-bench-2").click();
  await expect(page.getByTestId("patent-state-dilute-unlock")).toHaveText("available");
  await page.getByTestId("patent-unlock-dilute-unlock").click();
  await expect(page.getByTestId("patent-state-dilute-unlock")).toHaveText("unlocked");
  await expect(page.getByTestId("cash")).toHaveText(String(9999 - 120 - 180));
  await expect(page.getByTestId("research")).toHaveText(String(9999 - 2 - 3));
  await expect(page.getByTestId("patents-table")).not.toContainText(/unlock map|layer [b-d]/i);
  await page.getByTestId("view-research").click();
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
});

test("factory expansion confirms before resetting commissioned Production", async ({ page }) => {
  await page.goto("/");
  await page.evaluate((checkpoint) => {
    localStorage.setItem("hexapharma.save.checkpoint.0", checkpoint);
  }, commissionedCheckpoint());
  await page.reload();
  await page.getByTestId("load").click();
  await page.getByTestId("view-technology").click();

  await page.getByTestId("patent-unlock-bench-2").click();
  await expect(page.getByTestId("patent-confirm")).toContainText(/runtime and waste will reset/i);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("patent-confirm")).toHaveCount(0);
  await expect(page.getByTestId("patent-state-bench-2")).toHaveText("available");
  await expect(page.getByTestId("patent-unlock-bench-2")).toBeFocused();

  await page.getByTestId("patent-unlock-bench-2").click();
  await page.getByTestId("patent-confirm-unlock").click();
  await expect(page.getByTestId("patent-state-bench-2")).toHaveText("unlocked");
});
