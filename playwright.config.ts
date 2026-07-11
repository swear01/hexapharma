import { defineConfig, devices } from "@playwright/test";

// e2e runs against throwaway dev/preview servers (NOT the 53346 playtest port),
// so automated tests never collide with a manual playtest session.
const DEV_PORT = 53347;
const PREVIEW_PORT = 53348;

export default defineConfig({
  testDir: "test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${DEV_PORT}`,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /production-preview\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "production-preview",
      testMatch: /production-preview\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${PREVIEW_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npx vite --port ${DEV_PORT} --strictPort`,
      url: `http://localhost:${DEV_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `npm run build && npx vite preview --host 127.0.0.1 --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
