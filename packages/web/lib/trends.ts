// Trend aggregation for read-only (demo) mode, where the dashboard has the raw
// rollups in hand and computes buckets itself instead of calling the ingest
// trends endpoint. This mirrors the server-side computeTrends so both paths
// produce identical charts; it is kept here so the web bundle never has to
// import the ingest package.

import type { RunListItem, TrendBucket } from "./types";

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
      latencyP50Ms: percentile(durations, 50),
      latencyP95Ms: percentile(durations, 95),
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}
