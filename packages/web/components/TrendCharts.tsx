import type { ReactNode } from "react";
import type { TrendBucket } from "../lib/types";
import { formatUsd, formatTokens, formatDuration, formatPercent } from "../lib/format";

// Lightweight SVG charts, no charting library. The trends views show a handful
// of small multiples, and hand-rolled SVG keeps the bundle tiny and the markup
// legible. Charts use a fixed viewBox and stretch to their container width.

const W = 320;
const H = 120;
const PAD = 6;

function xFor(index: number, count: number): number {
  if (count <= 1) return W / 2;
  return PAD + (index / (count - 1)) * (W - 2 * PAD);
}

function yFor(value: number, max: number): number {
  const top = PAD;
  const bottom = H - PAD;
  if (max <= 0) return bottom;
  return bottom - (value / max) * (bottom - top);
}

function Bars({ values, max }: { values: number[]; max: number }) {
  const n = values.length;
  const slot = (W - 2 * PAD) / Math.max(1, n);
  const barW = Math.max(2, slot * 0.7);
  return (
    <>
      {values.map((v, i) => {
        const x = PAD + i * slot + (slot - barW) / 2;
        const y = yFor(v, max);
        return <rect key={i} className="chart-bar" x={x} y={y} width={barW} height={H - PAD - y} rx={2} />;
      })}
    </>
  );
}

// A line series that tolerates gaps: null values (buckets with nothing to
// measure) split the line into segments instead of dipping to zero, and a
// segment of one point renders as a dot so it stays visible. The optional dash
// pattern keeps two series distinguishable even where they overlap exactly,
// and without relying on color alone.
function Line({ values, max, color, dashed = false }: { values: (number | null)[]; max: number; color: string; dashed?: boolean }) {
  if (values.length === 0) return null;

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current);
      current = [];
      return;
    }
    current.push({ x: xFor(i, values.length), y: yFor(v, max) });
  });
  if (current.length) segments.push(current);

  return (
    <>
      {segments.map((seg, i) =>
        seg.length === 1 ? (
          <circle key={i} cx={seg[0]!.x} cy={seg[0]!.y} r={3} fill={color} />
        ) : (
          <polyline
            key={i}
            points={seg.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeDasharray={dashed ? "5 4" : undefined}
          />
        ),
      )}
    </>
  );
}

// Short axis label for a bucket timestamp: time-of-day when the whole window
// fits in a day, otherwise month and day.
function axisLabel(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs <= 24 * 60 * 60 * 1000) {
    return d.toISOString().slice(11, 16) + " UTC";
  }
  return d.toISOString().slice(5, 10);
}

function ChartCard({
  title,
  subtitle,
  buckets,
  children,
  legend,
}: {
  title: string;
  subtitle: string;
  buckets: TrendBucket[];
  children: ReactNode;
  legend?: ReactNode;
}) {
  const first = buckets[0];
  const last = buckets[buckets.length - 1];
  const spanMs = first && last ? last.startMs - first.startMs : 0;
  return (
    <div className="card card-pad">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 14 }}>{title}</h3>
        <span className="sub num">{subtitle}</span>
      </div>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}: ${subtitle}`}
      >
        <line className="chart-axis" x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
        {children}
      </svg>
      {first && last && buckets.length > 1 && (
        <div className="chart-x">
          <span>{axisLabel(first.startMs, spanMs)}</span>
          <span>{axisLabel(last.startMs, spanMs)}</span>
        </div>
      )}
      {legend}
    </div>
  );
}

export function TrendCharts({ buckets }: { buckets: TrendBucket[] }) {
  const cost = buckets.map((b) => b.totalCostUsd);
  const tokens = buckets.map((b) => b.totalTokens);
  const p50 = buckets.map((b) => b.latencyP50Ms);
  const p95 = buckets.map((b) => b.latencyP95Ms);
  const errorRate = buckets.map((b) => b.errorRate);
  const toolFail = buckets.map((b) => b.toolFailureRate);

  const measuredP95 = p95.filter((v): v is number => v !== null);
  const maxLatency = Math.max(1, ...measuredP95);
  // Rates share a 0..1 axis, with a little headroom so a 100% point is visible.
  const maxRate = Math.max(0.05, ...errorRate, ...toolFail) * 1.1;

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <div className="grid grid-2">
      <ChartCard title="Cost per bucket" subtitle={formatUsd(sum(cost))} buckets={buckets}>
        <Bars values={cost} max={Math.max(0.000001, ...cost)} />
      </ChartCard>

      <ChartCard title="Tokens per bucket" subtitle={formatTokens(sum(tokens))} buckets={buckets}>
        <Bars values={tokens} max={Math.max(1, ...tokens)} />
      </ChartCard>

      <ChartCard
        title="Latency"
        subtitle={measuredP95.length ? `peak p95 ${formatDuration(maxLatency)}` : "no completed runs"}
        buckets={buckets}
        legend={
          <div className="legend">
            <span>
              <i style={{ background: "#5eead4" }} /> p50
            </span>
            <span>
              <i style={{ background: "#60a5fa" }} /> p95 (dashed)
            </span>
          </div>
        }
      >
        <Line values={p50} max={maxLatency} color="#5eead4" />
        <Line values={p95} max={maxLatency} color="#60a5fa" dashed />
      </ChartCard>

      <ChartCard
        title="Error & tool-failure rate"
        subtitle={`peak ${formatPercent(Math.max(0, ...errorRate, ...toolFail))}`}
        buckets={buckets}
        legend={
          <div className="legend">
            <span>
              <i style={{ background: "#f87171" }} /> errors
            </span>
            <span>
              <i style={{ background: "#c084fc" }} /> tool failures (dashed)
            </span>
          </div>
        }
      >
        <Line values={errorRate} max={maxRate} color="#f87171" />
        <Line values={toolFail} max={maxRate} color="#c084fc" dashed />
      </ChartCard>
    </div>
  );
}
