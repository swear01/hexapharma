import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/",
      "node_modules/",
      "coverage/",
      "playwright-report/",
      "test-results/",
      "**/*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Determinism + purity hard-rules for the sim core, enforced automatically.
  // See AGENTS.md "Hard Rules".
  {
    files: ["src/sim/**/*.ts"],
    ignores: ["src/sim/**/*.test.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "sim core must use the seeded rng (src/sim/rng), never Math.random.",
        },
        {
          object: "Date",
          property: "now",
          message: "sim core is tick-based; time comes from the tick counter, not Date.now.",
        },
        {
          object: "performance",
          property: "now",
          message: "sim core is tick-based; no performance.now.",
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "sim core is tick-based; no wall-clock time." },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["pixi.js", "react", "react-dom", "**/render/**", "**/ui/**"],
              message: "sim core is pure: it must not import render / UI / DOM libraries.",
            },
          ],
        },
      ],
    },
  },
  // Tests and tooling may be looser.
  {
    files: ["test/**/*.ts", "tools/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
