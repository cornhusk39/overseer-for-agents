import { describe, it, expect } from "vitest";
import { spanSchema, runRollupSchema, toolFailureRate } from "./domain.js";

describe("domain span schema", () => {
  it("accepts a fully mapped LLM span", () => {
    const span = spanSchema.parse({
      runId: "trace-1",
      spanId: "span-1",
      parentSpanId: null,
      name: "chat",
      kind: "client",
      startMs: 1700000000000,
      endMs: 1700000000500,
      durationMs: 500,
      status: "ok",
      statusMessage: null,
      model: "claude-opus-4-8",
      inputTokens: 160,
      outputTokens: 90,
      costUsd: 0.0055,
      toolName: null,
      toolOutcome: null,
      stepIndex: 0,
      attributes: { "gen_ai.system": "anthropic" },
    });
    expect(span.model).toBe("claude-opus-4-8");
  });

  it("rejects a negative duration", () => {
    expect(() =>
      spanSchema.parse({
        runId: "t",
        spanId: "s",
        parentSpanId: null,
        name: "x",
        kind: "internal",
        startMs: 1,
        endMs: 0,
        durationMs: -1,
        status: "unset",
        statusMessage: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        toolName: null,
        toolOutcome: null,
        stepIndex: null,
        attributes: {},
      }),
    ).toThrow();
  });
});

describe("run rollup", () => {
  it("computes tool failure rate, guarding divide-by-zero", () => {
    expect(toolFailureRate({ toolCallCount: 0, toolErrorCount: 0 })).toBe(0);
    expect(toolFailureRate({ toolCallCount: 4, toolErrorCount: 1 })).toBe(0.25);
  });

  it("validates a rollup shape", () => {
    const rollup = runRollupSchema.parse({
      runId: "trace-1",
      agent: "booking",
      status: "ok",
      startMs: 1700000000000,
      endMs: 1700000000900,
      durationMs: 900,
      spanCount: 3,
      llmCallCount: 1,
      toolCallCount: 1,
      toolErrorCount: 0,
      errorCount: 0,
      totalCostUsd: 0.0055,
      totalInputTokens: 160,
      totalOutputTokens: 90,
      models: ["claude-opus-4-8"],
    });
    expect(rollup.spanCount).toBe(3);
  });
});
