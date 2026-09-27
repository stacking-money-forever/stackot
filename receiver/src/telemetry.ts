/**
 * Structured lifecycle telemetry (S42).
 *
 * One delivery's lifecycle — attempt, failure, retry, success, dead-letter —
 * and routing fallbacks are emitted as machine-readable JSON lines so they can
 * be correlated by `deliveryId`. Every string field passes through the S39
 * redaction list, and the schema is a fixed whitelist: event bodies
 * (summary/body text) can never reach a line even if a caller passes them.
 */
import { redact } from "./redact.ts";

export type TelemetryEvent = "delivery.delivered" | "delivery.failed" | "delivery.dead_letter" | "routing.fallback";

export type Telemetry = {
  /** A delivery reached the Gateway. `attempts` = prior failed attempts. */
  delivered(input: { deliveryId: string; attempts: number; target: string }): void;
  /** An attempt failed and a retry was scheduled (`nextAttemptAt`, epoch ms). */
  failed(input: { deliveryId: string; attempts: number; error: string; nextAttemptAt: number }): void;
  /** An attempt failed at the retry cap; the row is now dead-lettered. */
  deadLettered(input: { deliveryId: string; attempts: number; error: string }): void;
  /** Routing fell back to the admin or #ci-alerts channel (`reason` names why). */
  routingFallback(input: { deliveryId: string; repo: string; item: string; reason: string }): void;
};

/**
 * Build a telemetry emitter that writes one JSON object per line to `sink`.
 *
 * `secrets` is the redactSecrets(cfg) list; every emitted string field is
 * masked with it so a credential embedded in an error or target cannot leak.
 */
export function createTelemetry(sink: (line: string) => void, secrets: readonly string[]): Telemetry {
  const mask = (value: string): string => redact(value, secrets);
  const emit = (event: TelemetryEvent, fields: Record<string, string | number>): void => {
    sink(JSON.stringify({ event, at: Date.now(), ...fields }));
  };
  return {
    delivered: ({ deliveryId, attempts, target }) =>
      emit("delivery.delivered", { deliveryId: mask(deliveryId), attempts, target: mask(target) }),
    failed: ({ deliveryId, attempts, error, nextAttemptAt }) =>
      emit("delivery.failed", { deliveryId: mask(deliveryId), attempts, error: mask(error), nextAttemptAt }),
    deadLettered: ({ deliveryId, attempts, error }) =>
      emit("delivery.dead_letter", { deliveryId: mask(deliveryId), attempts, error: mask(error) }),
    routingFallback: ({ deliveryId, repo, item, reason }) =>
      emit("routing.fallback", { deliveryId: mask(deliveryId), repo: mask(repo), item: mask(item), reason: mask(reason) }),
  };
}
