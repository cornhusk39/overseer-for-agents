# Contributing

Thanks for taking an interest. This file carries the working rules the
project is built under so contributions land cleanly.

## Ground rules

- SPEC.md defines v1, including the explicit out-of-scope list. Features
  beyond that scope should start as an issue, not a surprise pull request.
- TypeScript end to end. pnpm workspace with four packages (schema, ingest,
  sdk, web) plus the example agent.
- Comments explain why, not what, in plain language.

## Tests

Vitest is the verification mechanism. Tests ride along with the change they
cover, in the same commit where practical. CI runs build, lint, and the full
suite on every push and pull request; all three stay green.

```sh
pnpm install
pnpm build
pnpm lint
pnpm test
```

## Security and secrets

- Secrets live in environment variables only. `.env` and `.env.*` are
  gitignored; `.env.example` is committed and documents every variable as it
  is added.
- A gitleaks pre-commit hook guards every commit. Enable it once per clone:
  `git config core.hooksPath .githooks`
- `./publish-gate.sh` is the hard gate: a full-history secret scan (gitleaks
  plus trufflehog) and hygiene checks. It must pass before any release and
  must never be edited just to force a pass.
- Treat all ingested telemetry as untrusted input everywhere it is handled.
  Redaction runs before any write. Outbound webhook URLs come from config
  env, never from ingested data.

## Git

Conventional commits, one logical unit per commit. Incremental history is a
feature here, not noise.

## Architecture constraints worth knowing before you patch

- Ingestion is OTLP/HTTP with JSON encoding, traces signal only. Metrics are
  derived from spans, not ingested separately.
- GenAI semantic conventions (`gen_ai.*`) map to agent-native fields; unknown
  attributes are preserved raw rather than dropped.
- Storage is SQLite via better-sqlite3. Postgres is the deferred scale path,
  not built in v1.
- The contract with AgentProbe is schema-level: the same trace shape,
  validated independently by the schema package. The cassette importer
  converts AgentProbe cassettes into runs.
