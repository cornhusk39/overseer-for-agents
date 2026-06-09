// A small home-service booking agent, instrumented with the Overseer SDK. It is
// the quickstart: it shows how a real agent would wrap its model and tool calls
// so they show up in Overseer, and it is the thing the end-to-end test drives to
// prove the SDK to ingest to SQLite path.
//
// The "intelligence" here is synthetic and deterministic on purpose. The point
// is the instrumentation shape (startRun, llmCall, toolCall, end), not the
// booking logic, and deterministic behavior keeps the example and its test
// stable.

import type { OverseerClient } from "@overseer/sdk";

export type BookingIntent = "list" | "book" | "decline" | "property";

export interface BookingScenario {
  intent: BookingIntent;
  address: string;
}

// The four scenarios mirror the reference cassettes from the eval side, so the
// demo data tells a coherent story across the eval and observability tools.
export const SCENARIOS: BookingScenario[] = [
  { intent: "list", address: "12 Oak St" },
  { intent: "book", address: "44 Maple Ave" },
  { intent: "decline", address: "9 Birch Ln" },
  { intent: "property", address: "12 Oak St" },
];

export interface ScenarioResult {
  traceId: string;
  exported: boolean;
}

// Pretend a model or tool took a moment. Keeps the waterfall from collapsing to
// zero-width bars without making the example slow.
function think(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Which tool a given intent calls, and whether the tool reports success. Only
// the deterministic shape matters.
function toolFor(intent: BookingIntent): { name: string; result: unknown } {
  switch (intent) {
    case "list":
      return { name: "check_availability", result: { slots: ["2026-06-10T09:00", "2026-06-10T13:00"] } };
    case "book":
      return { name: "book_slot", result: { confirmed: true, slot: "2026-06-10T09:00" } };
    case "decline":
      return { name: "check_availability", result: { slots: [] } };
    case "property":
      return { name: "lookup_property", result: { type: "single-family home", lastService: "2026-02-11" } };
  }
}

// Run one booking interaction through the SDK. The run records a planning model
// call, a tool call, and a response model call, then exports as one OTLP trace.
export async function runBookingScenario(
  client: OverseerClient,
  scenario: BookingScenario,
): Promise<ScenarioResult> {
  const run = client.startRun({
    agent: "home-service-booking",
    name: "handle booking",
    attributes: { "booking.intent": scenario.intent, "booking.address": scenario.address },
  });

  // Step 0: the agent plans what to do.
  await run.llmCall(
    { name: "plan", model: "claude-haiku-4-5", system: "anthropic", inputTokens: 120, outputTokens: 40, stepIndex: 0 },
    async () => {
      await think(8);
      return { tool: toolFor(scenario.intent).name };
    },
  );

  // Step 1: the agent calls a tool.
  const tool = toolFor(scenario.intent);
  await run.toolCall({ name: tool.name, stepIndex: 1 }, async () => {
    await think(12);
    return tool.result;
  });

  // Step 2: the agent writes its answer.
  await run.llmCall(
    { name: "respond", model: "claude-sonnet-4-6", system: "anthropic", inputTokens: 160, outputTokens: 90, stepIndex: 2 },
    async () => {
      await think(10);
      return { message: `handled ${scenario.intent} for ${scenario.address}` };
    },
  );

  const result = await run.end();
  return { traceId: run.traceId, exported: result.ok };
}
