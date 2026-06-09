import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  cassetteSchema,
  cassetteToolCalls,
  CASSETTE_VERSION,
  type CassetteTraceStep,
} from "./cassette.js";

// The compatibility guarantee in action: parse the real AgentProbe cassettes
// committed under fixtures/ with Overseer's independently-derived schema. If
// AgentProbe's shape ever drifts from ours, these fail.
const fixturesDir = fileURLToPath(
  new URL("../../../fixtures/agentprobe-cassettes", import.meta.url),
);
const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

describe("AgentProbe cassette compatibility", () => {
  it("found cassette fixtures to test against", () => {
    expect(fixtureFiles.length).toBeGreaterThan(0);
  });

  for (const file of fixtureFiles) {
    it(`accepts the real cassette ${file}`, () => {
      const raw = JSON.parse(readFileSync(`${fixturesDir}/${file}`, "utf8"));
      const parsed = cassetteSchema.parse(raw);
      expect(parsed.version).toBe(CASSETTE_VERSION);
      expect(parsed.agent).toBeTruthy();
      expect(parsed.result.metrics.costUsd).toBeGreaterThanOrEqual(0);
      // Every trace step must be one of the two known kinds.
      for (const step of parsed.result.trace) {
        expect(["message", "tool_call"]).toContain(step.type);
      }
    });
  }

  it("recovers tool calls from a cassette that uses tools", () => {
    const raw = JSON.parse(
      readFileSync(`${fixturesDir}/reports-property-history.json`, "utf8"),
    );
    const parsed = cassetteSchema.parse(raw);
    const calls = cassetteToolCalls(parsed.result.trace);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]?.name).toBe("lookup_property");
  });
});

describe("cassette schema defaults and validation", () => {
  it("defaults missing tool args and trace to empty", () => {
    const parsed = cassetteSchema.parse({
      version: 1,
      caseId: "c1",
      agent: "a1",
      recordedAt: "2026-06-08T00:00:00.000Z",
      input: { q: "hi" },
      result: {
        output: "ok",
        // trace omitted on purpose to exercise the default
        metrics: { latencyMs: 10, costUsd: 0, steps: 1 },
      },
    });
    expect(parsed.result.trace).toEqual([]);
  });

  it("rejects an unknown trace step type", () => {
    const bad = {
      version: 1,
      caseId: "c1",
      agent: "a1",
      recordedAt: "2026-06-08T00:00:00.000Z",
      input: {},
      result: {
        output: null,
        trace: [{ type: "thinking", content: "hmm" }] as unknown as CassetteTraceStep[],
        metrics: { latencyMs: 1, costUsd: 0, steps: 0 },
      },
    };
    expect(() => cassetteSchema.parse(bad)).toThrow();
  });

  it("rejects a cassette from a future version", () => {
    const bad = {
      version: 2,
      caseId: "c1",
      agent: "a1",
      recordedAt: "2026-06-08T00:00:00.000Z",
      input: {},
      result: { output: null, trace: [], metrics: { latencyMs: 1, costUsd: 0, steps: 0 } },
    };
    expect(() => cassetteSchema.parse(bad)).toThrow();
  });
});
