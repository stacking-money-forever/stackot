/**
 * Health/readiness separation (S41).
 *
 * Three different questions, three different answers:
 *   - liveness   — is the process alive? Always 200; never inspects deps.
 *   - readiness  — can the outbox accept work? Gateway reachability must NOT
 *                  factor in: a down Gateway means deliveries stall and retry,
 *                  but intake still works, and an orchestrator restarting a
 *                  healthy receiver would needlessly drop the intake queue.
 *                  S09Bb: decided by a real write probe plus the tracked
 *                  outcome of the last write, not a bare SELECT 1.
 *   - status     — operator view. Intake keeps accepting while the Gateway is
 *                  unreachable, but the report shows "degraded" with the
 *                  masked error so the stalled drain is visible instead of
 *                  silently accumulating retries and dead letters.
 *
 * State lives in process memory only; a restart resets it to "no attempt yet".
 */
import { redact } from "./redact.ts";
import type { QueueMetrics } from "./metrics.ts";
import type { OutboxHealth } from "./outbox.ts";

export type GatewayHealth = {
  /** false after a forward attempt fails; true again after the next success. */
  reachable: boolean;
  /** Masked message of the failure that marked the Gateway unreachable. */
  lastError: string | null;
  /** Epoch ms of the most recent successful forward; null before the first. */
  lastSuccessAt: number | null;
};

export type GatewayHealthRecorder = GatewayHealth & {
  recordSuccess(): void;
  recordFailure(error: string): void;
};

/**
 * In-memory Gateway reachability tracker. Starts optimistic ("no attempt yet"
 * is not "down") so /status is not degraded before the first forward attempt.
 * `recordFailure` masks the stored message again — callers already pass
 * redacted text, but the state must never hold a raw secret even if one slips
 * through an upstream path.
 */
export function createGatewayHealth(secrets: readonly string[] = []): GatewayHealthRecorder {
  const state: GatewayHealthRecorder = {
    reachable: true,
    lastError: null,
    lastSuccessAt: null,
    recordSuccess() {
      state.reachable = true;
      state.lastError = null;
      state.lastSuccessAt = Date.now();
    },
    recordFailure(error: string) {
      state.reachable = false;
      state.lastError = redact(error, secrets);
    },
  };
  return state;
}

/** Process liveness: 200 regardless of outbox or Gateway state. */
export function liveness(_outboxReady: boolean, _gateway: GatewayHealth): { status: 200; body: string } {
  return { status: 200, body: "ok" };
}

/** Intake readiness: only the outbox decides. Gateway state never fails it. */
export function readiness(outboxReady: boolean, _gateway: GatewayHealth): { status: 200 | 503; body: string } {
  return outboxReady ? { status: 200, body: "ready" } : { status: 503, body: "outbox unavailable" };
}

export type StatusReport = {
  status: "ok" | "degraded";
  outboxReady: boolean;
  /** S09Bb tracked outbox write-health; lastError is already masked. */
  outbox: OutboxHealth;
  gateway: GatewayHealth;
  /** S43 backlog snapshot; null when the stats probe itself failed. */
  queue: QueueMetrics | null;
};

/** Operator report: degraded when intake or forwarding is impaired. */
export function statusReport(
  outboxReady: boolean,
  gateway: GatewayHealth,
  queue?: QueueMetrics | null,
  outbox?: OutboxHealth,
): StatusReport {
  return {
    status: outboxReady && gateway.reachable ? "ok" : "degraded",
    outboxReady,
    outbox: outbox ?? { ok: outboxReady, lastError: null },
    gateway: {
      reachable: gateway.reachable,
      lastError: gateway.lastError,
      lastSuccessAt: gateway.lastSuccessAt,
    },
    queue: queue ?? null,
  };
}
