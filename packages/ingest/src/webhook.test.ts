import { describe, it, expect } from "vitest";
import { formatWebhookPayload, deliverWebhook } from "./webhook.js";
import type { FiredAlert } from "./alerts.js";

const alert: FiredAlert = {
  rule: {
    id: "r1",
    name: "Cost spike",
    metric: "cost_per_run",
    threshold: 0.05,
    windowRuns: 5,
    agent: "booking",
    enabled: true,
  },
  observed: 0.082,
  firedAtMs: 1_700_000_000_000,
};

describe("formatWebhookPayload", () => {
  it("builds a Discord embed", () => {
    const payload = formatWebhookPayload(alert, "discord", "2026-06-09T00:00:00.000Z") as {
      embeds: { title: string; description: string; fields: { name: string; value: string }[] }[];
    };
    expect(payload.embeds[0]!.title).toContain("Cost spike");
    expect(payload.embeds[0]!.description).toContain("cost_per_run");
    const observed = payload.embeds[0]!.fields.find((f) => f.name === "Observed")!;
    expect(observed.value).toBe("$0.0820");
  });

  it("builds a Slack attachment", () => {
    const payload = formatWebhookPayload(alert, "slack", "2026-06-09T00:00:00.000Z") as {
      text: string;
      attachments: { fields: { title: string; value: string }[] }[];
    };
    expect(payload.text).toContain("Cost spike");
    expect(payload.attachments[0]!.fields.some((f) => f.title === "Scope" && f.value === "booking")).toBe(true);
  });
});

describe("deliverWebhook", () => {
  it("posts JSON and reports success", async () => {
    let seen: { url: string; body: unknown; method?: string } | null = null;
    const stub = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), body: JSON.parse(String(init?.body)), method: init?.method };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await deliverWebhook("https://hooks.example/abc", { content: "hi" }, stub);
    expect(result.ok).toBe(true);
    expect(seen!.method).toBe("POST");
    expect(seen!.body).toEqual({ content: "hi" });
  });

  it("reports a non-2xx without throwing", async () => {
    const stub = (async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    const result = await deliverWebhook("https://hooks.example/abc", {}, stub);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it("reports a network error without throwing", async () => {
    const stub = (async () => {
      throw new Error("dns failure");
    }) as unknown as typeof fetch;
    const result = await deliverWebhook("https://hooks.example/abc", {}, stub);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("dns failure");
  });
});
