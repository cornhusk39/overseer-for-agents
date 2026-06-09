// Per-run rollups: the agent-native metrics for a single run, folded up from
// its spans. The dashboard reads these directly for the runs list and trends,
// so the heavy aggregation happens once at write time rather than on every
// page load.
//
// Rates (error rate, tool-failure rate, latency percentiles) are intentionally
// not stored here. They are aggregate questions across many runs over a time
// range, so they are computed by querying these rollups rather than baked into
// each one, which keeps a single run's row from ever disagreeing with itself.

import { type Run, type Span, type RunRollup } from "@overseer/schema";

export function computeRollup(run: Run, spans: Span[]): RunRollup {
  let llmCallCount = 0;
  let toolCallCount = 0;
  let toolErrorCount = 0;
  let errorCount = 0;
  let totalCostUsd = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const models = new Set<string>();

  for (const span of spans) {
    // A span counts as an LLM call when the mapping recognized a model on it.
    if (span.model) {
      llmCallCount += 1;
      models.add(span.model);
    }
    if (span.toolName) {
      toolCallCount += 1;
      if (span.toolOutcome === "error") toolErrorCount += 1;
    }
    if (span.status === "error") errorCount += 1;
    if (span.costUsd) totalCostUsd += span.costUsd;
    if (span.inputTokens) totalInputTokens += span.inputTokens;
    if (span.outputTokens) totalOutputTokens += span.outputTokens;
  }

  return {
    runId: run.id,
    agent: run.agent,
    status: run.status,
    startMs: run.startMs,
    endMs: run.endMs,
    durationMs: run.durationMs,
    spanCount: spans.length,
    llmCallCount,
    toolCallCount,
    toolErrorCount,
    errorCount,
    // Rounded to avoid summed floating-point noise creeping into the total.
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    totalInputTokens,
    totalOutputTokens,
    models: [...models],
  };
}
