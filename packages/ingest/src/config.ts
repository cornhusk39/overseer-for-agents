// Ingest configuration, loaded once from the environment and validated. Every
// limit that protects the service (body size, span and attribute counts, read
// timeout) lives here so the receiver has a single, typed source of truth and
// the defaults are visible in one place.

import { z } from "zod";

// Coerce an env string into a positive integer, falling back to a default when
// the variable is unset or blank. Invalid values are a configuration error, so
// they throw rather than silently using the default.
function intFromEnv(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return n;
}

export const redactionModeSchema = z.enum(["scrub", "allowlist"]);
export type RedactionMode = z.infer<typeof redactionModeSchema>;

export interface IngestConfig {
  // Bearer token required on every ingest request. Empty only in tests, where
  // the receiver is constructed directly with a known token.
  token: string;
  host: string;
  port: number;
  dbPath: string;
  // Reject request bodies larger than this before reading them fully.
  maxBodyBytes: number;
  // Reject a request that carries more spans than this.
  maxSpansPerRequest: number;
  // Keep at most this many attributes per span; extra ones are dropped.
  maxAttrsPerSpan: number;
  // Abort reading a slow request body after this many milliseconds.
  requestTimeoutMs: number;
  redactionMode: RedactionMode;
  // Attribute keys kept verbatim in allowlist mode. Empty in scrub mode.
  attrAllowlist: string[];
}

const DEFAULTS = {
  host: "127.0.0.1",
  port: 4318,
  dbPath: "./data/overseer.db",
  maxBodyBytes: 5 * 1024 * 1024,
  maxSpansPerRequest: 1000,
  maxAttrsPerSpan: 128,
  requestTimeoutMs: 10_000,
} as const;

// Build a config from a raw environment record (defaults to process.env). The
// token is required: a receiver with no token would accept anonymous writes,
// so we fail loudly instead of defaulting to something insecure.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): IngestConfig {
  const token = env.OVERSEER_INGEST_TOKEN?.trim() ?? "";
  if (token === "") {
    throw new Error(
      "OVERSEER_INGEST_TOKEN is required. Set a long random value, for example: openssl rand -hex 32",
    );
  }

  const mode = redactionModeSchema.parse(env.OVERSEER_REDACTION_MODE?.trim() || "scrub");
  const allowlist = (env.OVERSEER_ATTR_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return {
    token,
    host: env.OVERSEER_INGEST_HOST?.trim() || DEFAULTS.host,
    port: intFromEnv(env.OVERSEER_INGEST_PORT, DEFAULTS.port, "OVERSEER_INGEST_PORT"),
    dbPath: env.OVERSEER_DB_PATH?.trim() || DEFAULTS.dbPath,
    maxBodyBytes: intFromEnv(env.OVERSEER_MAX_BODY_BYTES, DEFAULTS.maxBodyBytes, "OVERSEER_MAX_BODY_BYTES"),
    maxSpansPerRequest: intFromEnv(
      env.OVERSEER_MAX_SPANS_PER_REQUEST,
      DEFAULTS.maxSpansPerRequest,
      "OVERSEER_MAX_SPANS_PER_REQUEST",
    ),
    maxAttrsPerSpan: intFromEnv(
      env.OVERSEER_MAX_ATTRS_PER_SPAN,
      DEFAULTS.maxAttrsPerSpan,
      "OVERSEER_MAX_ATTRS_PER_SPAN",
    ),
    requestTimeoutMs: intFromEnv(
      env.OVERSEER_REQUEST_TIMEOUT_MS,
      DEFAULTS.requestTimeoutMs,
      "OVERSEER_REQUEST_TIMEOUT_MS",
    ),
    redactionMode: mode,
    attrAllowlist: allowlist,
  };
}
