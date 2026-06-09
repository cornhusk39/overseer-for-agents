import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchRun, dataNowMs } from "../../../lib/api";
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
  const nowMs = dataNowMs();

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
            {formatRelativeTime(run.startMs, nowMs)}
          </div>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 22 }}>
        <Stat label="Duration" value={run.durationMs === null ? "running" : formatDuration(run.durationMs)} />
        {/* A missing rollup means "not computed yet", which is not the same
            claim as "$0.00"; show a dash rather than inventing a number. */}
        <Stat label="Cost" value={rollup ? formatUsd(rollup.totalCostUsd) : "—"} />
        <Stat
          label="Tokens"
          value={rollup ? formatTokens(rollup.totalInputTokens + rollup.totalOutputTokens) : "—"}
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
                <th scope="col">Tool</th>
                <th scope="col">Outcome</th>
                <th scope="col">Duration</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.spanId}>
                  <td className="mono">{t.toolName}</td>
                  <td>
                    {/* Unknown outcome gets a neutral badge; painting it green
                        would visually claim a success nobody recorded. */}
                    <span
                      className={`badge ${t.toolOutcome === "error" ? "error" : t.toolOutcome === "success" ? "ok" : "unset"}`}
                    >
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
              <th scope="col">Name</th>
              <th scope="col">Model</th>
              <th scope="col">Tokens</th>
              <th scope="col">Cost</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {spans.map((s) => (
              <tr key={s.spanId}>
                <td className="mono">
                  {/* Custom attributes (request ids, feature flags, whatever
                      the producer attached) are the debugging context; an
                      expander keeps them one click away without crowding the
                      table. Native details, no client JS. */}
                  {Object.keys(s.attributes).length > 0 ? (
                    <details className="attr-details">
                      <summary>{s.name}</summary>
                      <pre className="attr-json">{JSON.stringify(s.attributes, null, 2)}</pre>
                    </details>
                  ) : (
                    s.name
                  )}
                </td>
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
