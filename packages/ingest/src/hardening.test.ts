import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "./store.js";
import { mapRequest, MAX_ATTR_VALUE_CHARS } from "./otlp-mapping.js";
import { processTraces } from "./receiver.js";
import { importCassette } from "./importer.js";
import { evaluateAlerts } from "./alert-runner.js";
import { handleRead } from "./api.js";
import { buildOtlpRequest } from "./test-utils/otlp.js";
import { GEN_AI } from "@overseer/schema";
import type { IngestConfig } from "./config.js";

// Regression coverage for the issues found in the adversarial review pass.
// Each test pins one specific failure mode so it cannot quietly come back.

const scrub = { maxAttrsPerSpan: 128, redaction: { mode: "scrub" as const, allowlist: [] } };

function config(overrides: Partial<IngestConfig> = {}): IngestConfig {
  return {
    token: "t",
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    maxBodyBytes: 5 * 1024 * 1024,
    maxSpansPerRequest: 1000,
    maxAttrsPerSpan: 128,
    requestTimeoutMs: 2000,
    redactionMode: "scrub",
    attrAllowlist: [],
    ...overrides,
  };
}

describe("agent attribution across partial batches", () => {
  let store: Store;
  beforeEach(() => (store = new Store(":memory:")));
  afterEach(() => store.close());

  it("keeps the original agent when a later batch carries no identity", () => {
    const first = mapRequest(
      buildOtlpRequest({
        serviceName: "billing-agent",
        spans: [{ traceId: "t1", spanId: "root", name: "run", startMs: 0, endMs: 100, statusCode: 1 }],
      }),
      scrub,
    );
    store.ingest({ spans: first.spans, agentByRun: first.agentByRun, receivedAtMs: 1 });

    // Second batch for the same trace, no service.name anywhere.
    const second = mapRequest(
      buildOtlpRequest({
        spans: [{ traceId: "t1", spanId: "child", parentSpanId: "root", name: "tool", startMs: 10, endMs: 20 }],
      }),
      scrub,
    );
    expect(second.agentByRun.has("t1")).toBe(false);
    store.ingest({ spans: second.spans, agentByRun: second.agentByRun, receivedAtMs: 2 });

    expect(store.getRun("t1")!.agent).toBe("billing-agent");
    expect(store.listAgents().map((a) => a.name)).toEqual(["billing-agent"]);
  });
});

describe("semconv fields survive caps and scrubbing", () => {
  it("derives model and tokens even when the cap would drop the gen_ai keys", () => {
    const attributes: Record<string, string | number> = {};
    for (let i = 0; i < 10; i++) attributes[`custom.key.${i}`] = `v${i}`;
    attributes[GEN_AI.RESPONSE_MODEL] = "claude-opus-4-8";
    attributes[GEN_AI.USAGE_INPUT_TOKENS] = 100;
    const req = buildOtlpRequest({
      serviceName: "a",
      spans: [{ traceId: "t1", spanId: "s1", name: "chat", startMs: 0, endMs: 1, attributes }],
    });
    const { spans } = mapRequest(req, { maxAttrsPerSpan: 3, redaction: { mode: "scrub", allowlist: [] } });
    expect(spans[0]!.model).toBe("claude-opus-4-8");
    expect(spans[0]!.inputTokens).toBe(100);
    // The stored bag is still capped.
    expect(Object.keys(spans[0]!.attributes).length).toBe(3);
  });

  it("derives a string-typed token count before the phone scrubber can eat it", () => {
    const req = buildOtlpRequest({
      serviceName: "a",
      spans: [
        {
          traceId: "t1",
          spanId: "s1",
          name: "chat",
          startMs: 0,
          endMs: 1,
          attributes: { [GEN_AI.RESPONSE_MODEL]: "gpt-4o", [GEN_AI.USAGE_INPUT_TOKENS]: "1234567" },
        },
      ],
    });
    const { spans } = mapRequest(req, scrub);
    expect(spans[0]!.inputTokens).toBe(1234567);
  });
});

describe("oversized and hostile input", () => {
  it("truncates huge attribute strings before scrubbing", () => {
    const huge = "a".repeat(MAX_ATTR_VALUE_CHARS * 3);
    const req = buildOtlpRequest({
      serviceName: "a",
      spans: [{ traceId: "t1", spanId: "s1", name: "x", startMs: 0, endMs: 1, attributes: { big: huge } }],
    });
    const { spans } = mapRequest(req, scrub);
    expect((spans[0]!.attributes.big as string).length).toBeLessThanOrEqual(MAX_ATTR_VALUE_CHARS);
  });

  it("rejects a deeply nested body instead of recursing into it", () => {
    const store = new Store(":memory:");
    // Build the nesting textually; JSON.stringify itself recurses and cannot
    // even construct a payload this deep (which is exactly how an attacker
    // would craft it: as a raw string).
    const depth = 50_000;
    const nested =
      '{"arrayValue":{"values":['.repeat(depth) + '{"stringValue":"x"}' + "]}}".repeat(depth);
    const body =
      '{"resourceSpans":[{"scopeSpans":[{"spans":[{"traceId":"t","spanId":"s","name":"x",' +
      '"startTimeUnixNano":"1","endTimeUnixNano":"2","attributes":[{"key":"k","value":' +
      nested +
      "}]}]}]}]}";
    const result = processTraces(body, config(), store);
    expect(result.status).toBe(400);
    expect((result.body as { error: string }).error).toContain("nested");
    store.close();
  });

  it("clamps an absurd ?limit on the read API", () => {
    const store = new Store(":memory:");
    const res = handleRead("GET", new URL("http://x/api/runs?limit=1e308"), store)!;
    expect(res.status).toBe(200);
    store.close();
  });
});

