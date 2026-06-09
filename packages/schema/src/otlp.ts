// The subset of the OTLP/HTTP JSON trace protocol that Overseer speaks. v1
// ingests the traces signal only, JSON-encoded, so this is intentionally not a
// full OTLP implementation: it is exactly enough to validate an incoming
// ExportTraceServiceRequest and to let the SDK construct one.
//
// OTLP encodes attribute values in a verbose tagged form (AnyValue) and 64-bit
// timestamps as decimal strings. The helpers at the bottom flatten that into
// plain JavaScript so the rest of the system never has to think about the wire
// shape. Everything here is validated at runtime because it arrives from
// outside the trust boundary.

import { z } from "zod";

// OTLP's tagged union for an attribute value. It is recursive: an array or a
// key-value list can contain more AnyValues. The TypeScript interface is
// declared explicitly so the recursive Zod schema has a type to satisfy.
export interface AnyValue {
  stringValue?: string;
  boolValue?: boolean;
  // 64-bit integers are JSON-encoded as strings to avoid precision loss, but
  // some producers send a plain number, so we accept both.
  intValue?: string | number;
  doubleValue?: number;
  bytesValue?: string;
  arrayValue?: { values?: AnyValue[] };
  kvlistValue?: { values?: KeyValue[] };
}

export interface KeyValue {
  key: string;
  value?: AnyValue;
}

export const anyValueSchema: z.ZodType<AnyValue> = z.lazy(() =>
  z.object({
    stringValue: z.string().optional(),
    boolValue: z.boolean().optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.number().optional(),
    bytesValue: z.string().optional(),
    arrayValue: z.object({ values: z.array(anyValueSchema).optional() }).optional(),
    kvlistValue: z.object({ values: z.array(keyValueSchema).optional() }).optional(),
  }),
);

export const keyValueSchema: z.ZodType<KeyValue> = z.lazy(() =>
  z.object({
    key: z.string(),
    value: anyValueSchema.optional(),
  }),
);

// OTLP span status. Code is an enum: 0 unset, 1 ok, 2 error.
export const otlpStatusSchema = z.object({
  code: z.number().int().optional(),
  message: z.string().optional(),
});

// A single OTLP span. Timestamps are decimal strings of nanoseconds since the
// Unix epoch; a missing or empty parentSpanId marks a root span. We keep the
// fields the dashboard and the mapping need and ignore links and events in v1.
export const otlpSpanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  kind: z.number().int().optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]),
  endTimeUnixNano: z.union([z.string(), z.number()]),
  attributes: z.array(keyValueSchema).optional(),
  status: otlpStatusSchema.optional(),
});
export type OtlpSpan = z.infer<typeof otlpSpanSchema>;

export const otlpScopeSpansSchema = z.object({
  scope: z
    .object({ name: z.string().optional(), version: z.string().optional() })
    .optional(),
  spans: z.array(otlpSpanSchema).optional(),
  schemaUrl: z.string().optional(),
});

export const otlpResourceSpansSchema = z.object({
  resource: z.object({ attributes: z.array(keyValueSchema).optional() }).optional(),
  scopeSpans: z.array(otlpScopeSpansSchema).optional(),
  schemaUrl: z.string().optional(),
});

// The top-level body of a POST to /v1/traces.
export const exportTraceServiceRequestSchema = z.object({
  resourceSpans: z.array(otlpResourceSpansSchema).optional(),
});
export type ExportTraceServiceRequest = z.infer<typeof exportTraceServiceRequestSchema>;

// Span kind enum to a readable label. Unknown values fall back to "internal"
// since that is the OTLP default rather than an error condition.
const SPAN_KIND_LABELS: Record<number, string> = {
  0: "unspecified",
  1: "internal",
  2: "server",
  3: "client",
  4: "producer",
  5: "consumer",
};
export function spanKindToString(kind: number | undefined): string {
  if (kind === undefined) return "internal";
  return SPAN_KIND_LABELS[kind] ?? "internal";
}

export type SpanStatus = "unset" | "ok" | "error";
export function statusCodeToString(code: number | undefined): SpanStatus {
  if (code === 1) return "ok";
  if (code === 2) return "error";
  return "unset";
}

// Convert one OTLP AnyValue into a plain JavaScript value. Returns undefined for
// an empty value object. Integer strings become numbers when that is lossless,
// and stay strings otherwise so very large 64-bit ids are not silently mangled.
export function anyValueToJs(value: AnyValue | undefined): unknown {
  if (!value) return undefined;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.boolValue !== undefined) return value.boolValue;
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.bytesValue !== undefined) return value.bytesValue;
  if (value.intValue !== undefined) {
    if (typeof value.intValue === "number") return value.intValue;
    const n = Number(value.intValue);
    return Number.isSafeInteger(n) ? n : value.intValue;
  }
  if (value.arrayValue) {
    return (value.arrayValue.values ?? []).map((v) => anyValueToJs(v));
  }
  if (value.kvlistValue) {
    return flattenAttributes(value.kvlistValue.values);
  }
  return undefined;
}

// Flatten an OTLP attribute list into a plain object keyed by attribute name.
// This is how the verbose wire form becomes the ergonomic Record the mapping
// and storage layers work with.
export function flattenAttributes(
  attributes: KeyValue[] | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const attr of attributes ?? []) {
    if (!attr || typeof attr.key !== "string") continue;
    out[attr.key] = anyValueToJs(attr.value);
  }
  return out;
}

// Parse an OTLP nanosecond timestamp into milliseconds since the epoch, which
// is what the dashboard and rollups reason about. Nanosecond ints exceed the
// safe-integer range, so the division is done on the string before it becomes a
// Number to keep millisecond precision intact.
export function unixNanoToMs(nano: string | number): number {
  if (typeof nano === "number") return nano / 1e6;
  if (!/^\d+$/.test(nano)) return Number(nano) / 1e6;
  // Split off the last six digits (microseconds and finer) so the millisecond
  // value itself stays an exact integer-derived number.
  const ms = nano.length > 6 ? nano.slice(0, -6) : "0";
  const frac = nano.padStart(7, "0").slice(-6);
  return Number(ms) + Number(frac) / 1e6;
}
