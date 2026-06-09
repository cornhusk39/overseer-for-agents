// The alert rules engine. v1 rules are deliberately simple and explicit: a
// metric, a threshold, and a window of recent runs the condition must hold over
// (the "sustained window"). No ML, no anomaly detection. A rule fires when the
// metric measured across the last N runs crosses its threshold, and a per-rule
// cooldown keeps a sustained problem from spamming the same alert every cycle.
//
// The four metrics are exactly the ones the SPEC names: cost per run, error
// rate, tool-failure rate, and p95 latency.

import { type RunRollup, toolFailureRate } from "@overseer/schema";
import { percentile } from "./trends.js";

export type AlertMetric = "cost_per_run" | "error_rate" | "tool_failure_rate" | "p95_latency";

export const ALERT_METRICS: AlertMetric[] = [
  "cost_per_run",
  "error_rate",
  "tool_failure_rate",
  "p95_latency",
];

export interface AlertRule {
  id: string;
  name: string;
  metric: AlertMetric;
  // The value the measured metric must exceed to fire. Dollars for cost, a 0..1
  // fraction for the rates, milliseconds for latency.
  threshold: number;
  // How many of the most recent runs the metric is measured over. The rule does
  // not fire until at least this many runs exist, so a single outlier on a quiet
  // agent cannot trip it.
  windowRuns: number;
  // Limit the rule to one agent, or null to watch all agents together.
  agent: string | null;
  enabled: boolean;
}

export interface FiredAlert {
  rule: AlertRule;
  observed: number;
  firedAtMs: number;
}

// A recorded firing, persisted so the cooldown can be enforced and a history is
// available. "delivered" tracks whether the webhook post succeeded.
export interface AlertEvent {
  id: string;
  ruleId: string;
  firedAtMs: number;
  metric: AlertMetric;
  observed: number;
  threshold: number;
  agent: string | null;
  delivered: boolean;
}

// Reduce a window of run rollups to the single number a metric cares about.
export function measureMetric(metric: AlertMetric, window: RunRollup[]): number {
  if (window.length === 0) return 0;
  switch (metric) {
    case "cost_per_run": {
      const total = window.reduce((sum, r) => sum + r.totalCostUsd, 0);
      return total / window.length;
    }
    case "error_rate": {
      const errored = window.filter((r) => r.status === "error").length;
      return errored / window.length;
    }
    case "tool_failure_rate": {
      const calls = window.reduce((sum, r) => sum + r.toolCallCount, 0);
      const errors = window.reduce((sum, r) => sum + r.toolErrorCount, 0);
      return toolFailureRate({ toolCallCount: calls, toolErrorCount: errors });
    }
    case "p95_latency": {
      const durations = window.map((r) => r.durationMs).filter((d): d is number => d !== null);
      return percentile(durations, 95);
    }
  }
}

export interface RuleEvaluation {
  fire: boolean;
  observed: number;
  // False when there are not yet enough runs to judge the rule.
  windowFull: boolean;
}

// Decide whether a rule should fire given the most recent rollups for it. The
// caller passes the newest runs first; we take the rule's window off the front.
export function evaluateRule(rule: AlertRule, recentNewestFirst: RunRollup[]): RuleEvaluation {
  const window = recentNewestFirst.slice(0, rule.windowRuns);
  const windowFull = window.length >= rule.windowRuns;
  const observed = measureMetric(rule.metric, window);
  return { fire: windowFull && observed > rule.threshold, observed, windowFull };
}

// A human-readable description of a fired alert, used in webhook payloads and
// the test-fire output.
export function describeAlert(alert: FiredAlert): string {
  const scope = alert.rule.agent ? `agent "${alert.rule.agent}"` : "all agents";
  return `${alert.rule.name}: ${alert.rule.metric} over the last ${alert.rule.windowRuns} runs for ${scope} reached ${formatMetricValue(alert.rule.metric, alert.observed)} (threshold ${formatMetricValue(alert.rule.metric, alert.rule.threshold)})`;
}

// Format a metric value in its natural unit. Kept here so the engine, the
// webhook formatter, and the CLI all describe a value the same way.
export function formatMetricValue(metric: AlertMetric, value: number): string {
  switch (metric) {
    case "cost_per_run":
      return `$${value.toFixed(4)}`;
    case "error_rate":
    case "tool_failure_rate":
      return `${(value * 100).toFixed(1)}%`;
    case "p95_latency":
      return `${Math.round(value)} ms`;
  }
}
