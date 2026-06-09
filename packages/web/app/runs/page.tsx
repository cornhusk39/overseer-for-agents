import Link from "next/link";
import { fetchRuns } from "../../lib/api";
import type { RunListItem } from "../../lib/types";
import { StatusBadge } from "../../components/StatusBadge";
import { TimeRange, isRangeKey, rangeToSinceMs, type RangeKey } from "../../components/TimeRange";
import { formatUsd, formatTokens, formatDuration, formatRelativeTime } from "../../lib/format";

export const dynamic = "force-dynamic";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; range?: string }>;
}) {
  const params = await searchParams;
  const agent = params.agent;
  const range: RangeKey = isRangeKey(params.range) ? params.range : "24h";
  const sinceMs = rangeToSinceMs(range);

  let runs: RunListItem[] = [];
  let failed = false;
  try {
    runs = await fetchRuns({ agent, sinceMs, limit: 200 });
  } catch {
    failed = true;
  }

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Runs</h1>
          <div className="sub">
            {agent ? (
              <>
                Filtered to <span className="mono">{agent}</span>
                {" · "}
                <Link href="/runs" className="dim">
                  clear
                </Link>
              </>
            ) : (
              "Most recent runs across all agents"
            )}
          </div>
        </div>
        <TimeRange basePath="/runs" current={range} agent={agent} />
      </div>

      {failed && <div className="banner-error">Could not reach the ingest API.</div>}

      {runs.length === 0 ? (
        <div className="empty">No runs in this window.</div>
      ) : (
        <div className="card">
          <table className="table">
            <thead>
              <tr>
                <th>Run</th>
                <th>Agent</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Tools</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId}>
                  <td>
                    <Link href={`/runs/${encodeURIComponent(run.runId)}`} className="mono">
                      {run.runId.slice(0, 10)}
                    </Link>
                  </td>
                  <td className="dim mono">{run.agent}</td>
                  <td>
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="num">{run.durationMs === null ? "—" : formatDuration(run.durationMs)}</td>
                  <td className="num">
                    {run.toolCallCount === 0 ? (
                      <span className="faint">none</span>
                    ) : (
                      <span>
                        {run.toolCallCount - run.toolErrorCount}/{run.toolCallCount}
                        {run.toolErrorCount > 0 && <span style={{ color: "var(--error)" }}> ✕{run.toolErrorCount}</span>}
                      </span>
                    )}
                  </td>
                  <td className="num">{formatTokens(run.totalInputTokens + run.totalOutputTokens)}</td>
                  <td className="num">{formatUsd(run.totalCostUsd)}</td>
                  <td className="dim">{formatRelativeTime(run.startMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
