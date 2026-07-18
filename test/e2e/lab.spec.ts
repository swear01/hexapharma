import { expect, test, type Page } from "@playwright/test";
import { LAB_VIEWPORT, clampLabCamera, focusLabCamera } from "../../src/render/labCamera";
import { applyTemplate } from "../../src/sim/drug-graph";
import { applyGameIntent, createGameState } from "../../src/sim/game";
import { generate } from "../../src/sim/mapgen";
import { serializeGame } from "../../src/sim/save";
import { DEFAULT_CATALOG } from "../../src/sim/phase0_interfaces";
import { researchKnownCureCount, researchKnownCureLocations } from "../../src/ui/App";
import { defaultGenOptions, researchPlanningTrails } from "../../src/ui/Game";

test.setTimeout(60_000);

async function confirmLoad(page: Page): Promise<void> {
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
}

function known(text: string | null): number {
  const match = /revealed (\d+)\/\d+/.exec(text ?? "");
  if (match === null) throw new Error(`could not parse Research known count from ${String(text)}`);
  return Number(match[1]);
}

function plannedEndpoint(
  typeId: string,
  stepCount = 1,
): { readonly x: number; readonly y: number } {
  const options = defaultGenOptions(14);
  const level = generate(options);
  const game = createGameState(options, 200, 0);
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`unknown Research machine ${typeId}`);
  const trail = researchPlanningTrails(level.mm, game.fog, level.start, {
    steps: Array.from({ length: stepCount }, () => entry),
  })[0] ?? [];
  for (let index = trail.length - 1; index >= 0; index--) {
    const point = trail[index];
    if (point !== null && point !== undefined) return point;
  }
  throw new Error(`${typeId} has no Research preview endpoint`);
}

function actualEndpoint(typeId: string): { readonly x: number; readonly y: number } {
  const level = generate(defaultGenOptions(14));
  const entry = DEFAULT_CATALOG.find((candidate) => candidate.typeId === typeId);
  if (entry === undefined) throw new Error(`unknown Research machine ${typeId}`);
  const endpoint = applyTemplate(level.mm, level.start, { steps: [entry] }).pos[0];
  if (endpoint === undefined) throw new Error(`${typeId} has no Research outcome endpoint`);
  return endpoint;
}

async function candidateEndpointPoint(
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
  const endpoint = plannedEndpoint(typeId, stepCount);
  return {
    x: box.x + box.width / 2 + (endpoint.x + 0.5 - cameraX) * 40 * box.width / 832,
    y: box.y + box.height / 2 + (endpoint.y + 0.5 - cameraY) * 40 * box.height / 512,
  };
}

async function clickCandidateEndpoint(
  page: Page,
  typeId: string,
  stepCount = 1,
): Promise<void> {
  const point = await candidateEndpointPoint(page, typeId, stepCount);
  await page.mouse.click(point.x, point.y);
}

test("Research is one large centered Atlas with no Route Floor or layer-transfer controls", async ({
  page,
}) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame).toBeVisible();
  const level = generate(defaultGenOptions(14));
  const start = level.start.pos[0]!;
  expect(start).toEqual(level.mm.maps[0]!.origin);
  await expect(frame).toHaveAttribute("data-camera-x", String(start.x + 0.5));
  await expect(frame).toHaveAttribute("data-camera-y", String(start.y + 0.5));
  const generated = createGameState(defaultGenOptions(14), 200, 0);
  await expect(page.getByTestId("research-cures")).toHaveText(
    `Cure sites ${researchKnownCureCount(level.mm, generated.fog)}`,
  );

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

