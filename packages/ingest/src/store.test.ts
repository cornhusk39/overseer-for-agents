import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Store } from "./store.js";
import { mapRequest } from "./otlp-mapping.js";
import { buildOtlpRequest, type SpanSpec } from "./test-utils/otlp.js";

const scrub = { maxAttrsPerSpan: 128, redaction: { mode: "scrub" as const, allowlist: [] } };

// Convenience: map a synthetic request and write it, returning the touched runs.
function ingest(store: Store, serviceName: string, spans: SpanSpec[], receivedAtMs = 1000) {
  const { spans: mapped, agentByRun } = mapRequest(buildOtlpRequest({ serviceName, spans }), scrub);
  return store.ingest({ spans: mapped, agentByRun, receivedAtMs });
}

describe("Store", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
  });
  afterEach(() => {
    store.close();
  });

  it("persists spans and reads them back in start order", () => {
    ingest(store, "booking", [
      { traceId: "t1", spanId: "root", name: "run", startMs: 0, endMs: 900, statusCode: 1 },
      { traceId: "t1", spanId: "child", parentSpanId: "root", name: "tool", startMs: 100, endMs: 300 },
    ]);
    const spans = store.getSpans("t1");
    expect(spans.map((s) => s.spanId)).toEqual(["root", "child"]);
  });

  it("marks a run ok once its root span is present", () => {
    ingest(store, "booking", [
      { traceId: "t1", spanId: "root", name: "run", startMs: 0, endMs: 900, statusCode: 1 },
    ]);
    const run = store.getRun("t1")!;
    expect(run.status).toBe("ok");
    expect(run.durationMs).toBe(900);
    expect(run.agent).toBe("booking");
  });

  it("treats a run with no root span yet as running", () => {
    ingest(store, "booking", [
      { traceId: "t2", spanId: "child", parentSpanId: "root", name: "tool", startMs: 0, endMs: 50 },
    ]);
    const run = store.getRun("t2")!;
    expect(run.status).toBe("running");
    expect(run.endMs).toBeNull();
    expect(run.durationMs).toBeNull();
  });

  it("marks a run errored when any span errors", () => {
    ingest(store, "booking", [
      { traceId: "t3", spanId: "root", name: "run", startMs: 0, endMs: 100, statusCode: 1 },
      { traceId: "t3", spanId: "tool", parentSpanId: "root", name: "lookup", startMs: 10, endMs: 40, statusCode: 2 },
    ]);
    expect(store.getRun("t3")!.status).toBe("error");
  });

  it("upserts spans idempotently across repeated batches", () => {
    ingest(store, "booking", [
      { traceId: "t4", spanId: "root", name: "run", startMs: 0, endMs: 100, statusCode: 1 },
    ]);
    // Same span again with a later end time, simulating a corrected export.
    ingest(store, "booking", [
      { traceId: "t4", spanId: "root", name: "run", startMs: 0, endMs: 200, statusCode: 1 },
    ]);
    expect(store.getSpans("t4").length).toBe(1);
    expect(store.getRun("t4")!.durationMs).toBe(200);
  });

  it("tracks agents with first and last seen and run counts", () => {
    ingest(store, "booking", [{ traceId: "t5", spanId: "root", name: "run", startMs: 0, endMs: 10, statusCode: 1 }], 5000);
    ingest(store, "booking", [{ traceId: "t6", spanId: "root", name: "run", startMs: 0, endMs: 10, statusCode: 1 }], 8000);
    const agents = store.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("booking");
    expect(agents[0]!.firstSeenMs).toBe(5000);
    expect(agents[0]!.lastSeenMs).toBe(8000);
    expect(agents[0]!.runCount).toBe(2);
  });

  it("lists runs newest first", () => {
    ingest(store, "booking", [{ traceId: "old", spanId: "root", name: "run", startMs: 100, endMs: 200, statusCode: 1 }]);
    ingest(store, "booking", [{ traceId: "new", spanId: "root", name: "run", startMs: 5000, endMs: 5100, statusCode: 1 }]);
    expect(store.listRuns().map((r) => r.id)).toEqual(["new", "old"]);
  });
});
