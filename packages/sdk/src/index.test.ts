import { describe, it, expect } from "vitest";
import { SDK_PACKAGE } from "./index.js";

describe("sdk package bootstrap", () => {
  it("identifies itself", () => {
    expect(SDK_PACKAGE).toBe("@overseer/sdk");
  });
});
