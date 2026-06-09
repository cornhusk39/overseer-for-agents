import Link from "next/link";
import { fetchAgents, fetchRuns, dataNowMs } from "../lib/api";
import type { RunListItem } from "../lib/types";
import { formatUsd, formatPercent, formatRelativeTime } from "../lib/format";

// Always render fresh: the overview reflects live ingest, so it must not be
// prerendered into a stale snapshot at build time.
export const dynamic = "force-dynamic";

// How many of the most recent runs feed the cost and error columns. The agent
// list and run counts come from the agents table and are always complete; only
// the dollar and rate figures are windowed, and the UI says so.
const RECENT_RUNS = 1000;

interface AgentRow {
  name: string;
  runCount: number;
  recentRuns: number;
  recentErrors: number;
  recentCostUsd: number;
  lastSeenMs: number;
}

export default async function AgentsPage() {
  let rows: AgentRow[] = [];
  let totalRuns = 0;
  let recentCount = 0;
  let recentErrors = 0;
  let recentCost = 0;
  let failed = false;

  try {
    const [agents, runs] = await Promise.all([fetchAgents(), fetchRuns({ limit: RECENT_RUNS })]);

    // Fold the recent runs into per-agent figures, then attach them to the
    // full agent list so an agent with no recent activity still appears.
    const byAgent = new Map<string, { runs: number; errors: number; cost: number }>();
    for (const run of runs as RunListItem[]) {
      const entry = byAgent.get(run.agent) ?? { runs: 0, errors: 0, cost: 0 };
      entry.runs += 1;
      if (run.status === "error") entry.errors += 1;
      entry.cost += run.totalCostUsd;
      byAgent.set(run.agent, entry);
    }

    rows = agents
      .map((agent) => {
        const recent = byAgent.get(agent.name) ?? { runs: 0, errors: 0, cost: 0 };
        return {
          name: agent.name,
          runCount: agent.runCount,
          recentRuns: recent.runs,
          recentErrors: recent.errors,
          recentCostUsd: recent.cost,
          lastSeenMs: agent.lastSeenMs,
        };
      })
      .sort((a, b) => b.lastSeenMs - a.lastSeenMs);

    totalRuns = rows.reduce((n, r) => n + r.runCount, 0);
    recentCount = runs.length;
    recentErrors = rows.reduce((n, r) => n + r.recentErrors, 0);
    recentCost = rows.reduce((n, r) => n + r.recentCostUsd, 0);
  } catch {
    failed = true;
  }

  const nowMs = dataNowMs();

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

      {!failed && (
        <div className="grid grid-4" style={{ marginBottom: 22 }}>
          <Stat label="Agents" value={String(rows.length)} />
          <Stat label="Runs (all time)" value={totalRuns.toLocaleString("en-US")} />
          <Stat label="Recent cost" value={formatUsd(recentCost)} title={`Across the most recent ${recentCount} runs`} />
          <Stat
            label="Recent error rate"
            value={formatPercent(recentCount ? recentErrors / recentCount : 0)}
            title={`Across the most recent ${recentCount} runs`}
          />
        </div>
      )}

      {!failed &&
        (rows.length === 0 ? (
          <div className="empty">
            No agents yet. Send traces with the SDK or run the booking example to populate this view.
          </div>
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Runs</th>
                  <th scope="col">Error rate (recent)</th>
                  <th scope="col">Cost (recent)</th>
                  <th scope="col">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <Link href={`/runs?agent=${encodeURIComponent(r.name)}`} className="mono">
                        {r.name}
                      </Link>
                    </td>
                    <td className="num">{r.runCount.toLocaleString("en-US")}</td>
                    <td className="num">
                      {r.recentRuns ? formatPercent(r.recentErrors / r.recentRuns) : <span className="faint">—</span>}
                    </td>
                    <td className="num">{r.recentRuns ? formatUsd(r.recentCostUsd) : <span className="faint">—</span>}</td>
                    <td className="dim">{formatRelativeTime(r.lastSeenMs, nowMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="stat" title={title}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
