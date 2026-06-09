import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Store } from "./store.js";
import { importCassette, importCassetteDir, cassetteRunId } from "./importer.js";

const fixturesDir = fileURLToPath(
  new URL("../../../fixtures/agentprobe-cassettes", import.meta.url),
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixturesDir}/${name}`, "utf8"));
}

describe("cassette importer", () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(":memory:");
  });
  afterEach(() => store.close());

  it("round-trips a real AgentProbe cassette into a run with matching metrics", () => {
    const raw = loadFixture("reports-property-history.json");
    const { runId, agent } = importCassette(store, raw, () => 1000);

    const run = store.getRun(runId)!;
    expect(run.agent).toBe("home-service-booking");
    expect(run.status).toBe("ok");
    // The cassette's recorded latency becomes the run duration.
    expect(run.durationMs).toBe(340);

    const rollup = store.getRollup(runId)!;
    // The cassette's run-level cost and token totals are preserved exactly.
    expect(rollup.totalCostUsd).toBeCloseTo(0.0055, 6);
    expect(rollup.totalInputTokens).toBe(160);
    expect(rollup.totalOutputTokens).toBe(90);

    // The tool call from the cassette trace shows up as a tool span.
    const toolSpan = store.getSpans(runId).find((s) => s.toolName === "lookup_property");
    expect(toolSpan).toBeTruthy();
    expect(toolSpan!.toolOutcome).toBe("success");
    expect(agent).toBe("home-service-booking");
  });

  it("is idempotent: re-importing updates the same run", () => {
    const raw = loadFixture("lists-availability.json");
    const first = importCassette(store, raw, () => 1000);
    const second = importCassette(store, raw, () => 2000);
    expect(first.runId).toBe(second.runId);
    expect(store.listRuns().filter((r) => r.id === first.runId)).toHaveLength(1);
  });

  it("imports a whole directory of cassettes", async () => {
    const results = await importCassetteDir(store, fixturesDir);
    expect(results.length).toBeGreaterThanOrEqual(4);
    expect(store.listRuns().length).toBe(results.length);
  });

  it("derives a stable run id from agent and case id", () => {
    expect(cassetteRunId({ agent: "a", caseId: "b" })).toBe(cassetteRunId({ agent: "a", caseId: "b" }));
    expect(cassetteRunId({ agent: "a", caseId: "b" })).not.toBe(cassetteRunId({ agent: "a", caseId: "c" }));
  });
});
