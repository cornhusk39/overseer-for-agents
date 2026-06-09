import { describe, it, expect } from "vitest";
import { measureMetric, evaluateRule, type AlertRule } from "./alerts.js";
import type { RunRollup } from "@overseer/schema";

function rollup(partial: Partial<RunRollup>): RunRollup {
  return {
    runId: "r",
    agent: "booking",
    status: "ok",
    startMs: 0,
    endMs: 100,
    durationMs: 100,
    spanCount: 1,
    llmCallCount: 1,
    toolCallCount: 0,
    toolErrorCount: 0,
    errorCount: 0,
    totalCostUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    models: [],
    ...partial,
  };
}

function rule(partial: Partial<AlertRule>): AlertRule {
  return {
    id: "rule-1",
    name: "rule",
    metric: "cost_per_run",
    threshold: 0.05,
    windowRuns: 3,
    agent: null,
    enabled: true,
    ...partial,
  };
}

describe("measureMetric", () => {
  it("averages cost per run", () => {
    expect(measureMetric("cost_per_run", [rollup({ totalCostUsd: 0.02 }), rollup({ totalCostUsd: 0.04 })])).toBeCloseTo(0.03, 6);
  });
  it("computes error rate over the window", () => {
    expect(measureMetric("error_rate", [rollup({ status: "error" }), rollup({ status: "ok" })])).toBe(0.5);
  });
  it("computes tool-failure rate across the window's tool calls", () => {
    expect(
      measureMetric("tool_failure_rate", [
        rollup({ toolCallCount: 2, toolErrorCount: 1 }),
        rollup({ toolCallCount: 2, toolErrorCount: 0 }),
      ]),
    ).toBe(0.25);
  });
  it("computes p95 latency", () => {
    expect(measureMetric("p95_latency", [rollup({ durationMs: 100 }), rollup({ durationMs: 900 })])).toBe(900);
  });
});

describe("evaluateRule", () => {
  it("fires when a full window exceeds the threshold", () => {
    const r = rule({ metric: "cost_per_run", threshold: 0.05, windowRuns: 2 });
    const result = evaluateRule(r, [rollup({ totalCostUsd: 0.08 }), rollup({ totalCostUsd: 0.07 })]);
    expect(result.fire).toBe(true);
    expect(result.observed).toBeCloseTo(0.075, 6);
  });

  it("does not fire below the threshold", () => {
    const r = rule({ metric: "cost_per_run", threshold: 0.05, windowRuns: 2 });
    expect(evaluateRule(r, [rollup({ totalCostUsd: 0.01 }), rollup({ totalCostUsd: 0.02 })]).fire).toBe(false);
  });

  it("does not fire until the window is full", () => {
    const r = rule({ windowRuns: 3, threshold: 0.05 });
    const result = evaluateRule(r, [rollup({ totalCostUsd: 1 }), rollup({ totalCostUsd: 1 })]);
    expect(result.windowFull).toBe(false);
    expect(result.fire).toBe(false);
  });
});
