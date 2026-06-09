// Small presentation helpers shared across dashboard views. Pure functions, no
// React, so they are trivially testable and reusable. The dashboard deals in
// dollars, tokens, and milliseconds constantly, and inconsistent formatting of
// those reads as sloppy, so the formatting lives in one place.

// Format a US dollar amount. Sub-cent costs are common for a single agent run,
// so we keep enough precision to tell 0.0004 from 0.0009 rather than rounding
// both to "$0.00". Large totals get thousands separators so they scan the same
// way the token counts next to them do.
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return "$0.00";
  const decimals = amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2;
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

// Format a token count with thousands separators.
export function formatTokens(count: number): string {
  if (!Number.isFinite(count)) return "0";
  return Math.round(count).toLocaleString("en-US");
}

// Format a duration in milliseconds, escalating units as it grows so a
// three-hour agent run reads "3.0 h" rather than "10800.00 s".
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} m`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

// Format a 0..1 fraction as a percentage. Whole numbers drop the decimal so a
// clean 0% or 100% does not read as "0.0%".
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "0%";
  const pct = fraction * 100;
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

// A compact relative time like "3m ago" or "2h ago", with an absolute fallback
// once something is more than a week old. nowMs is injectable for testing.
export function formatRelativeTime(ms: number, nowMs: number = Date.now()): string {
  const diff = nowMs - ms;
  if (!Number.isFinite(diff)) return "";
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}
