import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleRead } from "./api.js";
import { Store } from "./store.js";
import { mapRequest } from "./otlp-mapping.js";
import { buildOtlpRequest, type SpanSpec } from "./test-utils/otlp.js";
import { GEN_AI } from "@overseer/schema";

const scrub = { maxAttrsPerSpan: 128, redaction: { mode: "scrub" as const, allowlist: [] } };

function ingest(store: Store, serviceName: string, spans: SpanSpec[], receivedAtMs = 1000) {
  const { spans: mapped, agentByRun } = mapRequest(buildOtlpRequest({ serviceName, spans }), scrub);
  store.ingest({ spans: mapped, agentByRun, receivedAtMs });
}

function url(path: string): URL {
  return new URL(path, "http://localhost:4318");
}

describe("read API", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
    ingest(store, "booking", [
      { traceId: "t1", spanId: "root", name: "run", startMs: 0, endMs: 500, statusCode: 1 },
      {
        traceId: "t1",
        spanId: "llm",
        parentSpanId: "root",
        name: "chat",
        startMs: 10,
        endMs: 300,
        statusCode: 1,
        attributes: { [GEN_AI.RESPONSE_MODEL]: "claude-opus-4-8", [GEN_AI.USAGE_INPUT_TOKENS]: 160, [GEN_AI.USAGE_OUTPUT_TOKENS]: 90 },
      },
      {
        traceId: "t1",
        spanId: "tool",
        parentSpanId: "root",
        name: "execute_tool",
        startMs: 310,
        endMs: 360,
        statusCode: 1,
        attributes: { [GEN_AI.TOOL_NAME]: "lookup_property" },
      },
    ]);
  });
  afterEach(() => store.close());

  it("returns null for non-api paths so the caller can handle them", () => {
    expect(handleRead("POST", url("/v1/traces"), store)).toBeNull();
  });

  it("rejects non-GET methods on the read API", () => {
    expect(handleRead("POST", url("/api/agents"), store)?.status).toBe(405);
  });

  it("lists agents", () => {
    const res = handleRead("GET", url("/api/agents"), store)!;
    expect(res.status).toBe(200);
    expect((res.body as { agents: unknown[] }).agents).toHaveLength(1);
  });

  it("lists runs with derived tool-failure rate", () => {
    const res = handleRead("GET", url("/api/runs"), store)!;
    const runs = (res.body as { runs: { runId: string; toolFailureRate: number }[] }).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0]!.runId).toBe("t1");
    expect(runs[0]!.toolFailureRate).toBe(0);
  });

  it("returns a run with its rollup and spans", () => {
    const res = handleRead("GET", url("/api/runs/t1"), store)!;
    expect(res.status).toBe(200);
    const body = res.body as { run: { id: string }; rollup: { llmCallCount: number }; spans: unknown[] };
    expect(body.run.id).toBe("t1");
    expect(body.rollup.llmCallCount).toBe(1);
    expect(body.spans).toHaveLength(3);
  });

  it("404s an unknown run", () => {
    expect(handleRead("GET", url("/api/runs/nope"), store)?.status).toBe(404);
  });

  it("returns trend buckets", () => {
    const res = handleRead("GET", url("/api/trends?bucketMs=3600000"), store)!;
    expect(res.status).toBe(200);
    const buckets = (res.body as { buckets: unknown[] }).buckets;
    expect(buckets.length).toBeGreaterThanOrEqual(1);
  });
});
