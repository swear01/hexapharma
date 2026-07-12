import { expect, test, type Page } from "@playwright/test";

async function factoryCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  const box = await canvas.boundingBox();
  if (box === null) throw new Error("factory canvas has no bounding box");
  const intrinsic = await canvas.evaluate((element) => ({
    width: (element as HTMLCanvasElement).width,
    height: (element as HTMLCanvasElement).height,
  }));
  const px = 12 + x * 42 + 21;
  const py = 12 + y * 42 + 21;
  return {
    x: box.x + px / intrinsic.width * box.width,
    y: box.y + py / intrinsic.height * box.height,
  };
}

async function hoverCell(page: Page, x: number, y: number): Promise<void> {
  const point = await factoryCell(page, x, y);
  await page.mouse.move(point.x, point.y);
}

async function dragCells(
  page: Page,
  from: readonly [number, number],
  to: readonly [number, number],
  button: "left" | "right" = "left",
): Promise<void> {
  const start = await factoryCell(page, from[0], from[1]);
  const end = await factoryCell(page, to[0], to[1]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up({ button });
}

test("the primary UI is a viewport-filling game shell with persistent chrome", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.locator("[data-testid='lab-canvas'] canvas")).toBeVisible();
  await expect(page.getByTestId("top-hud")).toBeVisible();
  await expect(page.getByTestId("nav-rail")).toBeVisible();
  await expect(page.getByTestId("game-stage")).toBeVisible();
  await expect(page.getByTestId("lab-toolbelt")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.innerWidth);
  expect(dimensions.scrollHeight).toBeLessThanOrEqual(dimensions.innerHeight);

  await page.keyboard.press("F2");
  await expect(page.getByTestId("view-factory")).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("factory-toolbelt")).toBeVisible();
  await page.keyboard.press("F1");
  await expect(page.getByTestId("view-lab")).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("save-msg")).toContainText(/Saved slot 1/i);
});

test("Factory supports keyboard tools, drag build, right-drag erase, undo, redo, hover, and zoom", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await page.keyboard.press("F2");
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(canvas).toBeVisible();

  await page.keyboard.press("1");
  await expect(page.getByTestId("brush-selected")).toHaveText("belt");
  const beforeDirection = await page.getByTestId("brush-direction").textContent();
  await page.keyboard.press("r");
  await expect(page.getByTestId("brush-direction")).not.toHaveText(beforeDirection ?? "");

  await dragCells(page, [5, 4], [7, 4]);
  await hoverCell(page, 6, 4);
  await expect(page.getByTestId("factory-hover-cell")).toContainText("6, 4");
  await expect(page.getByTestId("factory-hover-kind")).toHaveText("belt");

  await page.keyboard.press("Control+z");
  await hoverCell(page, 6, 4);
  await expect(page.getByTestId("factory-hover-kind")).toHaveText("empty");
  await page.keyboard.press("Control+y");
  await hoverCell(page, 6, 4);
  await expect(page.getByTestId("factory-hover-kind")).toHaveText("belt");

  await page.keyboard.press("Control+c");
  await expect(page.getByTestId("factory-clipboard")).toContainText("belt");
  await page.keyboard.press("Control+x");
  await hoverCell(page, 6, 4);
  await expect(page.getByTestId("factory-hover-kind")).toHaveText("empty");
  await page.keyboard.press("Control+v");
  await hoverCell(page, 6, 4);
  await expect(page.getByTestId("factory-hover-kind")).toHaveText("belt");

  await page.getByTestId("brush-sink").click();
  await page.keyboard.press("q");
  await expect(page.getByTestId("brush-selected")).toHaveText("belt");
  await page.getByTestId("brush-machine-pull").click();
  await page.keyboard.press("h");
  await expect(page.getByTestId("brush-effect-flip")).toContainText("on");
  await page.keyboard.press("v");
  await expect(page.getByTestId("brush-effect-rotate")).toContainText("90°");

  await dragCells(page, [5, 4], [7, 4], "right");
  await hoverCell(page, 6, 4);
  await expect(page.getByTestId("factory-hover-kind")).toHaveText("empty");

  const zoom = page.getByTestId("factory-zoom");
  const beforeZoom = await zoom.textContent();
  await canvas.hover();
  await page.mouse.wheel(0, -320);
  await expect(zoom).not.toHaveText(beforeZoom ?? "");

  const cameraTransform = page.locator(".factory-canvas-transform");
  const beforePan = await cameraTransform.getAttribute("style");
  const frame = await page.getByTestId("factory-canvas").boundingBox();
  if (frame === null) throw new Error("factory frame has no bounding box");
  await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(frame.x + frame.width / 2 + 55, frame.y + frame.height / 2 + 35);
  await page.mouse.up({ button: "middle" });
  await expect(cameraTransform).not.toHaveAttribute("style", beforePan ?? "");
  await page.getByTestId("factory-camera-reset").click();
  await expect(zoom).toHaveText("100%");

  await page.keyboard.press("Space");
  await expect(page.getByTestId("factory-pause")).toBeEnabled();
  await page.keyboard.press("Space");
  await expect(page.getByTestId("factory-pause")).toBeDisabled();
});

