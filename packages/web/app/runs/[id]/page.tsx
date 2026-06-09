import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchRun } from "../../../lib/api";
import { StatusBadge } from "../../../components/StatusBadge";
import { Waterfall } from "../../../components/Waterfall";
import { formatUsd, formatTokens, formatDuration, formatRelativeTime } from "../../../lib/format";

export const dynamic = "force-dynamic";

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await fetchRun(id);
  if (!detail) notFound();

  const { run, rollup, spans } = detail;
  const tools = spans.filter((s) => s.toolName);

  return (
    <div className="container">
      <Link href="/runs" className="back-link">
        ← Back to runs
      </Link>

      <div className="page-head">
        <div>
          <h1 style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="mono" style={{ fontSize: 18 }}>
              {run.id.slice(0, 16)}
            </span>
            <StatusBadge status={run.status} />
          </h1>
          <div className="sub">
            <Link href={`/runs?agent=${encodeURIComponent(run.agent)}`} className="mono">
              {run.agent}
            </Link>
            {" · "}
            {formatRelativeTime(run.startMs)}
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 22 }}>
        <Stat label="Duration" value={run.durationMs === null ? "running" : formatDuration(run.durationMs)} />
        <Stat label="Cost" value={formatUsd(rollup?.totalCostUsd ?? 0)} />
        <Stat
          label="Tokens"
          value={formatTokens((rollup?.totalInputTokens ?? 0) + (rollup?.totalOutputTokens ?? 0))}
        />
        <Stat label="Spans" value={String(spans.length)} />
      </div>

      <div className="card card-pad" style={{ marginBottom: 22 }}>
        <h3 style={{ fontSize: 14, marginBottom: 14 }}>Trace waterfall</h3>
        <Waterfall spans={spans} />
      </div>

      {tools.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 22 }}>
          <h3 style={{ fontSize: 14, marginBottom: 14 }}>Tool calls</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Outcome</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.spanId}>
                  <td className="mono">{t.toolName}</td>
                  <td>
                    <span className={`badge ${t.toolOutcome === "error" ? "error" : "ok"}`}>
                      <span className="dot" />
                      {t.toolOutcome ?? "unknown"}
                    </span>
                  </td>
                  <td className="num">{formatDuration(t.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card card-pad">
        <h3 style={{ fontSize: 14, marginBottom: 14 }}>Spans</h3>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Model</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {spans.map((s) => (
              <tr key={s.spanId}>
                <td className="mono">{s.name}</td>
                <td className="dim">{s.model ?? <span className="faint">—</span>}</td>
                <td className="num">
                  {s.inputTokens !== null || s.outputTokens !== null
                    ? `${formatTokens(s.inputTokens ?? 0)} / ${formatTokens(s.outputTokens ?? 0)}`
                    : <span className="faint">—</span>}
                </td>
                <td className="num">{s.costUsd !== null ? formatUsd(s.costUsd) : <span className="faint">—</span>}</td>
                <td className="dim">{s.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value sm">{value}</div>
    </div>
  );
}
