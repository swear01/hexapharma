import { expect, test, type Page } from "@playwright/test";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { compileEntitledPrototype } from "../../src/sim/recipe";
import { SAVE_VERSION, serializeSnapshot } from "../../src/sim/save";
import { BASE_GAME_FACTORY_HEIGHT, BASE_GAME_FACTORY_WIDTH, type GameState } from "../../src/sim/phase0_interfaces";
import { defaultGenOptions } from "../../src/ui/Game";
import { openMenu } from "./menu";

test.setTimeout(90_000);

function discover(game: GameState, disease: number): GameState {
  const { reference: program, map: base } = generate(game.genOptions).diseases[disease]!;
  const switched = base === 1 ? applyGameIntent(game, { kind: "setPatent", id: "oil-base", enabled: true }) : game;
  return applyGameIntent(switched, { kind: "runResearchTrial", program, base });
}

function fixture(): GameState {
  let game = discover(createGameState(defaultGenOptions(14), 9999), 0);
  const program = generate(game.genOptions).diseases[0]!.reference;
  const layout = compileEntitledPrototype(program, BASE_GAME_FACTORY_WIDTH, BASE_GAME_FACTORY_HEIGHT).layout;
  game = applyGameIntent(game, { kind: "buildProductionLayout", layout });
  game = applyGameIntent(game, { kind: "productionTicks", ticks: 400 });
  game = applyGameIntent(game, { kind: "sellProducts", disease: 0, productIds: game.inventory.slice(0, 3).map((product) => product.inventoryId) });
  return discover(game, 1);
}

const checkpointKey = `hexapharma.save.v${SAVE_VERSION}.checkpoint.0`;

async function loadFixture(page: Page, game = fixture()): Promise<void> {
  await page.goto("/");
  await page.evaluate(({ key, checkpoint }) => localStorage.setItem(key, checkpoint), {
    key: checkpointKey,
    checkpoint: JSON.stringify({ version: 2, head: serializeSnapshot(game), history: [] }),
  });
  await page.reload();
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("button", { name: "Load saved game", exact: true }).click();
  await page.keyboard.press("Escape");
}

test("Research keeps no formula ledger or Formulas drawer", async ({ page }) => {
  await loadFixture(page);
  await expect(page.getByTestId("view-formulas")).toHaveCount(0);
  await expect(page.getByText(/F-0\d/)).toHaveCount(0);
  await expect(page.getByTestId("research-atlas-outcome")).toContainText("Cure Disease 2");
});

async function readProduction(page: Page): Promise<readonly (string | null)[]> {
  return Promise.all(["factory-tick", "factory-produced", "factory-waste", "cash", "stock"].map((id) => page.getByTestId(id).textContent()));
}

test("an open drawer suppresses factory input across resize without pausing Production", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loadFixture(page, discover(createGameState(defaultGenOptions(14), 1000), 0));
  await page.getByTestId("view-production").click();
  const box = (await page.getByTestId("production-facility-workspace").locator("canvas").boundingBox())!;
  await page.mouse.click(box.x + 12 + Math.sqrt(3) * 21 / 2, box.y + 12 + 21);
  await page.getByTestId("factory-play").click();
  await openMenu(page);
  await page.getByTestId("view-help").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("heading", { name: "Guide" }).click();
  const direction = await page.getByTestId("brush-direction").getAttribute("aria-label");
  const tick = Number(await page.getByTestId("factory-tick").textContent());
  await page.keyboard.press("2");
  await page.keyboard.press("r");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("brush-selected")).toHaveAccessibleName("belt");
  await expect(page.getByTestId("brush-direction")).toHaveAccessibleName(direction!);
  await expect(page.getByTestId("factory-undo")).toBeEnabled();
  await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(tick);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press("Escape");
  await page.getByTestId("brush-belt").click();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("factory-undo")).toBeDisabled();
});

test("Escape closes Blueprints and Menu after their fields receive focus", async ({ page }) => {
  await loadFixture(page);
  await page.getByTestId("view-blueprints").click();
  await page.getByTestId("blueprint-name").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("blueprint-name")).toBeHidden();
  await openMenu(page);
  await page.getByTestId("save-slot").focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("save-slot")).toBeHidden();
  await openMenu(page);
  await page.getByTestId("view-help").click();
  await page.getByTestId("view-menu").click();
  await expect(page.getByRole("heading", { name: "Guide" })).toBeHidden();
  await expect(page.getByTestId("menu-drawer")).toBeHidden();
});

