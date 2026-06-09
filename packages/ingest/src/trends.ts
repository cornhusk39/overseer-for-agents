// Aggregate trends over many runs. The per-run rollups answer "what did this run
// cost"; trends answer "how is the agent trending" by bucketing rollups in time
// and computing the rates and percentiles the dashboard charts. Kept as pure
// functions over rollups so they are trivial to test and reuse.

import { type RunRollup } from "@overseer/schema";

export interface TrendBucket {
  // Inclusive start of the time bucket, ms since epoch.
  startMs: number;
  runCount: number;
  errorRate: number;
  toolFailureRate: number;
  totalCostUsd: number;
  totalTokens: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

// Nearest-rank percentile over a list of numbers. Returns 0 for an empty list,
// which is the sensible "nothing happened" value for a latency chart.
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

export function computeTrends(rollups: RunRollup[], bucketMs: number): TrendBucket[] {
  if (bucketMs <= 0) throw new Error("bucketMs must be positive");

  // Group rollups by the bucket their start falls into.
  const buckets = new Map<number, RunRollup[]>();
  for (const rollup of rollups) {
    const bucketStart = Math.floor(rollup.startMs / bucketMs) * bucketMs;
    const list = buckets.get(bucketStart);
    if (list) list.push(rollup);
    else buckets.set(bucketStart, [rollup]);
  }

  const result: TrendBucket[] = [];
  for (const [startMs, group] of buckets) {
    const runCount = group.length;
    const errored = group.filter((r) => r.status === "error").length;
    const toolCalls = group.reduce((sum, r) => sum + r.toolCallCount, 0);
    const toolErrors = group.reduce((sum, r) => sum + r.toolErrorCount, 0);
    const totalCostUsd = group.reduce((sum, r) => sum + r.totalCostUsd, 0);
    const totalTokens = group.reduce((sum, r) => sum + r.totalInputTokens + r.totalOutputTokens, 0);
    // Only completed runs have a duration to contribute to latency.
    const durations = group
      .map((r) => r.durationMs)
      .filter((d): d is number => d !== null);

    result.push({
      startMs,
      runCount,
      errorRate: runCount === 0 ? 0 : errored / runCount,
      toolFailureRate: toolCalls === 0 ? 0 : toolErrors / toolCalls,
      totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
      totalTokens,
      latencyP50Ms: percentile(durations, 50),
      latencyP95Ms: percentile(durations, 95),
    });
  }

  // Chronological order so the chart reads left to right.
  return result.sort((a, b) => a.startMs - b.startMs);
}
