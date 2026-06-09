// Ties the alert engine to the store: load enabled rules, evaluate each against
// its recent runs, and record a firing unless the rule is still inside its
// cooldown. Delivery is a separate step (see webhook.ts) so evaluation stays
// synchronous and easy to test.

import { randomUUID } from "node:crypto";
import type { Store } from "./store.js";
import { evaluateRule, type FiredAlert, type AlertEvent } from "./alerts.js";
import { formatWebhookPayload, deliverWebhook, type WebhookFormat, type DeliveryResult } from "./webhook.js";

// A sustained problem should not page every evaluation cycle. Once a rule fires,
// it stays quiet for this long. This is the "simple cooldown" the SPEC allows;
// anything fancier is explicitly out of scope for v1.
export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export interface EvaluateOptions {
  now?: () => number;
  cooldownMs?: number;
  idGen?: () => string;
}

// A firing along with the persisted event id, so delivery can mark the event
// delivered once the webhook post succeeds.
export interface FiredAlertWithEvent extends FiredAlert {
  eventId: string;
}

// Evaluate all enabled rules and return the ones that fired this cycle. Each
// firing is also persisted as an alert event, which is what the cooldown reads
// on the next cycle.
export function evaluateAlerts(store: Store, options: EvaluateOptions = {}): FiredAlertWithEvent[] {
  const now = options.now ?? (() => Date.now());
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const idGen = options.idGen ?? (() => randomUUID());
  const firedAtMs = now();

  const fired: FiredAlertWithEvent[] = [];
  for (const rule of store.listAlertRules({ enabledOnly: true })) {
    // Newest completed runs first; the engine takes the rule's window off the
    // front. In-flight runs are excluded so they cannot dilute the rates or
    // shrink the latency sample while still counting toward a "full" window.
    const recent = store.listRollups({
      agent: rule.agent ?? undefined,
      limit: rule.windowRuns,
      completedOnly: true,
    });
    const evaluation = evaluateRule(rule, recent);
    if (!evaluation.fire) continue;

    const last = store.lastAlertEventMs(rule.id);
    if (last !== null && firedAtMs - last < cooldownMs) continue;

    const event: AlertEvent = {
      id: idGen(),
      ruleId: rule.id,
      firedAtMs,
      metric: rule.metric,
      observed: evaluation.observed,
      threshold: rule.threshold,
      agent: rule.agent,
      delivered: false,
    };
    store.insertAlertEvent(event);
    fired.push({ rule, observed: evaluation.observed, firedAtMs, eventId: event.id });
  }
  return fired;
}

export interface DispatchOptions extends EvaluateOptions {
  webhookUrl: string;
  format?: WebhookFormat;
  // Public base URL of the dashboard; when set, alerts carry a link back to
  // the relevant runs view.
  dashboardUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface DispatchResult {
  alert: FiredAlert;
  delivery: DeliveryResult;
}

// Evaluate rules and deliver each firing to the configured webhook. Returns one
// result per fired alert. Delivery failures are reported, not thrown, so a flaky
// webhook never breaks the evaluation loop.
export async function dispatchAlerts(store: Store, options: DispatchOptions): Promise<DispatchResult[]> {
  const format = options.format ?? "discord";
  const fired = evaluateAlerts(store, options);
  const results: DispatchResult[] = [];
  for (const alert of fired) {
    const payload = formatWebhookPayload(
      alert,
      format,
      new Date(alert.firedAtMs).toISOString(),
      options.dashboardUrl,
    );
    const delivery = await deliverWebhook(options.webhookUrl, payload, options.fetchImpl);
    if (delivery.ok) store.markAlertDelivered(alert.eventId);
    results.push({ alert, delivery });
  }
  return results;
}
