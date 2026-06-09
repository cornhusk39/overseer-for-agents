// Flat ESLint config for the workspace. Type-aware linting is intentionally
// kept light here: the strict tsconfig already does the heavy checking at build
// time, so eslint focuses on the things tsc does not catch.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Generated and vendored output never gets linted.
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/coverage/**",
      "packages/web/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Unused variables are an error, but a leading underscore marks an
      // intentionally ignored argument (common in callbacks and handlers).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
