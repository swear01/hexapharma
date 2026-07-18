import { expect, test } from "@playwright/test";
import { machineName } from "../../src/ui/machineLabels";

test.setTimeout(60_000);

test("a default run starts with a viable budget and four independent disease markets", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("cash")).toHaveText("1000");
  await page.getByTestId("view-market").click();
  await expect(page.locator(".market-card")).toHaveCount(4);
  await expect(page.getByText(/complexity|difficulty/i)).toHaveCount(0);
});

test("the complete HUD stays reachable across narrow widths", async ({ page }) => {
  for (const width of [390, 430, 560, 651]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?cash=999712&research=100000");

    for (const element of await page.locator(".resource-chip, .system-strip > *").all()) {
      const box = await element.boundingBox();
      expect(box, `HUD element should have visible bounds at ${width}px`).not.toBeNull();
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? width) + (box?.width ?? 1)).toBeLessThanOrEqual(width);
    }
    const brand = await page.locator(".brand-mark").boundingBox();
    const cash = await page.locator(".resource-chip").first().boundingBox();
    if (brand === null || cash === null) throw new Error("HUD regions have no bounds");
    const overlap = brand.x < cash.x + cash.width &&
      brand.x + brand.width > cash.x &&
      brand.y < cash.y + cash.height &&
      brand.y + brand.height > cash.y;
    expect(overlap, `brand must not cover Cash at ${width}px`).toBe(false);
    await expect(page.getByTestId("cash")).toBeVisible();
    await expect(page.getByTestId("save")).toBeVisible();
    await expect(page.getByTestId("load")).toBeVisible();
    await expect(page.getByTestId("new-game")).toContainText("New");
    const overflowingResources = await page.locator(".resource-chip").evaluateAll((chips) =>
      chips
        .filter((chip) => chip.scrollWidth > chip.clientWidth)
        .map((chip) => chip.textContent),
    );
    expect(overflowingResources, `resource text must stay inside its chip at ${width}px`).toEqual([]);
    const clippedResourceParts = await page.locator(".resource-label, .resource-chip strong")
      .evaluateAll((parts) => parts
        .filter((part) => part.scrollWidth > part.clientWidth)
        .map((part) => part.textContent));
    expect(clippedResourceParts, `resource labels and values must remain readable at ${width}px`)
      .toEqual([]);
    for (const testId of ["research-undo", "research-command", "lab-focus", "research-cures"]) {
      const target = await page.getByTestId(testId).boundingBox();
      if (target === null) throw new Error(`${testId} has no bounds at ${width}px`);
      expect(target.height, `${testId} must remain touch-sized at ${width}px`)
        .toBeGreaterThanOrEqual(44);
    }
    const clippedLabels = await page.locator(".nav-label").evaluateAll((labels) =>
      labels
        .filter((label) => label.scrollWidth > label.clientWidth)
        .map((label) => label.textContent),
    );
    expect(clippedLabels).toEqual([]);
  }
});

test("facility hotkeys switch three world pages while utility hotkeys open drawers", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("view-research").locator(".nav-label")).toHaveText("Research");
  await expect(page.getByTestId("view-pilot").locator(".nav-label")).toHaveText("Pilot");
  await expect(page.getByTestId("view-production").locator(".nav-label")).toHaveText("Production");
  const clippedLabels = await page.locator(".nav-label").evaluateAll((labels) =>
    labels
      .filter((label) => label.scrollWidth > label.clientWidth)
      .map((label) => label.textContent),
  );
  expect(clippedLabels).toEqual([]);
  await expect(page.getByTestId("view-research")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("F2");
  await expect(page.getByTestId("view-pilot")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("F3");
  await expect(page.getByTestId("view-production")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("F1");
  await expect(page.getByTestId("view-research")).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("m");
  await expect(page.getByTestId("market-drawer")).toBeVisible();
  await page.keyboard.press("t");
  await expect(page.getByTestId("technology-drawer")).toBeVisible();
  await page.keyboard.press("b");
  await expect(page.getByTestId("blueprints-drawer")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("blueprints-drawer")).toHaveCount(0);
});

test("visited static worlds do not keep permanent Pixi frame loops alive", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as Window & { __hexapharmaDrawCount?: number };
    state.__hexapharmaDrawCount = 0;
    const patchDraw = (prototype: WebGLRenderingContext | WebGL2RenderingContext) => {
      const drawArrays = prototype.drawArrays;
      prototype.drawArrays = function (mode, first, count) {
        state.__hexapharmaDrawCount = (state.__hexapharmaDrawCount ?? 0) + 1;
        return drawArrays.call(this, mode, first, count);
      };
      const drawElements = prototype.drawElements;
      prototype.drawElements = function (mode, count, type, offset) {
        state.__hexapharmaDrawCount = (state.__hexapharmaDrawCount ?? 0) + 1;
        return drawElements.call(this, mode, count, type, offset);
      };
    };
    patchDraw(WebGLRenderingContext.prototype);
    patchDraw(WebGL2RenderingContext.prototype);
  });
  await page.goto("/");
  await expect(page.getByTestId("lab-canvas").locator("canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("view-pilot").click();
  await expect(page.getByTestId("pilot-facility-workspace").locator("canvas")).toBeVisible();
  await page.getByTestId("view-production").click();
  await expect(page.getByTestId("production-facility-workspace").locator("canvas")).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __hexapharmaDrawCount?: number }).__hexapharmaDrawCount = 0;
  });

  await page.waitForTimeout(1_000);

  const drawCalls = await page.evaluate(() =>
    (window as Window & { __hexapharmaDrawCount?: number }).__hexapharmaDrawCount ?? 0);
  expect(drawCalls).toBe(0);
});

