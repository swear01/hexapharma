import { installSaveFixture } from "./checkpoint";
import { openMenu } from "./menu";
import { expect, test, type Page } from "@playwright/test";
import { LAB_VIEWPORT, focusLabCamera } from "../../src/render/labCamera";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { applyTemplate } from "../../src/sim/drug-graph";
import type { HexCoord } from "../../src/sim/hex";
import { generate } from "../../src/sim/mapgen";
import { serializeGame } from "../../src/sim/save";
import { DEFAULT_CATALOG } from "../../src/sim/phase0_interfaces";
import { researchDrugPoint } from "../../src/ui/App";
import { defaultGenOptions, researchBaseLevel, researchPlanningPreview, type ResearchRoute } from "../../src/ui/Game";

test.setTimeout(60_000);

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`clipped Atlas can bring both map corners into view at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?seed=14");
    await expect(page.getByTestId("lab-canvas").locator("canvas")).toBeVisible();
    const frame = page.getByTestId("lab-map-frame");
    for (const end of [0, defaultGenOptions(14).width - 1]) {
      const box = (await frame.boundingBox())!;
      const near = { x: box.x + 50, y: box.y + 60 };
      const far = { x: box.x + box.width - 50, y: box.y + box.height - 70 };
      const from = end === 0 ? near : far;
      const to = end === 0 ? far : near;
      for (let drag = 0; drag < 14; drag++) {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 2 });
        await page.mouse.up();
      }
      const canvas = (await page.getByTestId("lab-canvas").boundingBox())!;
      const center = focusLabCamera({ q: end, r: end });
      const x = canvas.x + canvas.width / 2 + (center.x - Number(await frame.getAttribute("data-camera-x"))) * canvas.width / LAB_VIEWPORT.width;
      const y = canvas.y + canvas.height / 2 + (center.y - Number(await frame.getAttribute("data-camera-y"))) * canvas.height / LAB_VIEWPORT.height;
      expect(x).toBeGreaterThanOrEqual(box.x);
      expect(x).toBeLessThanOrEqual(box.x + box.width);
      expect(y).toBeGreaterThanOrEqual(box.y);
      expect(y).toBeLessThanOrEqual(box.y + box.height);
    }
  });
}

async function confirmLoad(page: Page): Promise<void> {
  await openMenu(page);
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

function known(text: string | null): number {
  if (text === null) throw new Error("Research Atlas has no revealed count");
  return Number(text);
}

function plannedRoute(typeId: string, stepCount = 1): ResearchRoute {
  const options = defaultGenOptions(14);
  const level = researchBaseLevel(generate(options), 0);
  const game = createGameState(options, 200);
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`unknown Research machine ${typeId}`);
  return researchPlanningPreview(level.mm, [game.fog[0]!], level.start, {
    steps: Array.from({ length: stepCount }, () => entry),
  });
}

/** Drawn end of the planned route (may sit half-way inside a swamp). */
function plannedEndpoint(typeId: string, stepCount = 1): HexCoord {
  const endpoint = plannedRoute(typeId, stepCount).controls.at(-1);
  if (endpoint === undefined) throw new Error(`${typeId} has no planned endpoint`);
  return endpoint;
}

/** Screen point of the planned route's last control cell (its click target). */
async function lastControlPoint(
  page: Page,
  typeId: string,
  stepCount = 1,
): Promise<{ readonly x: number; readonly y: number }> {
  const canvas = page.getByTestId("lab-canvas");
  const frame = page.getByTestId("lab-map-frame");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Research canvas has no bounds");
  const cameraX = Number(await frame.getAttribute("data-camera-x"));
  const cameraY = Number(await frame.getAttribute("data-camera-y"));
  const cameraZoom = Number(await frame.getAttribute("data-camera-zoom"));
  const cell = plannedRoute(typeId, stepCount).drug.pos[0]!;
  const cellCamera = focusLabCamera(cell);
  return {
    x: box.x + box.width / 2
      + (cellCamera.x - cameraX) * cameraZoom * box.width / LAB_VIEWPORT.width,
    y: box.y + box.height / 2
      + (cellCamera.y - cameraY) * cameraZoom * box.height / LAB_VIEWPORT.height,
  };
}

async function planSteps(page: Page, typeId: string, count: number): Promise<void> {
  for (let step = 0; step < count; step++) await page.getByTestId(`research-machine-${typeId}`).click();
}

test("Research is one large centered Atlas with no Route Floor or layer-transfer controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("objective-text")).toHaveText("Find Disease 1 on Saline · look west");
  await expect(page.getByTestId("research-mission")).toHaveAttribute("data-sector", "west");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame).toBeVisible();
  const level = generate(defaultGenOptions(14));
  const start = level.start.pos[0]!;
  const startCamera = focusLabCamera(start);
  expect(start).toEqual(level.mm.maps[0]!.origin);
  await expect(frame).toHaveAttribute("data-camera-x", String(startCamera.x));
  await expect(frame).toHaveAttribute("data-camera-y", String(startCamera.y));
  await expect(page.getByTestId("research-cures")).toHaveCount(0);
  await expect(page.getByTestId("lab-zoom")).toHaveCount(0);

  const frameBox = await frame.boundingBox();
  const stageBox = await page.getByTestId("game-stage").boundingBox();
  if (frameBox === null || stageBox === null) throw new Error("Research Atlas has no bounds");
  expect(frameBox.width).toBeGreaterThan(stageBox.width * 0.84);
  expect(frameBox.height).toBeGreaterThan(stageBox.height * 0.8);
  await expect(page.getByTestId("research-atlas")).toBeVisible();
  await expect(page.getByTestId("research-workspace")).toBeVisible();
  await expect(page.getByTestId("research-path-hotbar")).toBeVisible();
  await expect(page.locator("[data-testid^='lab-layer-']")).toHaveCount(0);
  await expect(page.getByTestId("map-count")).toHaveCount(0);
  await expect(page.getByTestId("research-workspace").locator("[data-testid='factory-canvas']"))
    .toHaveCount(0);
  for (const obsolete of [
    "Route Floor",
    "Effect Atlas",
    "Planning is safe",
    "No clock · layout edits are free",
    "swap01",
    "phase transfer",
  ]) {
    await expect(page.getByText(obsolete, { exact: false })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: /swap|phase|transfer/i })).toHaveCount(0);
});

test("planning is free; Run pays the whole route once and reveals only its actual trail", async ({
  page,
}) => {
  await page.goto("/?cash=200");
  const frame = page.getByTestId("lab-map-frame");
  const canvas = frame.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const push = page.getByTestId("research-machine-hook");
  await expect(push.locator("[data-icon-shape='path']")).toHaveCount(1);
  await expect(page.getByTestId("research-calibration")).toHaveCount(0);
  await expect(page.getByTestId("research-abort")).toHaveCount(0);
  await expect(page.getByTestId("research-command")).toBeDisabled();
  await expect(page.getByTestId("research-command")).toHaveText("Run · $0");

  const cash = page.getByTestId("cash");
  const revealed = page.getByTestId("lab-map-frame");
  const cashBefore = Number(await cash.textContent());
  const revealedBefore = known(await revealed.getAttribute("data-revealed"));
  const emptyPlan = await canvas.screenshot({ animations: "disabled" });
  await push.click();
  await page.waitForTimeout(50);
  expect((await canvas.screenshot({ animations: "disabled" })).equals(emptyPlan)).toBe(false);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem").first())
    .toContainText("Hook pump");
  const stepName = page.getByTestId("research-program-strip").locator(".research-step-name").first();
  await expect(stepName).toHaveAttribute("title", "Hook pump");
  expect(await stepName.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem").first())
    .toContainText("$3");
  await expect(cash).toHaveText(String(cashBefore));
  expect(known(await revealed.getAttribute("data-revealed"))).toBe(revealedBefore);
  await expect(page.getByTestId("research-atlas-outcome")).toHaveCount(0);

  await push.click();
  await expect(page.getByTestId("research-command")).toHaveText("Run · $6");
  await page.getByTestId("research-command").click();
  await expect(cash).toHaveText(String(cashBefore - 6));
  expect(known(await revealed.getAttribute("data-revealed"))).toBeGreaterThan(revealedBefore);
  await expect(page.getByTestId("research-atlas-outcome")).toContainText(/side effects/i);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(2);

  await page.keyboard.press("Enter");
  await expect(cash).toHaveText(String(cashBefore - 12));
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(2);
});

test("hovering and clicking the last control removes the last planned step", async ({ page }) => {
  await page.goto("/?cash=200");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await planSteps(page, "wave", 2);
  const target = await lastControlPoint(page, "wave", 2);
  await page.mouse.move(target.x, target.y);
  await expect(frame).toHaveCSS("cursor", "pointer");
  await expect(frame).toHaveAttribute("title", "Remove last step");
  const box = (await frame.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await expect(frame).toHaveCSS("cursor", "grab");
  await expect(frame).toHaveAttribute("title", "Drag map");
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(2);
  await page.mouse.click(target.x, target.y);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("cash")).toHaveText("200");
});

test("number keys append, Backspace and Ctrl+Z remove, Clear empties, and Enter runs", async ({ page }) => {
  await page.goto("/?cash=200");
  const available = DEFAULT_CATALOG.slice(0, 4);
  await expect(page.getByTestId(`research-machine-${available[0]!.typeId}`))
    .toHaveAttribute("title", "Add Hook pump (1)");
  const fullPaths = await page.getByTestId("research-path-hotbar").locator("[data-icon-shape='path']")
    .evaluateAll((paths) => paths.map((path) => path.getAttribute("points")));
  expect(new Set(fullPaths).size).toBe(available.length);
  await page.keyboard.press("Digit2");
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("research-cash-after")).toHaveText(`$${200 - available[1]!.cost} left`);
  const selectedName = page.getByTestId("research-program-strip").locator(".research-step-name").first();
  await expect(selectedName).toHaveAttribute("title", "Elbow press");
  await page.keyboard.press("Digit1");
  await page.keyboard.press("Digit1");
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(3);
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(2);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("cash")).toHaveText("200");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cash")).toHaveText(String(200 - available[1]!.cost));
  await page.getByTestId("research-clear").click();
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(0);
  await expect(page.getByTestId("research-undo")).toBeDisabled();
  await page.keyboard.press("Digit1");
  await page.getByTestId("research-undo").click();
  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cash")).toHaveText(String(200 - available[1]!.cost));
});

test("hotbar glyphs rotate to the heading at the end of the planned route", async ({ page }) => {
  await page.goto("/");
  const glyph = page.getByTestId("research-machine-wave").locator("[data-icon-shape='path']");
  const ahead = await glyph.getAttribute("points");
  await page.getByTestId("research-machine-hook").click();
  expect(plannedRoute("hook").drug.heading).toBe(1);
  await expect(glyph).not.toHaveAttribute("points", ahead ?? "");
  await page.keyboard.press("Backspace");
  await expect(glyph).toHaveAttribute("points", ahead ?? "");
});

test("native Enter activates a focused Research button instead of running the route", async ({ page }) => {
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });

  const push2 = page.getByTestId("research-machine-wave");
  await push2.focus();
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(1);
  await expect(page.getByTestId("cash")).toHaveText("200");
});

test("Research focus hotkey does not consume text entry in a drawer", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("b");
  const name = page.getByTestId("blueprint-name");
  await name.fill("");
  await name.press("f");
  await expect(name).toHaveValue("f");
});

test("a non-curing Run preserves the player's camera", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-wave").click();
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  const cameraX = await frame.getAttribute("data-camera-x");
  const cameraY = await frame.getAttribute("data-camera-y");
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-atlas-outcome")).toContainText(/side effects/i);
  await expect(frame).toHaveAttribute("data-camera-x", cameraX!);
  await expect(frame).toHaveAttribute("data-camera-y", cameraY!);
  await expect(page.getByTestId("lab-focus")).toHaveAttribute("aria-label", "Focus next endpoint");
});

test("a Research camera stays where the player left it across facilities", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-wave").click();
  await page.getByTestId("research-command").click();

  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  const pannedX = await frame.getAttribute("data-camera-x");
  const pannedY = await frame.getAttribute("data-camera-y");

  await page.keyboard.press("F2");
  await expect(page.getByTestId("pilot-facility-workspace")).toBeVisible();
  await page.keyboard.press("F1");
  await expect(frame).toBeVisible();
  await expect(frame).toHaveAttribute("data-camera-x", pannedX!);
  await expect(frame).toHaveAttribute("data-camera-y", pannedY!);
});

test("Next focus follows the end of the growing planned route", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lab-focus")).toHaveAttribute("aria-label", "Focus dose");

  for (let stepCount = 1; stepCount <= 3; stepCount++) {
    await page.getByTestId("research-machine-wave").click();
    await expect(page.getByTestId("lab-focus")).toHaveAttribute("aria-label", "Focus next endpoint");
    const endpointCamera = focusLabCamera(plannedEndpoint("wave", stepCount));
    await page.getByTestId("lab-focus").click();
    await expect(frame).toHaveAttribute("data-camera-x", String(endpointCamera.x));
    await expect(frame).toHaveAttribute("data-camera-y", String(endpointCamera.y));
  }
});

test("a resolved outcome keeps its feedback while focus stays on the planned endpoint", async ({ page }) => {
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-hook").click();
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-atlas-outcome")).toBeVisible();
  const focus = page.getByTestId("lab-focus");
  await expect(focus).toHaveAttribute("aria-label", "Focus next endpoint");
  await focus.click();
  const endpointCamera = focusLabCamera(plannedEndpoint("hook", 1));
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame).toHaveAttribute("data-camera-x", String(endpointCamera.x));
  await expect(frame).toHaveAttribute("data-camera-y", String(endpointCamera.y));
});

test("a curing trial reports the Cure without a formula card and the objective points to Plan", async ({ page }) => {
  const options = defaultGenOptions(14);
  const level = generate(options);
  let game = createGameState(options, 1_000);
  game = applyGameIntent(game, { kind: "runResearchTrial", program: level.diseases[0]!.reference, base: 0 });
  expect(game.research.lastTrial?.outcome.cured).toContain(0);

  await page.goto("/");
  await expect(page.getByTestId("objective-text")).toHaveText(/^Find Disease 1 on Saline · look /);
  await installSaveFixture(page, serializeGame(game));
  await page.reload();
  await confirmLoad(page);
  await expect(page.getByTestId("research-atlas-outcome")).toContainText("Cure Disease 1");
  await expect(page.getByRole("status", { name: /Cure found/ })).toHaveCount(0);
  await expect(page.getByTestId("research-open-plan")).toHaveCount(0);
  await expect(page.getByTestId("objective-text")).toHaveText("Plan a line to Disease 1 on Saline");
  await page.getByTestId("objective-action").click();
  await expect(page.getByTestId("pilot-facility-workspace")).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`a trial that resolves a Cure brings its actual finish into view at ${viewport.width}px`, async ({ page }) => {
    const options = defaultGenOptions(14);
    const level = researchBaseLevel(generate(options), 0);
    const reference = level.diseases[0]!.reference.steps;
    const finish = applyTemplate(level.mm, level.start, { steps: reference });
    const finishPoint = researchDrugPoint(finish, 0)!;

    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
    for (const machine of reference) await page.getByTestId(`research-machine-${machine.typeId}`).click();
    await expect(page.getByTestId("research-program-strip").getByRole("listitem")).toHaveCount(reference.length);
    await page.getByTestId("research-command").click();
    const readout = page.locator(".research-result");
    await expect(page.getByTestId("research-atlas-outcome")).toContainText("Cure Disease 1");
    const frame = page.getByTestId("lab-map-frame");
    let settled = "";
    await expect.poll(async () => {
      const next = `${await frame.getAttribute("data-camera-x")},${await frame.getAttribute("data-camera-y")},${await frame.getAttribute("data-camera-zoom")}`;
      const same = next === settled;
      settled = next;
      return same;
    }, { intervals: [150] }).toBe(true);
    const canvas = (await page.getByTestId("lab-canvas").boundingBox())!;
    const box = (await frame.boundingBox())!;
    const readoutBox = (await readout.boundingBox())!;
    const [cameraX, cameraY, zoom] = settled.split(",").map(Number) as [number, number, number];
    const projected = focusLabCamera(finishPoint);
    const x = canvas.x + canvas.width / 2 + (projected.x - cameraX) * zoom * canvas.width / LAB_VIEWPORT.width;
    const y = canvas.y + canvas.height / 2 + (projected.y - cameraY) * zoom * canvas.height / LAB_VIEWPORT.height;
    expect(x).toBeGreaterThan(box.x);
    expect(x).toBeLessThan(box.x + box.width);
    expect(y).toBeGreaterThan(box.y);
    expect(y).toBeLessThan(box.y + box.height);
    const underReadout = x >= readoutBox.x && x <= readoutBox.x + readoutBox.width
      && y >= readoutBox.y && y <= readoutBox.y + readoutBox.height;
    expect(underReadout, "the finish must not sit under the result readout").toBe(false);
  });
}

test("Research pan, zoom, and focus preserve the manually controlled camera", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(frame).toHaveAttribute("data-camera-zoom", "1");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.wheel(0, -500);
  await expect(frame).not.toHaveAttribute("data-camera-zoom", "1");
  await page.keyboard.press("f");
  await expect(frame).toHaveAttribute("data-camera-zoom", "1");
});

test("compact Research keeps every command and path control reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lab-focus").locator(".lab-focus-label")).toBeVisible();
  const stage = await page.getByTestId("game-stage").boundingBox();
  const nav = await page.getByTestId("nav-rail").boundingBox();
  if (stage === null || nav === null) throw new Error("compact Research chrome has no bounds");
  for (const testId of ["research-command", "research-undo", "research-clear", "research-path-hotbar"]) {
    const control = await page.getByTestId(testId).boundingBox();
    if (control === null) throw new Error(`${testId} has no compact bounds`);
    expect(control.x).toBeGreaterThanOrEqual(stage.x);
    expect(control.x + control.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(control.y).toBeGreaterThanOrEqual(stage.y);
    expect(control.y + control.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    expect(control.y).toBeGreaterThanOrEqual(nav.y + nav.height);
  }
  for (const testId of ["research-command", "research-undo", "research-clear", "lab-focus"]) {
    const target = await page.getByTestId(testId).boundingBox();
    if (target === null) throw new Error(`${testId} has no touch target`);
    expect(target.height, `${testId} must be at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
});

