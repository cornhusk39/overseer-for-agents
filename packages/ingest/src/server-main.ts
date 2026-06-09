// Runnable entrypoint for the ingest service. This is what the docker-compose
// self-host path and the local dev workflow start. It reads configuration from
// the environment, opens the store, and begins accepting OTLP and serving the
// read API. Keeping it tiny means there is almost nothing here to get wrong.

import { startIngest } from "./index.js";
import { loadConfig } from "./config.js";
import { dispatchAlerts } from "./alert-runner.js";

const config = loadConfig();

// How often the background alert loop evaluates rules. The per-rule cooldown,
// not this interval, governs how often a given alert can actually fire.
const ALERT_INTERVAL_MS = 30_000;

startIngest(config)
  .then((running) => {
    console.log(`overseer ingest listening on http://${config.host}:${config.port}`);
    console.log(`  OTLP traces:  POST /v1/traces`);
    console.log(`  read API:     GET  /api/agents | /api/runs | /api/runs/:id | /api/trends`);

    // If a webhook is configured, evaluate alert rules on a timer and deliver
    // any firings. Kept off the ingest hot path so a slow webhook never slows
    // trace ingestion.
    const webhookUrl = process.env.OVERSEER_ALERT_WEBHOOK_URL?.trim();
    if (webhookUrl) {
      const format = process.env.OVERSEER_ALERT_FORMAT === "slack" ? "slack" : "discord";
      console.log(`  alerts:       evaluating every ${ALERT_INTERVAL_MS / 1000}s, delivering to a ${format} webhook`);
      setInterval(() => {
        dispatchAlerts(running.store, { webhookUrl, format })
          .then((results) => {
            for (const r of results) {
              console.log(`alert "${r.alert.rule.name}" ${r.delivery.ok ? "delivered" : "delivery failed"}`);
            }
          })
          // An evaluation failure is logged and the next tick tries again; it
          // must never become an unhandled rejection that kills the service.
          .catch((err: unknown) => {
            console.error("alerts: evaluation cycle failed:", err);
          });
      }, ALERT_INTERVAL_MS).unref();
    }
  })
  .catch((err: unknown) => {
    console.error("overseer ingest failed to start:", err);
    process.exit(1);
  });
