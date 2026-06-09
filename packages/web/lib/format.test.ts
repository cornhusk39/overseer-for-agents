import { describe, it, expect } from "vitest";
import { formatUsd, formatTokens, formatDuration, formatPercent, formatRelativeTime } from "./format";

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

  it("formats fractions as percentages", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(0.333)).toBe("33.3%");
  });

  it("formats relative time against a fixed now", () => {
    const now = 1_000_000_000;
    expect(formatRelativeTime(now, now)).toBe("0s ago");
    expect(formatRelativeTime(now - 90_000, now)).toBe("1m ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  });
});
