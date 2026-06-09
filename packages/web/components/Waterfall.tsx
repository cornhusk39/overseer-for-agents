import type { Span } from "@overseer/schema";
import { formatDuration } from "../lib/format";

// Classify a span for coloring: a recognized tool call, an LLM call, or plain
// internal work. An errored span overrides the color so failures stand out.
function spanClass(span: Span): "llm" | "tool" | "other" {
  if (span.toolName) return "tool";
  if (span.model) return "llm";
  return "other";
}

// The trace waterfall. Spans are laid out on a shared timeline: each bar's
// horizontal position is its offset from the run start, its width its duration.
// This is the view that makes a slow or failing step obvious at a glance.
export function Waterfall({ spans }: { spans: Span[] }) {
  if (spans.length === 0) {
    return <div className="empty">This run has no spans.</div>;
  }

  const minStart = Math.min(...spans.map((s) => s.startMs));
  const maxEnd = Math.max(...spans.map((s) => s.endMs));
  // Guard against a zero-width run (all spans at the same instant).
  const total = Math.max(1, maxEnd - minStart);

  // Sort by start so the waterfall cascades top to bottom in execution order.
  const ordered = [...spans].sort((a, b) => a.startMs - b.startMs || a.spanId.localeCompare(b.spanId));

  return (
    <div className="waterfall">
      {ordered.map((span) => {
        const cls = spanClass(span);
        const left = ((span.startMs - minStart) / total) * 100;
        const width = Math.max(0.5, (span.durationMs / total) * 100);
        const barClass = span.status === "error" ? "errored" : cls;
        return (
          <div className="wf-row" key={`${span.runId}:${span.spanId}`}>
            <div className="wf-name" title={span.name}>
              <span className={`kind-pip ${cls}`} />
              {span.name}
            </div>
            <div className="wf-track">
              <div
                className={`wf-bar ${barClass}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${span.name} (${formatDuration(span.durationMs)})`}
              />
            </div>
            <div className="wf-dur">{formatDuration(span.durationMs)}</div>
          </div>
        );
      })}
    </div>
  );
}
