// Trend aggregation for read-only (demo) mode, where the dashboard has the raw
// rollups in hand and computes buckets itself instead of calling the ingest
// trends endpoint. This mirrors the server-side computeTrends so both paths
// produce identical charts; it is kept here so the web bundle never has to
// import the ingest package (which pulls in a native module that has no place
// in a browser bundle).

import type { RunListItem, TrendBucket } from "./types";

// Cap on how many buckets gap-filling will produce. A run with a wildly wrong
// timestamp must not explode a chart into millions of empty buckets; past the
// cap the series stays sparse instead.
const MAX_FILLED_BUCKETS = 1000;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))] as number;
}

export function computeTrends(runs: RunListItem[], bucketMs: number): TrendBucket[] {
  const buckets = new Map<number, RunListItem[]>();
  for (const run of runs) {
    const start = Math.floor(run.startMs / bucketMs) * bucketMs;
    const list = buckets.get(start);
    if (list) list.push(run);
    else buckets.set(start, [run]);
  }

  const out: TrendBucket[] = [];
  for (const [startMs, group] of buckets) {
    const runCount = group.length;
    const errored = group.filter((r) => r.status === "error").length;
    const toolCalls = group.reduce((s, r) => s + r.toolCallCount, 0);
    const toolErrors = group.reduce((s, r) => s + r.toolErrorCount, 0);
    const durations = group.map((r) => r.durationMs).filter((d): d is number => d !== null);
    out.push({
      startMs,
      runCount,
      errorRate: runCount === 0 ? 0 : errored / runCount,
      toolFailureRate: toolCalls === 0 ? 0 : toolErrors / toolCalls,
      totalCostUsd: Math.round(group.reduce((s, r) => s + r.totalCostUsd, 0) * 1_000_000) / 1_000_000,
      totalTokens: group.reduce((s, r) => s + r.totalInputTokens + r.totalOutputTokens, 0),
      latencyP50Ms: durations.length ? percentile(durations, 50) : null,
      latencyP95Ms: durations.length ? percentile(durations, 95) : null,
    });
  }
  out.sort((a, b) => a.startMs - b.startMs);
  return fillGaps(out, bucketMs);
}

// Insert explicit zero buckets for time gaps, so quiet periods render as dips
// instead of silently compressing out of the chart.
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
