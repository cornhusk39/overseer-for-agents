// Quickstart runner. Point it at a running Overseer ingest endpoint and it
// sends a handful of booking-agent traces you can then watch in the dashboard.
//
//   OVERSEER_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces \
//   OVERSEER_SDK_TOKEN=your-token \
//   pnpm --filter @overseer/example-booking start
//
// The data is fully synthetic, so it is safe to run against any environment.

import { createClient } from "@overseer/sdk";
import { runBookingScenario, SCENARIOS } from "./agent.js";

async function main(): Promise<void> {
  const endpoint = process.env.OVERSEER_OTLP_ENDPOINT ?? "http://127.0.0.1:4318/v1/traces";
  const token = process.env.OVERSEER_SDK_TOKEN ?? "";
  if (token === "") {
    console.error("Set OVERSEER_SDK_TOKEN to the ingest bearer token before running.");
    process.exitCode = 1;
    return;
  }

  const client = createClient({ endpoint, token, serviceName: "home-service-booking" });

  for (const scenario of SCENARIOS) {
    const { traceId, exported } = await runBookingScenario(client, scenario);
    console.log(`${exported ? "sent" : "FAILED"} ${scenario.intent.padEnd(8)} trace=${traceId}`);
  }
}

void main();
