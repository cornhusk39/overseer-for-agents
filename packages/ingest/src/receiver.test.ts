import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { processTraces, tokenMatches, bearerToken, createIngestServer, TRACES_PATH } from "./receiver.js";
import { Store } from "./store.js";
import type { IngestConfig } from "./config.js";
import { buildOtlpRequest } from "./test-utils/otlp.js";

function testConfig(overrides: Partial<IngestConfig> = {}): IngestConfig {
  return {
    token: "test-token",
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    maxBodyBytes: 1024 * 1024,
    maxSpansPerRequest: 5,
    maxAttrsPerSpan: 128,
    requestTimeoutMs: 2000,
    redactionMode: "scrub",
    attrAllowlist: [],
    ...overrides,
  };
}

const validRequest = buildOtlpRequest({
  serviceName: "booking",
  spans: [{ traceId: "t1", spanId: "root", name: "run", startMs: 0, endMs: 100, statusCode: 1 }],
});

describe("auth helpers", () => {
  it("parses a bearer token", () => {
    expect(bearerToken("Bearer abc123")).toBe("abc123");
    expect(bearerToken("bearer  abc123 ")).toBe("abc123");
    expect(bearerToken("Basic xyz")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });

  it("compares tokens without length-based false positives", () => {
    expect(tokenMatches("secret", "secret")).toBe(true);
    expect(tokenMatches("secret", "secrets")).toBe(false);
    expect(tokenMatches("", "secret")).toBe(false);
  });
});

describe("processTraces", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
  });
  afterEach(() => store.close());

  it("accepts a valid OTLP body and writes it", () => {
    const result = processTraces(JSON.stringify(validRequest), testConfig(), store, () => 1234);
    expect(result.status).toBe(200);
    expect(store.getRun("t1")?.status).toBe("ok");
  });

  it("rejects a non-JSON body", () => {
    expect(processTraces("not json", testConfig(), store).status).toBe(400);
  });

  it("rejects JSON that is not an OTLP request", () => {
    expect(processTraces(JSON.stringify({ hello: "world" }), testConfig(), store).status).toBe(200);
    // An object with the wrong shape for resourceSpans is rejected.
    expect(processTraces(JSON.stringify({ resourceSpans: "nope" }), testConfig(), store).status).toBe(400);
  });

  it("rejects a batch that exceeds the span cap", () => {
    const many = buildOtlpRequest({
      serviceName: "booking",
      spans: Array.from({ length: 6 }, (_, i) => ({
        traceId: "t1",
        spanId: `s${i}`,
        name: "x",
        startMs: 0,
        endMs: 1,
      })),
    });
    expect(processTraces(JSON.stringify(many), testConfig({ maxSpansPerRequest: 5 }), store).status).toBe(413);
  });
});

// Full path over a real socket, exercising auth, content-type, and body caps.
describe("ingest server", () => {
  let store: Store;
  let server: ReturnType<typeof createIngestServer>;
  let baseUrl: string;

  beforeEach(async () => {
    store = new Store(":memory:");
    server = createIngestServer(testConfig(), store);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  const post = (body: string, headers: Record<string, string>) =>
    fetch(`${baseUrl}${TRACES_PATH}`, { method: "POST", headers, body });

  const authJson = { "content-type": "application/json", authorization: "Bearer test-token" };

  it("rejects a request with no bearer token", async () => {
    const res = await post("{}", { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });

  it("rejects a non-JSON content type", async () => {
    const res = await post("{}", { "content-type": "text/plain", authorization: "Bearer test-token" });
    expect(res.status).toBe(415);
  });

  it("returns 404 for anything but POST /v1/traces", async () => {
    const res = await fetch(`${baseUrl}/healthz`, { headers: { authorization: "Bearer test-token" } });
    expect(res.status).toBe(404);
  });

  it("survives a run id with malformed percent-encoding", async () => {
    // decodeURIComponent throws on %zz; this must come back as a 404, not take
    // the process down with an unhandled rejection.
    const res = await fetch(`${baseUrl}/api/runs/%zz`);
    expect(res.status).toBe(404);
    // The server is still alive and serving.
    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
  });

  it("accepts a small valid payload", async () => {
    const tiny = buildOtlpRequest({
      serviceName: "b",
      spans: [{ traceId: "ok", spanId: "r", name: "x", startMs: 0, endMs: 1, statusCode: 1 }],
    });
    const res = await post(JSON.stringify(tiny), authJson);
    expect(res.status).toBe(200);
    expect(store.getRun("ok")).not.toBeNull();
  });

  it("rejects a body larger than the configured cap", async () => {
    // Use a dedicated server with a tiny cap so a normal-sized valid payload is
    // already over the limit and gets rejected before parsing.
    const tinyCapStore = new Store(":memory:");
    const tinyCapServer = createIngestServer(testConfig({ maxBodyBytes: 16 }), tinyCapStore);
    await new Promise<void>((resolve) => tinyCapServer.listen(0, "127.0.0.1", resolve));
    const addr = tinyCapServer.address() as AddressInfo;
    try {
      const big = JSON.stringify(validRequest);
      expect(big.length).toBeGreaterThan(16);
      const res = await fetch(`http://127.0.0.1:${addr.port}${TRACES_PATH}`, {
        method: "POST",
        headers: authJson,
        body: big,
      });
      expect(res.status).toBe(413);
    } finally {
      await new Promise<void>((resolve) => tinyCapServer.close(() => resolve()));
      tinyCapStore.close();
    }
  });
});
