// Shapes the dashboard reads from the ingest REST API. The core domain types
// (Agent, Run, Span, RunRollup) come from the shared schema package; the few
// API-only shapes that do not exist there are declared here.

import type { RunRollup } from "@overseer/schema";

// A run as it appears in the runs list: the stored rollup plus the tool-failure
// rate the API derives on read.
export type RunListItem = RunRollup & { toolFailureRate: number };

// One time bucket from the trends endpoint. Mirrors the ingest TrendBucket so
// the dashboard does not need to import the ingest package (which pulls in a
// native module that has no place in a browser bundle).
export interface TrendBucket {
  startMs: number;
  runCount: number;
  errorRate: number;
  toolFailureRate: number;
  totalCostUsd: number;
  totalTokens: number;
  // Null when a bucket has no completed runs; charts skip the point rather
  // than drawing a misleading dip to zero.
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}
