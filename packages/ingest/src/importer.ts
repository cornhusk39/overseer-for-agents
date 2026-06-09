// The AgentProbe cassette importer. It reads a cassette (validated by the shared
// schema's cassette contract) and reconstructs it as an Overseer run with spans,
// so a run recorded on the eval side shows up in the observability side. This is
// the interop promise made concrete.
//
// A cassette records steps without timestamps, so we lay the steps out evenly
// across the run's recorded latency to produce a plausible waterfall. The
// run-level token and cost totals from the cassette ride on the root span. We
// deliberately store only structural metadata (step roles, tool names), never
// the raw message or tool payloads, so importing cannot leak conversation text.

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cassetteSchema, type Cassette, type Span } from "@overseer/schema";
import type { Store } from "./store.js";

// Deterministic run id for a cassette, so re-importing the same cassette updates
// the same run rather than creating a duplicate.
export function cassetteRunId(cassette: Pick<Cassette, "agent" | "caseId">): string {
  return createHash("sha1").update(`${cassette.agent}:${cassette.caseId}`).digest("hex").slice(0, 32);
}

export interface ImportResult {
  runId: string;
  agent: string;
  spanCount: number;
}

// Convert a validated cassette into domain spans. fallbackStartMs anchors a
// cassette whose recordedAt is unparseable; the import time is a far more
// truthful default than the epoch, which would bury the run at the bottom of
// every list and in a 1970 trend bucket.
export function cassetteToSpans(
  cassette: Cassette,
  fallbackStartMs: number,
): { spans: Span[]; agent: string; runId: string } {
  const runId = cassetteRunId(cassette);
  const parsedStart = Date.parse(cassette.recordedAt);
  const startMs = Number.isNaN(parsedStart) ? fallbackStartMs : parsedStart;
  const total = Math.max(1, cassette.result.metrics.latencyMs);
  const steps = cassette.result.trace;
  const slice = total / Math.max(1, steps.length);

  const spans: Span[] = [];

  // Root span carries the run-level token and cost totals from the cassette.
  spans.push({
    runId,
    spanId: "root",
    parentSpanId: null,
    name: `run ${cassette.caseId}`,
    kind: "server",
    startMs,
    endMs: startMs + total,
    durationMs: total,
    status: "ok",
    statusMessage: null,
    model: null,
    inputTokens: cassette.result.metrics.inputTokens ?? null,
    outputTokens: cassette.result.metrics.outputTokens ?? null,
    costUsd: cassette.result.metrics.costUsd,
    toolName: null,
    toolOutcome: null,
    stepIndex: null,
    attributes: {
      "overseer.import.source": "agentprobe-cassette",
      "agentprobe.case_id": cassette.caseId,
    },
  });

  steps.forEach((step, i) => {
    const sStart = startMs + i * slice;
    const sEnd = sStart + slice;
    if (step.type === "tool_call") {
      const errored = typeof step.call.error === "string";
      spans.push({
        runId,
        spanId: `step-${i}`,
        parentSpanId: "root",
        name: `execute_tool ${step.call.name}`,
        kind: "client",
        startMs: sStart,
        endMs: sEnd,
        durationMs: slice,
        status: errored ? "error" : "ok",
        statusMessage: errored ? (step.call.error as string) : null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        toolName: step.call.name,
        toolOutcome: errored ? "error" : "success",
        stepIndex: i,
        attributes: { "gen_ai.tool.name": step.call.name },
      });
    } else {
      spans.push({
        runId,
        spanId: `step-${i}`,
        parentSpanId: "root",
        name: `message ${step.role}`,
        kind: "internal",
        startMs: sStart,
        endMs: sEnd,
        durationMs: slice,
        status: "ok",
        statusMessage: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        toolName: null,
        toolOutcome: null,
        stepIndex: i,
        attributes: { "message.role": step.role },
      });
    }
  });

  return { spans, agent: cassette.agent, runId };
}

// Import one cassette (already parsed JSON or a raw object) into the store. The
// run is rebuilt from scratch rather than upserted: a re-recorded cassette can
// have fewer steps than the previous recording, and leaving the removed steps
// behind would freeze stale data (including old error statuses) into the run.
export function importCassette(store: Store, raw: unknown, now: () => number = () => Date.now()): ImportResult {
  const cassette = cassetteSchema.parse(raw);
  const { spans, agent, runId } = cassetteToSpans(cassette, now());
  store.deleteRunData(runId);
  store.ingest({ spans, agentByRun: new Map([[runId, agent]]), receivedAtMs: now() });
  return { runId, agent, spanCount: spans.length };
}

export async function importCassetteFile(store: Store, filePath: string): Promise<ImportResult> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  return importCassette(store, raw);
}

// Import every .json cassette in a directory.
export async function importCassetteDir(store: Store, dir: string): Promise<ImportResult[]> {
  const entries = await fs.readdir(dir);
  const files = entries.filter((e) => e.endsWith(".json"));
  const results: ImportResult[] = [];
  for (const file of files) {
    results.push(await importCassetteFile(store, path.join(dir, file)));
  }
  return results;
}
