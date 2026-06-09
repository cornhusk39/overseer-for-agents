// Overseer's own domain model: the shapes the store persists and the dashboard
// renders. This is richer than the AgentProbe cassette contract because it is
// span-oriented (one row per OTLP span) rather than step-oriented, which is
// what a production trace waterfall needs.
//
// Timestamps are milliseconds since the Unix epoch. OTLP delivers nanoseconds
// as strings; the ingest mapping converts them once, here, so nothing
// downstream has to deal with nanosecond arithmetic.

import { z } from "zod";

// Lifecycle of a run. "running" means we have seen spans but not the end of the
// root span yet; the other two are terminal.
export const runStatusSchema = z.enum(["running", "ok", "error"]);
export type RunStatus = z.infer<typeof runStatusSchema>;

// Whether a tool call succeeded or failed. Derived from the span's status, since
// a tool that throws is reported as an errored span by convention.
export const toolOutcomeSchema = z.enum(["success", "error"]);
export type ToolOutcome = z.infer<typeof toolOutcomeSchema>;

// One span, after mapping from OTLP. The agent-native fields (model, tokens,
// cost, tool name and outcome, step index) are nullable because not every span
// is an LLM call or a tool call; they are populated by the semconv mapping when
// the relevant attributes are present.
export const spanSchema = z.object({
  // The run a span belongs to is the OTLP trace id.
  runId: z.string(),
  spanId: z.string(),
  // Null for the root span of a run.
  parentSpanId: z.string().nullable(),
  name: z.string(),
  kind: z.string(),
  startMs: z.number(),
  endMs: z.number(),
  durationMs: z.number().nonnegative(),
  status: z.enum(["unset", "ok", "error"]),
  statusMessage: z.string().nullable(),

  // Agent-native derived fields.
  model: z.string().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().nullable(),
  toolName: z.string().nullable(),
  toolOutcome: toolOutcomeSchema.nullable(),
  // Zero-based ordering of the span within its run.
  stepIndex: z.number().int().nonnegative().nullable(),

  // Every attribute we kept after redaction, including ones we do not map to a
  // first-class field. Preserving the raw set is a SPEC requirement: unknown
  // attributes are kept, not dropped.
  attributes: z.record(z.string(), z.unknown()),
});
export type Span = z.infer<typeof spanSchema>;

// A run, the unit a user reasons about. One run is one OTLP trace.
export const runSchema = z.object({
  id: z.string(),
  agent: z.string(),
  status: runStatusSchema,
  startMs: z.number(),
  // Null while the run is still in flight.
  endMs: z.number().nullable(),
  durationMs: z.number().nonnegative().nullable(),
});
export type Run = z.infer<typeof runSchema>;

// An agent, summarized. Identity is the agent name (service.name or the
// gen_ai.agent.name attribute). Multi-tenant identity is out of scope for v1.
export const agentSchema = z.object({
  name: z.string(),
  firstSeenMs: z.number(),
  lastSeenMs: z.number(),
  runCount: z.number().int().nonnegative(),
});
export type Agent = z.infer<typeof agentSchema>;

// Per-run rollup: the agent-native metrics for a single run, derived from its
// spans. Aggregate trends (p50 and p95 latency, error and tool-failure rates
// over a time range) are computed by querying many of these, so the rollup
// itself only carries per-run counts and totals, not rates.
export const runRollupSchema = z.object({
  runId: z.string(),
  agent: z.string(),
  status: runStatusSchema,
  startMs: z.number(),
  endMs: z.number().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  spanCount: z.number().int().nonnegative(),
  llmCallCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(),
  toolErrorCount: z.number().int().nonnegative(),
  // Spans in the run whose status is error, tool or otherwise.
  errorCount: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative(),
  totalInputTokens: z.number().int().nonnegative(),
  totalOutputTokens: z.number().int().nonnegative(),
  // Distinct models seen in the run, for at-a-glance attribution.
  models: z.array(z.string()),
});
export type RunRollup = z.infer<typeof runRollupSchema>;

// Tool failure rate for a run, guarded against divide-by-zero. Kept as a
// derived helper rather than a stored column so it can never disagree with the
// counts it comes from.
export function toolFailureRate(rollup: Pick<RunRollup, "toolCallCount" | "toolErrorCount">): number {
  if (rollup.toolCallCount === 0) return 0;
  return rollup.toolErrorCount / rollup.toolCallCount;
}
