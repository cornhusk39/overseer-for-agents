import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "./store.js";
import { mapRequest } from "./otlp-mapping.js";
import { buildOtlpRequest } from "./test-utils/otlp.js";
import { evaluateAlerts, dispatchAlerts, DEFAULT_COOLDOWN_MS } from "./alert-runner.js";
import type { AlertRule } from "./alerts.js";
import { GEN_AI } from "@overseer/schema";

const scrub = { maxAttrsPerSpan: 128, redaction: { mode: "scrub" as const, allowlist: [] } };

// Ingest a run whose single LLM call is expensive enough to trip a cost rule.
// opus at 1000/1000 tokens costs 0.015 + 0.075 = 0.09 per run.
function ingestExpensiveRun(store: Store, trace: string) {
  const req = buildOtlpRequest({
    serviceName: "booking",
    spans: [
      { traceId: trace, spanId: "root", name: "run", startMs: 0, endMs: 500, statusCode: 1 },
      {
        traceId: trace,
        spanId: "llm",
        parentSpanId: "root",
        name: "chat",
        startMs: 10,
        endMs: 400,
        statusCode: 1,
        attributes: {
          [GEN_AI.RESPONSE_MODEL]: "claude-opus-4-8",
          [GEN_AI.USAGE_INPUT_TOKENS]: 1000,
          [GEN_AI.USAGE_OUTPUT_TOKENS]: 1000,
        },
      },
    ],
  });
  const { spans, agentByRun } = mapRequest(req, scrub);
  store.ingest({ spans, agentByRun, receivedAtMs: 1 });
}

const costRule: AlertRule = {
  id: "cost-rule",
  name: "Cost per run too high",
  metric: "cost_per_run",
  threshold: 0.05,
  windowRuns: 3,
  agent: null,
  enabled: true,
};

describe("evaluateAlerts", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
    store.upsertAlertRule(costRule);
    for (const t of ["t1", "t2", "t3"]) ingestExpensiveRun(store, t);
  });
  afterEach(() => store.close());

  it("fires a rule whose window exceeds threshold and records an event", () => {
    const fired = evaluateAlerts(store, { now: () => 1000 });
    expect(fired).toHaveLength(1);
    expect(fired[0]!.rule.id).toBe("cost-rule");
    expect(fired[0]!.observed).toBeCloseTo(0.09, 6);
    expect(store.listAlertEvents()).toHaveLength(1);
  });

  it("respects the cooldown before firing the same rule again", () => {
    evaluateAlerts(store, { now: () => 1000 });
    // Within the cooldown: no new firing.
    expect(evaluateAlerts(store, { now: () => 1000 + DEFAULT_COOLDOWN_MS - 1 })).toHaveLength(0);
    // After the cooldown: fires again.
    expect(evaluateAlerts(store, { now: () => 1000 + DEFAULT_COOLDOWN_MS })).toHaveLength(1);
    expect(store.listAlertEvents()).toHaveLength(2);
  });

  it("does not fire a disabled rule", () => {
    store.upsertAlertRule({ ...costRule, enabled: false });
    expect(evaluateAlerts(store, { now: () => 5000 })).toHaveLength(0);
  });
});

describe("dispatchAlerts", () => {
  it("delivers a fired alert to the webhook", async () => {
    const store = new Store(":memory:");
    store.upsertAlertRule(costRule);
    for (const t of ["t1", "t2", "t3"]) ingestExpensiveRun(store, t);

    const calls: unknown[] = [];
    const stub = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const results = await dispatchAlerts(store, {
      webhookUrl: "https://hooks.example/abc",
      fetchImpl: stub,
      now: () => 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.delivery.ok).toBe(true);
    expect(calls).toHaveLength(1);
    store.close();
  });
});
