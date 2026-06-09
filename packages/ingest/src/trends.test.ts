import { describe, it, expect } from "vitest";
import { computeTrends, percentile } from "./trends.js";
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

describe("percentile", () => {
  it("uses nearest-rank and handles edges", () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([5], 50)).toBe(5);
  });
});

describe("computeTrends", () => {
  it("buckets rollups by time and aggregates per bucket", () => {
    const hour = 3_600_000;
    const buckets = computeTrends(
      [
        rollup({ runId: "a", startMs: 0, durationMs: 100, totalCostUsd: 0.01, totalInputTokens: 100, totalOutputTokens: 50 }),
        rollup({ runId: "b", startMs: 1000, durationMs: 300, status: "error", errorCount: 1 }),
        rollup({ runId: "c", startMs: hour + 5, durationMs: 200, toolCallCount: 4, toolErrorCount: 1 }),
      ],
      hour,
    );
    expect(buckets).toHaveLength(2);

    const first = buckets[0]!;
    expect(first.startMs).toBe(0);
    expect(first.runCount).toBe(2);
    expect(first.errorRate).toBe(0.5);
    expect(first.totalCostUsd).toBeCloseTo(0.01, 6);
    expect(first.totalTokens).toBe(150);
    expect(first.latencyP50Ms).toBe(100);

    const second = buckets[1]!;
    expect(second.startMs).toBe(hour);
    expect(second.toolFailureRate).toBe(0.25);
  });

  it("orders buckets chronologically", () => {
    const hour = 3_600_000;
    const buckets = computeTrends(
      [rollup({ startMs: 2 * hour }), rollup({ startMs: 0 }), rollup({ startMs: hour })],
      hour,
    );
    expect(buckets.map((b) => b.startMs)).toEqual([0, hour, 2 * hour]);
  });
});
