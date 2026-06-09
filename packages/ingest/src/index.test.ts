import { describe, it, expect } from "vitest";
import { INGEST_PACKAGE } from "./index.js";

describe("ingest package bootstrap", () => {
  it("identifies itself", () => {
    expect(INGEST_PACKAGE).toBe("@overseer/ingest");
  });
});
