import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

const solverImportPattern = {
  regex: "(^|/)solver(?:/|$)",
  message: "the dev/test-only solver must not enter the production dependency graph.",
};

const dynamicSolverImportRestriction = {
  selector: "ImportExpression[source.type='Literal'][source.value=/\\/solver(?:\\/|$)/]",
  message: "the dev/test-only solver must not be imported dynamically by production code.",
};

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
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/sim/solver/**"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [solverImportPattern] }],
      "no-restricted-syntax": ["error", dynamicSolverImportRestriction],
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
  {
    files: ["src/sim/**/*.ts"],
    ignores: ["src/sim/**/*.test.ts", "src/sim/solver/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["pixi.js", "react", "react-dom", "**/render/**", "**/ui/**"],
              message: "sim core is pure: it must not import render / UI / DOM libraries.",
            },
            solverImportPattern,
          ],
        },
      ],
      "no-restricted-syntax": ["error", dynamicSolverImportRestriction],
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
