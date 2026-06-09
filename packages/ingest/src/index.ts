// Public surface of the ingest package: the OTLP/HTTP receiver, the SQLite
// store, the derived rollups, the alert engine, and the CLI that ties them
// together. Everything that touches untrusted telemetry lives here, so this is
// where auth, caps, timeouts, and redaction are enforced before any write.
//
// The receiver and store land in M2. For now this exports a name so the
// bootstrap can prove the package builds and tests run.

export const INGEST_PACKAGE = "@overseer/ingest" as const;
