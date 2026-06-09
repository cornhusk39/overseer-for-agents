import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import { createIngestServer, Store, TRACES_PATH, type IngestConfig } from "@overseer/ingest";
import { createClient } from "@overseer/sdk";
import { runBookingScenario, SCENARIOS } from "./agent.js";

// The M4 acceptance test: an example agent run, sent through the real SDK to the
// real ingest receiver, lands in SQLite with correct structure and metrics. This
// is the whole point of the SDK, exercised end to end with nothing stubbed
// except the choice of an ephemeral port and an in-memory database.

function config(): IngestConfig {
  return {
    token: "e2e-token",
    host: "127.0.0.1",
    port: 0,
    dbPath: ":memory:",
    maxBodyBytes: 5 * 1024 * 1024,
    maxSpansPerRequest: 1000,
    maxAttrsPerSpan: 128,
    requestTimeoutMs: 5000,
    redactionMode: "scrub",
    attrAllowlist: [],
  };
}

describe("booking agent end to end (SDK to ingest to SQLite)", () => {
  let store: Store;
  let server: ReturnType<typeof createIngestServer>;
  let endpoint: string;

  beforeEach(async () => {
    store = new Store(":memory:");
    server = createIngestServer(config(), store);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as AddressInfo;
    endpoint = `http://127.0.0.1:${addr.port}${TRACES_PATH}`;
  });
  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  });

  it("lands a single run with its spans and a correct rollup", async () => {
    const client = createClient({ endpoint, token: "e2e-token", serviceName: "home-service-booking" });
    const { traceId, exported } = await runBookingScenario(client, { intent: "property", address: "12 Oak St" });
    expect(exported).toBe(true);

    const run = store.getRun(traceId);
    expect(run).not.toBeNull();
    expect(run!.agent).toBe("home-service-booking");
    expect(run!.status).toBe("ok");

    // root + plan + tool + respond
    const spans = store.getSpans(traceId);
    expect(spans).toHaveLength(4);

    const rollup = store.getRollup(traceId)!;
    expect(rollup.llmCallCount).toBe(2);
    expect(rollup.toolCallCount).toBe(1);
    expect(rollup.toolErrorCount).toBe(0);
    // haiku: 120 in / 40 out, sonnet: 160 in / 90 out
    expect(rollup.totalInputTokens).toBe(280);
    expect(rollup.totalOutputTokens).toBe(130);
    // haiku 0.8/4 per Mtok: 120/1e6*0.8 + 40/1e6*4 = 0.000256
    // sonnet 3/15 per Mtok: 160/1e6*3 + 90/1e6*15 = 0.00183
    expect(rollup.totalCostUsd).toBeCloseTo(0.002086, 6);
    expect(rollup.models.sort()).toEqual(["claude-haiku-4-5", "claude-sonnet-4-6"]);
  });

  it("records a tool call's success outcome from span status", async () => {
    const client = createClient({ endpoint, token: "e2e-token", serviceName: "home-service-booking" });
    const { traceId } = await runBookingScenario(client, { intent: "book", address: "44 Maple Ave" });
    const toolSpan = store.getSpans(traceId).find((s) => s.toolName === "book_slot");
    expect(toolSpan?.toolOutcome).toBe("success");
  });

  it("ingests all four demo scenarios as four runs for one agent", async () => {
    const client = createClient({ endpoint, token: "e2e-token", serviceName: "home-service-booking" });
    for (const scenario of SCENARIOS) {
      await runBookingScenario(client, scenario);
    }
    expect(store.listRuns()).toHaveLength(4);
    const agents = store.listAgents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.runCount).toBe(4);
  });
});
