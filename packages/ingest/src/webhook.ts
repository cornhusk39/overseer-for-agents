// Outbound alert delivery. Alerts go to a Discord (or Slack-compatible) incoming
// webhook. Two things matter for safety here: the webhook URL comes only from
// configuration, never from ingested telemetry, and a delivery failure is
// reported, not thrown, so one bad webhook cannot take down the evaluator.

import { type FiredAlert, describeAlert, formatMetricValue } from "./alerts.js";

export type WebhookFormat = "discord" | "slack";

// A neutral alert color (amber-red) so the message reads as a warning at a
// glance in both Discord and Slack.
const ALERT_COLOR_HEX = "#f87171";
const ALERT_COLOR_INT = 0xf8_71_71;

// Build the JSON body for a webhook post. Discord and Slack both accept simple
// JSON; the shapes differ, so we format per target. Unknown fields are ignored
// by both, but we keep the payloads minimal and conventional. dashboardUrl,
// when configured, links the alert back to the runs view so whoever gets paged
// can jump straight to the data instead of hunting for the dashboard.
export function formatWebhookPayload(
  alert: FiredAlert,
  format: WebhookFormat,
  isoTime: string,
  dashboardUrl?: string,
): unknown {
  const summary = describeAlert(alert);
  const scope = alert.rule.agent ?? "all agents";
  const runsLink = dashboardUrl
    ? `${dashboardUrl.replace(/\/$/, "")}/runs${alert.rule.agent ? `?agent=${encodeURIComponent(alert.rule.agent)}` : ""}`
    : undefined;

  if (format === "slack") {
    return {
      text: `:rotating_light: Overseer alert: ${alert.rule.name}`,
      attachments: [
        {
          color: ALERT_COLOR_HEX,
          text: runsLink ? `${summary}\n<${runsLink}|Open in Overseer>` : summary,
          fields: [
            { title: "Metric", value: alert.rule.metric, short: true },
            { title: "Scope", value: scope, short: true },
            { title: "Observed", value: formatMetricValue(alert.rule.metric, alert.observed), short: true },
            { title: "Threshold", value: formatMetricValue(alert.rule.metric, alert.rule.threshold), short: true },
          ],
        },
      ],
    };
  }

  return {
    username: "Overseer",
    embeds: [
      {
        title: `Alert: ${alert.rule.name}`,
        description: summary,
        ...(runsLink ? { url: runsLink } : {}),
        color: ALERT_COLOR_INT,
        timestamp: isoTime,
        fields: [
          { name: "Metric", value: alert.rule.metric, inline: true },
          { name: "Scope", value: scope, inline: true },
          { name: "Observed", value: formatMetricValue(alert.rule.metric, alert.observed), inline: true },
          { name: "Threshold", value: formatMetricValue(alert.rule.metric, alert.rule.threshold), inline: true },
        ],
      },
    ],
  };
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  error?: string;
}

// Post a payload to a webhook URL. Never throws; returns the outcome so callers
// can log it and move on.
export async function deliverWebhook(
  url: string,
  payload: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<DeliveryResult> {
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      // Webhooks should not be able to bounce us somewhere else.
      redirect: "manual",
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
