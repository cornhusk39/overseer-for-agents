// Runnable entrypoint for the ingest service. This is what the docker-compose
// self-host path and the local dev workflow start. It reads configuration from
// the environment, opens the store, and begins accepting OTLP and serving the
// read API. Keeping it tiny means there is almost nothing here to get wrong.

import { startIngest } from "./index.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

startIngest(config)
  .then(() => {
    console.log(`overseer ingest listening on http://${config.host}:${config.port}`);
    console.log(`  OTLP traces:  POST /v1/traces`);
    console.log(`  read API:     GET  /api/agents | /api/runs | /api/runs/:id | /api/trends`);
  })
  .catch((err: unknown) => {
    console.error("overseer ingest failed to start:", err);
    process.exit(1);
  });
