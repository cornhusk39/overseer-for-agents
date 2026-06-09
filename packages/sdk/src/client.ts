// The thin SDK client. It gives agent authors a small, obvious API (startRun,
// span, llmCall, toolCall, end) and emits standard OTLP underneath, so adopting
// it never locks anyone into a proprietary protocol. Everything it produces
// could be sent to any OTLP backend.
//
// Telemetry must not crash the thing it observes, so an export failure is
// reported through the return value and logged, never thrown. Agent authors who
// want strictness can inspect the result of end().

import {
  GEN_AI,
  OVERSEER,
  type ExportTraceServiceRequest,
} from "@overseer/schema";
import { newTraceId, newSpanId, type RandomHex } from "./ids.js";
import {
  buildRequest,
  SPAN_KIND,
  STATUS_CODE,
  type RecordedSpan,
  type AttributeValue,
} from "./otlp-build.js";

const SDK_VERSION = "0.1.0";

export interface ClientOptions {
  // Full URL of the ingest receiver, for example http://127.0.0.1:4318/v1/traces.
  endpoint: string;
  // Bearer token the receiver requires.
  token: string;
  // Default agent name, reported as the resource service.name.
  serviceName: string;
  // Injectable for tests. Defaults to the global fetch and the wall clock.
  fetchImpl?: typeof fetch;
  now?: () => number;
  randomHex?: RandomHex;
}

export interface ExportResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export interface StartRunOptions {
  // Overrides the client's default agent name for this run.
  agent?: string;
  // Name of the root span. Defaults to the agent name.
  name?: string;
  attributes?: Record<string, AttributeValue>;
}

export interface SpanOptions {
  parentSpanId?: string;
  kind?: number;
  attributes?: Record<string, AttributeValue>;
}

export interface SpanEndOptions {
  error?: boolean;
  statusMessage?: string;
  attributes?: Record<string, AttributeValue>;
}

// A manual span handle for callers that want to open and close their own span.
export interface SpanHandle {
  spanId: string;
  end(options?: SpanEndOptions): void;
}

export interface LlmCallOptions {
  name?: string;
  model: string;
  system?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  stepIndex?: number;
  parentSpanId?: string;
  attributes?: Record<string, AttributeValue>;
}

export interface ToolCallOptions {
  name: string;
  stepIndex?: number;
  parentSpanId?: string;
  attributes?: Record<string, AttributeValue>;
}

