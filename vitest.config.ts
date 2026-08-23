import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./test/vitest.setup.ts"],
  },
});
