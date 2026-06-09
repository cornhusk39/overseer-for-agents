import Link from "next/link";

// The set of time windows the runs and trends views can filter by. "all" drops
// the time bound entirely.
export const RANGES = [
  { key: "1h", label: "1h" },
  { key: "24h", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "all", label: "All" },
] as const;

export type RangeKey = (typeof RANGES)[number]["key"];

const RANGE_MS: Record<Exclude<RangeKey, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
};

export function isRangeKey(value: string | undefined): value is RangeKey {
  return value === "1h" || value === "24h" || value === "7d" || value === "all";
}

// Translate a range key into a "since" timestamp, or undefined for "all".
export function rangeToSinceMs(range: RangeKey, nowMs: number = Date.now()): number | undefined {
  if (range === "all") return undefined;
  return nowMs - RANGE_MS[range];
}

// Filter pills that link to the same page with a different range, preserving any
// agent filter already in the query.
export function TimeRange({
  basePath,
  current,
  agent,
}: {
  basePath: string;
  current: RangeKey;
  agent?: string;
}) {
  return (
    <div className="filters">
      {RANGES.map((r) => {
        const params = new URLSearchParams();
        params.set("range", r.key);
        if (agent) params.set("agent", agent);
        return (
          <Link
            key={r.key}
            href={`${basePath}?${params.toString()}`}
            className={r.key === current ? "active" : ""}
          >
            {r.label}
          </Link>
        );
      })}
    </div>
  );
}
