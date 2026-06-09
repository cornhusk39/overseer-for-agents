import { describe, it, expect, afterEach } from "vitest";
import { Store } from "./store.js";
import { generateTraffic } from "./generator.js";
import { seedDemo } from "./demo.js";
import { evaluateAlerts } from "./alert-runner.js";

const NOW = 1_700_000_000_000;

describe("generateTraffic", () => {
  const stores: Store[] = [];
  const open = () => {
    const s = new Store(":memory:");
    stores.push(s);
    return s;
  };
  afterEach(() => {
    for (const s of stores.splice(0)) s.close();
  });

  it("creates the requested number of runs across the window", () => {
    const store = open();
    const summary = generateTraffic(store, { now: NOW, days: 7, totalRuns: 60, seed: 1 });
    expect(summary.runs).toBe(60);
    expect(store.listRuns(1000)).toHaveLength(60);
    // Runs are spread across the 7-day window, not all at once.
    const starts = store.listRuns(1000).map((r) => r.startMs);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(3 * 24 * 60 * 60 * 1000);
  });

  it("is deterministic for a given seed", () => {
    const a = open();
    const b = open();
    generateTraffic(a, { now: NOW, days: 7, totalRuns: 40, seed: 99 });
    generateTraffic(b, { now: NOW, days: 7, totalRuns: 40, seed: 99 });
    const cost = (s: Store) => s.listRollups({ limit: 1000 }).reduce((n, r) => n + r.totalCostUsd, 0);
    expect(cost(a)).toBeCloseTo(cost(b), 6);
  });

  it("seeds a regression that trips the default cost alert", () => {
    const store = open();
    seedDemo(store, { now: NOW, totalRuns: 120, seed: 7 });
    // The most recent runs are the regression window, so a cost rule evaluated
    // now should fire.
    const fired = evaluateAlerts(store, { now: () => NOW });
    expect(fired.some((f) => f.rule.metric === "cost_per_run")).toBe(true);
  });
});
