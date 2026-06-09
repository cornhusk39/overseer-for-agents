// Public surface of the schema package. This package is the trace contract:
// the shared Zod schemas and TypeScript types that every other package
// validates against. It is intentionally dependency-light (zod only) so it can
// be imported anywhere, including the browser bundle for the dashboard.
//
// The real contract lands in M1. For now this exports the contract version so
// the bootstrap has something concrete to test and the other packages have a
// package to depend on.

// Bumped when the on-the-wire or on-disk trace shape changes in a way consumers
// must notice. Kept in lockstep with the AgentProbe cassette version it mirrors.
export const TRACE_CONTRACT_VERSION = 1 as const;