test("Lab, Market, and Patents use game toolbelts and card/tree panels", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("game-shell")).toBeVisible();

  await page.keyboard.press("1");
  await expect(page.getByTestId("template-count")).toHaveText("0");
  await expect(page.getByTestId("recipe-held")).toContainText(/push/i);
  await page.getByTestId("recipe-insert-0").click();
  await expect(page.getByTestId("template-list")).toContainText(/push/i);
  await page.keyboard.press("r");
  await page.getByTestId("recipe-insert-1").click();
  await expect(page.getByTestId("recipe-step-1")).toHaveAttribute("data-rotation", "1");
  await page.keyboard.press("Escape");
  await page.getByTestId("recipe-step-1").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("template-count")).toHaveText("1");

  await page.keyboard.press("F3");
  await expect(page.getByTestId("market-grid")).toBeVisible();
  await expect(page.locator("table[data-testid='shop-table']")).toHaveCount(0);

  await page.keyboard.press("F4");
  await expect(page.getByTestId("patent-grid")).toBeVisible();
  await expect(page.locator("table[data-testid='patents-table']")).toHaveCount(0);
});

test("only the active world handles gameplay keys and focused tool buttons keep hotkeys live", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("game-shell")).toBeVisible();

  await page.keyboard.press("F2");
  await page.getByTestId("brush-belt").click();
  await expect(page.getByTestId("brush-direction")).toContainText("E");
  await page.keyboard.press("r");
  await expect(page.getByTestId("brush-direction")).toContainText("S");

  await page.keyboard.press("F1");
  await page.keyboard.press("1");
  await expect(page.getByTestId("rotate")).toContainText("0°");
  await page.keyboard.press("r");
  await expect(page.getByTestId("rotate")).toContainText("90°");
  await expect(page.getByTestId("brush-direction")).toContainText("S");

  await page.keyboard.press("F3");
  const count = await page.getByTestId("template-count").textContent();
  await page.keyboard.press("1");
  await expect(page.getByTestId("template-count")).toHaveText(count ?? "");

  await page.keyboard.press("F1");
  await page.getByTestId("save-slot").focus();
  const focusedCount = await page.getByTestId("template-count").textContent();
  await page.keyboard.press("1");
  await expect(page.getByTestId("template-count")).toHaveText(focusedCount ?? "");
});

test("Factory chrome clicks never paint through to the canvas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.locator("[data-testid='lab-canvas'] canvas")).toBeVisible();
  await page.getByTestId("view-factory").click();
  await expect(page.getByTestId("factory-canvas")).toBeVisible();
  await expect(page.getByTestId("factory-undo")).toBeDisabled();

  await page.getByTestId("brush-belt").click();
  await page.getByTestId("factory-step").click();
  await expect(page.getByTestId("factory-tick")).toHaveText("1");
  await expect(page.getByTestId("factory-undo")).toBeDisabled();
});

