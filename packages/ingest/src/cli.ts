#!/usr/bin/env node
// The overseer CLI. A thin dispatcher over the package's library functions so
// the same logic the tests cover is what runs on the command line. Subcommands:
//
//   serve                     start the ingest service (reads full config)
//   import-cassette <path>    import an AgentProbe cassette file or directory
//   alert-test                evaluate rules and deliver any firings; if none
//                             fire, send a synthetic alert to prove the webhook
//   rules init|list|set       manage alert rules in the configured database
//   seed-demo                 fabricate demo traffic and export the snapshot

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { importCassetteFile, importCassetteDir } from "./importer.js";
import { dispatchAlerts } from "./alert-runner.js";
import { formatWebhookPayload, deliverWebhook, type WebhookFormat } from "./webhook.js";
import { type FiredAlert } from "./alerts.js";
import { seedDemo, exportSnapshot, DEFAULT_ALERT_RULES } from "./demo.js";
import { ALERT_METRICS, formatMetricValue, type AlertMetric } from "./alerts.js";

// Default paths resolve from the workspace root (three levels up from this
// file, whether running from src via tsx or dist via node), not the current
// working directory. Otherwise `pnpm --filter @overseer/ingest exec overseer
// seed-demo` would scatter files under packages/ingest depending on where pnpm
// happened to run it. An explicit env var always wins.
const workspaceRoot = fileURLToPath(new URL("../../..", import.meta.url));

function dbPath(): string {
  return process.env.OVERSEER_DB_PATH?.trim() || path.join(workspaceRoot, "data", "overseer.db");
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

// Manage alert rules in the configured database. `init` installs the default
// rule set, `list` shows what is configured, and `set` tweaks one rule by id.
// This is how a real (non-demo) install turns alerting on: init the defaults,
// then adjust thresholds to taste.
async function rulesCommand(args: string[]): Promise<void> {
  const [sub, ...rest] = args;
  const store = new Store(dbPath());
  try {
    if (sub === "init") {
      for (const rule of DEFAULT_ALERT_RULES) store.upsertAlertRule(rule);
      console.log(`installed ${DEFAULT_ALERT_RULES.length} default rules into ${dbPath()}`);
      for (const rule of DEFAULT_ALERT_RULES) {
        console.log(`  ${rule.id}: ${rule.metric} > ${formatMetricValue(rule.metric, rule.threshold)} over ${rule.windowRuns} runs`);
      }
      return;
    }

    if (sub === "list") {
      const rules = store.listAlertRules();
      if (rules.length === 0) {
        console.log("no alert rules configured. Run: overseer rules init");
        return;
      }
      for (const rule of rules) {
        const scope = rule.agent ?? "all agents";
        const state = rule.enabled ? "enabled" : "disabled";
        console.log(
          `${rule.id}  [${state}]  ${rule.metric} > ${formatMetricValue(rule.metric, rule.threshold)} over ${rule.windowRuns} runs  (${scope})`,
        );
      }
      return;
    }

    if (sub === "set") {
      const [id, ...pairs] = rest;
      if (!id || pairs.length === 0) {
        fail(
          "usage: overseer rules set <id> key=value...\n" +
            "  keys: threshold=<number> window=<runs> agent=<name|all> enabled=<true|false>\n" +
            `        metric=<${ALERT_METRICS.join("|")}> name=<text>`,
        );
      }
      const existing = store.listAlertRules().find((r) => r.id === id);
      // Editing a missing rule creates it, so an operator can define a custom
      // rule without a separate "add" verb. Sensible blanks fill the rest.
      const rule = existing ?? {
        id,
        name: id,
        metric: "cost_per_run" as AlertMetric,
        threshold: 0.05,
        windowRuns: 10,
        agent: null,
        enabled: true,
      };
      for (const pair of pairs) {
        const eq = pair.indexOf("=");
        if (eq < 1) fail(`expected key=value, got "${pair}"`);
        const key = pair.slice(0, eq);
        const value = pair.slice(eq + 1);
        switch (key) {
          case "threshold": {
            const n = Number(value);
            if (!Number.isFinite(n) || n < 0) fail(`threshold must be a non-negative number, got "${value}"`);
            rule.threshold = n;
            break;
          }
          case "window": {
            const n = Number(value);
            if (!Number.isInteger(n) || n < 1) fail(`window must be a positive integer, got "${value}"`);
            rule.windowRuns = n;
            break;
          }
          case "agent":
            rule.agent = value === "all" || value === "" ? null : value;
            break;
          case "enabled":
            if (value !== "true" && value !== "false") fail(`enabled must be true or false, got "${value}"`);
            rule.enabled = value === "true";
            break;
          case "metric":
            if (!ALERT_METRICS.includes(value as AlertMetric)) {
              fail(`metric must be one of ${ALERT_METRICS.join(", ")}, got "${value}"`);
            }
            rule.metric = value as AlertMetric;
            break;
          case "name":
            rule.name = value;
            break;
          default:
            fail(`unknown key "${key}" (use threshold, window, agent, enabled, metric, name)`);
        }
      }
      store.upsertAlertRule(rule);
      console.log(`${existing ? "updated" : "created"} rule ${rule.id}: ${rule.metric} > ${formatMetricValue(rule.metric, rule.threshold)} over ${rule.windowRuns} runs (${rule.agent ?? "all agents"}, ${rule.enabled ? "enabled" : "disabled"})`);
      return;
    }

    fail("usage: overseer rules <init | list | set <id> key=value...>");
  } finally {
    store.close();
  }
}

// Seed a fresh demo database with synthetic traffic and default alert rules,
// then export the JSON snapshot the read-only dashboard serves.
async function seedDemoCommand(): Promise<void> {
  const dbTarget = process.env.OVERSEER_DB_PATH?.trim() || path.join(workspaceRoot, "data", "demo.db");
  const snapshotPath =
    process.env.OVERSEER_DEMO_SNAPSHOT?.trim() ||
    path.join(workspaceRoot, "packages", "web", "lib", "demo-snapshot.json");

  // Start clean so re-seeding is reproducible rather than additive.
  await fs.rm(dbTarget, { force: true }).catch(() => {});
  const store = new Store(dbTarget);
  try {
    const now = Date.now();
    const summary = seedDemo(store, { now });
    const snapshot = exportSnapshot(store, now);
    await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
    await fs.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    console.log(`seeded ${summary.runs} runs for ${summary.agents.join(", ")} into ${dbTarget}`);
    console.log(`wrote read-only snapshot to ${snapshotPath} (${snapshot.runs.length} runs)`);
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
    case "rules":
      await rulesCommand(args);
      break;
    case "seed-demo":
      await seedDemoCommand();
      break;
    default:
      console.log("usage: overseer <serve | import-cassette <path> | alert-test | rules <init|list|set> | seed-demo>");
      process.exitCode = command ? 1 : 0;
  }
}

void main();
