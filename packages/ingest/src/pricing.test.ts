import { describe, it, expect } from "vitest";
import { computeCost, findPrice } from "./pricing.js";

describe("pricing", () => {
  it("matches a model id by substring, most specific first", () => {
    expect(findPrice("claude-opus-4-8")?.key).toBe("claude-opus");
    expect(findPrice("gpt-4o-mini-2024")?.key).toBe("gpt-4o-mini");
    expect(findPrice("gpt-4o-2024")?.key).toBe("gpt-4o");
  });

  it("computes cost from input and output tokens", () => {
    // claude-opus is 15 in / 75 out per million tokens.
    // 160 in: 160/1e6 * 15 = 0.0024. 90 out: 90/1e6 * 75 = 0.00675. Sum 0.00915.
    expect(computeCost("claude-opus-4-8", 160, 90)).toBeCloseTo(0.00915, 6);
  });

  it("returns null for an unknown model so callers can tell it was unpriced", () => {
    expect(computeCost("some-local-llm", 100, 100)).toBeNull();
    expect(computeCost(null, 100, 100)).toBeNull();
  });

  it("treats missing token counts as zero", () => {
    expect(computeCost("gpt-4o", null, null)).toBe(0);
  });
});