test("compact layouts keep resources and both world panels reachable without overlap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await expect(page.locator("[data-testid='lab-canvas'] canvas")).toBeVisible();
  for (const id of ["cash", "research"] as const) await expect(page.getByTestId(id)).toBeVisible();
  await expect(page.getByText("Stock", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Seed", { exact: false }).first()).toBeVisible();

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const labLayout = await page.evaluate(() => {
      const world = document.querySelector<HTMLElement>(".lab-world");
      const inspector = document.querySelector<HTMLElement>(".lab-inspector");
      const canvas = document.querySelector<HTMLCanvasElement>("[data-testid='lab-canvas'] canvas");
      if (world === null || inspector === null || canvas === null) throw new Error("Lab layout missing");
      const worldRect = world.getBoundingClientRect();
      const inspectorRect = inspector.getBoundingClientRect();
      const canScrollX = world.scrollWidth > world.clientWidth;
      const canScrollY = world.scrollHeight > world.clientHeight;
      world.scrollLeft = world.scrollWidth;
      world.scrollTop = world.scrollHeight;
      return {
        noOverlap: worldRect.bottom <= inspectorRect.top || inspectorRect.bottom <= worldRect.top ||
          worldRect.right <= inspectorRect.left || inspectorRect.right <= worldRect.left,
        scrolledToReachContent: (!canScrollX || world.scrollLeft > 0) && (!canScrollY || world.scrollTop > 0),
        touchAction: getComputedStyle(world).touchAction,
      };
    });
    expect(labLayout.noOverlap).toBe(true);
    expect(labLayout.scrolledToReachContent).toBe(true);
    expect(labLayout.touchAction).toContain("pan");
  }

  await page.getByTestId("view-factory").click();
  await expect(page.getByTestId("factory-canvas")).toBeVisible();
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    const factoryNoOverlap = await page.evaluate(() => {
      const world = document.querySelector<HTMLElement>(".factory-world");
      const inspector = document.querySelector<HTMLElement>(".factory-inspector");
      if (world === null || inspector === null) throw new Error("Factory layout missing");
      const a = world.getBoundingClientRect();
      const b = inspector.getBoundingClientRect();
      return a.bottom <= b.top || b.bottom <= a.top || a.right <= b.left || b.right <= a.left;
    });
    expect(factoryNoOverlap).toBe(true);
  }
});

test("touch tap builds while touch drag pans without editing", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:53347/");
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await page.getByTestId("view-factory").click();
  const canvas = page.locator("[data-testid='factory-canvas'] canvas");
  await expect(canvas).toBeVisible();
  await page.getByTestId("factory-canvas").evaluate((element) => {
    element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2;
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2;
  });
  const point = await factoryCell(page, 15, 8);

  await page.touchscreen.tap(point.x, point.y);
  await expect(page.getByTestId("factory-undo")).toBeEnabled();
  await page.getByTestId("factory-undo").click();
  await expect(page.getByTestId("factory-undo")).toBeDisabled();

  const transform = page.locator(".factory-canvas-transform");
  const before = await transform.getAttribute("style");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: point.x, y: point.y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: point.x + 70, y: point.y + 45, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(transform).not.toHaveAttribute("style", before ?? "");
  await expect(page.getByTestId("factory-undo")).toBeDisabled();
  await context.close();
});

test("patent confirmation traps focus, closes with Escape, and restores its trigger", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await page.getByTestId("view-patents").click();
  await page.getByTestId("patent-unlock-bench-2").click();
  const trigger = page.getByTestId("patent-unlock-new-map");
  await trigger.click();
  await expect(page.getByTestId("patent-confirmation")).toBeVisible();
  await expect(page.getByTestId("patent-confirm-new-map")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("patent-cancel-new-map")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("patent-confirmation")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Market and Patents have approved full-shell visual baselines", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await expect(page.getByTestId("game-shell")).toBeVisible();
  await page.getByTestId("view-shop").click();
  await expect(page).toHaveScreenshot("market-cards.png", { animations: "disabled" });
  await page.getByTestId("view-patents").click();
  await expect(page).toHaveScreenshot("patent-lattice.png", { animations: "disabled" });
});
