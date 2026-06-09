// Public surface of the sdk package: a thin convenience client over OTLP. It
// gives agent authors startRun, span, toolCall, llmCall, and end without making
// them learn OpenTelemetry, while emitting nothing but standard OTLP/HTTP JSON
// underneath. No bespoke wire protocol, by design.
//
// The client lands in M4. For now this exports a name so the bootstrap can
// prove the package builds and tests run.

export const SDK_PACKAGE = "@overseer/sdk" as const;
