// Public surface of the sdk package: a thin convenience client over OTLP. It
// gives agent authors startRun, span, llmCall, toolCall, and end without making
// them learn OpenTelemetry, while emitting nothing but standard OTLP/HTTP JSON
// underneath. No bespoke wire protocol, by design.

export * from "./ids.js";
export * from "./otlp-build.js";
export * from "./client.js";
