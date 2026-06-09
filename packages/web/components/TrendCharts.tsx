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
  if (count <= 1) return PAD;
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

function Line({ values, max, color }: { values: number[]; max: number; color: string }) {
  if (values.length === 0) return null;
  const points = values.map((v, i) => `${xFor(i, values.length)},${yFor(v, max)}`).join(" ");
  return <polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />;
}

function ChartCard({
  title,
  subtitle,
  children,
  legend,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  legend?: ReactNode;
}) {
  return (
    <div className="card card-pad">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 14 }}>{title}</h3>
        <span className="sub num">{subtitle}</span>
      </div>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line className="chart-axis" x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} />
        {children}
      </svg>
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

  const maxLatency = Math.max(1, ...p95);
  // Rates share a 0..1 axis, with a little headroom so a 100% point is visible.
  const maxRate = Math.max(0.05, ...errorRate, ...toolFail) * 1.1;

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  return (
    <div className="grid grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
      <ChartCard title="Cost per bucket" subtitle={formatUsd(sum(cost))}>
        <Bars values={cost} max={Math.max(0.000001, ...cost)} />
      </ChartCard>

      <ChartCard title="Tokens per bucket" subtitle={formatTokens(sum(tokens))}>
        <Bars values={tokens} max={Math.max(1, ...tokens)} />
      </ChartCard>

      <ChartCard
        title="Latency"
        subtitle={`p95 ${formatDuration(maxLatency)}`}
        legend={
          <div className="legend">
            <span>
              <i style={{ background: "#5eead4" }} /> p50
            </span>
            <span>
              <i style={{ background: "#60a5fa" }} /> p95
            </span>
          </div>
        }
      >
        <Line values={p50} max={maxLatency} color="#5eead4" />
        <Line values={p95} max={maxLatency} color="#60a5fa" />
      </ChartCard>

      <ChartCard
        title="Error & tool-failure rate"
        subtitle={`peak ${formatPercent(Math.max(0, ...errorRate, ...toolFail))}`}
        legend={
          <div className="legend">
            <span>
              <i style={{ background: "#f87171" }} /> errors
            </span>
            <span>
              <i style={{ background: "#c084fc" }} /> tool failures
            </span>
          </div>
        }
      >
        <Line values={errorRate} max={maxRate} color="#f87171" />
        <Line values={toolFail} max={maxRate} color="#c084fc" />
      </ChartCard>
    </div>
  );
}
