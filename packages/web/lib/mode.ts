// Whether the dashboard is running in read-only demo mode. Read from the
// environment so the same build serves both a live self-host instance and the
// public demo, with no ingest endpoint or keys in the latter.
export function isReadOnly(): boolean {
  return process.env.OVERSEER_READ_ONLY === "true";
}
