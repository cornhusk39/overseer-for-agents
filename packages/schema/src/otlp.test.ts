import { describe, it, expect } from "vitest";
import {
  anyValueToJs,
  flattenAttributes,
  spanKindToString,
  statusCodeToString,
  unixNanoToMs,
  exportTraceServiceRequestSchema,
} from "./otlp.js";

describe("OTLP AnyValue conversion", () => {
  it("unwraps each scalar value kind", () => {
    expect(anyValueToJs({ stringValue: "hi" })).toBe("hi");
    expect(anyValueToJs({ boolValue: true })).toBe(true);
    expect(anyValueToJs({ doubleValue: 1.5 })).toBe(1.5);
    expect(anyValueToJs({ intValue: "42" })).toBe(42);
    expect(anyValueToJs(undefined)).toBeUndefined();
  });

  it("keeps oversized integers as strings to avoid precision loss", () => {
    const huge = "9007199254740993"; // one past Number.MAX_SAFE_INTEGER
    expect(anyValueToJs({ intValue: huge })).toBe(huge);
  });

  it("recurses into arrays and key-value lists", () => {
    expect(anyValueToJs({ arrayValue: { values: [{ intValue: "1" }, { intValue: "2" }] } })).toEqual([
      1, 2,
    ]);
    expect(
      anyValueToJs({ kvlistValue: { values: [{ key: "k", value: { stringValue: "v" } }] } }),
    ).toEqual({ k: "v" });
  });
});

describe("OTLP attribute flattening", () => {
  it("turns the verbose attribute list into a plain object", () => {
    const flat = flattenAttributes([
      { key: "gen_ai.request.model", value: { stringValue: "claude-opus-4-8" } },
      { key: "gen_ai.usage.input_tokens", value: { intValue: "160" } },
    ]);
    expect(flat).toEqual({
      "gen_ai.request.model": "claude-opus-4-8",
      "gen_ai.usage.input_tokens": 160,
    });
  });

  it("tolerates an empty or missing attribute list", () => {
    expect(flattenAttributes(undefined)).toEqual({});
    expect(flattenAttributes([])).toEqual({});
  });
});

describe("OTLP enum and timestamp helpers", () => {
  it("labels span kinds and falls back to internal", () => {
    expect(spanKindToString(2)).toBe("server");
    expect(spanKindToString(undefined)).toBe("internal");
    expect(spanKindToString(99)).toBe("internal");
  });

  it("maps status codes", () => {
    expect(statusCodeToString(1)).toBe("ok");
    expect(statusCodeToString(2)).toBe("error");
    expect(statusCodeToString(undefined)).toBe("unset");
  });

  it("converts nanosecond timestamps to milliseconds without overflow", () => {
    // 1_700_000_000_000 ms expressed in nanoseconds.
    expect(unixNanoToMs("1700000000000000000")).toBe(1700000000000);
    expect(unixNanoToMs("1700000000123000000")).toBeCloseTo(1700000000123, 3);
    expect(unixNanoToMs(500)).toBe(0.0005);
  });
});

describe("OTLP request schema", () => {
  it("accepts a minimal traces export request", () => {
    const req = {
      resourceSpans: [
        {
          resource: { attributes: [{ key: "service.name", value: { stringValue: "demo" } }] },
          scopeSpans: [
            {
              scope: { name: "@overseer/sdk", version: "0.1.0" },
              spans: [
                {
                  traceId: "abc",
                  spanId: "def",
                  name: "chat",
                  startTimeUnixNano: "1700000000000000000",
                  endTimeUnixNano: "1700000000500000000",
                  attributes: [{ key: "gen_ai.system", value: { stringValue: "anthropic" } }],
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = exportTraceServiceRequestSchema.parse(req);
    expect(parsed.resourceSpans?.[0]?.scopeSpans?.[0]?.spans?.[0]?.name).toBe("chat");
  });
});
