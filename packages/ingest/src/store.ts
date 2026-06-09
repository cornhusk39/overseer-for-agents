// The SQLite store. better-sqlite3 is synchronous, which suits an ingest path
// that writes a batch of spans inside one transaction and a dashboard that
// reads on request. Single-node self-host is the v1 target; the schema is kept
// plain so the Postgres scale path stays a straightforward port later.
//
// The full table set is created up front, including the rollup and alert tables
// that later milestones populate, so the database shape is stable from the
// first write and no migrations are needed as features land.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type Span,
  type Run,
  type Agent,
  type RunStatus,
  type RunRollup,
} from "@overseer/schema";
import { computeRollup } from "./rollups.js";
import type { AlertRule, AlertEvent, AlertMetric } from "./alerts.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  name           TEXT PRIMARY KEY,
  first_seen_ms  REAL NOT NULL,
  last_seen_ms   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  agent        TEXT NOT NULL,
  status       TEXT NOT NULL,
  start_ms     REAL NOT NULL,
  end_ms       REAL,
  duration_ms  REAL,
  received_at_ms REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_agent_start ON runs (agent, start_ms DESC);
CREATE INDEX IF NOT EXISTS idx_runs_start ON runs (start_ms DESC);

CREATE TABLE IF NOT EXISTS spans (
  run_id          TEXT NOT NULL,
  span_id         TEXT NOT NULL,
  parent_span_id  TEXT,
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL,
  start_ms        REAL NOT NULL,
  end_ms          REAL NOT NULL,
  duration_ms     REAL NOT NULL,
  status          TEXT NOT NULL,
  status_message  TEXT,
  model           TEXT,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_usd        REAL,
  tool_name       TEXT,
  tool_outcome    TEXT,
  step_index      INTEGER,
  attributes      TEXT NOT NULL,
  received_at_ms  REAL NOT NULL,
  PRIMARY KEY (run_id, span_id)
);
CREATE INDEX IF NOT EXISTS idx_spans_run ON spans (run_id, start_ms);