describe("root span detection", () => {
  it("treats an all-zeros parent id as no parent", () => {
    const store = new Store(":memory:");
    const { spans, agentByRun } = mapRequest(
      buildOtlpRequest({
        serviceName: "a",
        spans: [
          {
            traceId: "t1",
            spanId: "root",
            parentSpanId: "0000000000000000",
            name: "run",
            startMs: 0,
            endMs: 50,
            statusCode: 1,
          },
        ],
      }),
      scrub,
    );
    store.ingest({ spans, agentByRun, receivedAtMs: 1 });
    expect(store.getRun("t1")!.status).toBe("ok");
    store.close();
  });
});

describe("cassette re-import", () => {
  it("replaces the previous recording instead of merging with it", () => {
    const store = new Store(":memory:");
    const base = {
      version: 1,
      caseId: "case-1",
      agent: "agent-1",
      recordedAt: "2026-06-01T00:00:00.000Z",
      input: {},
    };
    // First recording: an errored tool call among 3 steps.
    importCassette(store, {
      ...base,
      result: {
        output: "no",
        trace: [
          { type: "message", role: "user", content: "hi" },
          { type: "tool_call", call: { name: "boom", args: {}, error: "exploded" } },
          { type: "message", role: "assistant", content: "sorry" },
        ],
        metrics: { latencyMs: 100, costUsd: 0.01, steps: 3 },
      },
    });
    const runId = store.listRuns()[0]!.id;
    expect(store.getRun(runId)!.status).toBe("error");

    // Re-recorded: shorter and clean. The old error must not linger.
    importCassette(store, {
      ...base,
      result: {
        output: "ok",
        trace: [{ type: "message", role: "assistant", content: "done" }],
        metrics: { latencyMs: 80, costUsd: 0.01, steps: 1 },
      },
    });
    expect(store.getRun(runId)!.status).toBe("ok");
    // root + 1 step, nothing stale.
    expect(store.getSpans(runId)).toHaveLength(2);
    store.close();
  });

  it("falls back to the import time when recordedAt is unparseable", () => {
    const store = new Store(":memory:");
    importCassette(
      store,
      {
        version: 1,
        caseId: "bad-date",
        agent: "agent-1",
        recordedAt: "not a date",
        input: {},
        result: { output: null, trace: [], metrics: { latencyMs: 10, costUsd: 0, steps: 0 } },
      },
      () => 1_700_000_000_000,
    );
    expect(store.listRuns()[0]!.startMs).toBe(1_700_000_000_000);
    store.close();
  });
});

describe("alert windows and delivery accounting", () => {
  it("excludes running runs from the window and records delivery", async () => {
    const store = new Store(":memory:");
    store.upsertAlertRule({
      id: "err",
      name: "errors",
      metric: "error_rate",
      threshold: 0.5,
      windowRuns: 2,
      agent: null,
      enabled: true,
    });

    // Two errored completed runs and one in-flight run (no root span). The
    // in-flight run must not dilute the 2-run window below the threshold.
    for (const t of ["c1", "c2"]) {
      const m = mapRequest(
        buildOtlpRequest({
          serviceName: "a",
          spans: [{ traceId: t, spanId: "root", name: "run", startMs: 5000, endMs: 5100, statusCode: 2 }],
        }),
        scrub,
      );
      store.ingest({ spans: m.spans, agentByRun: m.agentByRun, receivedAtMs: 1 });
    }
    const inflight = mapRequest(
      buildOtlpRequest({
        serviceName: "a",
        spans: [{ traceId: "r1", spanId: "child", parentSpanId: "root", name: "step", startMs: 9000, endMs: 9010, statusCode: 1 }],
      }),
      scrub,
    );
    store.ingest({ spans: inflight.spans, agentByRun: inflight.agentByRun, receivedAtMs: 2 });
    expect(store.getRun("r1")!.status).toBe("running");

    const fired = evaluateAlerts(store, { now: () => 10_000 });
    expect(fired).toHaveLength(1);
    expect(fired[0]!.observed).toBe(1);

    // Delivery flips the persisted event to delivered.
    store.markAlertDelivered(fired[0]!.eventId);
    expect(store.listAlertEvents()[0]!.delivered).toBe(true);
    store.close();
  });
});