test("compact Research keeps resolved feedback separate from its path controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-hook").click();
  await page.getByTestId("research-command").click();
  const outcome = page.getByTestId("research-atlas-outcome");
  await expect(outcome).toBeVisible();
  expect(await outcome.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const outcomeBox = await outcome.boundingBox();
  const hotbarBox = await page.getByTestId("research-path-hotbar").boundingBox();
  const navBox = await page.getByTestId("nav-rail").boundingBox();
  if (outcomeBox === null || hotbarBox === null || navBox === null) {
    throw new Error("compact Research outcome chrome has no bounds");
  }
  for (const testId of ["lab-focus"]) {
    const statusControl = await page.getByTestId(testId).boundingBox();
    if (statusControl === null) throw new Error(`${testId} has no compact outcome bounds`);
    expect(statusControl.y + statusControl.height, `${testId} must stay above the path hotbar`)
      .toBeLessThanOrEqual(hotbarBox.y + 1);
  }
  expect(outcomeBox.y + outcomeBox.height).toBeLessThanOrEqual(hotbarBox.y + 1);
  expect(outcomeBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height);
});

test("the Research Atlas has no recipe timeline or unclosable Pilot Bench", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("recipe-track")).toHaveCount(0);
  await expect(page.getByTestId("pilot-bench")).toHaveCount(0);
  await expect(page.getByTestId("research-atlas")).toBeVisible();
});

test("a Research renderer initialization failure is visible and handled", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.route("**/src/render/labRenderer.ts*", async (route) => {
    await route.fulfill({
      contentType: "application/javascript",
      body: 'export async function createLabRenderer() { throw new Error("synthetic init failure"); }',
    });
  });
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(/synthetic init failure/i);
  expect(errors).toEqual([]);
});
