// Public surface of the schema package. This package is the trace contract: the
// shared Zod schemas and TypeScript types that every other package validates
// against. It depends only on zod so it can be imported anywhere, including the
// browser bundle for the dashboard.

// Bumped when the on-the-wire or on-disk trace shape changes in a way consumers
// must notice. Kept in lockstep with the AgentProbe cassette version it mirrors.
export const TRACE_CONTRACT_VERSION = 1 as const;

export * from "./semconv.js";
export * from "./otlp.js";
export * from "./domain.js";
export * from "./cassette.js";
