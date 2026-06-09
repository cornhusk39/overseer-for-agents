// Test-only helper for building synthetic OTLP/HTTP JSON trace requests. Kept
// out of the build (see tsconfig.build.json) so it never ships in dist. Lets
// tests describe spans in plain terms and get back a wire-shaped request.

import type {
  ExportTraceServiceRequest,
  KeyValue,
  AnyValue,
  OtlpSpan,
} from "@overseer/schema";

export interface SpanSpec {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startMs: number;
  endMs: number;
  attributes?: Record<string, string | number | boolean>;
  statusCode?: number;
  statusMessage?: string;
}

export interface RequestSpec {
  serviceName?: string;
  spans: SpanSpec[];
}

function toAnyValue(v: string | number | boolean): AnyValue {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  // Integers ride as the OTLP int string form; non-integers as doubles.
  return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
}

function toAttributes(attrs: Record<string, string | number | boolean> | undefined): KeyValue[] {
  return Object.entries(attrs ?? {}).map(([key, value]) => ({ key, value: toAnyValue(value) }));
}

// Milliseconds since the epoch to the OTLP nanosecond string form.
export function msToUnixNano(ms: number): string {
  return String(Math.round(ms * 1e6));
}

export function buildOtlpRequest(spec: RequestSpec): ExportTraceServiceRequest {
  const spans: OtlpSpan[] = spec.spans.map((s) => ({
    traceId: s.traceId,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId,
    name: s.name,
    kind: s.kind,
    startTimeUnixNano: msToUnixNano(s.startMs),
    endTimeUnixNano: msToUnixNano(s.endMs),
    attributes: toAttributes(s.attributes),
    status:
      s.statusCode !== undefined || s.statusMessage !== undefined
        ? { code: s.statusCode, message: s.statusMessage }
        : undefined,
  }));

  return {
    resourceSpans: [
      {
        resource: {
          attributes: spec.serviceName
            ? [{ key: "service.name", value: { stringValue: spec.serviceName } }]
            : [],
        },
        scopeSpans: [{ scope: { name: "@overseer/sdk", version: "0.1.0" }, spans }],
      },
    ],
  };
}
