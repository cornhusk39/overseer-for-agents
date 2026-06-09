import Link from "next/link";
import { fetchTrends } from "../../lib/api";
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

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; range?: string }>;
}) {
  const params = await searchParams;
  const agent = params.agent;
  const range: RangeKey = isRangeKey(params.range) ? params.range : "7d";
  const sinceMs = rangeToSinceMs(range);

  let buckets: TrendBucket[] = [];
  let failed = false;
  try {
    buckets = await fetchTrends({ agent, sinceMs, bucketMs: BUCKET_FOR[range] });
  } catch {
    failed = true;
  }

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1>Trends</h1>
          <div className="sub">
            {agent ? (
              <>
                <span className="mono">{agent}</span>
                {" · "}
                <Link href="/trends" className="dim">
                  all agents
                </Link>
              </>
            ) : (
              "Cost, tokens, latency, and failure rates over time"
            )}
          </div>
        </div>
        <TimeRange basePath="/trends" current={range} agent={agent} />
      </div>

      {failed && <div className="banner-error">Could not reach the ingest API.</div>}

      {buckets.length === 0 ? (
        <div className="empty">No data in this window.</div>
      ) : (
        <TrendCharts buckets={buckets} />
      )}
    </div>
  );
}
