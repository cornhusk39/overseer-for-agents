import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Run the example end-to-end against library source, so a fresh checkout can
// prove the SDK to ingest path without building the libraries first.
export default defineConfig({
  resolve: {
    alias: {
      "@overseer/schema": fileURLToPath(new URL("../../packages/schema/src/index.ts", import.meta.url)),
      "@overseer/sdk": fileURLToPath(new URL("../../packages/sdk/src/index.ts", import.meta.url)),
      "@overseer/ingest": fileURLToPath(new URL("../../packages/ingest/src/index.ts", import.meta.url)),
    },
  },
});
