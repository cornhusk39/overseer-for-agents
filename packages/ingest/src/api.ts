// The REST read API the dashboard calls. The ingest service is both an OTLP
// receiver and a read API (per the SPEC), so these GET handlers live alongside
// the receiver and share its store. They are read-only and side-effect free.
//
// Unlike the write path, the read API is unauthenticated: it is meant for the
// trusted local dashboard, and the service binds to localhost by default. A
// deployment that exposes it more widely should put it behind its own gateway.

import type { Store } from "./store.js";
import { computeTrends } from "./trends.js";
import { toolFailureRate } from "@overseer/schema";

export interface ReadResult {
  status: number;
  body: unknown;
}

// One hour. The default trend bucket width when a caller does not specify one.
const DEFAULT_BUCKET_MS = 60 * 60 * 1000;

// Largest run list a single request can ask for. The read API is meant for the
// dashboard, not bulk export, so an unbounded ?limit= should not be able to
// force a full-table serialization.
const MAX_LIMIT = 1000;

function intParam(value: string | null, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

// Handle a read request. Returns a ReadResult for any /api/* route, or null if
// the path is not a read route so the caller can fall through to a 404.
export function handleRead(method: string, url: URL, store: Store): ReadResult | null {
  const path = url.pathname;
  if (!path.startsWith("/api/")) return null;
  if (method !== "GET") return { status: 405, body: { error: "read API is GET only" } };

  if (path === "/api/health") {
    return { status: 200, body: { ok: true } };
  }

  if (path === "/api/agents") {
    return { status: 200, body: { agents: store.listAgents() } };
  }

  if (path === "/api/runs") {
    const agent = url.searchParams.get("agent") ?? undefined;
    const limit = intParam(url.searchParams.get("limit"), 100, MAX_LIMIT);
    const sinceMs = url.searchParams.has("sinceMs")
      ? intParam(url.searchParams.get("sinceMs"), 0)
      : undefined;
    const runs = store.listRollups({ agent, limit, sinceMs }).map(withDerivedRates);
    return { status: 200, body: { runs } };
  }

  // /api/runs/{id}
  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(path);
  if (runMatch) {
    // The id comes off the wire, so malformed percent-encoding is possible and
    // decodeURIComponent throws on it. Treat an undecodable id as not found
    // rather than letting the error propagate out of the request handler.
    let id: string;
    try {
      id = decodeURIComponent(runMatch[1] as string);
    } catch {
      return { status: 404, body: { error: "run not found" } };
    }
    const run = store.getRun(id);
    if (!run) return { status: 404, body: { error: "run not found" } };
    return {
      status: 200,
      body: { run, rollup: store.getRollup(id), spans: store.getSpans(id) },
    };
  }

  if (path === "/api/trends") {
    const agent = url.searchParams.get("agent") ?? undefined;
    const bucketMs = intParam(url.searchParams.get("bucketMs"), DEFAULT_BUCKET_MS);
    const sinceMs = url.searchParams.has("sinceMs")
      ? intParam(url.searchParams.get("sinceMs"), 0)
      : undefined;
    // Pull a generous window of rollups to bucket. The dashboard narrows by time
    // range on the client, so a high limit here keeps the series complete.
    const rollups = store.listRollups({ agent, limit: 10_000, sinceMs });
    return { status: 200, body: { buckets: computeTrends(rollups, bucketMs) } };
  }

  return { status: 404, body: { error: "unknown read route" } };
}

// Attach the rates the dashboard wants on the runs list without storing them.
function withDerivedRates<T extends { toolCallCount: number; toolErrorCount: number }>(rollup: T) {
  return { ...rollup, toolFailureRate: toolFailureRate(rollup) };
}
