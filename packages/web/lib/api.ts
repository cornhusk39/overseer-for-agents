// Server-side data access for the dashboard. Every page is a server component
// that calls these helpers, which fetch from the ingest REST API. Reads are
// uncached so the live runs view actually reflects what just happened.
//
// The base URL comes from config. A request that fails (the ingest service is
// down, say) throws, and pages catch it to show an empty or error state rather
// than crashing the whole dashboard.

import type { Agent, Run, Span, RunRollup } from "@overseer/schema";
import type { RunListItem, TrendBucket } from "./types";

export function apiBaseUrl(): string {
  return process.env.OVERSEER_API_BASE_URL ?? "http://127.0.0.1:4318";
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${apiBaseUrl()}${path}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`ingest API ${path} responded ${res.status}`);
  }
  return (await res.json()) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export async function fetchAgents(): Promise<Agent[]> {
  const { agents } = await get<{ agents: Agent[] }>("/api/agents");
  return agents;
}

export async function fetchRuns(params: { agent?: string; sinceMs?: number; limit?: number } = {}): Promise<
  RunListItem[]
> {
  const { runs } = await get<{ runs: RunListItem[] }>(
    `/api/runs${query({ agent: params.agent, sinceMs: params.sinceMs, limit: params.limit })}`,
  );
  return runs;
}

export interface RunDetail {
  run: Run;
  rollup: RunRollup | null;
  spans: Span[];
}

export async function fetchRun(id: string): Promise<RunDetail | null> {
  try {
    return await get<RunDetail>(`/api/runs/${encodeURIComponent(id)}`);
  } catch {
    // A 404 (or any read failure) surfaces as "not found" to the page.
    return null;
  }
}

export async function fetchTrends(
  params: { agent?: string; sinceMs?: number; bucketMs?: number } = {},
): Promise<TrendBucket[]> {
  const { buckets } = await get<{ buckets: TrendBucket[] }>(
    `/api/trends${query({ agent: params.agent, sinceMs: params.sinceMs, bucketMs: params.bucketMs })}`,
  );
  return buckets;
}
