# Working rules for this repo

Overseer for Agents is a self-hosted observability plane for production LLM
agents. These rules carry across every session so the build stays coherent and
the repo stays safe to make public later. SPEC.md is the source of truth for
what we are building; this file is the source of truth for how.

## Ground truth

- SPEC.md defines v1. If reality conflicts with SPEC, stop and flag it rather
  than silently diverging.
- The v1 scope in SPEC is binding, including the out-of-scope list. If a piece
  of work starts ballooning past that scope, stop and call it out instead of
  pushing through.

## Code and comments

- TypeScript end to end. pnpm workspace with four packages: schema, ingest, sdk,
  web.
- Comments explain why, not what, in plain language. Skip comments that just
  restate the code.
- No em dashes anywhere, in code, comments, or docs. Use commas, parentheses, or
  separate sentences.
- Keep functions and modules small enough to hold in your head. Validate
  anything crossing a trust boundary at runtime with the schema package.

## Tests

- Vitest is the verification mechanism. Tests ride along with each feature, in
  the same commit where practical.
- Vitest and lint stay green at every milestone gate. A red suite is a stop, not
  a footnote.

## Security and secrets

- Secrets live in environment variables only. `.env` and `.env.*` are
  gitignored; `.env.example` is committed and documents every variable as it is
  added.
- The gitleaks pre-commit hook runs from the first commit. publish-gate.sh is
  the hard gate: a full-history secret scan plus hygiene checks. It must never
  be edited just to force a pass.
- Treat all ingested telemetry as untrusted input everywhere it is handled.
  Redaction runs before any write. Outbound webhook URLs come from config env,
  never from ingested data.

## Git

- Conventional commits, one logical unit per commit. Incremental history is a
  feature here, not noise.
- The GitHub remote is private and stays private. Never run a command that flips
  visibility to public. Publishing is a manual, human-only step.

## Architecture notes

- Ingestion is OTLP/HTTP with JSON encoding, traces signal only. Metrics are
  derived from spans, not ingested separately.
- GenAI semantic conventions (`gen_ai.*`) map to agent-native fields. Unknown
  attributes are preserved raw rather than dropped.
- Storage is SQLite via better-sqlite3. Postgres is the deferred scale path,
  noted in the README, not built in v1.
- The contract with AgentProbe is schema-level: the same trace shape, validated
  by the schema package. The cassette importer converts AgentProbe cassettes
  into Overseer runs.
