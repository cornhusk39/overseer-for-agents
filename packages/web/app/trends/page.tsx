import Link from "next/link";
import { fetchTrends, fetchAgents } from "../../lib/api";
import type { TrendBucket } from "../../lib/types";
import { TrendCharts } from "../../components/TrendCharts";
import { TimeRange, isRangeKey, rangeToSinceMs, type RangeKey } from "../../components/TimeRange";

export const dynamic = "force-dynamic";

// Bucket width scales with the window so each chart shows a readable number of
// points rather than thousands of slivers or a single bar.
const BUCKET_FOR: Record<RangeKey, number> = {
  "1h": 5 * 60 * 1000,
  "24h": 60 * 60 * 1000,
  "7d": 6 * 60 * 60 * 1000,
  all: 24 * 60 * 60 * 1000,
};

// Next delivers a repeated query param as an array; the views only ever want
// one value, so take the first.
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string | string[]; range?: string | string[] }>;
}) {
  const params = await searchParams;
  const agent = first(params.agent);
  const rangeParam = first(params.range);
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : "7d";
  const sinceMs = rangeToSinceMs(range);

  let buckets: TrendBucket[] = [];
  let agentNames: string[] = [];
  let failed = false;
  try {
    const [trendBuckets, agents] = await Promise.all([
      fetchTrends({ agent, sinceMs, bucketMs: BUCKET_FOR[range] }),
      fetchAgents(),
    ]);
    buckets = trendBuckets;
    agentNames = agents.map((a) => a.name);
  } catch {
    failed = true;
  }

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Trends</h1>
          <div className="sub">Cost, tokens, latency, and failure rates over time</div>
        </div>
        <TimeRange basePath="/trends" current={range} agent={agent} />
      </div>

      {failed && <div className="banner-error">Could not reach the ingest API.</div>}

      {/* Scope the charts to one agent. Mirrors the time-range pills so the two
          filters compose through the same URL params. */}
      {!failed && agentNames.length > 1 && (
        <div className="filters" style={{ marginBottom: 18 }}>
          <Link href={`/trends?range=${range}`} className={agent ? "" : "active"}>
            All agents
          </Link>
          {agentNames.map((name) => (
            <Link
              key={name}
              href={`/trends?range=${range}&agent=${encodeURIComponent(name)}`}
              className={agent === name ? "active" : ""}
            >
              {name}
            </Link>
          ))}
        </div>
      )}

      {!failed &&
        (buckets.length === 0 ? (
          <div className="empty">No data in this window.</div>
        ) : (
          <TrendCharts buckets={buckets} />
        ))}
    </div>
  );
}
