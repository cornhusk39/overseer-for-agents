# Security

Overseer is a network-facing service that ingests telemetry from agents and is
meant to be self-hosted. This document describes the threat model it is built
against and how to report a problem.

## Reporting a vulnerability

Please do not open a public issue for a security problem. Instead, report it
privately through GitHub's security advisory flow for this repository. Include
enough detail to reproduce. You will get an acknowledgement and a fix timeline.

## Threat model

**Secrets.** Secrets live in environment variables only. `.env` and `.env.*` are
gitignored; `.env.example` is committed and documents every variable. A gitleaks
pre-commit hook runs from the first commit, and `./publish-gate.sh` is a hard
gate that scans the entire git history with two independent tools (gitleaks and
trufflehog) plus hygiene checks, and must pass before the repository is made
public. If a secret ever lands, rotate it first, then scrub history.

**Ingest endpoint abuse.** The OTLP receiver requires a static bearer token on
every request. It enforces a request body-size cap (rejected before the body is
read), a per-request span-count cap, a per-span attribute cap, and a read
timeout, and it does not follow redirects. Oversized or slow requests are closed
cleanly rather than allowed to exhaust resources.

**PII and secrets in telemetry.** All ingested telemetry is treated as untrusted
input everywhere it is handled. Ingest-time redaction is mandatory and runs
before any write: scrubbers mask emails, phone numbers, and key-shaped tokens,
and an attribute allowlist mode is available for default-deny. Raw unscrubbed
payloads are never persisted. The cassette importer stores only structural
metadata (step roles, tool names), never raw message or tool payloads.

**Webhook safety.** Outbound alert webhook URLs come only from configuration,
never from ingested data, and delivery does not follow redirects. A failed
delivery is reported and logged, never allowed to crash the evaluator.

**Read API exposure.** The dashboard read API (`/api/*`) is unauthenticated and
intended for the trusted local dashboard. The service binds to localhost by
default. A deployment that exposes it more widely should place it behind its own
gateway or network controls.

**Demo deployment.** The public read-only demo serves a bundled synthetic
snapshot. It mounts no ingest route and carries no keys, and all of its data is
fabricated, so there is nothing sensitive to leak.

## Supported scope

This is a v1 self-host target. Multi-tenancy, RBAC, and authenticated read access
are explicitly out of scope for v1; do not rely on the read API as an
authorization boundary.
