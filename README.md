# Overseer for Agents

Self-hosted observability for production LLM agents. Send traces in over
standard OTLP, get agent-native metrics (cost, tokens, tool-call success,
latency, error rate), live run waterfalls, and threshold alerts to Discord or
Slack. One compose file runs the whole plane. No prompts or customer data ever
leave your infrastructure.

> Work in progress. This README is expanded into a full case study (positioning,
> architecture, design tradeoffs, and the self-host quickstart) at the M7
> milestone. See [SPEC.md](SPEC.md) for the v1 specification and
> [DISCOVERY.md](DISCOVERY.md) for the build's ground truth.

## Why not a hosted platform

- Agent-native, not prompt-native: tool-call success and multi-step run health
  are first-class.
- Standards-first: OTLP in, GenAI semantic conventions respected, no
  proprietary protocol.
- Self-host-first: a single compose file, SQLite, no external services.
- Interop: reads the AgentProbe trace schema, so eval and production
  observability are one toolchain.

## Workspace layout

- `packages/schema` shared Zod trace contract and types.
- `packages/ingest` OTLP/HTTP receiver, SQLite store, rollups, alerts, CLI.
- `packages/sdk` thin TypeScript client over OTLP.
- `packages/web` Next.js dashboard.

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

## License

MIT. See [LICENSE](LICENSE).
