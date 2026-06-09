import { describe, it, expect } from "vitest";
import { deriveAgentNative } from "./semconv-map.js";
import { GEN_AI, OVERSEER } from "@overseer/schema";

describe("deriveAgentNative", () => {
  it("lifts model, tokens, and derived cost from an LLM span", () => {
    const fields = deriveAgentNative(
      {
        [GEN_AI.RESPONSE_MODEL]: "claude-opus-4-8",
        [GEN_AI.USAGE_INPUT_TOKENS]: 160,
        [GEN_AI.USAGE_OUTPUT_TOKENS]: 90,
      },
      { status: "ok" },
    );
    expect(fields.model).toBe("claude-opus-4-8");
    expect(fields.inputTokens).toBe(160);
    expect(fields.outputTokens).toBe(90);
    expect(fields.costUsd).toBeCloseTo(0.00915, 6);
    expect(fields.toolName).toBeNull();
  });

  it("prefers the response model over the request model", () => {
    const fields = deriveAgentNative(
      { [GEN_AI.REQUEST_MODEL]: "claude-opus-4-8", [GEN_AI.RESPONSE_MODEL]: "claude-sonnet-4-6" },
      { status: "ok" },
    );
    expect(fields.model).toBe("claude-sonnet-4-6");
  });

  it("prefers an explicit cost attribute over the derived one", () => {
    const fields = deriveAgentNative(
      {
        [GEN_AI.RESPONSE_MODEL]: "claude-opus-4-8",
        [GEN_AI.USAGE_INPUT_TOKENS]: 160,
        [GEN_AI.USAGE_OUTPUT_TOKENS]: 90,
        [OVERSEER.COST_USD]: 0.05,
      },
      { status: "ok" },
    );
    expect(fields.costUsd).toBe(0.05);
  });

  it("derives tool name and outcome, using span status for success or failure", () => {
    const ok = deriveAgentNative({ [GEN_AI.TOOL_NAME]: "lookup_property" }, { status: "ok" });
    expect(ok.toolName).toBe("lookup_property");
    expect(ok.toolOutcome).toBe("success");

    const failed = deriveAgentNative({ [GEN_AI.TOOL_NAME]: "lookup_property" }, { status: "error" });
    expect(failed.toolOutcome).toBe("error");
  });

  it("reads step index and tolerates the string form", () => {
    expect(deriveAgentNative({ [OVERSEER.STEP_INDEX]: 2 }, { status: "ok" }).stepIndex).toBe(2);
    expect(deriveAgentNative({ [OVERSEER.STEP_INDEX]: "3" }, { status: "ok" }).stepIndex).toBe(3);
  });

  it("leaves everything null for a plain internal span", () => {
    const fields = deriveAgentNative({ "http.method": "GET" }, { status: "ok" });
    expect(fields).toEqual({
      model: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      toolName: null,
      toolOutcome: null,
      stepIndex: null,
    });
  });
});
