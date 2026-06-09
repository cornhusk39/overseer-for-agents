import { describe, it, expect } from "vitest";
import { scrubString, scrubValue, redactAttributes } from "./redaction.js";

describe("scrubString", () => {
  it("masks emails", () => {
    const r = scrubString("contact jane.doe@example.com please");
    expect(r.value).toBe("contact [redacted-email] please");
    expect(r.hits).toBe(1);
  });

  it("masks key-shaped tokens but leaves ordinary words", () => {
    expect(scrubString("key sk-abcdef0123456789ABCDEF").value).toBe("key [redacted-api-key]");
    expect(scrubString("AKIAIOSFODNN7EXAMPLE").value).toBe("[redacted-aws-key]");
    expect(scrubString("just some normal text").value).toBe("just some normal text");
    expect(scrubString("just some normal text").hits).toBe(0);
  });

  it("masks phone numbers", () => {
    expect(scrubString("call +1 415-555-0132 now").value).toContain("[redacted-phone]");
  });
});

describe("scrubValue", () => {
  it("recurses through nested objects and arrays", () => {
    const r = scrubValue({
      user: { email: "a@b.com", id: 7 },
      notes: ["plain", "reach me at c@d.io"],
      ok: true,
    });
    expect(r.value).toEqual({
      user: { email: "[redacted-email]", id: 7 },
      notes: ["plain", "reach me at [redacted-email]"],
      ok: true,
    });
    expect(r.hits).toBe(2);
  });
});

describe("redactAttributes", () => {
  it("scrub mode keeps keys and masks values", () => {
    const r = redactAttributes(
      { "user.email": "x@y.com", "gen_ai.request.model": "claude-opus-4-8" },
      { mode: "scrub", allowlist: [] },
    );
    expect(r.value).toEqual({
      "user.email": "[redacted-email]",
      "gen_ai.request.model": "claude-opus-4-8",
    });
    expect(r.hits).toBe(1);
  });

  it("allowlist mode drops keys that are not listed", () => {
    const r = redactAttributes(
      { "gen_ai.request.model": "claude-opus-4-8", "user.email": "x@y.com", secret: "shh" },
      { mode: "allowlist", allowlist: ["gen_ai.request.model"] },
    );
    expect(r.value).toEqual({ "gen_ai.request.model": "claude-opus-4-8" });
    // Two attributes were dropped.
    expect(r.hits).toBe(2);
  });
});
