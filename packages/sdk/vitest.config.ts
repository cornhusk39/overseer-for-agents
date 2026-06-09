import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve @overseer/schema to its source during tests so the SDK is exercised
// against the latest contract without a build step.
export default defineConfig({
  resolve: {
    alias: {
      "@overseer/schema": fileURLToPath(new URL("../schema/src/index.ts", import.meta.url)),
    },
  },
});
