# Discovery

Ground truth for the Overseer for Agents v1 build, captured before any feature
code so the milestone plan rests on verified facts rather than assumptions.

## Goal restated

Overseer for Agents is a self-hosted observability plane for production LLM
agents. Agents send traces in over standard OTLP/HTTP (JSON), or through a thin
TypeScript SDK that wraps OTLP. Overseer stores the traces in SQLite, renders
live runs and trace waterfalls in a Next.js dashboard, derives agent-native
metrics (cost, tokens, tool-call success, latency, error rate) from the spans,
and pushes threshold-based alerts to Discord or Slack webhooks. The whole plane
comes up with one `docker compose up`.

The positioning is deliberate: agent-native rather than prompt-native,
standards-first (OTLP in, GenAI semantic conventions respected), self-host-first
(SQLite, no external services), and interoperable with AgentProbe so that eval
and production observability form one toolchain.

## Locked decisions (from SPEC, not up for debate)

- TypeScript end to end, pnpm workspace, four packages: `schema`, `ingest`,
  `sdk`, `web`.
- Ingestion is OTLP/HTTP with JSON encoding, traces signal only. Metrics are
  derived from spans, never ingested separately. GenAI semantic conventions
  (`gen_ai.*`) map to agent-native fields; unknown attributes are preserved raw.
- SDK is a thin convenience layer over OTLP. No bespoke wire protocol.
- Storage is SQLite via better-sqlite3. Single-node self-host is the v1 target.
  Postgres is deferred and called out in the README as the scale path.
- The AgentProbe contract is schema-level, not code-level: same trace shape,
  validated by the `schema` package. An importer converts AgentProbe cassettes
  into Overseer runs.
- Alerting is webhook-based, Discord first, Slack-compatible payload. Rules are
  threshold plus sustained-window on cost per run, error rate, tool failure
  rate, and p95 latency. No ML anomaly detection in v1.
- Vitest for tests. Conventional commits. Comments explain why, in plain
  language, no em dashes.

## Proposed defaults (these were vetoable at this gate; all accepted as-is)

- Ingest auth: static bearer token from env. No multi-tenant auth in v1.
- Redaction at ingest: configurable scrubbers (emails, phone numbers,
  API-key-shaped strings) run before any write, plus an attribute allowlist
  mode. Raw unscrubbed payloads are never persisted.
- Demo: a synthetic traffic generator replays realistic booking-agent traces
  (synthetic data only) into a seeded SQLite snapshot. The public demo serves
  the dashboard read-only from that snapshot. No live ingest, no keys.
- Self-host artifact: docker-compose running ingest plus web, a volume for the
  SQLite database, and an .env.example documenting every variable.

None of the defaults are blocking, so the build proceeds with them intact.

## Environment inventory

| Tool       | Found            | Notes                                        |
| ---------- | ---------------- | -------------------------------------------- |
| OS         | macOS (Darwin 24.6, arm64) | Coltons-Mac-mini                   |
| Shell      | zsh              |                                              |
| Node       | v22.22.0         | Satisfies the Node 20+ requirement           |
| pnpm       | 9.15.0           | Workspace package manager                    |
| npm        | 10.9.4           | Present, not the primary manager             |
| git        | 2.50.1           |                                              |
| gh CLI     | 2.87.0           | Authenticated as cornhusk39, scopes include repo and workflow |
| gitleaks   | 8.30.1           | Pre-commit hook and gate scanner             |
| trufflehog | 3.95.5           | Installed during discovery via Homebrew      |
| docker     | 29.4.0           | For the compose self-host path               |
| corepack   | 0.34.0           |                                              |

All prerequisites are satisfied. trufflehog was the only gap and was installed
before the build started, so publish-gate.sh can run both scanners.

## Verification mechanism

Vitest, established as part of M0 with one trivial green test per package. Every
milestone gate runs the full Vitest suite plus lint and must be green before a
commit and push.

## Repository placement and naming

- Local path: `~/apps/overseer-for-agents`, alongside the sibling projects.
- Remote: `cornhusk39/overseer-for-agents`, created private. The plain
  `overseer` name is already taken by the personal homelab overseer that this
  project's origin story generalizes from, which is a clean tie-in for the
  README rather than a conflict.

## AgentProbe interop contract (the compatibility target)

AgentProbe records each agent run as a cassette. The shape that Overseer's
`schema` package must accept and the importer must convert:

```
{
  version: 1,
  caseId: string,
  agent: string,
  recordedAt: ISO-8601 string,
  input: unknown,
  result: {
    output: unknown,
    trace: TraceStep[],   // discriminated union on "type"
    metrics: { latencyMs, costUsd, steps, inputTokens?, outputTokens? }
  },
  redaction?: { hits: [{ rule, path }] }
}
```

A `TraceStep` is either `{ type: "message", role, content }` or
`{ type: "tool_call", call: { name, args, result?, error? } }`. Overseer maps a
cassette to one run whose spans are reconstructed from `trace`, with the run
rollup seeded from `metrics`. This is verified by a round-trip test against the
committed AgentProbe cassette fixtures (booking-agent domain), which keeps the
two tools' trace shapes from drifting.

## Assumptions and open inputs

- Cost accounting derives dollars from a small per-model pricing table applied
  to token counts, and also honors a cost attribute if a trace supplies one
  directly. Fixtures pin the expected numbers so the math is testable.
- "Step index" comes from an explicit span attribute when present and falls back
  to span ordering within a run otherwise.
- Discord delivery is exercised in tests against a stub webhook; the real
  outbound URL only ever comes from config env, never from ingested data.
- No blocking unknowns remain. The build can run end to end without further
  input.

## Milestone plan

- M0 Bootstrap: git init on main, CLAUDE.md with the build rules, .gitignore,
  .env.example, gitleaks pre-commit hook, publish-gate.sh, pnpm workspace
  scaffold with Vitest green, private remote created and pushed.
- M1 schema: the Zod trace contract, OTLP and GenAI semconv types, the domain
  model, and AgentProbe compatibility tests.
- M2 ingest: OTLP/HTTP JSON receiver with bearer auth, size and count caps,
  timeouts, redaction, and SQLite writes, proven by posting synthetic OTLP.
- M3 rollups: derived per-run rollups and the GenAI semconv mapping, with cost
  and token accounting correct against fixture traces.
- M4 SDK: the thin OTLP client plus an instrumented example agent, proving the
  SDK to ingest to SQLite path end to end.
- M5 dashboard: agents overview, live runs, run detail with waterfall and tool
  outcomes, and trends with time-range filters.
- M6 alerts and importer: the threshold plus sustained-window rules engine,
  Discord delivery, a test-fire command, and the AgentProbe cassette importer.
- M7 demo and ship: synthetic traffic generator, seeded demo snapshot,
  read-only mode, docker-compose, the README case study, hardening, and a clean
  publish-gate.sh run.