test("fixed paths use endpoint commit, an ordered costed route, and quoted Dispense", async ({
  page,
}) => {
  await page.goto("/?cash=200");
  const frame = page.getByTestId("lab-map-frame");
  const canvas = frame.locator("canvas");
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  const push = page.getByTestId("research-machine-push");
  await expect(push).toHaveAttribute("aria-pressed", "true");
  await expect(push.locator("[data-icon-shape='path']")).toHaveCount(1);
  await expect(page.getByTestId("research-calibration")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /shorter|longer/i })).toHaveCount(0);

  const fullPreview = await canvas.screenshot({ animations: "disabled" });
  await page.getByTestId("research-machine-push2").click();
  await page.waitForTimeout(50);
  const otherPreview = await canvas.screenshot({ animations: "disabled" });
  expect(otherPreview.equals(fullPreview)).toBe(false);
  await push.click();

  const cash = page.getByTestId("cash");
  const revealed = page.getByTestId("revealed-count");
  const cashBefore = Number(await cash.textContent());
  const revealedBefore = known(await revealed.textContent());
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  const clickBlankWorld = () => page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.2);
  const clickPushEndpoint = () => clickCandidateEndpoint(page, "push");
  const pushEndpoint = await candidateEndpointPoint(page, "push");
  await page.mouse.move(pushEndpoint.x, pushEndpoint.y);
  await expect(frame).toHaveCSS("cursor", "pointer");
  await expect(frame).toHaveAttribute("title", "Place next path");
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
  await expect(frame).toHaveCSS("cursor", "grab");
  await expect(frame).toHaveAttribute("title", "Drag map");
  await clickBlankWorld();
  await expect(page.getByTestId("research-program-count")).toHaveText("0 placed");
  await clickPushEndpoint();
  await expect(page.getByTestId("research-program-count")).toHaveText("1 placed");
  await expect(page.getByTestId("research-program-strip").getByRole("listitem"))
    .toHaveCount(1);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem").first())
    .toContainText("Hook pump");
  const stepName = page.getByTestId("research-program-strip").locator(".research-step-name").first();
  await expect(stepName).toHaveAttribute("title", "Hook pump");
  expect(await stepName.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByTestId("research-program-strip").getByRole("listitem").first())
    .toContainText("$2");
  await expect(page.getByTestId("research-shot-cost")).toHaveText("$2");
  await page.getByRole("button", { name: "Remove Hook pump step 1" }).click();
  await expect(page.getByTestId("research-program-count")).toHaveText("0 placed");
  await expect(page.getByTestId("research-program-strip")).toHaveCount(0);
  await expect(page.getByTestId("research-shot-cost")).toHaveText("$0");
  await clickPushEndpoint();
  await expect(page.getByTestId("research-program-count")).toHaveText("1 placed");
  await expect(cash).toHaveText(String(cashBefore));
  expect(known(await revealed.textContent())).toBe(revealedBefore);

  await page.getByTestId("research-command").click();
  await expect(cash).toHaveText(String(cashBefore - 2));
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await expect(page.getByTestId("research-atlas-outcome")).toContainText(/side effects/i);
});

test("machine hotkeys select paths while Enter dispenses the committed program", async ({ page }) => {
  await page.goto("/?cash=200");
  const hotbar = page.getByTestId("research-path-hotbar");
  const available = DEFAULT_CATALOG.slice(0, 4);
  await expect(page.getByTestId(`research-machine-${available[0]!.typeId}`))
    .toHaveAttribute("title", "Hook pump — previews next path (1)");
  const fullPaths = await hotbar.locator("[data-icon-shape='path']")
    .evaluateAll((paths) => paths.map((path) => path.getAttribute("points")));
  expect(new Set(fullPaths).size).toBe(available.length);
  await page.keyboard.press("Digit2");
  await expect(page.getByTestId(`research-machine-${available[1]!.typeId}`))
    .toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("[");
  await expect(page.getByTestId("research-calibration")).toHaveCount(0);
  const frame = page.getByTestId("lab-map-frame");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await clickCandidateEndpoint(page, available[1]!.typeId);
  await expect(page.getByTestId("research-program-count")).toHaveText("1 placed");
  const selectedName = page.getByTestId("research-program-strip").locator(".research-step-name").first();
  await expect(selectedName).toHaveAttribute("title", "Wave reactor");
  expect(await selectedName.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(page.getByTestId("research-shot-cost")).toHaveText(`$${available[1]!.cost}`);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("cash")).toHaveText(String(200 - available[1]!.cost));
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await page.keyboard.press("Backspace");
  await expect(page.getByTestId("research-program-count")).toHaveText("0 placed");
});

