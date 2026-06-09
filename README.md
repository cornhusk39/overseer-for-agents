# Overseer for Agents

Self-hosted observability for production LLM agents. Send traces in over standard
OpenTelemetry, get agent-native metrics (cost, tokens, tool-call success,
latency, error and tool-failure rates), live run waterfalls, and threshold
alerts to Discord or Slack. One `docker compose up` runs the whole plane, and no
prompts or customer data ever leave your infrastructure.

```
  your agent ──OTLP/HTTP JSON──▶  ingest  ──▶  SQLite  ──▶  dashboard
   (SDK or raw OTLP)              redact          rollups       waterfalls,
                                  + caps          + alerts      trends, alerts
```

## The problem

Teams that ship LLM agents can usually answer "did it pass eval," but not "what
is it doing in production right now." Costs drift, a tool call quietly starts
failing, latency creeps, and nobody notices until a customer does. Generic APM
tools do not understand agent semantics (steps, tool calls, tokens, model cost),
and hosted LLM observability platforms are a non-starter for teams that cannot
ship prompts and customer data to a third party.

Overseer is the missing middle: an observability plane that speaks agent, runs
on your own box, and stands up in one command.

## Why not a hosted platform (or Langfuse)

1. **Agent-native, not prompt-native.** Tool-call success and multi-step run
   health are first-class, not bolted on. The run waterfall, the per-run rollup,
   and the alert metrics are all built around how agents actually fail.
2. **Standards-first.** Ingestion is OpenTelemetry OTLP/HTTP with the GenAI
   semantic conventions (`gen_ai.*`) mapped to agent-native fields. There is no
   proprietary wire protocol to lock you in. Attributes Overseer does not
   recognize are preserved raw rather than dropped.
3. **Self-host-first.** A single compose file, SQLite, no external services. The
   whole thing is one image run twice.
