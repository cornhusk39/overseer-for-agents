import { describe, it, expect } from "vitest";
import { formatUsd, formatTokens, formatDuration } from "./format.js";

describe("format helpers", () => {
  it("keeps extra precision for sub-cent costs", () => {
    expect(formatUsd(0.0055)).toBe("$0.0055");
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("groups large token counts", () => {
    expect(formatTokens(160)).toBe("160");
    expect(formatTokens(12345)).toBe("12,345");
  });

  it("switches from milliseconds to seconds when long", () => {
    expect(formatDuration(340)).toBe("340 ms");
    expect(formatDuration(1500)).toBe("1.50 s");
  });
});
