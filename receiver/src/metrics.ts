/**
 * Queue backlog metrics (S43).
 *
 * The outbox can silently accumulate work: due() exposes one row and has() a
 * boolean, so nothing surfaces a growing backlog or a dead-letter pile. This
 * module turns Outbox.stats() into a stable shape for the periodic
 * `queue.metrics` stdout line and the /status report. Every field is a number
 * or null — no string ever reaches the line, so there is nothing to redact.
 */
import type { OutboxStats } from "./outbox.ts";

export type QueueMetrics = {
  pending: number;
  deadLetter: number;
  delivered: number;
  oldestPendingAgeMs: number | null;
};

/** How often server.ts emits the queue.metrics line. */
export const METRICS_INTERVAL_MS = 60_000;

/** Normalize Outbox.stats() into QueueMetrics: negative or NaN counts become 0, a missing or non-finite age becomes null. */
export function collectMetrics(stats: OutboxStats): QueueMetrics {
  const age = stats.oldestPendingAgeMs;
  return {
    pending: Number.isFinite(stats.pending) ? Math.max(0, stats.pending) : 0,
    deadLetter: Number.isFinite(stats.deadLetter) ? Math.max(0, stats.deadLetter) : 0,
    delivered: Number.isFinite(stats.delivered) ? Math.max(0, stats.delivered) : 0,
    oldestPendingAgeMs: age === null || !Number.isFinite(age) ? null : Math.max(0, age),
  };
}

/**
 * One JSON object per line. `ts` is the S43 stamp; `at` mirrors the S42
 * telemetry schema so every JSON line on stdout shares the same shape.
 */
export function toLogLine(metrics: QueueMetrics): string {
  const now = Date.now();
  return JSON.stringify({ ts: now, at: now, event: "queue.metrics", ...metrics });
}
