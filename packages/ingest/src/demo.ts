// Demo seeding and snapshot export. seedDemo fills a store with synthetic
// traffic and a set of default alert rules; exportSnapshot serializes what the
// dashboard needs into a plain JSON object the web app can bundle and serve in
// read-only mode, with no database or ingest endpoint in the deployment.

import { type Agent, type Run, type Span, type RunRollup, toolFailureRate } from "@overseer/schema";
import type { Store } from "./store.js";
import type { AlertRule } from "./alerts.js";
import { generateTraffic, type GenerateSummary } from "./generator.js";

// Sensible starting rules so the demo (and a fresh self-host install) has
// alerting configured out of the box. The synthetic regression is tuned to trip
// the cost rule.
export const DEFAULT_ALERT_RULES: AlertRule[] = [
  { id: "cost-per-run", name: "Cost per run elevated", metric: "cost_per_run", threshold: 0.03, windowRuns: 5, agent: null, enabled: true },
  { id: "error-rate", name: "Run error rate high", metric: "error_rate", threshold: 0.2, windowRuns: 10, agent: null, enabled: true },
  { id: "tool-failure", name: "Tool failure rate high", metric: "tool_failure_rate", threshold: 0.15, windowRuns: 10, agent: null, enabled: true },
  { id: "p95-latency", name: "p95 latency high", metric: "p95_latency", threshold: 1500, windowRuns: 10, agent: null, enabled: true },
];

export interface SeedOptions {
  now: number;
  days?: number;
  totalRuns?: number;
  seed?: number;
}

export function seedDemo(store: Store, options: SeedOptions): GenerateSummary {
  const summary = generateTraffic(store, {
    now: options.now,
    days: options.days ?? 7,
    totalRuns: options.totalRuns ?? 220,
    seed: options.seed ?? 1337,
  });
  for (const rule of DEFAULT_ALERT_RULES) store.upsertAlertRule(rule);
  return summary;
}

// The shape the read-only dashboard reads. It carries everything the views need:
// the agent list, the run list (rollups with derived tool-failure rate), and the
// full detail for every run so any run page renders.
export interface DemoRunListItem extends RunRollup {
  toolFailureRate: number;
}

export interface DemoRunDetail {
  run: Run;
  rollup: RunRollup | null;
  spans: Span[];
}

export interface DemoSnapshot {
  generatedAtMs: number;
  agents: Agent[];
  runs: DemoRunListItem[];
  details: Record<string, DemoRunDetail>;
}

export function exportSnapshot(store: Store, generatedAtMs: number): DemoSnapshot {
  const rollups = store.listRollups({ limit: 100_000 });
  const runs: DemoRunListItem[] = rollups.map((r) => ({ ...r, toolFailureRate: toolFailureRate(r) }));
  const details: Record<string, DemoRunDetail> = {};
  for (const rollup of rollups) {
    const run = store.getRun(rollup.runId);
    if (!run) continue;
    details[rollup.runId] = { run, rollup, spans: store.getSpans(rollup.runId) };
  }
  return { generatedAtMs, agents: store.listAgents(), runs, details };
}
