import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve @overseer/schema to its TypeScript source during tests so the suite
// runs against the latest contract without a build step. The production build
// still resolves the bare specifier to schema's compiled dist.
export default defineConfig({
  resolve: {
    alias: {
      "@overseer/schema": fileURLToPath(new URL("../schema/src/index.ts", import.meta.url)),
    },
  },
});
