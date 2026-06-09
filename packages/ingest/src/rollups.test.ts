import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Run, Span } from "@overseer/schema";
import { computeRollup } from "./rollups.js";
import { Store } from "./store.js";
import { mapRequest } from "./otlp-mapping.js";
import { buildOtlpRequest } from "./test-utils/otlp.js";
import { GEN_AI } from "@overseer/schema";

const scrub = { maxAttrsPerSpan: 128, redaction: { mode: "scrub" as const, allowlist: [] } };

// Minimal span factory for direct rollup tests, with sensible defaults.
function span(partial: Partial<Span>): Span {
  return {
    runId: "t1",
    spanId: "s",
    parentSpanId: null,
    name: "span",
    kind: "internal",
    startMs: 0,
    endMs: 1,
    durationMs: 1,
    status: "ok",
    statusMessage: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    toolName: null,
    toolOutcome: null,
    stepIndex: null,
    attributes: {},
    ...partial,
  };
}

const run: Run = {
  id: "t1",
  agent: "booking",
  status: "ok",
  startMs: 0,
  endMs: 900,
  durationMs: 900,
};

describe("computeRollup", () => {
  it("folds span-level facts into run totals", () => {
    const rollup = computeRollup(run, [
      span({ spanId: "root", name: "run" }),
      span({ spanId: "llm", model: "claude-opus-4-8", inputTokens: 160, outputTokens: 90, costUsd: 0.00915 }),
      span({ spanId: "tool", toolName: "lookup_property", toolOutcome: "success" }),
    ]);
    expect(rollup.spanCount).toBe(3);
    expect(rollup.llmCallCount).toBe(1);
    expect(rollup.toolCallCount).toBe(1);
    expect(rollup.toolErrorCount).toBe(0);
    expect(rollup.totalInputTokens).toBe(160);
    expect(rollup.totalOutputTokens).toBe(90);
    expect(rollup.totalCostUsd).toBeCloseTo(0.00915, 6);
    expect(rollup.models).toEqual(["claude-opus-4-8"]);
  });

  it("counts errored tool calls", () => {
    const rollup = computeRollup(run, [
      span({ spanId: "tool", toolName: "book_slot", toolOutcome: "error", status: "error" }),
    ]);
    expect(rollup.toolCallCount).toBe(1);
    expect(rollup.toolErrorCount).toBe(1);
    expect(rollup.errorCount).toBe(1);
  });
});

describe("rollups end to end through the store", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
  });
  afterEach(() => store.close());

  it("derives correct cost and token totals from an ingested trace", () => {
    // A booking run: a root span, two LLM calls on different models, and a tool
    // call. The expected cost is computed by hand from the price table.
    const req = buildOtlpRequest({
      serviceName: "booking",
      spans: [
        { traceId: "t1", spanId: "root", name: "handle booking", startMs: 0, endMs: 900, statusCode: 1 },
        {
          traceId: "t1",
          spanId: "llm1",
          parentSpanId: "root",
          name: "chat",
          startMs: 10,
          endMs: 400,
          statusCode: 1,
          attributes: {
            [GEN_AI.RESPONSE_MODEL]: "claude-opus-4-8",
            [GEN_AI.USAGE_INPUT_TOKENS]: 160,
            [GEN_AI.USAGE_OUTPUT_TOKENS]: 90,
          },
        },
        {
          traceId: "t1",
          spanId: "tool1",
          parentSpanId: "root",
          name: "execute_tool",
          startMs: 410,
          endMs: 460,
          statusCode: 1,
          attributes: { [GEN_AI.TOOL_NAME]: "lookup_property" },
        },
        {
          traceId: "t1",
          spanId: "llm2",
          parentSpanId: "root",
          name: "chat",
          startMs: 470,
          endMs: 880,
          statusCode: 1,
          attributes: {
            [GEN_AI.RESPONSE_MODEL]: "claude-sonnet-4-6",
            [GEN_AI.USAGE_INPUT_TOKENS]: 50,
            [GEN_AI.USAGE_OUTPUT_TOKENS]: 20,
          },
        },
      ],
    });

    const { spans, agentByRun } = mapRequest(req, scrub);
    store.ingest({ spans, agentByRun, receivedAtMs: 1000 });

    const rollup = store.getRollup("t1")!;
    expect(rollup.spanCount).toBe(4);
    expect(rollup.llmCallCount).toBe(2);
    expect(rollup.toolCallCount).toBe(1);
    expect(rollup.totalInputTokens).toBe(210);
    expect(rollup.totalOutputTokens).toBe(110);
    // opus: 160/1e6*15 + 90/1e6*75 = 0.00915
    // sonnet: 50/1e6*3 + 20/1e6*15 = 0.00045
    expect(rollup.totalCostUsd).toBeCloseTo(0.0096, 6);
    expect(rollup.models.sort()).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
    expect(rollup.status).toBe("ok");
    expect(rollup.durationMs).toBe(900);
  });

  it("lists rollups newest first and filters by agent", () => {
    const mk = (trace: string, agent: string, startMs: number) =>
      mapRequest(
        buildOtlpRequest({
          serviceName: agent,
          spans: [{ traceId: trace, spanId: "root", name: "run", startMs, endMs: startMs + 10, statusCode: 1 }],
        }),
        scrub,
      );
    for (const { trace, agent, startMs } of [
      { trace: "a-old", agent: "alpha", startMs: 100 },
      { trace: "b-new", agent: "beta", startMs: 5000 },
      { trace: "a-new", agent: "alpha", startMs: 9000 },
    ]) {
      const m = mk(trace, agent, startMs);
      store.ingest({ spans: m.spans, agentByRun: m.agentByRun, receivedAtMs: 1 });
    }
    expect(store.listRollups().map((r) => r.runId)).toEqual(["a-new", "b-new", "a-old"]);
    expect(store.listRollups({ agent: "alpha" }).map((r) => r.runId)).toEqual(["a-new", "a-old"]);
  });
});
