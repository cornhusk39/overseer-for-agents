import { describe, it, expect } from "vitest";
import { TRACE_CONTRACT_VERSION } from "./index.js";

describe("schema package bootstrap", () => {
  it("exposes a pinned trace contract version", () => {
    expect(TRACE_CONTRACT_VERSION).toBe(1);
  });
});
