import { describe, it, expect } from "vitest";
import { mapRequest, countSpans } from "./otlp-mapping.js";
import { buildOtlpRequest } from "./test-utils/otlp.js";

const scrub = { maxAttrsPerSpan: 128, redaction: { mode: "scrub" as const, allowlist: [] } };

describe("countSpans", () => {
  it("counts spans across resource and scope groups", () => {
    const req = buildOtlpRequest({
      serviceName: "booking",
      spans: [
        { traceId: "t1", spanId: "s1", name: "run", startMs: 0, endMs: 10 },
        { traceId: "t1", spanId: "s2", name: "tool", startMs: 1, endMs: 5 },
      ],
    });
    expect(countSpans(req)).toBe(2);
  });
});

describe("mapRequest", () => {
  it("maps timing, kind, status, and parent into a domain span", () => {
    const req = buildOtlpRequest({
      serviceName: "booking",
      spans: [
        {
          traceId: "t1",
          spanId: "root",
          name: "handle booking",
          kind: 2,
          startMs: 1_700_000_000_000,
          endMs: 1_700_000_000_500,
          statusCode: 1,
        },
        {
          traceId: "t1",
          spanId: "child",
          parentSpanId: "root",
          name: "check availability",
          startMs: 1_700_000_000_100,
          endMs: 1_700_000_000_300,
          statusCode: 2,
          statusMessage: "no slots",
        },
      ],
    });

    const { spans, agentByRun } = mapRequest(req, scrub);
    expect(agentByRun.get("t1")).toBe("booking");

    const root = spans.find((s) => s.spanId === "root")!;
    expect(root.parentSpanId).toBeNull();
    expect(root.kind).toBe("server");
    expect(root.status).toBe("ok");
    expect(root.startMs).toBe(1_700_000_000_000);
    expect(root.durationMs).toBe(500);

    const child = spans.find((s) => s.spanId === "child")!;
    expect(child.parentSpanId).toBe("root");
    expect(child.status).toBe("error");
    expect(child.statusMessage).toBe("no slots");
    // This span carries no gen_ai attributes, so the semconv mapping leaves the
    // agent-native fields null.
    expect(child.model).toBeNull();
  });

  it("redacts attribute values before they leave the mapping", () => {
    const req = buildOtlpRequest({
      serviceName: "booking",
      spans: [
        {
          traceId: "t1",
          spanId: "s1",
          name: "chat",
          startMs: 0,
          endMs: 1,
          attributes: { "customer.email": "jane@example.com", "gen_ai.system": "anthropic" },
        },
      ],
    });
    const { spans, redactionHits } = mapRequest(req, scrub);
    expect(spans[0]!.attributes["customer.email"]).toBe("[redacted-email]");
    expect(spans[0]!.attributes["gen_ai.system"]).toBe("anthropic");
    expect(redactionHits).toBe(1);
  });

  it("caps attributes to the configured maximum", () => {
    const attributes: Record<string, string> = {};
    for (let i = 0; i < 10; i++) attributes[`k${i}`] = `v${i}`;
    const req = buildOtlpRequest({
      spans: [{ traceId: "t1", spanId: "s1", name: "x", startMs: 0, endMs: 1, attributes }],
    });
    const { spans } = mapRequest(req, { maxAttrsPerSpan: 3, redaction: { mode: "scrub", allowlist: [] } });
    expect(Object.keys(spans[0]!.attributes).length).toBe(3);
  });

  it("prefers gen_ai.agent.name over the resource service name", () => {
    const req = buildOtlpRequest({
      serviceName: "fallback-service",
      spans: [
        {
          traceId: "t1",
          spanId: "s1",
          name: "x",
          startMs: 0,
          endMs: 1,
          attributes: { "gen_ai.agent.name": "explicit-agent" },
        },
      ],
    });
    const { agentByRun } = mapRequest(req, scrub);
    expect(agentByRun.get("t1")).toBe("explicit-agent");
  });
});
