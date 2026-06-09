import type { Span } from "@overseer/schema";
import { formatDuration } from "../lib/format";

// Classify a span for coloring: a recognized tool call, an LLM call, or plain
// internal work. An errored span overrides the color so failures stand out.
function spanClass(span: Span): "llm" | "tool" | "other" {
  if (span.toolName) return "tool";
  if (span.model) return "llm";
  return "other";
}

interface TreeRow {
  span: Span;
  depth: number;
}

// Order spans as a tree walk: each parent first, then its children by start
// time. A flat sort by start time puts a child that started in the same
// millisecond above its own parent, which reads backwards. Orphans (parent id
// pointing at a span we never received) are treated as roots so they still
// show up.
function treeOrder(spans: Span[]): TreeRow[] {
  const byStart = (a: Span, b: Span) => a.startMs - b.startMs || a.spanId.localeCompare(b.spanId);
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string, Span[]>();
  const roots: Span[] = [];

  for (const span of spans) {
    const parent = span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : null;
    if (parent === null) {
      roots.push(span);
    } else {
      const list = children.get(parent);
      if (list) list.push(span);
      else children.set(parent, [span]);
    }
  }

  const rows: TreeRow[] = [];
  const visit = (span: Span, depth: number) => {
    rows.push({ span, depth });
    for (const child of (children.get(span.spanId) ?? []).sort(byStart)) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots.sort(byStart)) visit(root, 0);
  return rows;
}

function depthClass(depth: number): string {
  if (depth === 0) return "";
  if (depth === 1) return "depth-1";
  if (depth === 2) return "depth-2";
  return "depth-3plus";
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

  return (
    <div className="waterfall">
      {treeOrder(spans).map(({ span, depth }) => {
        const cls = spanClass(span);
        const left = ((span.startMs - minStart) / total) * 100;
        const width = Math.max(0.5, (span.durationMs / total) * 100);
        const errored = span.status === "error";
        const barClass = errored ? "errored" : cls;
        return (
          <div className="wf-row" key={`${span.runId}:${span.spanId}`}>
            <div className={`wf-name ${depthClass(depth)}`} title={span.name}>
              <span className={`kind-pip ${cls}`} />
              {span.name}
              {errored && (
                <span className="wf-err" aria-label="errored span">
                  ✕
                </span>
              )}
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