test("native Enter activates a focused Research button instead of dispensing", async ({ page }) => {
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await clickCandidateEndpoint(page, "push");
  await expect(page.getByTestId("research-program-count")).toHaveText("1 placed");

  const push2 = page.getByTestId("research-machine-push2");
  await push2.focus();
  await page.keyboard.press("Enter");

  await expect(push2).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("cash")).toHaveText("200");
  await expect(page.getByTestId("research-program-count")).toHaveText("1 placed");
  await expect(page.getByTestId("research-undo")).toHaveAttribute("aria-label", "Undo last path");
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

test("the active Research shot keeps its dose and resolved outcome in frame", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-push2").click();
  await expect(page.getByTestId("research-machine-push2")).toHaveAttribute("aria-pressed", "true");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  const endpoint = actualEndpoint("push2");
  await clickCandidateEndpoint(page, "push2");
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("lab-focus")).toHaveAttribute("aria-label", "Focus dose");
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await expect(frame).toHaveAttribute("data-camera-x", String(endpoint.x + 0.5));
  await expect(frame).toHaveAttribute("data-camera-y", String(endpoint.y + 0.5));
  await expect(page.getByTestId("research-atlas-outcome")).toContainText(/side effects/i);
  await expect(page.getByTestId("lab-focus")).toHaveAttribute("aria-label", "Focus next endpoint");
});

test("a resolved Research camera stays where the player left it across facilities", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-push2").click();
  await clickCandidateEndpoint(page, "push2");
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });

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

test("Next focus follows the held candidate at the end of a growing route", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("research-machine-push2").click();
  await expect(page.getByTestId("lab-focus")).toHaveAttribute("aria-label", "Focus next endpoint");

  for (let stepCount = 1; stepCount <= 2; stepCount++) {
    const endpoint = plannedEndpoint("push2", stepCount);
    await page.getByTestId("lab-focus").click();
    await expect(frame).toHaveAttribute("data-camera-x", String(endpoint.x + 0.5));
    await expect(frame).toHaveAttribute("data-camera-y", String(endpoint.y + 0.5));
    await clickCandidateEndpoint(page, "push2", stepCount);
    await expect(page.getByTestId("research-program-count")).toHaveText(`${stepCount} placed`);
  }

  const held = plannedEndpoint("push2", 3);
  await page.getByTestId("lab-focus").click();
  await expect(frame).toHaveAttribute("data-camera-x", String(held.x + 0.5));
  await expect(frame).toHaveAttribute("data-camera-y", String(held.y + 0.5));
});

test("a resolved outcome keeps its feedback while focus returns to the next endpoint", async ({ page }) => {
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await clickCandidateEndpoint(page, "push");
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  await expect(page.getByTestId("research-atlas-outcome")).toBeVisible();
  const focus = page.getByTestId("lab-focus");
  await expect(focus).toHaveAttribute("aria-label", "Focus next endpoint");
  await focus.click();
  const endpoint = plannedEndpoint("push", 2);
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame).toHaveAttribute("data-camera-x", String(endpoint.x + 0.5));
  await expect(frame).toHaveAttribute("data-camera-y", String(endpoint.y + 0.5));
});

