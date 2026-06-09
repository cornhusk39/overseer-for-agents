import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("requires an ingest token", () => {
    expect(() => loadConfig({})).toThrow(/OVERSEER_INGEST_TOKEN/);
  });

  it("applies defaults when only the token is set", () => {
    const c = loadConfig({ OVERSEER_INGEST_TOKEN: "abc" });
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(4318);
    expect(c.maxBodyBytes).toBe(5 * 1024 * 1024);
    expect(c.redactionMode).toBe("scrub");
    expect(c.attrAllowlist).toEqual([]);
  });

  it("parses the attribute allowlist into a trimmed list", () => {
    const c = loadConfig({
      OVERSEER_INGEST_TOKEN: "abc",
      OVERSEER_REDACTION_MODE: "allowlist",
      OVERSEER_ATTR_ALLOWLIST: "gen_ai.system, gen_ai.request.model ,",
    });
    expect(c.redactionMode).toBe("allowlist");
    expect(c.attrAllowlist).toEqual(["gen_ai.system", "gen_ai.request.model"]);
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadConfig({ OVERSEER_INGEST_TOKEN: "abc", OVERSEER_INGEST_PORT: "nope" })).toThrow(
      /OVERSEER_INGEST_PORT/,
    );
  });
});
