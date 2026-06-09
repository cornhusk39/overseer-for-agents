# Overseer for Agents, v1 Specification

## Problem
Teams that ship LLM agents can answer "did it work in eval" but not "what is it
doing in production right now." Costs drift, tool calls silently start failing,
latency creeps, and nobody notices until a customer does. Generic APM tools do
not understand agent semantics (steps, tool calls, tokens, model cost), and
hosted LLM observability platforms are a non-starter for teams that cannot ship
prompts and customer data to a third party.

## What Overseer for Agents is
A self-hosted observability plane for production AI agents. Agents send traces
in via standard OpenTelemetry (OTLP), or via a thin TypeScript SDK for teams
that do not want to touch OTel directly. Overseer stores them, renders live
runs and trace waterfalls, computes agent-native metrics (cost, tokens,
tool-call success, latency, error rate), and pushes anomaly alerts to Discord
or Slack webhooks. One docker compose up gets you the whole plane.

## Positioning (the README must answer "why not Langfuse")
1. Agent-native, not prompt-native: tool-call success and multi-step run health
   are first-class, not afterthoughts.
2. Standards-first: OTLP in, GenAI semantic conventions respected. No
   proprietary lock-in protocol.
3. Self-host-first: single compose file, SQLite, no external services required.
4. Interop: natively reads AgentProbe trace schema, so eval (AgentProbe) and
   production observability (Overseer) form one toolchain. Cassettes from
   AgentProbe can be imported as runs.

## Pinned decisions (locked)
- TypeScript end to end. pnpm workspace, packages: `schema` (shared types and
  Zod schemas, the AgentProbe-compatible trace contract), `ingest` (Node OTLP
  receiver and REST API), `sdk` (thin TS client wrapping OTLP), `web` (Next.js
  App Router dashboard).
- Ingestion: OTLP/HTTP with JSON encoding first, traces signal only. Metrics
  are derived from spans, not ingested separately. GenAI semantic conventions
  (gen_ai.* attributes) mapped to agent-native fields; unknown attributes are
  preserved raw.
- SDK: thin convenience layer over OTLP. startRun, span, toolCall, llmCall,
  end. No bespoke wire protocol.
- Storage: SQLite via better-sqlite3. Single-node self-host is the v1 target.
  Postgres is deferred and noted in the README as the scale path.
- Contract with AgentProbe is schema-level, not code-level: same trace shape,
  validated by the `schema` package. An importer converts AgentProbe cassettes
  into Overseer runs.
- Alerting: webhook-based, Discord first, Slack-compatible payload option.
  Rules are simple and explicit in v1: threshold plus sustained-window on cost
  per run, error rate, tool failure rate, and p95 latency. No ML anomaly
  detection in v1.
- Vitest for tests. Conventional commits. Comments explain why, in plain
  language, no em dashes.

## Defaults (proposed, veto at the discovery gate)
- Auth on ingest: static bearer token from env. Multi-tenant auth is out of
  scope for v1.
- Redaction at ingest: configurable scrubbers run before write (regex set for
  emails, phone numbers, API-key-shaped strings; attribute allowlist mode
  available). Raw unscrubbed payloads are never persisted.
- Demo: a synthetic traffic generator replays realistic agent traces (booking
  agent domain, synthetic data only) into a seeded SQLite snapshot. The public
  Vercel demo serves the dashboard read-only from that snapshot. No live
  ingest endpoint and no keys in the demo deployment.
- Self-host artifact: docker-compose.yml running ingest plus web, volume for
  SQLite, .env.example documenting every variable.

## v1 scope
In:
1. `schema` package: trace contract, Zod-validated, AgentProbe-compatible.
2. OTLP/HTTP JSON receiver with bearer auth, size caps, timeouts, and
   ingest-time redaction.
3. GenAI semconv mapping to agent-native fields (model, tokens in/out, cost,
   tool name, tool outcome, step index).
4. SQLite persistence: agents, runs, spans, derived per-run rollups.
5. Thin TS SDK over OTLP plus a quickstart example agent instrumented with it.
6. AgentProbe cassette importer (CLI command).
7. Dashboard: agents overview, live runs list, run detail with trace waterfall
   and tool-call outcomes, trends (cost, tokens, latency p50/p95, error and
   tool-failure rates) with time-range filters.
8. Alert rules engine (threshold plus sustained window) and Discord webhook
   delivery, with a test-fire command.
9. Synthetic traffic generator, seeded demo snapshot, read-only demo mode.
10. docker-compose self-host path documented in the README.

Out (explicit, to prevent sprawl):
- Metrics and logs OTLP signals, multi-tenancy, RBAC, Postgres, ML-based
  anomaly detection, alert dedup beyond a simple cooldown, eval scoring (that
  is AgentProbe's job), Prometheus/Grafana integration.

## Milestones
- M0. Bootstrap: repo initialized, private GitHub remote created, hygiene in
  place (working rules, .gitignore, .env.example, gitleaks pre-commit hook,
  publish-gate.sh), pnpm workspace scaffolded, Vitest green on a trivial test.
- M1. `schema` package with the trace contract and AgentProbe compatibility
  tests.
- M2. Ingest service: OTLP/HTTP JSON receiver, auth, caps, redaction, SQLite
  writes. Proven by tests posting synthetic OTLP payloads.
- M3. Derived rollups and the GenAI semconv mapping. Cost and token accounting
  correct against fixture traces.
- M4. SDK plus instrumented example agent. End to end: example agent run
  appears in the database via the SDK path.
- M5. Dashboard: agents, runs, waterfall, trends.
- M6. Alerts engine plus Discord delivery plus test-fire. Cassette importer.
- M7. Synthetic traffic generator, seeded demo snapshot, read-only mode,
  compose file, README as a case study (origin story: generalized from a
  personal homelab overseer; why not Langfuse; design tradeoffs). Harden,
  publish-gate.sh clean. STOP for human review.

## Threat model (public repo, network-facing service)
- Secrets: env only, .env gitignored, .env.example committed, gitleaks hook
  from commit 1, publish-gate.sh as the hard gate. Rotate first if anything
  ever lands, then scrub.
- Ingest endpoint abuse: bearer auth required, request size caps, span and
  attribute count caps, timeouts, no redirects followed.
- PII and secrets in telemetry: ingest-time redaction is mandatory and runs
  before any write. Demo data is fully synthetic.
- Webhook safety: outbound alert URLs come from config env, never from
  ingested data.
- Demo deployment: read-only, no ingest route mounted, no keys.

## Definition of done
M0 through M7 complete; Vitest and lint green; an example agent run flows
SDK -> ingest -> SQLite -> dashboard end to end; a fixture regression in the
synthetic traffic fires a Discord alert via test-fire; the AgentProbe cassette
importer round-trips a real cassette fixture; the demo snapshot renders all
dashboard views; README covers positioning, architecture, tradeoffs, and the
self-host quickstart; publish-gate.sh exits clean. Then STOP. The repo stays
private. Report status and wait for human review.
