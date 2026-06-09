// OpenTelemetry GenAI semantic convention attribute keys, plus the few
// Overseer-specific keys the SDK sets where the spec has no standard yet.
//
// Centralizing the strings here keeps the SDK (which writes them) and the
// ingest mapping (which reads them) from drifting apart over a typo. The
// mapping logic that turns these into agent-native fields lives in the ingest
// package; this module is only the shared vocabulary.

// Standard gen_ai.* keys from the OpenTelemetry GenAI conventions.
export const GEN_AI = {
  // The provider or system, for example "anthropic" or "openai".
  SYSTEM: "gen_ai.system",
  // The model the caller requested and the model the provider actually served.
  // Both exist because providers sometimes substitute a versioned model id.
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  // Token usage for the call.
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  // The operation a span represents, for example "chat" or "execute_tool".
  OPERATION_NAME: "gen_ai.operation.name",
  // The tool a tool-execution span invoked.
  TOOL_NAME: "gen_ai.tool.name",
  // The agent identity, when the instrumentation sets it directly. Overseer
  // falls back to the resource service.name when this is absent.
  AGENT_NAME: "gen_ai.agent.name",
} as const;

// The standard resource attribute carrying the service (agent) name. Used as
// the fallback source of an agent's identity.
export const SERVICE_NAME = "service.name";

// Overseer-specific keys. These cover things the GenAI conventions do not yet
// standardize. They are namespaced so they never collide with future gen_ai.*
// additions, and unknown-to-us attributes are always preserved raw regardless.
export const OVERSEER = {
  // Direct cost in US dollars for a span, when the producer already knows it.
  // When absent, ingest derives cost from token counts and a model price table.
  COST_USD: "overseer.cost_usd",
  // Zero-based position of a step within its run, when the producer tracks it.
  // When absent, ingest assigns step order from span start time.
  STEP_INDEX: "overseer.step_index",
} as const;

// Operation-name values worth special-casing in the mapping. Anything else is
// still ingested; these just get first-class agent-native treatment.
export const OPERATION = {
  EXECUTE_TOOL: "execute_tool",
} as const;