test("Cure sites focuses only a Cure already present in authoritative fog", async ({ page }) => {
  const options = defaultGenOptions(14);
  const level = generate(options);
  let game = createGameState(options, 1_000, 0);
  const map = level.mm.maps[0]!;
  game = applyGameIntent(game, {
    kind: "setResearchProgram",
    program: level.diseases[0]!.reference,
  });
  game = applyGameIntent(game, { kind: "beginResearchShot" });
  while (game.research.shot !== null) {
    game = applyGameIntent(game, { kind: "advanceResearchShot" });
  }
  const knownCures = researchKnownCureLocations(level.mm, game.fog);
  const target = knownCures[0];
  if (target === undefined) throw new Error("reference route did not discover its Cure");
  const expected = clampLabCamera(focusLabCamera(target.pos), LAB_VIEWPORT, map);

  await page.goto("/");
  await page.evaluate((save) => localStorage.setItem("hexapharma.save.slot.0", save), serializeGame(game));
  await page.reload();
  await confirmLoad(page);
  const cures = page.getByTestId("research-cures");
  await expect(cures).toHaveText(`Cure sites ${knownCures.length}`);
  await expect(cures).toBeEnabled();
  await cures.click();
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame).toHaveAttribute("data-camera-x", String(expected.x));
  await expect(frame).toHaveAttribute("data-camera-y", String(expected.y));
});

test("Research pan, zoom, and focus preserve the manually controlled camera", async ({ page }) => {
  await page.goto("/");
  const frame = page.getByTestId("lab-map-frame");
  await expect(frame.locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lab-zoom")).toContainText("100%");
  const box = await frame.boundingBox();
  if (box === null) throw new Error("Research Atlas has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 + 40, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width / 2, box.y + 80);
  await page.mouse.wheel(0, -500);
  await expect(page.getByTestId("lab-zoom")).not.toContainText("100%");
  await page.keyboard.press("f");
  await expect(page.getByTestId("lab-zoom")).toContainText("100%");
});

test("compact Research keeps every command and path control reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("lab-focus").locator(".lab-focus-label")).toBeVisible();
  const stage = await page.getByTestId("game-stage").boundingBox();
  const nav = await page.getByTestId("nav-rail").boundingBox();
  if (stage === null || nav === null) throw new Error("compact Research chrome has no bounds");
  for (const testId of ["research-command", "research-path-hotbar"]) {
    const control = await page.getByTestId(testId).boundingBox();
    if (control === null) throw new Error(`${testId} has no compact bounds`);
    expect(control.x).toBeGreaterThanOrEqual(stage.x);
    expect(control.x + control.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
    expect(control.y).toBeGreaterThanOrEqual(stage.y);
    expect(control.y + control.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
    expect(control.y + control.height).toBeLessThanOrEqual(nav.y + 1);
  }
  for (const testId of ["research-undo", "research-command", "lab-focus", "research-cures"]) {
    const target = await page.getByTestId(testId).boundingBox();
    if (target === null) throw new Error(`${testId} has no touch target`);
    expect(target.height, `${testId} must be at least 44px tall`).toBeGreaterThanOrEqual(44);
  }
});

test("compact Research keeps the resolved outcome visible below its path controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?cash=200");
  await expect(page.getByTestId("lab-map-frame").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await clickCandidateEndpoint(page, "push");
  await page.getByTestId("research-command").click();
  await expect(page.getByTestId("research-command")).toBeEnabled({ timeout: 5_000 });
  const outcome = page.getByTestId("research-atlas-outcome");
  await expect(outcome).toBeVisible();
  expect(await outcome.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const outcomeBox = await outcome.boundingBox();
  const hotbarBox = await page.getByTestId("research-path-hotbar").boundingBox();
  const navBox = await page.getByTestId("nav-rail").boundingBox();
  if (outcomeBox === null || hotbarBox === null || navBox === null) {
    throw new Error("compact Research outcome chrome has no bounds");
  }
  for (const testId of ["lab-focus", "lab-zoom", "revealed-count", "research-cures"]) {
    const statusControl = await page.getByTestId(testId).boundingBox();
    if (statusControl === null) throw new Error(`${testId} has no compact outcome bounds`);
    expect(statusControl.y, `${testId} must stay below the path hotbar`)
      .toBeGreaterThanOrEqual(hotbarBox.y + hotbarBox.height);
  }
  expect(outcomeBox.y).toBeGreaterThanOrEqual(hotbarBox.y + hotbarBox.height);
  expect(outcomeBox.y + outcomeBox.height).toBeLessThanOrEqual(navBox.y);
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