export class OverseerClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly randomHex?: RandomHex;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => Date.now());
    this.randomHex = options.randomHex;
  }

  // Begin a run. The returned Run buffers spans in memory and sends them as one
  // OTLP request when end() is called.
  startRun(options: StartRunOptions = {}): Run {
    const agent = options.agent ?? this.options.serviceName;
    const traceId = newTraceId(this.randomHex);
    const rootSpanId = newSpanId(this.randomHex);
    return new Run({
      traceId,
      rootSpanId,
      agent,
      rootName: options.name ?? agent,
      rootAttributes: options.attributes ?? {},
      startMs: this.now(),
      now: this.now,
      randomHex: this.randomHex,
      send: (req) => this.send(req),
    });
  }

  private async send(request: ExportTraceServiceRequest): Promise<ExportResult> {
    try {
      const res = await this.fetchImpl(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.options.token}`,
        },
        body: JSON.stringify(request),
      });
      if (!res.ok) {
        console.warn(`overseer-sdk: ingest responded ${res.status}`);
        return { ok: false, status: res.status };
      }
      return { ok: true, status: res.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`overseer-sdk: failed to export traces: ${message}`);
      return { ok: false, error: message };
    }
  }
}

interface RunInternals {
  traceId: string;
  rootSpanId: string;
  agent: string;
  rootName: string;
  rootAttributes: Record<string, AttributeValue>;
  startMs: number;
  now: () => number;
  randomHex?: RandomHex;
  send: (request: ExportTraceServiceRequest) => Promise<ExportResult>;
}

export class Run {
  private readonly spans: RecordedSpan[] = [];
  private ended = false;

  constructor(private readonly internals: RunInternals) {}

  get traceId(): string {
    return this.internals.traceId;
  }

  get rootSpanId(): string {
    return this.internals.rootSpanId;
  }

  // Open a manual child span. The caller is responsible for calling end().
  span(name: string, options: SpanOptions = {}): SpanHandle {
    const spanId = newSpanId(this.internals.randomHex);
    const startMs = this.internals.now();
    const parentSpanId = options.parentSpanId ?? this.internals.rootSpanId;
    const recordSpan = (endOptions: SpanEndOptions = {}) => {
      this.spans.push({
        spanId,
        parentSpanId,
        name,
        kind: options.kind ?? SPAN_KIND.INTERNAL,
        startMs,
        endMs: this.internals.now(),
        statusCode: endOptions.error ? STATUS_CODE.ERROR : STATUS_CODE.OK,
        statusMessage: endOptions.statusMessage,
        attributes: { ...options.attributes, ...endOptions.attributes },
      });
    };
    return { spanId, end: recordSpan };
  }

  // Record an LLM call, timing the provided function. The gen_ai.* attributes
  // are set so the ingest mapping can derive model, tokens, and cost.
  async llmCall<T>(options: LlmCallOptions, fn: () => Promise<T>): Promise<T> {
    const attributes: Record<string, AttributeValue> = {
      [GEN_AI.RESPONSE_MODEL]: options.model,
      ...(options.system ? { [GEN_AI.SYSTEM]: options.system } : {}),
      ...(options.inputTokens !== undefined ? { [GEN_AI.USAGE_INPUT_TOKENS]: options.inputTokens } : {}),
      ...(options.outputTokens !== undefined ? { [GEN_AI.USAGE_OUTPUT_TOKENS]: options.outputTokens } : {}),
      ...(options.costUsd !== undefined ? { [OVERSEER.COST_USD]: options.costUsd } : {}),
      ...(options.stepIndex !== undefined ? { [OVERSEER.STEP_INDEX]: options.stepIndex } : {}),
      ...options.attributes,
    };
    return this.record(options.name ?? "chat", SPAN_KIND.CLIENT, options.parentSpanId, attributes, fn);
  }

  // Record a tool call, timing the provided function. A throw is captured as an
  // errored tool span and then rethrown so the caller's control flow is intact.
  async toolCall<T>(options: ToolCallOptions, fn: () => Promise<T>): Promise<T> {
    const attributes: Record<string, AttributeValue> = {
      [GEN_AI.OPERATION_NAME]: "execute_tool",
      [GEN_AI.TOOL_NAME]: options.name,
      ...(options.stepIndex !== undefined ? { [OVERSEER.STEP_INDEX]: options.stepIndex } : {}),
      ...options.attributes,
    };
    return this.record(`execute_tool ${options.name}`, SPAN_KIND.CLIENT, options.parentSpanId, attributes, fn);
  }

  // Shared timing-and-recording wrapper for llmCall and toolCall.
  private async record<T>(
    name: string,
    kind: number,
    parentSpanId: string | undefined,
    attributes: Record<string, AttributeValue>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const spanId = newSpanId(this.internals.randomHex);
    const startMs = this.internals.now();
    const parent = parentSpanId ?? this.internals.rootSpanId;
    try {
      const result = await fn();
      this.spans.push({
        spanId,
        parentSpanId: parent,
        name,
        kind,
        startMs,
        endMs: this.internals.now(),
        statusCode: STATUS_CODE.OK,
        attributes,
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.spans.push({
        spanId,
        parentSpanId: parent,
        name,
        kind,
        startMs,
        endMs: this.internals.now(),
        statusCode: STATUS_CODE.ERROR,
        statusMessage: message,
        attributes,
      });
      throw err;
    }
  }

  // Close the run's root span and export every recorded span as one OTLP
  // request. Safe to call once; a second call is a no-op that reports failure.
  async end(options: { error?: boolean; attributes?: Record<string, AttributeValue> } = {}): Promise<ExportResult> {
    if (this.ended) return { ok: false, error: "run already ended" };
    this.ended = true;

    const rootSpan: RecordedSpan = {
      spanId: this.internals.rootSpanId,
      parentSpanId: null,
      name: this.internals.rootName,
      kind: SPAN_KIND.SERVER,
      startMs: this.internals.startMs,
      endMs: this.internals.now(),
      statusCode: options.error ? STATUS_CODE.ERROR : STATUS_CODE.OK,
      attributes: { ...this.internals.rootAttributes, ...options.attributes },
    };

    const request = buildRequest({
      traceId: this.internals.traceId,
      serviceName: this.internals.agent,
      sdkVersion: SDK_VERSION,
      // Root first keeps the request readable; the receiver does not rely on order.
      spans: [rootSpan, ...this.spans],
    });

    return this.internals.send(request);
  }
}

export function createClient(options: ClientOptions): OverseerClient {
  return new OverseerClient(options);
}
