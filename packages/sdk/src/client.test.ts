import { describe, it, expect } from "vitest";
import {
  exportTraceServiceRequestSchema,
  flattenAttributes,
  GEN_AI,
  type ExportTraceServiceRequest,
  type OtlpSpan,
} from "@overseer/schema";
import { createClient } from "./client.js";

// A fetch stub that records the last request body and returns a configurable
// status, so tests can inspect exactly what the SDK put on the wire.
function stubFetch(status = 200) {
  const calls: { url: string; body: ExportTraceServiceRequest; headers: Record<string, string> }[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(JSON.stringify({ partialSuccess: {} }), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// Deterministic clock and id generator so assertions are stable.
function deterministic() {
  let clock = 1000;
  let id = 0;
  return {
    now: () => (clock += 10),
    randomHex: (bytes: number) => String(id++).padStart(bytes * 2, "0"),
  };
}

function spansOf(req: ExportTraceServiceRequest): OtlpSpan[] {
  return req.resourceSpans?.[0]?.scopeSpans?.[0]?.spans ?? [];
}

describe("OverseerClient", () => {
  it("exports a valid OTLP request with root, llm, and tool spans", async () => {
    const fetch = stubFetch();
    const det = deterministic();
    const client = createClient({
      endpoint: "http://localhost:4318/v1/traces",
      token: "secret",
      serviceName: "booking",
      fetchImpl: fetch.impl,
      now: det.now,
      randomHex: det.randomHex,
    });

    const run = client.startRun();
    await run.llmCall({ model: "claude-opus-4-8", system: "anthropic", inputTokens: 160, outputTokens: 90 }, async () => "answer");
    await run.toolCall({ name: "lookup_property" }, async () => ({ id: "P-100" }));
    const result = await run.end();

    expect(result.ok).toBe(true);
    expect(fetch.calls).toHaveLength(1);

    // The body is valid OTLP by the schema package's own validator.
    const req = exportTraceServiceRequestSchema.parse(fetch.calls[0]!.body);
    expect(fetch.calls[0]!.headers.authorization).toBe("Bearer secret");

    const spans = spansOf(req);
    // root + llm + tool
    expect(spans).toHaveLength(3);

    const root = spans.find((s) => !s.parentSpanId)!;
    expect(root.name).toBe("booking");

    const llm = spans.find((s) => s.name === "chat")!;
    const llmAttrs = flattenAttributes(llm.attributes);
    expect(llmAttrs[GEN_AI.RESPONSE_MODEL]).toBe("claude-opus-4-8");
    expect(llmAttrs[GEN_AI.USAGE_INPUT_TOKENS]).toBe(160);
    expect(llm.parentSpanId).toBe(root.spanId);

    const tool = spans.find((s) => String(s.name).startsWith("execute_tool"))!;
    expect(flattenAttributes(tool.attributes)[GEN_AI.TOOL_NAME]).toBe("lookup_property");
  });

  it("records a thrown tool call as an errored span and rethrows", async () => {
    const fetch = stubFetch();
    const det = deterministic();
    const client = createClient({
      endpoint: "http://x/v1/traces",
      token: "t",
      serviceName: "booking",
      fetchImpl: fetch.impl,
      now: det.now,
      randomHex: det.randomHex,
    });

    const run = client.startRun();
    await expect(
      run.toolCall({ name: "book_slot" }, async () => {
        throw new Error("no availability");
      }),
    ).rejects.toThrow("no availability");
    await run.end();

    const tool = spansOf(fetch.calls[0]!.body).find((s) => String(s.name).startsWith("execute_tool"))!;
    expect(tool.status?.code).toBe(2);
    expect(tool.status?.message).toBe("no availability");
  });

  it("reports an export failure through the result rather than throwing", async () => {
    const fetch = stubFetch(401);
    const client = createClient({
      endpoint: "http://x/v1/traces",
      token: "wrong",
      serviceName: "booking",
      fetchImpl: fetch.impl,
    });
    const run = client.startRun();
    const result = await run.end();
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
  });

  it("refuses to export a run twice", async () => {
    const fetch = stubFetch();
    const client = createClient({
      endpoint: "http://x/v1/traces",
      token: "t",
      serviceName: "booking",
      fetchImpl: fetch.impl,
    });
    const run = client.startRun();
    await run.end();
    const second = await run.end();
    expect(second.ok).toBe(false);
    expect(fetch.calls).toHaveLength(1);
  });
});
