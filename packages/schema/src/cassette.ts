// The AgentProbe cassette contract, re-derived here at the schema level. This
// is the interop promise from the SPEC: Overseer and AgentProbe share a trace
// shape, validated independently by each project, rather than sharing code. If
// AgentProbe changes its cassette shape, the compatibility tests in this
// package fail and we find out immediately instead of at import time.
//
// A cassette is one recorded agent run. The importer (in the ingest package)
// turns a cassette into an Overseer run plus synthesized spans.

import { z } from "zod";

// Kept in lockstep with AgentProbe's cassette version. A mismatch here is a
// deliberate signal to revisit compatibility, not something to bump blindly.
export const CASSETTE_VERSION = 1 as const;

// One tool invocation inside a run. Args are an open record because every
// agent's tools differ. A present `error` distinguishes a failed call from one
// that simply reported no result.
export const cassetteToolCallSchema = z.object({
  name: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type CassetteToolCall = z.infer<typeof cassetteToolCallSchema>;

// A step in a recorded run: either a conversational message or a tool call. The
// shape is deliberately narrow so different agents map onto it cleanly.
export const cassetteTraceStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message"),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  }),
  z.object({
    type: z.literal("tool_call"),
    call: cassetteToolCallSchema,
  }),
]);
export type CassetteTraceStep = z.infer<typeof cassetteTraceStepSchema>;

// Quantitative facts about a run. Cost is US dollars, latency is milliseconds,
// steps is the count of model or tool steps the agent took.
export const cassetteMetricsSchema = z.object({
  latencyMs: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  steps: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
});
export type CassetteMetrics = z.infer<typeof cassetteMetricsSchema>;

// The complete result of one recorded run: the final answer, how it got there,
// and what it cost.
export const cassetteResultSchema = z.object({
  output: z.unknown(),
  trace: z.array(cassetteTraceStepSchema).default([]),
  metrics: cassetteMetricsSchema,
});
export type CassetteResult = z.infer<typeof cassetteResultSchema>;

export const cassetteSchema = z.object({
  version: z.literal(CASSETTE_VERSION),
  // Ties the cassette back to the suite case it was recorded for.
  caseId: z.string(),
  // Which agent produced it, used for attribution.
  agent: z.string(),
  // ISO-8601 timestamp of when the run was recorded.
  recordedAt: z.string(),
  input: z.unknown(),
  result: cassetteResultSchema,
  // A record of what redaction removed, when present. Useful for auditing a
  // cassette without re-running redaction.
  redaction: z
    .object({
      hits: z.array(z.object({ rule: z.string(), path: z.string() })),
    })
    .optional(),
});
export type Cassette = z.infer<typeof cassetteSchema>;

// Pull the tool calls out of a recorded trace, in order. The importer uses this
// to reconstruct tool spans.
export function cassetteToolCalls(trace: CassetteTraceStep[]): CassetteToolCall[] {
  const calls: CassetteToolCall[] = [];
  for (const step of trace) {
    if (step.type === "tool_call") calls.push(step.call);
  }
  return calls;
}