test("Pilot spatial editing supports palette, rotate, drag paint, erase, undo, redo, and zoom", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  const frame = pilot.getByTestId("factory-canvas");
  const canvas = frame.locator("canvas");
  await expect(canvas).toBeVisible();
  const clippedTools = await pilot.locator(".tool-name").evaluateAll((labels) =>
    labels
      .filter((label) => label.scrollWidth > label.clientWidth)
      .map((label) => label.textContent),
  );
  expect(clippedTools).toEqual([]);
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("Pilot canvas has no bounds");
  await pilot.getByTestId("brush-belt").click();
  await page.keyboard.press("r");
  await expect(pilot.getByTestId("brush-direction")).toContainText("S");
  const x = box.x + 12 + 10 * 42 + 21;
  const y = box.y + 12 + 6 * 42 + 21;
  await page.mouse.move(x, y);
  const ghostBox = await frame.locator(".factory-ghost").first().boundingBox();
  if (ghostBox === null) throw new Error("Factory placement preview has no bounds");
  expect(ghostBox.width).toBeCloseTo(42, 0);
  expect(ghostBox.height).toBeCloseTo(42, 0);
  await page.mouse.down();
  await page.mouse.move(x + 84, y, { steps: 5 });
  await page.mouse.up();
  await expect(pilot.getByTestId("factory-undo")).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect(pilot.getByTestId("factory-redo")).toBeEnabled();
  await page.keyboard.press("Control+y");
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });

  const machineX = box.x + 12 + 3 * 42 + 21;
  const machineY = box.y + 12 + 3 * 42 + 21;
  const movedX = machineX + 3 * 42;
  await pilot.getByTestId("brush-machine-push").click();
  await page.mouse.click(machineX, machineY);
  await expect(pilot.getByTestId("factory-hover-kind")).toHaveText(machineName("push"));
  await page.keyboard.press("r");
  await expect(pilot.getByTestId("brush-direction")).toHaveText("Footprint 0°");
  await page.mouse.move(machineX, machineY);
  await page.mouse.down();
  await page.mouse.move(movedX, machineY, { steps: 5 });
  await page.mouse.up();
  await page.mouse.move(machineX, machineY);
  await expect(pilot.getByTestId("factory-hover-kind")).toHaveText("empty");
  await page.mouse.move(movedX, machineY);
  await expect(pilot.getByTestId("factory-hover-kind")).toHaveText(machineName("push"));
  await page.keyboard.press("Control+z");
  await page.mouse.move(machineX, machineY);
  await expect(pilot.getByTestId("factory-hover-kind")).toHaveText(machineName("push"));

  await frame.hover();
  await page.mouse.wheel(0, -500);
  await expect(pilot.getByTestId("factory-zoom")).not.toHaveText("100%");
});

test("the world canvas remains primary and the inspector never covers it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("view-pilot").click();
  const pilot = page.getByTestId("pilot-facility-workspace");
  const world = pilot.locator(".factory-world");
  const inspector = pilot.getByTestId("factory-inspector");
  const worldBox = await world.boundingBox();
  const inspectorBox = await inspector.boundingBox();
  if (worldBox === null || inspectorBox === null) throw new Error("facility layout missing");
  expect(worldBox.width).toBeGreaterThan(inspectorBox.width * 2);
  expect(worldBox.x + worldBox.width).toBeLessThanOrEqual(inspectorBox.x + 1);
});
