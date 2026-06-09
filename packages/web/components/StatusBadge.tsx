import type { RunStatus } from "@overseer/schema";

// A small status pill used in the runs list and run header. Pure and shared so
// the three run states always read the same color and label everywhere.
export function StatusBadge({ status }: { status: RunStatus }) {
  const label = status === "ok" ? "ok" : status === "error" ? "error" : "running";
  return (
    <span className={`badge ${status}`}>
      <span className="dot" />
      {label}
    </span>
  );
}
