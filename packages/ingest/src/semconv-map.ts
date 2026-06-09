// The GenAI semantic-convention mapping. This reads the gen_ai.* (and a couple
// of overseer.*) attributes off a span and turns them into Overseer's
// agent-native fields: model, token counts, cost, tool name and outcome, and
// step index. Attributes we do not recognize are left untouched in the raw
// attribute bag; this only lifts the known ones into first-class columns.
//
// Cost prefers an explicit attribute when a producer supplies one, and
// otherwise derives it from token counts and the price table. Tool outcome is
// inferred from the span's status, since a tool that throws is reported as an
// errored span by convention.

import {
  type Span,
  type SpanStatus,
  type ToolOutcome,
  GEN_AI,
  OVERSEER,
} from "@overseer/schema";
import { computeCost, type ModelPrice } from "./pricing.js";

// The subset of a Span that this mapping is responsible for filling in.
export type AgentNativeFields = Pick<
  Span,
  "model" | "inputTokens" | "outputTokens" | "costUsd" | "toolName" | "toolOutcome" | "stepIndex"
>;

export interface DeriveContext {
  status: SpanStatus;
}

export interface DeriveOptions {
  prices?: ModelPrice[];
}

// Read a value that should be a non-negative integer, tolerating the string
// form some producers send. Returns null for anything else, so a malformed
// attribute degrades to "unknown" rather than poisoning the column.
function asNonNegInt(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function asNonNegNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return null;
  return n;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function deriveAgentNative(
  attributes: Record<string, unknown>,
  ctx: DeriveContext,
  options: DeriveOptions = {},
): AgentNativeFields {
  // Prefer the model the provider actually served, falling back to the one the
  // caller requested.
  const model =
    asNonEmptyString(attributes[GEN_AI.RESPONSE_MODEL]) ??
    asNonEmptyString(attributes[GEN_AI.REQUEST_MODEL]);

  const inputTokens = asNonNegInt(attributes[GEN_AI.USAGE_INPUT_TOKENS]);
  const outputTokens = asNonNegInt(attributes[GEN_AI.USAGE_OUTPUT_TOKENS]);

  // An explicit cost attribute wins; otherwise derive from tokens and price.
  const explicitCost = asNonNegNumber(attributes[OVERSEER.COST_USD]);
  const costUsd = explicitCost ?? computeCost(model, inputTokens, outputTokens, options.prices);

  const toolName = asNonEmptyString(attributes[GEN_AI.TOOL_NAME]);
  const toolOutcome: ToolOutcome | null = toolName
    ? ctx.status === "error"
      ? "error"
      : "success"
    : null;

  const stepIndex = asNonNegInt(attributes[OVERSEER.STEP_INDEX]);

  return {
    model: model ?? null,
    inputTokens,
    outputTokens,
    costUsd,
    toolName,
    toolOutcome,
    stepIndex,
  };
}
