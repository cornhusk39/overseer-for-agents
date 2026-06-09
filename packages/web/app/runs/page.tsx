import Link from "next/link";
import { fetchRuns, dataNowMs } from "../../lib/api";
import type { RunListItem } from "../../lib/types";
import { StatusBadge } from "../../components/StatusBadge";
import { TimeRange, isRangeKey, rangeToSinceMs, type RangeKey } from "../../components/TimeRange";
import { formatUsd, formatTokens, formatDuration, formatRelativeTime } from "../../lib/format";

export const dynamic = "force-dynamic";

// Next delivers a repeated query param as an array; the views only ever want
// one value, so take the first.
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[]; range?: string | string[] }>;
}) {
  const params = await searchParams;
  const agent = first(params.agent);
  const rangeParam = first(params.range);
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "24h";
  const sinceMs = rangeToSinceMs(range);

  let runs: RunListItem[] = [];
  let failed = false;
  try {
    runs = await fetchRuns({ agent, sinceMs, limit: 200 });
  } catch {
    failed = true;
  }

  const nowMs = dataNowMs();

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

      {!failed &&
        (runs.length === 0 ? (
          <div className="empty">No runs in this window.</div>
        ) : (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Agent</th>
                  <th scope="col">Status</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Tools</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Cost</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.runId}>
                    <td>
                      <Link href={`/runs/${encodeURIComponent(run.runId)}`} className="mono">
                        {run.runId.slice(0, 12)}
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
                          {run.toolErrorCount > 0 && (
                            <span style={{ color: "var(--error)" }}> ✕{run.toolErrorCount}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="num">{formatTokens(run.totalInputTokens + run.totalOutputTokens)}</td>
                    <td className="num">{formatUsd(run.totalCostUsd)}</td>
                    <td className="dim">{formatRelativeTime(run.startMs, nowMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
}
