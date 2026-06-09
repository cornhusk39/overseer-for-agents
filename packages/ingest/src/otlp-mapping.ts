// Turn a validated OTLP trace export request into Overseer domain spans, ready
// to persist. This is the structural mapping: ids, timing, kind, status, and
// the redacted attribute bag, plus the agent-native fields lifted from the
// gen_ai.* attributes.
//
// Ordering inside this file is deliberate and load-bearing. The agent name and
// the agent-native fields are derived from the raw flattened attributes FIRST,
// because both the attribute cap and the scrubbers can mangle the values they
// need (a token count sent as a string looks like a phone number to the
// scrubber; a producer that emits its custom attributes first would push the
// gen_ai.* keys past the cap). Only the stored attribute bag goes through
// truncation, capping, and redaction.

import {
  type ExportTraceServiceRequest,
  type Span,
  flattenAttributes,
  spanKindToString,
  statusCodeToString,
  unixNanoToMs,
  SERVICE_NAME,
  GEN_AI,
} from "@overseer/schema";
import { redactAttributes, scrubString, type RedactionOptions } from "./redaction.js";
import { deriveAgentNative } from "./semconv-map.js";

// Longest attribute string value we keep. Anything past this is truncated
// before the scrubbers run, which is what bounds the regex work per value (the
// scrubber patterns backtrack quadratically on pathological input, so an
// unbounded string is an event-loop stall waiting to happen). 4 KB is far more
// than any sane telemetry value needs.
export const MAX_ATTR_VALUE_CHARS = 4096;

export interface MappingOptions {
  maxAttrsPerSpan: number;
  redaction: RedactionOptions;
}

export interface MappingResult {
  spans: Span[];
  // Agent name resolved per run id, so the store can attribute runs even when a
  // later batch of spans for the same run omits the identifying attribute. A
  // run id is only present here when a name was actually resolved; an absent
  // entry tells the store to keep whatever attribution it already has.
  agentByRun: Map<string, string>;
  // Total redaction replacements across the batch, for logging and metadata.
  redactionHits: number;
}

// Count the spans in a request without mapping them, so the receiver can reject
// an over-large batch before doing the work of mapping and redacting it.
export function countSpans(req: ExportTraceServiceRequest): number {
  let n = 0;
  for (const rs of req.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      n += ss.spans?.length ?? 0;
    }
  }
  return n;
}

export function mapRequest(req: ExportTraceServiceRequest, options: MappingOptions): MappingResult {
  const spans: Span[] = [];
  const agentByRun = new Map<string, string>();
  let redactionHits = 0;

  for (const rs of req.resourceSpans ?? []) {
    const resourceAttrs = flattenAttributes(rs.resource?.attributes);
    const serviceName = asString(resourceAttrs[SERVICE_NAME]);

    for (const ss of rs.scopeSpans ?? []) {
      for (const otlpSpan of ss.spans ?? []) {
        const rawAttrs = flattenAttributes(otlpSpan.attributes);

        // Resolve the agent from raw attributes. When this batch carries no
        // identity at all, leave the map entry absent so the store falls back
        // to the run's existing attribution instead of stamping it "unknown"
        // and yanking the run out of its agent's views.
        const agentName = asString(rawAttrs[GEN_AI.AGENT_NAME]) ?? serviceName;
        if (agentName) agentByRun.set(otlpSpan.traceId, agentName);

        const status = statusCodeToString(otlpSpan.status?.code);

        // Lift the known gen_ai.* attributes into agent-native fields from the
        // RAW attributes, before the cap can drop them or a scrubber can eat a
        // string-typed token count.
        const agentNative = deriveAgentNative(rawAttrs, { status });

        // Now shape the stored bag: truncate oversized values, cap the count,
        // and redact what remains.
        const bounded = truncateValues(rawAttrs, MAX_ATTR_VALUE_CHARS);
        const capped = capAttributes(bounded, options.maxAttrsPerSpan);
        const redacted = redactAttributes(capped, options.redaction);
        redactionHits += redacted.hits;

        const startMs = unixNanoToMs(otlpSpan.startTimeUnixNano);
        const endMs = unixNanoToMs(otlpSpan.endTimeUnixNano);

        // Free-text fields are not attributes, so the allowlist does not apply
        // to them; they always get the regex scrub as a pure safety measure.
        const scrubbedName = scrubString(truncateString(otlpSpan.name, MAX_ATTR_VALUE_CHARS));
        const name = scrubbedName.value;
        redactionHits += scrubbedName.hits;

        const statusMessageRaw = otlpSpan.status?.message;
        let statusMessage: string | null = null;
        if (statusMessageRaw) {
          const scrubbed = scrubString(truncateString(statusMessageRaw, MAX_ATTR_VALUE_CHARS));
          statusMessage = scrubbed.value;
          redactionHits += scrubbed.hits;
        }

        const span: Span = {
          runId: otlpSpan.traceId,
          spanId: otlpSpan.spanId,
          parentSpanId: normalizeParentId(otlpSpan.parentSpanId),
          name,
          kind: spanKindToString(otlpSpan.kind),
          startMs,
          endMs,
          durationMs: Math.max(0, endMs - startMs),
          status,
          statusMessage,
          attributes: redacted.value,
          ...agentNative,
        };

        spans.push(span);
      }
    }
  }

  return { spans, agentByRun, redactionHits };
}

function capAttributes(
  attrs: Record<string, unknown>,
  max: number,
): Record<string, unknown> {
  const entries = Object.entries(attrs);
  if (entries.length <= max) return attrs;
  return Object.fromEntries(entries.slice(0, max));
}

function truncateString(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

// Bound every string in an attribute record (including strings nested inside
// arrays and objects) so no single value can make the scrubbers, storage, or
// the dashboard choke.
function truncateValues(attrs: Record<string, unknown>, max: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(attrs)) {
    out[k] = truncateDeep(v, max);
  }
  return out;
}

function truncateDeep(value: unknown, max: number): unknown {
  if (typeof value === "string") return truncateString(value, max);
  if (Array.isArray(value)) return value.map((v) => truncateDeep(v, max));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateDeep(v, max);
    }
    return out;
  }
  return value;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// The OTel data model spells "no parent" three ways in the wild: an omitted
// field, an empty string, or an all-zeros id (hex or its base64 form). All of
// them must read as "this is a root span" or the run never completes.
function normalizeParentId(value: string | undefined): string | null {
  if (!value || value.length === 0) return null;
  if (/^0+$/.test(value) || value === "AAAAAAAAAAA=") return null;
  return value;
}
