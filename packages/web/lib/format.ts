// Small presentation helpers shared across dashboard views. Pure functions, no
// React, so they are trivially testable and reusable. The dashboard deals in
// dollars, tokens, and milliseconds constantly, and inconsistent formatting of
// those reads as sloppy, so the formatting lives in one place.

// Format a US dollar amount. Sub-cent costs are common for a single agent run,
// so we keep enough precision to tell 0.0004 from 0.0009 rather than rounding
// both to "$0.00".
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  const decimals = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  return `$${amount.toFixed(decimals)}`;
}

// Format a token count with thousands separators.
export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) return "0";
  return Math.round(count).toLocaleString("en-US");
}

// Format a duration in milliseconds, switching to seconds once it gets long
// enough that the millisecond digits stop carrying useful information.
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}