CREATE TABLE IF NOT EXISTS run_rollups (
  run_id              TEXT PRIMARY KEY,
  agent               TEXT NOT NULL,
  status              TEXT NOT NULL,
  start_ms            REAL NOT NULL,
  end_ms              REAL,
  duration_ms         REAL,
  span_count          INTEGER NOT NULL,
  llm_call_count      INTEGER NOT NULL,
  tool_call_count     INTEGER NOT NULL,
  tool_error_count    INTEGER NOT NULL,
  error_count         INTEGER NOT NULL,
  total_cost_usd      REAL NOT NULL,
  total_input_tokens  INTEGER NOT NULL,
  total_output_tokens INTEGER NOT NULL,
  models              TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rollups_agent_start ON run_rollups (agent, start_ms DESC);

CREATE TABLE IF NOT EXISTS alert_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  metric      TEXT NOT NULL,
  threshold   REAL NOT NULL,
  window_runs INTEGER NOT NULL,
  agent       TEXT,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS alert_events (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  fired_at_ms REAL NOT NULL,
  metric      TEXT NOT NULL,
  observed    REAL NOT NULL,
  threshold   REAL NOT NULL,
  agent       TEXT,
  delivered   INTEGER NOT NULL DEFAULT 0
);
`;

// One span as it sits in the database. The agent-native columns are nullable
// because not every span is an LLM or tool call; attributes is a JSON string.
interface SpanRow {
  run_id: string;
  span_id: string;
  parent_span_id: string | null;
  name: string;
  kind: string;
  start_ms: number;
  end_ms: number;
  duration_ms: number;
  status: string;
  status_message: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  tool_name: string | null;
  tool_outcome: string | null;
  step_index: number | null;
  attributes: string;
  received_at_ms: number;
}

export interface IngestInput {
  spans: Span[];
  // The agent name resolved for each run id during mapping.
  agentByRun: Map<string, string>;
  receivedAtMs: number;
}

export class Store {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      // Make sure the directory exists so a fresh self-host install does not
      // fail on first write just because ./data is not there yet.
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    // WAL gives concurrent dashboard reads while ingest writes; foreign_keys is
    // on for correctness even though the v1 schema leans on application logic.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // Persist a batch of spans and refresh the derived run and agent rows for
  // every run the batch touched. Wrapped in a single transaction so a partial
  // write can never leave a run half-updated.
  ingest(input: IngestInput): { runsTouched: string[] } {
    const insertSpan = this.db.prepare<SpanRow>(`
      INSERT INTO spans (
        run_id, span_id, parent_span_id, name, kind, start_ms, end_ms, duration_ms,
        status, status_message, model, input_tokens, output_tokens, cost_usd,
        tool_name, tool_outcome, step_index, attributes, received_at_ms
      ) VALUES (
        @run_id, @span_id, @parent_span_id, @name, @kind, @start_ms, @end_ms, @duration_ms,
        @status, @status_message, @model, @input_tokens, @output_tokens, @cost_usd,
        @tool_name, @tool_outcome, @step_index, @attributes, @received_at_ms
      )
      ON CONFLICT (run_id, span_id) DO UPDATE SET
        parent_span_id = excluded.parent_span_id,
        name = excluded.name,
        kind = excluded.kind,
        start_ms = excluded.start_ms,
        end_ms = excluded.end_ms,
        duration_ms = excluded.duration_ms,
        status = excluded.status,
        status_message = excluded.status_message,
        model = excluded.model,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        cost_usd = excluded.cost_usd,
        tool_name = excluded.tool_name,
        tool_outcome = excluded.tool_outcome,
        step_index = excluded.step_index,
        attributes = excluded.attributes,
        received_at_ms = excluded.received_at_ms
    `);

    const runIds = new Set<string>();

    const tx = this.db.transaction((batch: Span[]) => {
      for (const span of batch) {
        insertSpan.run(this.toSpanRow(span, input.receivedAtMs));
        runIds.add(span.runId);
      }
      for (const runId of runIds) {
        const agent = input.agentByRun.get(runId) ?? this.existingAgent(runId) ?? "unknown";
        this.recomputeRun(runId, agent, input.receivedAtMs);
        this.touchAgent(agent, input.receivedAtMs);
        // Refresh the derived metrics for the run from its full span set. Reads
        // inside this transaction see the writes above on the same connection.
        this.recomputeRollup(runId);
      }
    });
    tx(input.spans);

    return { runsTouched: [...runIds] };
  }

  private toSpanRow(span: Span, receivedAtMs: number): SpanRow {
    return {
      run_id: span.runId,
      span_id: span.spanId,
      parent_span_id: span.parentSpanId,
      name: span.name,
      kind: span.kind,
      start_ms: span.startMs,
      end_ms: span.endMs,
      duration_ms: span.durationMs,
      status: span.status,
      status_message: span.statusMessage,
      model: span.model,
      input_tokens: span.inputTokens,
      output_tokens: span.outputTokens,
      cost_usd: span.costUsd,
      tool_name: span.toolName,
      tool_outcome: span.toolOutcome,
      step_index: span.stepIndex,
      attributes: JSON.stringify(span.attributes),
      received_at_ms: receivedAtMs,
    };
  }

  private existingAgent(runId: string): string | null {
    const row = this.db.prepare(`SELECT agent FROM runs WHERE id = ?`).get(runId) as
      | { agent: string }
      | undefined;
    return row?.agent ?? null;
  }

  // Rebuild a run's row from its spans. A run is "running" until its root span
  // (the one with no parent) has been received; any errored span makes it an
  // error run. This is the live-run heuristic the dashboard relies on.
  private recomputeRun(runId: string, agent: string, receivedAtMs: number): void {
    const agg = this.db
      .prepare(
        `SELECT
           MIN(start_ms) AS start_ms,
           MAX(end_ms)   AS end_ms,
           SUM(CASE WHEN parent_span_id IS NULL THEN 1 ELSE 0 END) AS root_count,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)       AS error_count
         FROM spans WHERE run_id = ?`,
      )
      .get(runId) as {
      start_ms: number | null;
      end_ms: number | null;
      root_count: number;
      error_count: number;
    };

    if (agg.start_ms === null) return; // no spans, nothing to record

    const hasRoot = agg.root_count > 0;
    const status: RunStatus = agg.error_count > 0 ? "error" : hasRoot ? "ok" : "running";
    const endMs = hasRoot ? agg.end_ms : null;
    const durationMs = endMs !== null ? endMs - agg.start_ms : null;

    this.db
      .prepare(
        `INSERT INTO runs (id, agent, status, start_ms, end_ms, duration_ms, received_at_ms)
         VALUES (@id, @agent, @status, @start_ms, @end_ms, @duration_ms, @received_at_ms)
         ON CONFLICT (id) DO UPDATE SET
           agent = excluded.agent,
           status = excluded.status,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           duration_ms = excluded.duration_ms,
           received_at_ms = excluded.received_at_ms`,
      )
      .run({
        id: runId,
        agent,
        status,
        start_ms: agg.start_ms,
        end_ms: endMs,
        duration_ms: durationMs,
        received_at_ms: receivedAtMs,
      });
  }

  // Rebuild a run's rollup row from its current run row and span set. Cheap
  // enough to run on every ingest because a run's span count is small.
  private recomputeRollup(runId: string): void {
    const run = this.getRun(runId);
    if (!run) return;
    const rollup = computeRollup(run, this.getSpans(runId));
    this.db
      .prepare(
        `INSERT INTO run_rollups (
           run_id, agent, status, start_ms, end_ms, duration_ms, span_count,
           llm_call_count, tool_call_count, tool_error_count, error_count,
           total_cost_usd, total_input_tokens, total_output_tokens, models
         ) VALUES (
           @run_id, @agent, @status, @start_ms, @end_ms, @duration_ms, @span_count,
           @llm_call_count, @tool_call_count, @tool_error_count, @error_count,
           @total_cost_usd, @total_input_tokens, @total_output_tokens, @models
         )
         ON CONFLICT (run_id) DO UPDATE SET
           agent = excluded.agent,
           status = excluded.status,
           start_ms = excluded.start_ms,
           end_ms = excluded.end_ms,
           duration_ms = excluded.duration_ms,
           span_count = excluded.span_count,
           llm_call_count = excluded.llm_call_count,
           tool_call_count = excluded.tool_call_count,
           tool_error_count = excluded.tool_error_count,
           error_count = excluded.error_count,
           total_cost_usd = excluded.total_cost_usd,
           total_input_tokens = excluded.total_input_tokens,
           total_output_tokens = excluded.total_output_tokens,
           models = excluded.models`,
      )
      .run({
        run_id: rollup.runId,
        agent: rollup.agent,
        status: rollup.status,
        start_ms: rollup.startMs,
        end_ms: rollup.endMs,
        duration_ms: rollup.durationMs,
        span_count: rollup.spanCount,
        llm_call_count: rollup.llmCallCount,
        tool_call_count: rollup.toolCallCount,
        tool_error_count: rollup.toolErrorCount,
        error_count: rollup.errorCount,
        total_cost_usd: rollup.totalCostUsd,
        total_input_tokens: rollup.totalInputTokens,
        total_output_tokens: rollup.totalOutputTokens,
        models: JSON.stringify(rollup.models),
      });
  }

  private touchAgent(name: string, seenMs: number): void {
    this.db
      .prepare(
        `INSERT INTO agents (name, first_seen_ms, last_seen_ms)
         VALUES (@name, @seen, @seen)
         ON CONFLICT (name) DO UPDATE SET
           first_seen_ms = MIN(first_seen_ms, excluded.first_seen_ms),
           last_seen_ms  = MAX(last_seen_ms, excluded.last_seen_ms)`,
      )
      .run({ name, seen: seenMs });
  }

  // --- Read paths used by the dashboard and tests ---

  getRun(id: string): Run | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
      | RunRow
      | undefined;
    return row ? rowToRun(row) : null;
  }

  getSpans(runId: string): Span[] {
    const rows = this.db
      .prepare(`SELECT * FROM spans WHERE run_id = ? ORDER BY start_ms ASC, span_id ASC`)
      .all(runId) as SpanRow[];
    return rows.map(rowToSpan);
  }

  listRuns(limit = 50): Run[] {
    const rows = this.db
      .prepare(`SELECT * FROM runs ORDER BY start_ms DESC LIMIT ?`)
      .all(limit) as RunRow[];
    return rows.map(rowToRun);
  }

  getRollup(runId: string): RunRollup | null {
    const row = this.db.prepare(`SELECT * FROM run_rollups WHERE run_id = ?`).get(runId) as
      | RollupRow
      | undefined;
    return row ? rowToRollup(row) : null;
  }

  // Rollups for the most recent runs, optionally narrowed to one agent. This is
  // the read path behind the runs list and the trends views.
  listRollups(options: { limit?: number; agent?: string; sinceMs?: number } = {}): RunRollup[] {
    const limit = options.limit ?? 100;
    const clauses: string[] = [];
    const params: Record<string, unknown> = { limit };
    if (options.agent) {
      clauses.push("agent = @agent");
      params.agent = options.agent;
    }
    if (options.sinceMs !== undefined) {
      clauses.push("start_ms >= @sinceMs");
      params.sinceMs = options.sinceMs;
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM run_rollups ${where} ORDER BY start_ms DESC LIMIT @limit`)
      .all(params) as RollupRow[];
    return rows.map(rowToRollup);
  }

  listAgents(): Agent[] {
    const rows = this.db
      .prepare(
        `SELECT a.name, a.first_seen_ms, a.last_seen_ms,
                (SELECT COUNT(*) FROM runs r WHERE r.agent = a.name) AS run_count
         FROM agents a
         ORDER BY a.last_seen_ms DESC`,
      )
      .all() as { name: string; first_seen_ms: number; last_seen_ms: number; run_count: number }[];
    return rows.map((r) => ({
      name: r.name,
      firstSeenMs: r.first_seen_ms,
      lastSeenMs: r.last_seen_ms,
      runCount: r.run_count,
    }));
  }

  // --- Alert rules and events ---

  upsertAlertRule(rule: AlertRule): void {
    this.db
      .prepare(
        `INSERT INTO alert_rules (id, name, metric, threshold, window_runs, agent, enabled)
         VALUES (@id, @name, @metric, @threshold, @window_runs, @agent, @enabled)
         ON CONFLICT (id) DO UPDATE SET
           name = excluded.name,
           metric = excluded.metric,
           threshold = excluded.threshold,
           window_runs = excluded.window_runs,
           agent = excluded.agent,
           enabled = excluded.enabled`,
      )
      .run({
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        threshold: rule.threshold,
        window_runs: rule.windowRuns,
        agent: rule.agent,
        enabled: rule.enabled ? 1 : 0,
      });
  }

  listAlertRules(options: { enabledOnly?: boolean } = {}): AlertRule[] {
    const where = options.enabledOnly ? "WHERE enabled = 1" : "";
    const rows = this.db.prepare(`SELECT * FROM alert_rules ${where} ORDER BY name`).all() as AlertRuleRow[];
    return rows.map(rowToAlertRule);
  }

  // Timestamp of the most recent firing of a rule, or null if it has never
  // fired. This is what the cooldown check reads.
  lastAlertEventMs(ruleId: string): number | null {
    const row = this.db
      .prepare(`SELECT MAX(fired_at_ms) AS last FROM alert_events WHERE rule_id = ?`)
      .get(ruleId) as { last: number | null };
    return row.last;
  }

  insertAlertEvent(event: AlertEvent): void {
    this.db
      .prepare(
        `INSERT INTO alert_events (id, rule_id, fired_at_ms, metric, observed, threshold, agent, delivered)
         VALUES (@id, @rule_id, @fired_at_ms, @metric, @observed, @threshold, @agent, @delivered)`,
      )
      .run({
        id: event.id,
        rule_id: event.ruleId,
        fired_at_ms: event.firedAtMs,
        metric: event.metric,
        observed: event.observed,
        threshold: event.threshold,
        agent: event.agent,
        delivered: event.delivered ? 1 : 0,
      });
  }

  listAlertEvents(limit = 100): AlertEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM alert_events ORDER BY fired_at_ms DESC LIMIT ?`)
      .all(limit) as AlertEventRow[];
    return rows.map(rowToAlertEvent);
  }

  // Exposed so later milestones can run their own statements without widening
  // this class prematurely.
  get raw(): Database.Database {
    return this.db;
  }
}

interface AlertRuleRow {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  window_runs: number;
  agent: string | null;
  enabled: number;
}

function rowToAlertRule(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    name: row.name,
    metric: row.metric as AlertMetric,
    threshold: row.threshold,
    windowRuns: row.window_runs,
    agent: row.agent,
    enabled: row.enabled === 1,
  };
}

interface AlertEventRow {
  id: string;
  rule_id: string;
  fired_at_ms: number;
  metric: string;
  observed: number;
  threshold: number;
  agent: string | null;
  delivered: number;
}

function rowToAlertEvent(row: AlertEventRow): AlertEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    firedAtMs: row.fired_at_ms,
    metric: row.metric as AlertMetric,
    observed: row.observed,
    threshold: row.threshold,
    agent: row.agent,
    delivered: row.delivered === 1,
  };
}

interface RunRow {
  id: string;
  agent: string;
  status: string;
  start_ms: number;
  end_ms: number | null;
  duration_ms: number | null;
  received_at_ms: number;
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    agent: row.agent,
    status: row.status as RunStatus,
    startMs: row.start_ms,
    endMs: row.end_ms,
    durationMs: row.duration_ms,
  };
}

interface RollupRow {
  run_id: string;
  agent: string;
  status: string;
  start_ms: number;
  end_ms: number | null;
  duration_ms: number | null;
  span_count: number;
  llm_call_count: number;
  tool_call_count: number;
  tool_error_count: number;
  error_count: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  models: string;
}

function rowToRollup(row: RollupRow): RunRollup {
  return {
    runId: row.run_id,
    agent: row.agent,
    status: row.status as RunStatus,
    startMs: row.start_ms,
    endMs: row.end_ms,
    durationMs: row.duration_ms,
    spanCount: row.span_count,
    llmCallCount: row.llm_call_count,
    toolCallCount: row.tool_call_count,
    toolErrorCount: row.tool_error_count,
    errorCount: row.error_count,
    totalCostUsd: row.total_cost_usd,
    totalInputTokens: row.total_input_tokens,
    totalOutputTokens: row.total_output_tokens,
    models: JSON.parse(row.models) as string[],
  };
}

function rowToSpan(row: SpanRow): Span {
  return {
    runId: row.run_id,
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    name: row.name,
    kind: row.kind,
    startMs: row.start_ms,
    endMs: row.end_ms,
    durationMs: row.duration_ms,
    status: row.status as Span["status"],
    statusMessage: row.status_message,
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    costUsd: row.cost_usd,
    toolName: row.tool_name,
    toolOutcome: row.tool_outcome as Span["toolOutcome"],
    stepIndex: row.step_index,
    attributes: JSON.parse(row.attributes) as Record<string, unknown>,
  };
}
