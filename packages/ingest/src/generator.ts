// Synthetic traffic generator. It fabricates realistic booking-agent runs and
// writes them straight to the store, which is how the demo snapshot is seeded
// and how the alert path gets something to fire on. Every value here is made up;
// no real customer data is involved, which is exactly what makes it safe to ship
// in a public demo.
//
// The generator is deterministic given a seed, so a regenerated snapshot is
// reproducible. It spreads runs across a time window so the trends charts have a
// real shape, and it bends the last slice of the window into a cost regression
// so a threshold alert has a reason to fire.

import { type Span } from "@overseer/schema";
import type { Store } from "./store.js";
import { computeCost } from "./pricing.js";

// A tiny seeded PRNG (mulberry32). Deterministic and dependency-free, so the
// snapshot regenerates identically and tests can rely on it.
function makePrng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(prng: () => number, min: number, max: number): number {
  return Math.floor(prng() * (max - min + 1)) + min;
}

function pick<T>(prng: () => number, items: readonly T[]): T {
  return items[Math.floor(prng() * items.length)] as T;
}

interface AgentProfile {
  name: string;
  // Tools this agent tends to call, by booking intent.
  tools: readonly string[];
}

const AGENTS: readonly AgentProfile[] = [
  { name: "home-service-booking", tools: ["check_availability", "book_slot", "lookup_property"] },
  { name: "scheduling-copilot", tools: ["find_open_slots", "reschedule", "notify_customer"] },
];

const ADDRESSES = ["12 Oak St", "44 Maple Ave", "9 Birch Ln", "301 Cedar Ct", "78 Elm Way"] as const;

export interface GenerateOptions {
  // Wall-clock anchor; the window ends here. Injectable for determinism.
  now: number;
  // How many days back the window stretches.
  days: number;
  // Total runs to fabricate across the window.
  totalRuns: number;
  // PRNG seed.
  seed: number;
}

export interface GenerateSummary {
  runs: number;
  agents: string[];
}

// Build the spans for one synthetic run. A run is a root span plus a planning
// model call, a tool call, and a response model call. `regression` makes the run
// expensive (the response uses an Opus-class model with heavy token use), which
// is what trips the cost alert near the end of the window.
function buildRun(
  prng: () => number,
  agent: AgentProfile,
  traceId: string,
  startMs: number,
  regression: boolean,
): Span[] {
  const address = pick(prng, ADDRESSES);
  const toolName = pick(prng, agent.tools);
  // A small fraction of runs hit a tool failure.
  const toolFailed = prng() < (regression ? 0.25 : 0.05);

  const planMs = randInt(prng, 120, 400);
  const toolMs = randInt(prng, 40, 260);
  const respondMs = randInt(prng, 300, regression ? 1600 : 900);
  const gap = 15;
  const total = planMs + toolMs + respondMs + gap * 2;

  const planModel = "claude-haiku-4-5";
  const respondModel = regression ? "claude-opus-4-8" : "claude-sonnet-4-6";
  const planIn = randInt(prng, 90, 200);
  const planOut = randInt(prng, 20, 80);
  const respIn = randInt(prng, 120, regression ? 1200 : 320);
  const respOut = randInt(prng, 60, regression ? 700 : 180);

  const runErrored = toolFailed;

  let cursor = startMs;
  const spans: Span[] = [];

  spans.push({
    runId: traceId,
    spanId: "root",
    parentSpanId: null,
    name: "handle booking",
    kind: "server",
    startMs,
    endMs: startMs + total,
    durationMs: total,
    status: runErrored ? "error" : "ok",
    statusMessage: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    toolName: null,
    toolOutcome: null,
    stepIndex: null,
    attributes: { "booking.address": address },
  });

  // Plan (LLM).
  spans.push(llmSpan(traceId, "plan", "plan", planModel, cursor, planMs, planIn, planOut, 0));
  cursor += planMs + gap;

  // Tool call.
  spans.push({
    runId: traceId,
    spanId: "tool",
    parentSpanId: "root",
    name: `execute_tool ${toolName}`,
    kind: "client",
    startMs: cursor,
    endMs: cursor + toolMs,
    durationMs: toolMs,
    status: toolFailed ? "error" : "ok",
    statusMessage: toolFailed ? "tool call failed" : null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    toolName,
    toolOutcome: toolFailed ? "error" : "success",
    stepIndex: 1,
    attributes: { "gen_ai.tool.name": toolName },
  });
  cursor += toolMs + gap;

  // Respond (LLM).
  spans.push(llmSpan(traceId, "respond", "respond", respondModel, cursor, respondMs, respIn, respOut, 2));

  return spans;
}

function llmSpan(
  traceId: string,
  spanId: string,
  name: string,
  model: string,
  startMs: number,
  durationMs: number,
  inputTokens: number,
  outputTokens: number,
  stepIndex: number,
): Span {
  return {
    runId: traceId,
    spanId,
    parentSpanId: "root",
    name,
    kind: "client",
    startMs,
    endMs: startMs + durationMs,
    durationMs,
    status: "ok",
    statusMessage: null,
    model,
    inputTokens,
    outputTokens,
    costUsd: computeCost(model, inputTokens, outputTokens),
    toolName: null,
    toolOutcome: null,
    stepIndex,
    attributes: { "gen_ai.response.model": model },
  };
}

export function generateTraffic(store: Store, options: GenerateOptions): GenerateSummary {
  const prng = makePrng(options.seed);
  const windowMs = options.days * 24 * 60 * 60 * 1000;
  const windowStart = options.now - windowMs;
  // The last eighth of the window is the regression: costs climb and tool
  // failures get more common, giving the alert engine something to catch.
  const regressionStart = options.now - windowMs / 8;

  const agentsSeen = new Set<string>();

  for (let i = 0; i < options.totalRuns; i++) {
    const agent = pick(prng, AGENTS);
    agentsSeen.add(agent.name);
    // Spread starts across the window with a little jitter so buckets vary.
    const base = windowStart + (i / options.totalRuns) * windowMs;
    const startMs = Math.round(base + prng() * (windowMs / options.totalRuns));
    const regression = startMs >= regressionStart;
    const traceId = `gen-${options.seed.toString(16)}-${i.toString().padStart(4, "0")}`;
    const spans = buildRun(prng, agent, traceId, startMs, regression);
    store.ingest({ spans, agentByRun: new Map([[traceId, agent.name]]), receivedAtMs: startMs });
  }

  return { runs: options.totalRuns, agents: [...agentsSeen] };
}
