import Link from "next/link";
import { fetchAgents, fetchRuns } from "../lib/api";
import type { RunListItem } from "../lib/types";
import { formatUsd, formatPercent, formatRelativeTime } from "../lib/format";

// Always render fresh: the overview reflects live ingest, so it must not be
// prerendered into a stale snapshot at build time.
export const dynamic = "force-dynamic";

interface AgentSummary {
  name: string;
  runCount: number;
  errorRuns: number;
  totalCostUsd: number;
  lastSeenMs: number;
}

// Fold the recent runs into per-agent summaries. We aggregate on the client of
// the API (here, the server component) rather than adding another endpoint,
// since the overview already needs the run list anyway.
function summarize(runs: RunListItem[], lastSeen: Map<string, number>): AgentSummary[] {
  const byAgent = new Map<string, AgentSummary>();
  for (const run of runs) {
    const s =
      byAgent.get(run.agent) ??
      { name: run.agent, runCount: 0, errorRuns: 0, totalCostUsd: 0, lastSeenMs: 0 };
    s.runCount += 1;
    if (run.status === "error") s.errorRuns += 1;
    s.totalCostUsd += run.totalCostUsd;
    s.lastSeenMs = Math.max(s.lastSeenMs, lastSeen.get(run.agent) ?? run.startMs);
    byAgent.set(run.agent, s);
  }
  return [...byAgent.values()].sort((a, b) => b.lastSeenMs - a.lastSeenMs);
}

export default async function AgentsPage() {
  let summaries: AgentSummary[] = [];
  let failed = false;
  try {
    const [agents, runs] = await Promise.all([fetchAgents(), fetchRuns({ limit: 1000 })]);
    const lastSeen = new Map(agents.map((a) => [a.name, a.lastSeenMs]));
    summaries = summarize(runs, lastSeen);
  } catch {
    failed = true;
  }

  const totalRuns = summaries.reduce((n, s) => n + s.runCount, 0);
  const totalCost = summaries.reduce((n, s) => n + s.totalCostUsd, 0);
  const totalErrors = summaries.reduce((n, s) => n + s.errorRuns, 0);

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Agents</h1>
          <div className="sub">Production agents reporting to this Overseer instance</div>
        </div>
      </div>

      {failed && (
        <div className="banner-error">
          Could not reach the ingest API. Start the ingest service and reload, or check
          OVERSEER_API_BASE_URL.
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 22 }}>
        <Stat label="Agents" value={String(summaries.length)} />
        <Stat label="Runs" value={String(totalRuns)} />
        <Stat label="Total cost" value={formatUsd(totalCost)} />
        <Stat label="Error rate" value={formatPercent(totalRuns ? totalErrors / totalRuns : 0)} />
      </div>

      {summaries.length === 0 ? (
        <div className="empty">
          No agents yet. Send traces with the SDK or run the booking example to populate this view.
        </div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Runs</th>
                <th>Error rate</th>
                <th>Cost</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((s) => (
                <tr key={s.name}>
                  <td>
                    <Link href={`/runs?agent=${encodeURIComponent(s.name)}`} className="mono">
                      {s.name}
                    </Link>
                  </td>
                  <td className="num">{s.runCount}</td>
                  <td className="num">{formatPercent(s.runCount ? s.errorRuns / s.runCount : 0)}</td>
                  <td className="num">{formatUsd(s.totalCostUsd)}</td>
                  <td className="dim">{formatRelativeTime(s.lastSeenMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
