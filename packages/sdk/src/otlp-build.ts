// Build an OTLP/HTTP JSON trace export request from the spans the client
// recorded during a run. This is the only place the SDK touches the wire shape,
// and it produces nothing proprietary: a standard ExportTraceServiceRequest
// that any OTLP receiver, not just Overseer, could accept.

import {
  type ExportTraceServiceRequest,
  type KeyValue,
  type AnyValue,
  type OtlpSpan,
  SERVICE_NAME,
} from "@overseer/schema";

// OTLP span kind numbers. The SDK uses server for the run root and client for
// the calls it makes out to models and tools, which mirrors how those spans
// relate to the agent process.
export const SPAN_KIND = {
  INTERNAL: 1,
  SERVER: 2,
  CLIENT: 3,
} as const;

// OTLP status codes.
export const STATUS_CODE = {
  UNSET: 0,
  OK: 1,
  ERROR: 2,
} as const;

export type AttributeValue = string | number | boolean;

// A span as the client accumulates it, in friendly units (milliseconds, a plain
// attribute record). buildRequest converts these into the wire form.
export interface RecordedSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: number;
  startMs: number;
  endMs: number;
  statusCode: number;
  statusMessage?: string;
  attributes: Record<string, AttributeValue>;
}

function toAnyValue(v: AttributeValue): AnyValue {
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { boolValue: v };
  // Integers ride as OTLP int strings; non-integers as doubles.
  return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
}

function toKeyValues(attrs: Record<string, AttributeValue>): KeyValue[] {
  return Object.entries(attrs).map(([key, value]) => ({ key, value: toAnyValue(value) }));
}

function msToUnixNano(ms: number): string {
  return String(Math.round(ms * 1e6));
}

export interface BuildParams {
  traceId: string;
  serviceName: string;
  sdkVersion: string;
  spans: RecordedSpan[];
}

export function buildRequest(params: BuildParams): ExportTraceServiceRequest {
  const spans: OtlpSpan[] = params.spans.map((s) => ({
    traceId: params.traceId,
    spanId: s.spanId,
    parentSpanId: s.parentSpanId ?? undefined,
    name: s.name,
    kind: s.kind,
    startTimeUnixNano: msToUnixNano(s.startMs),
    endTimeUnixNano: msToUnixNano(s.endMs),
    attributes: toKeyValues(s.attributes),
    status: { code: s.statusCode, message: s.statusMessage },
  }));

  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: SERVICE_NAME, value: { stringValue: params.serviceName } }] },
        scopeSpans: [{ scope: { name: "@overseer/sdk", version: params.sdkVersion }, spans }],
      },
    ],
  };
}
