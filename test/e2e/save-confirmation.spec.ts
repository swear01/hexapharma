import { expect, test } from "@playwright/test";

test("Ctrl+S saves the game while text entry keeps its native keys", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("view-blueprints").click();
  const name = page.getByTestId("blueprint-name");
  await name.fill("Draft");
  await name.press("m");
  await expect(name).toHaveValue("Draftm");
  await expect(page.getByTestId("blueprints-drawer")).toBeVisible();

  await name.press("Control+s");
  await expect(page.getByTestId("save-msg")).toContainText("Saved slot 1");
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .not.toBeNull();
  await expect(name).toHaveValue("Draftm");
});

test("Load confirms before replacing a different current game and remains cancelable", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await page.getByTestId("save").click();
  await page.getByTestId("view-technology").click();
  await page.getByTestId("patent-unlock-reveal-aid").click();
  await expect(page.getByTestId("cash")).toHaveText("9919");
  await page.keyboard.press("Escape");
  const researchFrame = page.getByTestId("lab-map-frame");
  const cameraBeforeModal = {
    x: await researchFrame.getAttribute("data-camera-x"),
    y: await researchFrame.getAttribute("data-camera-y"),
  };

  const checkpointBefore = await page.evaluate(() =>
    localStorage.getItem("hexapharma.save.checkpoint.0"));
  await page.getByTestId("load").click();
  const dialog = page.getByRole("alertdialog", { name: "Load saved game?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/replace the current unsaved state/i);
  await expect(dialog.getByRole("button", { name: "Load saved game" })).toBeFocused();
  await page.keyboard.press("f");
  await expect(researchFrame).toHaveAttribute("data-camera-x", cameraBeforeModal.x ?? "");
  await expect(researchFrame).toHaveAttribute("data-camera-y", cameraBeforeModal.y ?? "");
  await page.evaluate(() => {
    const state = window as Window & { __saveShortcutPrevented?: boolean };
    window.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        state.__saveShortcutPrevented = event.defaultPrevented;
      }
    });
  });
  await page.keyboard.press("Control+s");
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() =>
    (window as Window & { __saveShortcutPrevented?: boolean }).__saveShortcutPrevented))
    .toBe(true);
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .toBe(checkpointBefore);
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("load")).toBeFocused();
  await expect(page.getByTestId("cash")).toHaveText("9919");
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .toBe(checkpointBefore);

  await page.getByTestId("load").click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("cash")).toHaveText("9919");
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .toBe(checkpointBefore);

  await page.getByTestId("load").click();
  await dialog.getByRole("button", { name: "Load saved game" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("cash")).toHaveText("9999");

  await page.getByTestId("load").click();
  await expect(dialog).toHaveCount(0);
});

test("Rewind confirms before dropping the latest checkpoint and restoring the older game", async ({ page }) => {
  await page.goto("/?cash=9999&research=9999");
  await page.getByTestId("save").click();
  await page.getByTestId("view-technology").click();
  await page.getByTestId("patent-unlock-reveal-aid").click();
  await expect(page.getByTestId("cash")).toHaveText("9919");
  await page.getByTestId("save").click();
  await expect(page.getByTestId("rewind")).toBeEnabled();

  const checkpointBefore = await page.evaluate(() =>
    localStorage.getItem("hexapharma.save.checkpoint.0"));
  await page.getByTestId("rewind").click();
  const dialog = page.getByRole("alertdialog", { name: "Rewind save history?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/permanently drop the latest saved checkpoint/i);
  await expect(dialog).toContainText(/older checkpoint.*replace the current game/i);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("rewind")).toBeFocused();
  await expect(page.getByTestId("cash")).toHaveText("9919");
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .toBe(checkpointBefore);

  await page.getByTestId("rewind").click();
  await dialog.getByRole("button", { name: "Rewind" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("cash")).toHaveText("9999");
  expect(await page.evaluate(() => localStorage.getItem("hexapharma.save.checkpoint.0")))
    .not.toBe(checkpointBefore);
  await expect(page.getByTestId("rewind")).toBeDisabled();
});