4. **Interop.** Overseer natively reads the
   [AgentProbe](https://github.com/cornhusk39/agentprobe) trace schema, so eval
   (AgentProbe) and production observability (Overseer) form one toolchain.
   Cassettes recorded on the eval side import as runs on the observability side.

## Origin story

This started as a personal homelab "overseer," a read-only watcher that kept an
eye on a handful of self-hosted services and posted to Discord when something
drifted. Pointing it at a couple of LLM agents made the gap obvious: the generic
version had no idea what a tool call or a token was. Overseer for Agents is that
idea generalized and rebuilt around agent semantics, OTLP, and a real trace
model, while keeping the two things the homelab version got right: it runs on
your own hardware, and it tells you in Discord when something breaks.

## Architecture

A TypeScript pnpm workspace, four packages plus an example:

| Package            | Role                                                                 |
| ------------------ | -------------------------------------------------------------------- |
| `packages/schema`  | The trace contract: Zod schemas and types, shared everywhere. Includes the OTLP request shape, the GenAI semconv keys, the domain model (agents, runs, spans, rollups), and the AgentProbe-compatible cassette schema. |
| `packages/ingest`  | The OTLP/HTTP receiver, the SQLite store, the GenAI mapping and per-run rollups, the alert engine and webhook delivery, the cassette importer, the synthetic generator, and the `overseer` CLI. |
| `packages/sdk`     | A thin TypeScript client over OTLP: `startRun`, `span`, `llmCall`, `toolCall`, `end`. No bespoke protocol underneath. |
| `packages/web`     | The Next.js dashboard: agents overview, live runs, run detail with trace waterfall, and trends. |
| `examples/booking-agent` | A small instrumented agent and the end-to-end test that proves the SDK to ingest to SQLite path. |

Data flow: an agent emits OTLP spans (via the SDK or any OTLP client). The ingest
receiver authenticates the request, enforces size and count caps, times it out,
redacts every retained string, maps `gen_ai.*` attributes to agent-native
fields, and writes spans to SQLite in one transaction that also refreshes the
run and its rollup. The dashboard reads a small REST API the ingest service
exposes. Alerts are evaluated on a timer and delivered to a webhook.

Storage is SQLite via better-sqlite3. Postgres is the documented scale path for a
later version, not built in v1; the schema is plain SQL so that port stays
straightforward.

## Quickstart (self-host)

Prerequisites: Docker.

```sh
cp .env.example .env
# Set a long random ingest token, for example:
#   OVERSEER_INGEST_TOKEN=$(openssl rand -hex 32)
docker compose up --build
```

- Dashboard: http://localhost:4319
- OTLP ingest: `POST http://localhost:4318/v1/traces` (bearer auth)
- Read API: `GET http://localhost:4318/api/agents` (and `/api/runs`, `/api/runs/:id`, `/api/trends`)

The SQLite database lives in a named volume, so runs survive restarts.

### Local development

Prerequisites: Node 20+ and pnpm.

```sh
pnpm install
pnpm build
pnpm test      # Vitest across every package
pnpm lint
```

Run the ingest service and dashboard locally:

```sh
OVERSEER_INGEST_TOKEN=dev-token pnpm --filter @overseer/ingest serve   # :4318
pnpm --filter @overseer/web dev                                        # :4319
```

## Sending traces

With the SDK:

```ts
import { createClient } from "@overseer/sdk";

const overseer = createClient({
  endpoint: "http://127.0.0.1:4318/v1/traces",
  token: process.env.OVERSEER_SDK_TOKEN!,
  serviceName: "home-service-booking",
});

const run = overseer.startRun({ name: "handle booking" });
await run.llmCall({ model: "claude-opus-4-8", inputTokens: 160, outputTokens: 90 }, async () => {
  return callYourModel();
});
await run.toolCall({ name: "lookup_property" }, async () => {
  return lookupProperty();
});
await run.end();
```

Or send raw OTLP/HTTP JSON to `/v1/traces` from any OpenTelemetry SDK. Overseer
maps the GenAI conventions automatically. To see it end to end, run the example:

```sh
OVERSEER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces \
OVERSEER_SDK_TOKEN=dev-token \
pnpm --filter @overseer/example-booking start
```

## Alerts

Rules are simple and explicit: a metric, a threshold, and a window of recent runs
the condition must hold over, plus a per-rule cooldown. The four metrics are cost
per run, error rate, tool-failure rate, and p95 latency. Firings are delivered to
a Discord (or Slack-compatible) webhook whose URL comes only from configuration,
never from ingested telemetry.

Verify your webhook wiring, or fire any currently-tripping rule, with:

```sh
OVERSEER_ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/... \
pnpm --filter @overseer/ingest exec overseer alert-test
```

## AgentProbe interop

Import cassettes recorded by AgentProbe as Overseer runs:

```sh
pnpm --filter @overseer/ingest exec overseer import-cassette ./path/to/cassettes
```

The importer preserves the run-level cost and token totals and surfaces tool
calls with their outcomes. Re-importing the same cassette is idempotent.

## Demo (read-only)

The `overseer seed-demo` command fabricates a week of synthetic booking-agent
traffic (including a deliberate cost-and-failure regression near the end) and
exports a snapshot the dashboard can serve with `OVERSEER_READ_ONLY=true`. In
that mode there is no ingest endpoint and no keys, just the bundled synthetic
data, which is exactly what makes it safe to deploy publicly.

## Design tradeoffs

- **SQLite over Postgres.** Single-node self-host is the v1 target, and SQLite
  makes "one command to run it" real. Postgres is the scale path, noted here, not
  built yet. The schema is plain SQL to keep that port honest.
- **Threshold alerts over ML.** v1 rules are a metric, a threshold, and a
  sustained window. They are explainable and tunable, and they do not need a
  training corpus. Anomaly detection is deliberately out of scope.
- **OTLP-first over a custom protocol.** Speaking OTLP means any OpenTelemetry
  SDK can feed Overseer and the SDK stays a thin convenience layer. The cost is
  mapping the verbose OTLP shape, which the schema package isolates.
- **Redaction at ingest, fail-safe by default.** All ingested telemetry is
  treated as untrusted. Scrubbers run before any write, and an attribute
  allowlist mode is available for default-deny. Raw unscrubbed payloads are never
  persisted.

## Security

Secrets live in environment variables only. `.env` is gitignored, `.env.example`
documents every variable, a gitleaks pre-commit hook runs from the first commit,
and `./publish-gate.sh` is a hard full-history secret scan (gitleaks plus
trufflehog) with hygiene checks. The ingest endpoint requires a bearer token and
enforces body-size, span-count, and attribute caps plus a read timeout. See
[SECURITY.md](SECURITY.md) for the full threat model.

## Scope

The v1 specification, including the explicit out-of-scope list, is in
[SPEC.md](SPEC.md). In short: OTLP traces in, SQLite storage, agent-native
metrics, a dashboard, threshold alerts, the AgentProbe importer, and a synthetic
demo. Out: metrics and logs OTLP signals, multi-tenancy, RBAC, Postgres, ML
anomaly detection, and eval scoring (that is AgentProbe's job).

## License

MIT. See [LICENSE](LICENSE).
