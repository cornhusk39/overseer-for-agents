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
  // Null when the bucket has no completed runs to measure. Charts skip null
  // rather than drawing a misleading dip to zero.
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

// Cap on how many buckets gap-filling will produce. A run with a wildly wrong
// timestamp (say, the epoch) must not explode a 7-day chart into millions of
// empty buckets; past the cap the series stays sparse instead.
const MAX_FILLED_BUCKETS = 1000;

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
      latencyP50Ms: durations.length ? percentile(durations, 50) : null,
      latencyP95Ms: durations.length ? percentile(durations, 95) : null,
    });
  }

  // Chronological order so the chart reads left to right.
  result.sort((a, b) => a.startMs - b.startMs);
  return fillGaps(result, bucketMs);
}

// Insert explicit zero buckets for time gaps. Without them a quiet period
// compresses out of the chart entirely: two busy days around an outage would
// render as adjacent points, hiding exactly the event an observability tool
// exists to show.
function fillGaps(sorted: TrendBucket[], bucketMs: number): TrendBucket[] {
  if (sorted.length < 2) return sorted;
  const first = sorted[0] as TrendBucket;
  const last = sorted[sorted.length - 1] as TrendBucket;
  const span = Math.floor((last.startMs - first.startMs) / bucketMs) + 1;
  if (span > MAX_FILLED_BUCKETS) return sorted;

  const byStart = new Map(sorted.map((b) => [b.startMs, b]));
  const filled: TrendBucket[] = [];
  for (let t = first.startMs; t <= last.startMs; t += bucketMs) {
    filled.push(
      byStart.get(t) ?? {
        startMs: t,
        runCount: 0,
        errorRate: 0,
        toolFailureRate: 0,
        totalCostUsd: 0,
        totalTokens: 0,
        latencyP50Ms: null,
        latencyP95Ms: null,
      },
    );
  }
  return filled;
}
