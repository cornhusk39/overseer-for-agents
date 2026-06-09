// The OTLP/HTTP JSON receiver. This is the network-facing edge of the service,
// so it is defensive by construction: bearer auth is required, the body size is
// capped before it is read, a slow client is timed out, the payload is schema
// validated, and the span count is bounded. Only after all of that does any
// data reach the store, and even then it has already been redacted by the
// mapping layer.
//
// The request handling is split into small pure functions so the auth, parsing,
// and ingest logic can be tested without opening a socket. createIngestServer
// wires them onto node:http.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { exportTraceServiceRequestSchema } from "@overseer/schema";
import type { IngestConfig } from "./config.js";
import type { Store } from "./store.js";
import { mapRequest, countSpans } from "./otlp-mapping.js";
import { handleRead } from "./api.js";

export const TRACES_PATH = "/v1/traces";

export interface HandlerResult {
  status: number;
  body: unknown;
}

// Compare a presented bearer token to the configured one without leaking timing
// information about how many characters matched.
export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Pull the bearer token out of an Authorization header, or null if absent or
// malformed.
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? (match[1] as string).trim() : null;
}

// Validate, map, and persist an already-read request body. Returns the OTLP
// response and HTTP status. Pure except for the store write, so tests can drive
// it directly with a string body and an in-memory store.
// Deepest JSON nesting accepted in a request body. OTLP attribute values are
// recursive (arrays of kv-lists of arrays...), and both Zod validation and the
// attribute flattening recurse over them, so attacker-controlled depth means
// attacker-controlled stack. Real telemetry nests a handful of levels at most.
const MAX_JSON_DEPTH = 64;

// Iterative depth check, so measuring the depth cannot itself blow the stack.
function jsonTooDeep(root: unknown, maxDepth: number): boolean {
  let frontier: unknown[] = [root];
  for (let depth = 0; frontier.length > 0; depth++) {
    if (depth > maxDepth) return true;
    const next: unknown[] = [];
    for (const node of frontier) {
      if (Array.isArray(node)) next.push(...node);
      else if (node && typeof node === "object") next.push(...Object.values(node));
    }
    frontier = next;
  }
  return false;
}

export function processTraces(
  rawBody: string,
  config: IngestConfig,
  store: Store,
  now: () => number = () => Date.now(),
): HandlerResult {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid JSON body" } };
  }

  if (jsonTooDeep(json, MAX_JSON_DEPTH)) {
    return { status: 400, body: { error: "request body is nested too deeply" } };
  }

  const parsed = exportTraceServiceRequestSchema.safeParse(json);
  if (!parsed.success) {
    return { status: 400, body: { error: "body is not a valid OTLP trace export request" } };
  }

  const spanCount = countSpans(parsed.data);
  if (spanCount > config.maxSpansPerRequest) {
    return {
      status: 413,
      body: { error: `too many spans: ${spanCount} exceeds limit of ${config.maxSpansPerRequest}` },
    };
  }

  const mapped = mapRequest(parsed.data, {
    maxAttrsPerSpan: config.maxAttrsPerSpan,
    redaction: { mode: config.redactionMode, allowlist: config.attrAllowlist },
  });

  store.ingest({ spans: mapped.spans, agentByRun: mapped.agentByRun, receivedAtMs: now() });

  // OTLP treats an empty partialSuccess as full success. We report how many
  // spans we accepted in a non-standard field for convenience; standard clients
  // ignore unknown fields.
  return { status: 200, body: { partialSuccess: {}, accepted: mapped.spans.length } };
}

interface ReadBodyOk {
  ok: true;
  body: string;
}
interface ReadBodyErr {
  ok: false;
  status: number;
  message: string;
}

// Read a request body with two independent guards: a hard byte cap that aborts
// as soon as it is exceeded (so a huge upload cannot exhaust memory) and an
// overall timeout (so a trickle client cannot hold a connection open forever).
function readBody(req: IncomingMessage, maxBytes: number, timeoutMs: number): Promise<ReadBodyOk | ReadBodyErr> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const finish = (result: ReadBodyOk | ReadBodyErr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, status: 408, message: "request body read timed out" });
    }, timeoutMs);

    req.on("data", (chunk: Buffer) => {
      // Once over the cap, stop accumulating so a huge upload cannot grow our
      // memory while we are in the middle of rejecting it. We deliberately do
      // not destroy the socket here: the caller still needs to send a clean 413
      // response, and it closes the connection afterward.
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        finish({ ok: false, status: 413, message: "request body too large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish({ ok: true, body: Buffer.concat(chunks).toString("utf8") }));
    req.on("error", () => finish({ ok: false, status: 400, message: "error reading request body" }));
  });
}

// Send a JSON response. When close is set we ask the connection to close after
// the response, which is how we end a request whose body we stopped reading
// (oversized or timed out) without abruptly destroying the socket first.
function sendJson(res: ServerResponse, status: number, body: unknown, close = false): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (close) headers["connection"] = "close";
  res.writeHead(status, headers);
  res.end(payload);
}

// Build (but do not start) the ingest HTTP server. The caller owns listen() and
// close() so tests can bind an ephemeral port and shut it down cleanly.
//
// The catch here is the last line of defense: this service faces the network,
// and an async handler that throws becomes an unhandled rejection, which takes
// the whole process down. No single request is ever allowed to do that.
export function createIngestServer(config: IngestConfig, store: Store): Server {
  return createServer((req, res) => {
    handle(req, res, config, store).catch((err: unknown) => {
      console.error("ingest: unexpected error handling request:", err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal error" }, true);
      } else {
        res.destroy();
      }
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  config: IngestConfig,
  store: Store,
): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  // Read API (GET /api/*). Side-effect free and unauthenticated; serves the
  // dashboard. handleRead returns null for non-/api paths so the write path
  // below still gets a chance.
  const readResult = handleRead(method, url, store);
  if (readResult) {
    // Allow a browser-side dashboard to read cross-origin if it ever needs to.
    res.setHeader("access-control-allow-origin", "*");
    sendJson(res, readResult.status, readResult.body);
    return;
  }

  if (method !== "POST" || url.pathname !== TRACES_PATH) {
    sendJson(res, 404, { error: "not found" });
    return;
  }

  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) {
    sendJson(res, 415, { error: "content-type must be application/json" });
    return;
  }

  if (!tokenMatches(bearerToken(req.headers.authorization) ?? "", config.token)) {
    sendJson(res, 401, { error: "missing or invalid bearer token" });
    return;
  }

  const read = await readBody(req, config.maxBodyBytes, config.requestTimeoutMs);
  if (!read.ok) {
    // We may have stopped reading the body mid-stream, so close the connection
    // after responding rather than trying to keep it alive.
    sendJson(res, read.status, { error: read.message }, true);
    return;
  }

  try {
    const result = processTraces(read.body, config, store);
    sendJson(res, result.status, result.body);
  } catch (err) {
    // A mapping or storage failure is our fault, not the client's. Do not leak
    // internal detail in the response body.
    sendJson(res, 500, { error: "internal error handling trace export" });
    // Surface the real cause in the server log for the operator.
    console.error("ingest: failed to process traces:", err);
  }
}
