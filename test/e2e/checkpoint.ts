import type { Page } from "@playwright/test";
import { SAVE_VERSION, deserializeGame, serializeSnapshot } from "../../src/sim/save";

export async function installSaveFixture(page: Page, fullSave: string): Promise<void> {
  await page.evaluate(({ key, checkpoint }) => localStorage.setItem(key, checkpoint), {
    key: `hexapharma.save.v${SAVE_VERSION}.checkpoint.0`,
    checkpoint: JSON.stringify({
      version: 2,
      head: serializeSnapshot(deserializeGame(fullSave)),
      history: [],
    }),
  });
}
