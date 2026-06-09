#!/usr/bin/env node
// The overseer CLI. A thin dispatcher over the package's library functions so
// the same logic the tests cover is what runs on the command line. Subcommands:
//
//   serve                     start the ingest service (reads full config)
//   import-cassette <path>    import an AgentProbe cassette file or directory
//   alert-test                evaluate rules and deliver any firings; if none
//                             fire, send a synthetic alert to prove the webhook
//
// More subcommands (traffic generation, demo seeding) are added in M7.

import { promises as fs } from "node:fs";
import { Store } from "./store.js";
import { importCassetteFile, importCassetteDir } from "./importer.js";
import { dispatchAlerts } from "./alert-runner.js";
import { formatWebhookPayload, deliverWebhook, type WebhookFormat } from "./webhook.js";
import { type FiredAlert } from "./alerts.js";

function dbPath(): string {
  return process.env.OVERSEER_DB_PATH?.trim() || "./data/overseer.db";
}

function webhookFormat(): WebhookFormat {
  return process.env.OVERSEER_ALERT_FORMAT === "slack" ? "slack" : "discord";
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function importCassettes(target: string): Promise<void> {
  const store = new Store(dbPath());
  try {
    const stat = await fs.stat(target);
    const results = stat.isDirectory()
      ? await importCassetteDir(store, target)
      : [await importCassetteFile(store, target)];
    for (const r of results) {
      console.log(`imported ${r.agent} run=${r.runId} (${r.spanCount} spans)`);
    }
    console.log(`done: ${results.length} cassette(s) imported into ${dbPath()}`);
  } finally {
    store.close();
  }
}

// A fabricated alert used when nothing real fired, so an operator can confirm the
// webhook is wired up correctly.
function syntheticAlert(): FiredAlert {
  return {
    rule: {
      id: "test-fire",
      name: "Test fire",
      metric: "cost_per_run",
      threshold: 0.05,
      windowRuns: 5,
      agent: null,
      enabled: true,
    },
    observed: 0.0731,
    firedAtMs: Date.now(),
  };
}

async function alertTest(): Promise<void> {
  const webhookUrl = process.env.OVERSEER_ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) fail("OVERSEER_ALERT_WEBHOOK_URL is not set. Configure it before running alert-test.");

  const store = new Store(dbPath());
  try {
    const results = await dispatchAlerts(store, { webhookUrl, format: webhookFormat() });
    if (results.length > 0) {
      for (const r of results) {
        console.log(`${r.delivery.ok ? "delivered" : "FAILED"} alert "${r.alert.rule.name}"`);
      }
      return;
    }
    // Nothing real fired: send a synthetic alert so the webhook can be verified.
    console.log("no rules fired against current data; sending a synthetic test alert");
    const alert = syntheticAlert();
    const payload = formatWebhookPayload(alert, webhookFormat(), new Date(alert.firedAtMs).toISOString());
    const delivery = await deliverWebhook(webhookUrl, payload);
    console.log(delivery.ok ? "synthetic test alert delivered" : `delivery failed: ${delivery.status ?? delivery.error}`);
  } finally {
    store.close();
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "serve":
      await import("./server-main.js");
      break;
    case "import-cassette":
      if (!args[0]) fail("usage: overseer import-cassette <file-or-directory>");
      await importCassettes(args[0]);
      break;
    case "alert-test":
      await alertTest();
      break;
    default:
      console.log("usage: overseer <serve | import-cassette <path> | alert-test>");
      process.exitCode = command ? 1 : 0;
  }
}

void main();
