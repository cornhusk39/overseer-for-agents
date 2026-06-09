// Turn a validated OTLP trace export request into Overseer domain spans, ready
// to persist. This is the structural mapping: ids, timing, kind, status, and
// the redacted attribute bag. The agent-native enrichment (model, tokens, cost,
// tool name and outcome, step index) is layered on in the M3 semconv mapping;
// here those fields start null.
//
// Two safety steps happen in this file because it is the last place that sees
// raw telemetry before it becomes a storable Span: attributes are capped to a
// configured maximum, and every retained string is redacted.

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

export interface MappingOptions {
  maxAttrsPerSpan: number;
  redaction: RedactionOptions;
}

export interface MappingResult {
  spans: Span[];
  // Agent name resolved per run id, so the store can attribute runs even when a
  // later batch of spans for the same run omits the identifying attribute.
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

        // Resolve the agent before redaction so a scrubber can never mangle an
        // identifier. Prefer the explicit gen_ai.agent.name, then service.name.
        const agentName =
          asString(rawAttrs[GEN_AI.AGENT_NAME]) ?? serviceName ?? "unknown";

        // Cap attributes, then redact what remains.
        const capped = capAttributes(rawAttrs, options.maxAttrsPerSpan);
        const redacted = redactAttributes(capped, options.redaction);
        redactionHits += redacted.hits;

        const startMs = unixNanoToMs(otlpSpan.startTimeUnixNano);
        const endMs = unixNanoToMs(otlpSpan.endTimeUnixNano);

        // Free-text fields are not attributes, so the allowlist does not apply
        // to them; they always get the regex scrub as a pure safety measure.
        const scrubbedName = scrubString(otlpSpan.name);
        const name = scrubbedName.value;
        redactionHits += scrubbedName.hits;

        const statusMessageRaw = otlpSpan.status?.message;
        let statusMessage: string | null = null;
        if (statusMessageRaw) {
          const scrubbed = scrubString(statusMessageRaw);
          statusMessage = scrubbed.value;
          redactionHits += scrubbed.hits;
        }

        const span: Span = {
          runId: otlpSpan.traceId,
          spanId: otlpSpan.spanId,
          parentSpanId: emptyToNull(otlpSpan.parentSpanId),
          name,
          kind: spanKindToString(otlpSpan.kind),
          startMs,
          endMs,
          durationMs: Math.max(0, endMs - startMs),
          status: statusCodeToString(otlpSpan.status?.code),
          statusMessage,
          attributes: redacted.value,

          // Agent-native fields are populated by the semconv mapping in M3.
          // Until then a span carries its structural data and raw attributes.
          model: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          toolName: null,
          toolOutcome: null,
          stepIndex: null,
        };

        spans.push(span);
        agentByRun.set(span.runId, agentName);
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

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function emptyToNull(value: string | undefined): string | null {
  return value && value.length > 0 ? value : null;
}