test("Research hotkeys work only while the world is visible", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadFixture(page, discover(createGameState(defaultGenOptions(14), 1000), 0));
  await openMenu(page);
  await page.getByTestId("view-help").click();
  await page.getByRole("heading", { name: "Guide" }).click();
  const cash = await page.getByTestId("cash").textContent();
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cash")).toHaveText(cash!);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByTestId("lab-map-frame").click({ position: { x: 600, y: 80 } });
  await page.keyboard.press("2");
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cash")).not.toHaveText(cash!);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
});

for (const action of ["new", "load", "rewind", "unlock", "delete"] as const) {
  test(`running Production freezes behind ${action} confirmation and Cancel resumes`, async ({ page }) => {
    await loadFixture(page);
    await page.getByTestId("view-production").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-step").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-play").click();
    await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(401);
    if (action === "new" || action === "load" || action === "rewind") {
      await openMenu(page);
      await page.getByTestId(action === "new" ? "new-game" : action).click();
    } else if (action === "unlock") {
      await page.getByTestId("view-technology").click();
      await page.getByTestId("patent-switch-bench-2").click();
    } else {
      await page.getByTestId("view-blueprints").click();
      await page.getByTestId("blueprint-name").fill("Pause fixture");
      await page.getByTestId("blueprint-save-production").click();
      await page.getByRole("button", { name: "Delete Pause fixture", exact: true }).click();
    }
    const modal = page.getByRole("alertdialog");
    await expect(modal).toBeVisible();
    const before = await readProduction(page);
    const checkpoint = await page.evaluate((key) => localStorage.getItem(key), checkpointKey);
    await page.waitForTimeout(700);
    for (const key of [".", "r", "F1", "m", "Control+s"]) await page.keyboard.press(key);
    expect(await readProduction(page)).toEqual(before);
    expect(await page.evaluate((key) => localStorage.getItem(key), checkpointKey)).toBe(checkpoint);
    await modal.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(Number(before[0]));
    if (action === "delete") {
      await page.getByRole("button", { name: "Delete Pause fixture", exact: true }).click();
      const beforeDelete = Number(await page.getByTestId("factory-tick").textContent());
      await page.getByRole("button", { name: "Delete blueprint", exact: true }).click();
      await expect.poll(async () => Number(await page.getByTestId("factory-tick").textContent())).toBeGreaterThan(beforeDelete);
    }
    await page.getByTestId("view-production").click();
    await page.getByTestId("factory-pause").click();
  });
}

test("Cancel does not start a paused factory; confirmed Load and New stop the previous timer", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-production").click();
  await openMenu(page);
  await page.getByTestId("new-game").click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await page.getByTestId("factory-play").click();
  await expect(page.getByTestId("factory-tick")).not.toHaveText("0");
  await openMenu(page);
  await page.getByTestId("load").click();
  await page.getByRole("button", { name: "Load saved game", exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("factory-play")).toBeEnabled();
  await page.getByTestId("factory-play").click();
  await openMenu(page);
  await page.getByTestId("new-game").click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.getByTestId("view-production").click();
  await page.waitForTimeout(400);
  await expect(page.getByTestId("factory-tick")).toHaveText("0");
  await expect(page.getByTestId("factory-play")).toBeEnabled();
});

for (const action of ["unlock", "rewind"] as const) {
  test(`confirmed ${action} replaces the runtime and leaves Production paused`, async ({ page }) => {
    await loadFixture(page);
    await page.getByTestId("view-production").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-step").click();
    await page.keyboard.press("Control+s");
    await page.getByTestId("factory-play").click();
    if (action === "unlock") {
      await page.getByTestId("view-technology").click();
      await page.getByTestId("patent-switch-bench-2").click();
      await page.getByTestId("patent-confirm-switch").click();
    } else {
      await openMenu(page);
      await page.getByTestId("rewind").click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Rewind", exact: true }).click();
    }
    await page.getByTestId("view-production").click();
    await expect(page.getByTestId("factory-play")).toBeEnabled();
    const after = await readProduction(page);
    await page.waitForTimeout(500);
    expect(await readProduction(page)).toEqual(after);
  });
}
